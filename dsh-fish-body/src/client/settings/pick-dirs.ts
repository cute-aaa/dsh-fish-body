/**
 * 选择框目录记忆：某个用途上次选过哪个目录，下次直接从那里打开。
 *
 * 为什么记在客户端 `localStorage` 而不是宿主：三个用途（权重目录 / 参考音频 / 参考文本）只在这里出现，
 * 要让宿主知道「这次是哪个用途」就得给 `/pick-*` 加字段——那是改契约；而落主配置的话，每次选文件
 * 都会触发一次主配置整份重写（注释与排版会被抹掉）。纯 UI 事实记在 UI 侧，丢了不影响任何配置真值，
 * 只是下次要重新点几下。与 `tab-memory.ts`、`selection-memory.ts`、`session-fish/offsets.ts` 同一类。
 *
 * **已知限制**（写进产物，不粉饰）：换浏览器、换访问端口、清站点数据都会失忆；那时的退路是
 * 「不传 `start` → 系统给默认目录」，与改造前完全一致，不会更糟。
 *
 * 所有存储访问一律吞错：隐私模式、被策略禁用、没有 DOM 时退化成「不记忆」，绝不把异常抛到 UI。
 * @module dsh-fish-body/src/client/settings/pick-dirs
 */

/** 记忆里的用途槽位：与三处选择框一一对应。 */
export type PickPurpose = 'weights' | 'refAudio' | 'refText';

/** 记住的目录：三个用途各一个槽位，外加「最近一次任何选择用过的目录」。 */
export interface PickDirs {
  /** 权重目录（`GPT_weights` / `SoVITS_weights` 的上一层）。 */
  readonly weights?: string;
  /** 参考音频所在目录。 */
  readonly refAudio?: string;
  /** 参考文本所在目录。 */
  readonly refText?: string;
  /** 本功能内最近一次选择的目录（任何用途）：没选过的用途回落到它。 */
  readonly last?: string;
}

/** 记住目录用的存储键。 */
export const PICK_DIRS_KEY = 'dsh-pet/pick-dirs';

/** 读写用的最小存储口（`localStorage` 的读写子集），便于单测注入。 */
export interface PickDirStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 已知槽位：读的时候只认这几个键，坏数据与未来新增字段一律忽略。 */
const SLOTS: readonly (keyof PickDirs)[] = ['weights', 'refAudio', 'refText', 'last'];

/**
 * 取浏览器存储。
 *
 * @returns `localStorage`；没有 DOM、隐私模式或访问器本身抛错时 `null`（调用方按「不记忆」处理）。
 */
export function pickDirStorage(): PickDirStorage | null {
  try {
    // 隐私模式下访问 localStorage 这个属性本身就可能抛，所以连取值都包在 try 里。
    return (globalThis as { localStorage?: PickDirStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * 读记忆。
 *
 * 只留四个已知键里的非空字符串：坏 JSON、非对象、非字符串值、空串一律当「没记过」。
 * 多出来的键（例如别处写入的 `schema`）直接忽略，不做迁移——没有真值需要迁移。
 *
 * @param storage - 存储口；`null` 表示没有可用存储。
 * @returns 记忆；读不到或读失败时是空对象（永远不会抛）。
 */
export function readPickDirs(storage: PickDirStorage | null): PickDirs {
  if (storage === null) return {};
  let raw: string | null;
  try {
    raw = storage.getItem(PICK_DIRS_KEY);
  } catch {
    return {};
  }
  if (raw === null || raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const source = parsed as Record<string, unknown>;
  const next: Record<string, string> = {};
  for (const slot of SLOTS) {
    const value = source[slot];
    if (typeof value === 'string' && value.trim() !== '') next[slot] = value;
  }
  return next as PickDirs;
}

/**
 * 从「选中了什么」推出「下次该从哪个目录打开」。
 *
 * @param path - 选择框返回的路径。
 * @param kind - 选的是文件还是目录。
 * @returns 目录路径；`folder` 原样返回，`file` 取父目录（同时认 `\` 与 `/`）。取不到父目录时返回空串。
 */
export function dirOfPickedPath(path: string, kind: 'file' | 'folder'): string {
  const picked = path.trim();
  if (picked === '') return '';
  if (kind === 'folder') return picked;
  const cut = Math.max(picked.lastIndexOf('\\'), picked.lastIndexOf('/'));
  // 没有分隔符（相对文件名 / 裸名字）：交给系统默认，别记一个假目录。
  if (cut <= 0) return '';
  return picked.slice(0, cut);
}

/**
 * 算一次选择框的初始目录。
 *
 * 优先级（= 需求的语义，也是这个函数存在的唯一理由）：
 * 1. 该用途自己的槽位；
 * 2. 最近一次任何选择用过的目录（`last`）；
 * 3. 调用方给的兜底（权重目录手输框里的草稿）；
 * 4. 都没有 → `undefined`，不传 `start`，交给系统「上次目录」。
 *
 * @param purpose - 这次是哪个用途。
 * @param dirs - 读出来的记忆。
 * @param draft - 可选的兜底目录（已由调用方 trim 过或原样传，这里再 trim 一次）。
 * @returns 初始目录；`undefined` 表示不传。
 */
export function startFor(purpose: PickPurpose, dirs: PickDirs, draft?: string): string | undefined {
  const own = dirs[purpose];
  if (own !== undefined && own.trim() !== '') return own;
  const last = dirs.last;
  if (last !== undefined && last.trim() !== '') return last;
  const fallback = draft?.trim() ?? '';
  return fallback === '' ? undefined : fallback;
}

/**
 * 记住这次选中落在哪个目录。
 *
 * **只该在 `picked` 之后调用**：`cancelled` / `unsupported` / `aborted` 都不代表用户认可了某个目录。
 * 一次写入同时更新该用途槽位与 `last`（单键一次 `setItem`，不存在半写）。
 *
 * @param purpose - 这次是哪个用途。
 * @param picked - 选择框返回的路径。
 * @param kind - 选的是文件还是目录。
 * @param storage - 存储口；`null` 表示没有可用存储（静默跳过）。
 */
export function rememberPickDir(
  purpose: PickPurpose,
  picked: string,
  kind: 'file' | 'folder',
  storage: PickDirStorage | null,
): void {
  if (storage === null) return;
  const dir = dirOfPickedPath(picked, kind);
  if (dir === '') return;
  const next: Record<string, string> = { ...readPickDirs(storage), [purpose]: dir, last: dir };
  try {
    storage.setItem(PICK_DIRS_KEY, JSON.stringify(next));
  } catch {
    // 写不进（配额满 / 隐私模式）：记不住下一次而已，不该让选择框失败。
  }
}
