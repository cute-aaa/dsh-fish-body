/**
 * surfcore 的人格来源：它的角色目录带**自述路径**，所以不用猜文件名。
 *
 * 真实布局（本机实测 v0.8.9）：
 *   `<DSH_HOME>/surfcore/characters/current.json`        → `{ id, name, dir, switchedAt }`
 *   `<dir>/character.json`                               → `{ persona: "persona.md", memory, bili, personaMeta }`
 *   `<dir>/persona.md`                                   → Markdown，`# 名字` + `- 性格 / - 说话风格 / …`
 *
 * 关键点：`character.json` 里的 `persona` 字段就是**文件自述**（与 Soul Spec 的 `files.*` 同一手法），
 * 所以这里先读元数据再读它指的那份——不靠「目录里有没有 persona.md」这种猜测，改名也不会失准。
 *
 * 只读：不写它的目录、不改它的 `current.json`。`purpose-outreach.json`（`drives` / `nextFireAt`）
 * 是它自己的主动开口引擎，属于「灵魂侧的调度」，本插件不读也不接管。
 * @module dsh-fish-body/src/host/persona-source/surfcore-source
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownCardOfOne, readMarkdownPersona } from './markdown-card.ts';
import type { PersonaResolution, PersonaScanResult, PersonaSource, PersonaSourceAvailability } from './types.ts';

/** 默认的展示名与 id（注册表按 id 去重）。 */
const SOURCE_ID = 'surfcore';
const SOURCE_NAME = 'surfcore';

/** 没写 `persona` 字段时的兜底文件名（它的默认值）。 */
const DEFAULT_PERSONA_FILE = 'persona.md';

/** 一份解析出来的角色位置。 */
interface CharacterFiles {
  /** 角色目录（绝对路径）。 */
  readonly dir: string;
  /** 人设文件（绝对路径）。 */
  readonly file: string;
  /** `character.json` 里声明的显示名；没有时为空串。 */
  readonly name: string;
}

/** 读一个 JSON 文件；不存在或坏掉返回 undefined（不抛）。 */
function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** 当前角色目录的绝对位置：优先 `current.json` 的 `dir`，其次按 id 拼。 */
function currentCharDir(charactersDir: string): string | undefined {
  const current: unknown = readJson(join(charactersDir, 'current.json'));
  if (!current || typeof current !== 'object') return undefined;
  const record = current as Record<string, unknown>;
  const explicit = typeof record.dir === 'string' ? record.dir.trim() : '';
  if (explicit !== '' && existsSync(explicit)) return explicit;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (id === '') return undefined;
  const byId = join(charactersDir, id);
  return existsSync(byId) ? byId : undefined;
}

/**
 * 找到当前角色的人设文件。
 *
 * @param charactersDir - `<DSH_HOME>/surfcore/characters`。
 * @returns 角色目录 / 人设文件 / 声明名；任一步缺失返回 undefined。
 */
function characterFilesOf(charactersDir: string): CharacterFiles | undefined {
  const dir = currentCharDir(charactersDir);
  if (dir === undefined) return undefined;
  const meta: unknown = readJson(join(dir, 'character.json'));
  const record = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};
  const declared = typeof record.persona === 'string' && record.persona.trim() !== '' ? record.persona.trim() : '';
  const file = join(dir, declared === '' ? DEFAULT_PERSONA_FILE : declared);
  if (!existsSync(file)) return undefined;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  return { dir, file, name };
}

/** 造一个 surfcore 人格来源。 */
export function createSurfcoreSource(options: {
  readonly dshHome: string;
  readonly id?: string;
  readonly name?: string;
}): PersonaSource {
  const charactersDir = join(options.dshHome, 'surfcore', 'characters');

  const probe = async (): Promise<PersonaSourceAvailability> => {
    const files = characterFilesOf(charactersDir);
    return { installed: files !== undefined, path: files?.file ?? join(charactersDir, 'current.json') };
  };

  const scan = async (): Promise<PersonaScanResult> => {
    const files = characterFilesOf(charactersDir);
    if (files === undefined) return { characters: [], skipped: [] };
    let text: string;
    try {
      text = readFileSync(files.file, 'utf8');
    } catch {
      return { characters: [], skipped: [{ path: files.file, reason: 'invalid-card' }] };
    }
    const card = markdownCardOfOne(files.file.replace(/\\/g, '/').split('/').pop() ?? DEFAULT_PERSONA_FILE, text);
    // 名字优先用 `character.json` 的 `name`（那是用户在它自己的界面里起的名字），
    // 没有才用 Markdown 推断——两条都取不到时按空串交给 id 兜底。
    const name = files.name !== '' ? files.name : card.name;
    if (card.description.trim() === '') {
      return { characters: [], skipped: [{ path: files.file, reason: 'empty' }] };
    }
    return { characters: [{ name, text: card.description, path: files.file, data: card }], skipped: [] };
  };

  return {
    id: options.id ?? SOURCE_ID,
    name: options.name ?? SOURCE_NAME,
    kind: 'soul-card',
    watchPath: join(charactersDir, 'current.json'),
    probe,
    scan,
    // resolve 走同一份投影：文件位置由 character.json 自述，所以每次现读一次元数据
    resolve: async (): Promise<PersonaResolution> => {
      const files = characterFilesOf(charactersDir);
      if (files === undefined) return { ok: false, reason: 'not-found', message: charactersDir };
      const resolved = await readMarkdownPersona(files.file);
      if (!resolved.ok) return resolved;
      return { ...resolved, name: files.name !== '' ? files.name : resolved.name };
    },
  };
}
