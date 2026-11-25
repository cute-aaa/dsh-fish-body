/**
 * 外部记忆目录：把 rofm / suzu 这类「记忆插件」的产物读成一段长期记忆，交给对话前的召回钩子。
 *
 * 为什么不做新的记忆契约：契约已经有了——`src/host/chat-memory-provider.ts` 的
 * `ChatMemoryProvider`（`recall` / `capture` 两钩子，单槽，后注册覆盖）。再立一个 `MemorySource`
 * 只会变成两套并行的记忆系统，而单槽设计的本意就是「同时只有一个后端在改内容」。
 * 这里补的是**读写层**：把别人写在磁盘上的记忆文件读成 `ChatTurn` 之外的「长期记忆段」。
 *
 * 三条不猜的原则：
 * 1. 只认 `.md` / `.txt` / 结构像记忆的 `.json`（数组，或对象里有 `messages`/`entries`/`memories` 数组）；
 *    目录里混着的设置文件（`settings.json`）**跳过而不是报错**——它本来就不该被当记忆。
 * 2. 时间只从文件名（`2026-11-25.md` / `20261125.md`）或 JSON 里的 `ts`/`at` 取，取不到用文件 mtime；
 *    不从正文里猜日期。
 * 3. 注入时**带边界声明**：这是「过去发生的事」，可能过时；与当前对话冲突时以当前为准。
 *    没有这句，模型会把旧记忆当现状陈述。
 * @module dsh-fish-body/src/host/memory/external
 */
import { readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatMemoryProvider } from '../chat-memory-provider.ts';

/** 认作记忆的扩展名（小写）。 */
const MEMORY_EXTS = ['.md', '.txt', '.json'];

/** 单个记忆文件的上限：超过就不读（读一份几十 MB 的导出只会拖死对话）。 */
const MAX_FILE_BYTES = 512 * 1024;

/** 默认取最近多少条。 */
const DEFAULT_MAX_ENTRIES = 20;

/** 默认注入 system 的字数预算（中文按字符算；超了从最旧的开始丢）。 */
const DEFAULT_MAX_CHARS = 1200;

/** 目录扫描深度：目录本身 + 一层子目录（`memory/2026-11.md` 这种就够）。 */
const SCAN_DEPTH = 2;

/** JSON 里被当成「记忆条目」的字段名。 */
const NOTE_ARRAY_FIELDS = ['messages', 'entries', 'memories', 'notes'] as const;

/** 一条记忆。 */
export interface MemoryNote {
  /** 来源文件（排障用）。 */
  readonly path: string;
  /** 发生时刻（毫秒时间戳）；认不出时用文件 mtime。 */
  readonly at: number;
  /** 正文（已 trim）。 */
  readonly text: string;
}

/** 读不出来但值得说明的文件。 */
export interface MemorySkip {
  readonly path: string;
  readonly reason: 'too-large' | 'unreadable';
}

/** 一次读取的结果。 */
export interface MemoryReadResult {
  readonly notes: readonly MemoryNote[];
  readonly skipped: readonly MemorySkip[];
}

/** provider 的配置。 */
export interface ExternalMemoryOptions {
  /** 注册用的 id（进日志，也用于排障「为什么没走我这份」）。 */
  readonly id: string;
  /** 记忆目录（绝对路径）。不存在按「没有记忆」处理，不抛。 */
  readonly dir: string;
  /** 取最近多少条，缺省 {@link DEFAULT_MAX_ENTRIES}。 */
  readonly maxEntries?: number;
  /** 注入 system 的字数预算，缺省 {@link DEFAULT_MAX_CHARS}。 */
  readonly maxChars?: number;
}

/** 文件名里的日期：`2026-11-25` 或 `20261125`。 */
const DATE_DASH = /(\d{4})-(\d{2})-(\d{2})/;
const DATE_COMPACT = /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/;

/**
 * 从文件名里认日期（本地时区当天零点）。
 * @param name - 文件名（可含路径）。
 * @returns 毫秒时间戳；认不出为 undefined。
 */
export function dateOfName(name: string): number | undefined {
  const dash = DATE_DASH.exec(name);
  if (dash) {
    const at = new Date(Number(dash[1]), Number(dash[2]) - 1, Number(dash[3])).getTime();
    if (Number.isFinite(at)) return at;
  }
  const compact = DATE_COMPACT.exec(name);
  if (compact) {
    const at = new Date(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3])).getTime();
    if (Number.isFinite(at)) return at;
  }
  return undefined;
}

/** 列目录（深度受限、跳过点开头的隐藏项与常见的项目文档）。 */
function listFiles(dir: string, depth: number, out: string[]): void {
  if (depth <= 0) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const path = join(dir, name);
    let isDir: boolean;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      listFiles(path, depth - 1, out);
      continue;
    }
    if (MEMORY_EXTS.some((ext) => name.toLowerCase().endsWith(ext))) out.push(path);
  }
}

/** JSON 里的条目 → 文本（只认有内容的字符串字段，其余丢掉）。 */
function textOfJsonItem(item: unknown): string | undefined {
  if (typeof item === 'string') {
    const text = item.trim();
    return text === '' ? undefined : text;
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const record = item as Record<string, unknown>;
  for (const key of ['text', 'content', 'summary', 'memory', 'note']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}

/** JSON 条目里的时间戳（`ts` / `at` / `time` / `timestamp`，数字或可解析字符串）。 */
function atOfJsonItem(item: unknown): number | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const record = item as Record<string, unknown>;
  for (const key of ['ts', 'at', 'time', 'timestamp']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = new Date(value).getTime();
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

/**
 * 把一个文件读成记忆条目。
 *
 * `.md` / `.txt` 整份算一条；`.json` 只认数组或含 `messages`/`entries`/… 数组的对象，
 * 逐条转成一条（时间取条目自己的 `ts`，没有就继承文件时间）。
 *
 * @param path - 绝对路径。
 * @param fallbackAt - 文件时间（文件名日期或 mtime）。
 * @returns 条目列表；文件不像记忆时为空数组。
 */
async function notesOfFile(path: string, fallbackAt: number): Promise<MemoryNote[]> {
  const raw = await readFile(path, 'utf8');
  if (!path.toLowerCase().endsWith('.json')) {
    const text = raw.trim();
    return text === '' ? [] : [{ path, at: fallbackAt, text }];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : (() => {
        if (!parsed || typeof parsed !== 'object') return [];
        const record = parsed as Record<string, unknown>;
        for (const field of NOTE_ARRAY_FIELDS) {
          const value = record[field];
          if (Array.isArray(value)) return value;
        }
        return [];
      })();
  if (list.length === 0) return [];
  const out: MemoryNote[] = [];
  for (const item of list) {
    const text = textOfJsonItem(item);
    if (text === undefined) continue;
    out.push({ path, at: atOfJsonItem(item) ?? fallbackAt, text });
  }
  return out;
}

/**
 * 读一个目录下的全部记忆，按时间升序（旧 → 新）。
 *
 * @param dir - 记忆目录；不存在时返回空结果（不是错误）。
 * @returns 记忆与被跳过的文件。
 */
export async function readMemoryNotes(dir: string): Promise<MemoryReadResult> {
  const files: string[] = [];
  listFiles(dir, SCAN_DEPTH, files);
  const notes: MemoryNote[] = [];
  const skipped: MemorySkip[] = [];
  for (const path of files) {
    let mtime: number;
    let size: number;
    try {
      const stat = statSync(path);
      mtime = stat.mtimeMs;
      size = stat.size;
    } catch {
      skipped.push({ path, reason: 'unreadable' });
      continue;
    }
    if (size > MAX_FILE_BYTES) {
      skipped.push({ path, reason: 'too-large' });
      continue;
    }
    const at = dateOfName(path) ?? mtime;
    try {
      notes.push(...(await notesOfFile(path, at)));
    } catch {
      skipped.push({ path, reason: 'unreadable' });
    }
  }
  notes.sort((a, b) => a.at - b.at);
  return { notes, skipped };
}

/** 时间戳 → `YYYY-MM-DD`。 */
function dayOf(at: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

/**
 * 把记忆拼成一段可直接接在 system 末尾的文本。
 *
 * 从**最新**的记忆往前累积，超出字数预算就停——旧事被丢比现状被丢更安全。
 * 整段带边界声明：这些是过去的事、可能过时、与当前对话冲突时以当前为准。
 *
 * @param notes - 已按时间升序排好的记忆。
 * @param maxChars - 字数预算。
 * @returns 拼好的段落；没有记忆时为空串。
 */
export function memoryPromptOf(notes: readonly MemoryNote[], maxChars: number = DEFAULT_MAX_CHARS): string {
  const kept: string[] = [];
  let used = 0;
  for (let i = notes.length - 1; i >= 0; i -= 1) {
    const note = notes[i];
    if (note === undefined) continue;
    const day = dayOf(note.at);
    const line = (day === '' ? '' : day + '：') + note.text.replace(/\s+/g, ' ').trim();
    if (line === '') continue;
    if (used + line.length > maxChars && kept.length > 0) break;
    kept.unshift(line);
    used += line.length;
  }
  if (kept.length === 0) return '';
  return (
    '【长期记忆】以下是从记忆库读到的旧事，按时间从早到晚排列。它们**可能已经过时**；' +
    '与当前对话或【当下】冲突时，以当前为准，不要拿旧记忆当现状复述。\n' +
    kept.map((line) => '- ' + line).join('\n')
  );
}

/** 带缓存的 provider：同一份目录在一次对话里只读一遍盘。 */
export interface ExternalMemoryProvider extends ChatMemoryProvider {
  /** 丢掉缓存（记忆文件被外部写过之后调用）。 */
  invalidate(): void;
}

/** 缓存有效期：记忆文件通常不会在同一秒内变化，但也不能永久缓存。 */
const CACHE_TTL_MS = 30_000;

/**
 * 造一个「外部记忆目录」provider。
 *
 * `recall` 做得很少：把记忆段**追加**到 system 末尾（不改人设、不动历史、不动本轮问题）——
 * 记忆是补充信息，不是人设，替换 system 会让 soul 侧的定义失效。
 *
 * @param options - id / 目录 / 条数与字数上限。
 * @returns provider；目录不存在时 `recall` 返回 undefined（等同不介入）。
 */
export function createExternalMemoryProvider(options: ExternalMemoryOptions): ExternalMemoryProvider {
  const { id, dir } = options;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  let cachedAt = 0;
  let cached = '';

  const memoryBlock = async (): Promise<string> => {
    const now = Date.now();
    if (cached !== '' && now - cachedAt < CACHE_TTL_MS) return cached;
    const { notes } = await readMemoryNotes(dir);
    const recent = notes.slice(-maxEntries);
    const block = memoryPromptOf(recent, maxChars);
    cached = block;
    cachedAt = now;
    return block;
  };

  return {
    id,
    invalidate: () => {
      cached = '';
      cachedAt = 0;
    },
    recall: async (input) => {
      const block = await memoryBlock();
      if (block === '') return undefined;
      return { system: input.system === '' ? block : input.system + '\n' + block };
    },
  };
}
