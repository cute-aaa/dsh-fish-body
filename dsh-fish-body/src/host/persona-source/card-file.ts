/**
 * 卡片文件来源工厂：把「某个目录下的人格产物」包成一个人格来源。
 *
 * 认三种布局，**同一份规则只在这里**：
 * 1. `<目录>/persona.json` —— 单卡（SillyTavern v2，含 PNG 卡的 `tEXt chara`）；
 * 2. `<目录>/personas/*.{json,png,md}` —— 一文件一角色（多角色池）；
 * 3. `<目录>/*.md` —— Markdown 人格文档族：一份就是单角色，多份（`SOUL.md`/`IDENTITY.md`/
 *    `AGENTS.md` 那类五件套）**合并成一个角色**，按文件名给每份定语义（见 ./markdown-card）。
 *    顶层有 `persona.json` 时不再看顶层 md（两者都是「单角色」语义，同时生效会有两个身份）。
 *
 * fish-soul / dsh-soul / dsh-rofm / dsh-suzu-memory / 自定义路径都只是这一个工厂的不同参数，
 * 扫卡规则因此只有一份：改目录约定就只改这里，不牵动角色库、路由与设置页。
 *
 * 只读盘、不写盘、不抛；一次扫描的产出全部是投影后的正文（可直接进 whisperPrompt）。
 * @module dsh-fish-body/src/host/persona-source/card-file
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fingerprintOf } from '../persona/characters/ids.ts';
import { isNotPersonaDoc, markdownCardOf, markdownCardOfOne, type MarkdownDoc } from './markdown-card.ts';
import { parseCardBytes, projectCard, readCardFile } from './card-reader.ts';
import type {
  PersonaScanResult,
  PersonaScannedCharacter,
  PersonaScanSkip,
  PersonaSource,
  PersonaSourceAvailability,
  PersonaSourceKind,
  PersonaSourceOptions,
} from './types.ts';

/** 单卡文件名（fish-soul 已实证的形态）。 */
const SINGLE_CARD = 'persona.json';
/** 多角色目录（**未实证的目录约定**：一个文件一个角色）。 */
const MULTI_CARD_DIR = 'personas';
/** 单个卡片文件的上限：超过就不读，进 `skipped/too-large`（读整份 100 MB 的图只会拖死扫描）。 */
const MAX_CARD_BYTES = 1024 * 1024;

/** 卡片文件允许的扩展名（小写）：角色卡两种 + Markdown 人格文档。 */
const CARD_EXTS = ['.json', '.png', '.md'];

/** 工厂参数。 */
export interface CardFileSourceSpec {
  /** 唯一标识（注册表按它去重，也进角色记录的 source.id）。 */
  readonly id: string;
  /** 展示名。 */
  readonly name: string;
  /** 约定目录（绝对路径）；缺省 = `<dshHome>/<id>`。 */
  readonly dir?: string;
  /** DSH 数据根：只在没给 `dir` 时用来拼约定目录。 */
  readonly dshHome?: string;
  /** 来源形态，缺省 'soul-card'。 */
  readonly kind?: PersonaSourceKind;
}

/** 一个路径是文件、目录还是不存在（不抛）。 */
function kindOf(path: string): 'file' | 'dir' | undefined {
  try {
    const stat = statSync(path);
    return stat.isFile() ? 'file' : stat.isDirectory() ? 'dir' : undefined;
  } catch {
    return undefined;
  }
}

/** 列目录里符合卡片扩展名的文件名（不含目录、不含点开头的隐藏文件，排序稳定）。 */
function cardFilesIn(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const lower = name.toLowerCase();
    if (!CARD_EXTS.some((ext) => lower.endsWith(ext))) continue;
    if (kindOf(join(dir, name)) !== 'file') continue;
    out.push(name);
  }
  return out.sort();
}

/** 读一个卡片文件（带大小闸门）；成功给角色，失败给 skipped 条目。 */
async function readOne(path: string): Promise<{ character: PersonaScannedCharacter } | { skip: PersonaScanSkip }> {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return { skip: { path, reason: 'invalid-card' } };
  }
  if (size > MAX_CARD_BYTES) return { skip: { path, reason: 'too-large' } };
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch {
    return { skip: { path, reason: 'invalid-card' } };
  }
  // 按扩展名分派：`.md` 走 Markdown 归一路径，其余（json / png）走角色卡解码。
  // 不按内容嗅探——文件名已经是作者给的声明，嗅探只会在两者都像的时候给出更难解释的结论。
  const isMarkdown = path.toLowerCase().endsWith('.md');
  const data = isMarkdown ? markdownCardOfOne(basename(path), new TextDecoder().decode(bytes)) : parseCardBytes(bytes);
  if (!data) return { skip: { path, reason: 'invalid-card' } };
  const text = projectCard(data);
  if (text === '') return { skip: { path, reason: 'empty' } };
  return { character: { name: data.name, text, path, data } };
}

/** 顶层可当人格的 Markdown 文档（排除 README 那类项目文档，排序稳定）。 */
function markdownDocsIn(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .filter((name) => !name.startsWith('.'))
    .filter((name) => !isNotPersonaDoc(name))
    .filter((name) => kindOf(join(dir, name)) === 'file')
    .sort();
}

/**
 * 扫一个目录：先 `persona.json`；没有单卡时看顶层 Markdown（多份合并成一个角色）；
 * 再 `personas/*.{json,png,md}`；按正文指纹去重。
 *
 * @param dir - 约定目录（绝对路径）。
 * @returns 角色与被跳过的文件；目录不存在时两者皆空。
 */
async function scanDir(dir: string): Promise<PersonaScanResult> {
  const characters: PersonaScannedCharacter[] = [];
  const skipped: PersonaScanSkip[] = [];

  const accept = (result: Awaited<ReturnType<typeof readOne>>): void => {
    if ('skip' in result) {
      skipped.push(result.skip);
      return;
    }
    const fingerprint = fingerprintOf(result.character.text);
    if (seen.has(fingerprint)) {
      // 同内容不同文件：只留第一个，其余按「没有新正文」记一条（前端逐条展示，不静默丢）。
      skipped.push({ path: result.character.path, reason: 'empty' });
      return;
    }
    seen.add(fingerprint);
    characters.push(result.character);
  };
  const seen = new Set<string>();

  const single = join(dir, SINGLE_CARD);
  const hasSingle = kindOf(single) === 'file';
  if (hasSingle) accept(await readOne(single));

  // 顶层 Markdown：单份 = 单角色；多份 = 合并成一个角色（五件套那种形态）。
  // 有 persona.json 时跳过——两者都是「单角色」语义，同时生效会让模型收到两个身份。
  if (!hasSingle) {
    const docs = markdownDocsIn(dir);
    if (docs.length > 0) {
      const loaded: MarkdownDoc[] = [];
      for (const name of docs) {
        const path = join(dir, name);
        let size: number;
        try {
          size = statSync(path).size;
        } catch {
          skipped.push({ path, reason: 'invalid-card' });
          continue;
        }
        if (size > MAX_CARD_BYTES) {
          skipped.push({ path, reason: 'too-large' });
          continue;
        }
        try {
          loaded.push({ name, text: await readFile(path, 'utf8') });
        } catch {
          skipped.push({ path, reason: 'invalid-card' });
        }
      }
      if (loaded.length > 0) {
        const card = markdownCardOf(loaded);
        const text = projectCard(card);
        // 来源记目录而不是某一份文件：这一角色由多份合成，指着一份说「来自这里」是错的。
        if (text === '') skipped.push({ path: dir, reason: 'empty' });
        else characters.push({ name: card.name, text, path: dir, data: card });
      }
    }
  }

  const multiDir = join(dir, MULTI_CARD_DIR);
  if (kindOf(multiDir) === 'dir') {
    for (const name of cardFilesIn(multiDir)) accept(await readOne(join(multiDir, name)));
  }
  return { characters, skipped };
}

/**
 * 造一个卡片文件来源。
 *
 * `scan(options)` 给了 `options.path` 时**只**扫该路径：文件 = 1 个角色，目录 = 按约定规则扫一层；
 * 路径不存在时两者皆空（由调用方按 `probe` 回 not-found）。
 *
 * @param spec - id / 展示名 / 约定目录（或 dshHome + id）。
 * @returns 人格来源；`resolve()` 仍按约定目录里的单卡读取（老协议，签名不变）。
 * @throws {TypeError} 既没有目录也算不出约定目录时。
 */
export function createCardFileSource(spec: CardFileSourceSpec): PersonaSource {
  const dir = spec.dir ?? (spec.dshHome ? join(spec.dshHome, spec.id) : '');
  if (dir === '') throw new TypeError('createCardFileSource 需要 dir 或 dshHome');
  const expected = join(dir, SINGLE_CARD);

  const probe = async (options?: PersonaSourceOptions): Promise<PersonaSourceAvailability> => {
    const explicit = (options?.path ?? '').trim();
    if (explicit !== '') return { installed: existsSync(explicit), path: explicit };
    const installed =
      kindOf(expected) === 'file' || kindOf(join(dir, MULTI_CARD_DIR)) === 'dir' || markdownDocsIn(dir).length > 0;
    return { installed, path: expected };
  };

  const scan = async (options?: PersonaSourceOptions): Promise<PersonaScanResult> => {
    const explicit = (options?.path ?? '').trim();
    if (explicit === '') return scanDir(dir);
    const kind = kindOf(explicit);
    if (kind === 'file') {
      const result = await readOne(explicit);
      return 'skip' in result
        ? { characters: [], skipped: [result.skip] }
        : { characters: [result.character], skipped: [] };
    }
    if (kind === 'dir') return scanDir(explicit);
    return { characters: [], skipped: [] };
  };

  return {
    id: spec.id,
    name: spec.name,
    kind: spec.kind ?? 'soul-card',
    watchPath: expected,
    scan,
    probe,
    resolve: () => readCardFile(expected),
  };
}
