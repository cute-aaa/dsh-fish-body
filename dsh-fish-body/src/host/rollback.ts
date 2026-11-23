/**
 * 插件回滚：把「构建产物 + 可选配置」拍成快照，出了问题时整份退回上一个可用状态。
 *
 * 为什么需要它：宿主代码与配置是一起变的（`main-config.jsonc` 的字段跟着代码走），
 * 升级后不兼容时单退代码会留下一份新代码写过、旧代码读不懂的配置。所以快照同时收这三样：
 * `lib/`（tsdown + tsc 产物）、`package.json`、`cordis.patch.yml`，另可选 `config/`。
 *
 * 只收白名单，**永不**碰用户数据：`data/`（对话记忆）、`skin/`、`assets/pet/`、`assets/webm/`、
 * `node_modules/`、`dist-app/` 一条都不进快照。回滚不该有任何丢掉「用户自己的东西」的可能。
 *
 * 两条硬约束：
 * - **快照永不覆盖**：id 撞了就失败，宁可让用户改个 label；
 * - **恢复前先自拍**：先拍一份 `pre-restore`，把「回滚错了」也变成一次可逆操作。
 *
 * 默认干跑由 CLI 负责（`scripts/rollback.mjs`），这里只有纯逻辑，fs 可注入以便单测。
 * 数据布局的回滚不在这里：那条走 `src/host/migrate-layout.ts` 的 `revertLayout` 与 `.layout.json` 回执。
 * @module dsh-fish-body/src/host/rollback
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, sep } from 'node:path';

/** 快照根目录名：落在 `<插件>/artifacts/rollback`（`artifacts/` 已被 .gitignore 忽略）。 */
export const ROLLBACK_DIR = 'rollback';

/** 快照清单文件名（每个快照目录一份）。 */
export const MANIFEST_FILE = 'manifest.json';

/** 恢复时用来装文件内容的子目录名（与 manifest 同级，避免和它抢文件名）。 */
export const FILES_DIR = 'files';

/** 快照里允许出现的东西：插件侧三项 + 可选的数据根 `config/`。 */
export const SNAPSHOT_ITEMS: readonly string[] = ['lib', 'package.json', 'cordis.patch.yml'];

/** 可选的地面配置目录（相对数据根）。 */
export const CONFIG_ITEM = 'config';

/** 单个文件上限：64 MiB。超了说明这份快照在收不该收的东西。 */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** 整份快照上限：512 MiB。 */
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

/** 一条快照条目：相对路径（正斜杠）与字节数。 */
export interface RollbackEntry {
  /** 相对插件目录（或数据根）的路径，统一用 `/`，跨平台可比。 */
  readonly rel: string;
  /** 字节数。 */
  readonly bytes: number;
}

/** 一份快照的清单。 */
export interface SnapshotManifest {
  /** 快照 id（= 目录名）：`YYYYMMDD-HHmmss-<label>`。 */
  readonly id: string;
  /** 用户给的标签（已规整成 `[a-z0-9-]`；缺省 `snap`）。 */
  readonly label: string;
  /** 拍下时的 ISO 时间戳。 */
  readonly createdAt: string;
  /** 拍下时的 git commit（拿不到时为空串，不阻塞）。 */
  readonly commit: string;
  /** 拍下时的插件版本（`package.json` 的 `version`）。 */
  readonly version: string;
  /** 是否含数据根下的 `config/`。 */
  readonly includeConfig: boolean;
  /** 条目（不保证排序；列目录时按 rel 排一次）。 */
  readonly entries: readonly RollbackEntry[];
  /** 总字节数。 */
  readonly totalBytes: number;
}

/** 回滚用到的最小文件系统能力（测试注入替身）。 */
export interface RollbackFs {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  /** 只列名字；不存在时返回空数组（调用方先 existsSync）。 */
  readdirSync(path: string): string[];
  isDirectory(path: string): boolean;
  sizeOf(path: string): number;
  readFileSync(path: string): string;
  writeFileSync(path: string, data: string): void;
  /** 递归复制（目录整棵、文件一份）。 */
  copyTree(from: string, to: string): void;
  /** 递归删除；不存在时不报错。 */
  removeSync(path: string): void;
}

/** 生产环境的 fs 实现（只在 CLI 里用）。 */
export const NODE_FS: RollbackFs = {
  existsSync,
  mkdirSync: (path, options) => mkdirSync(path, options),
  readdirSync: (path) => readdirSync(path),
  isDirectory: (path) => statSync(path).isDirectory(),
  sizeOf: (path) => statSync(path).size,
  readFileSync: (path) => readFileSync(path, 'utf8'),
  writeFileSync: (path, data) => writeFileSync(path, data, 'utf8'),
  copyTree: (from, to) => cpSync(from, to, { recursive: true }),
  removeSync: (path) => rmSync(path, { recursive: true, force: true }),
};

/** 日志出口（与 `migrate-layout` 同形：CLI 传 console，测试传收集器）。 */
export interface RollbackLog {
  info(message: string): void;
  warn(message: string): void;
}

/** 拍快照的输入。 */
export interface SnapshotInput {
  /** 插件目录（含 `lib/`、`package.json`）。 */
  readonly repo: string;
  /** 快照根目录（通常是 `<插件>/artifacts/rollback`）。 */
  readonly dir: string;
  /** 标签；会被规整。 */
  readonly label: string;
  /** 可选的 git commit。 */
  readonly commit: string;
  /** 插件版本。 */
  readonly version: string;
  /** 数据根：`includeConfig` 为真时从 `<数据根>/config` 收配置。 */
  readonly dataRoot: string;
  /** 是否连配置一起收。 */
  readonly includeConfig: boolean;
  /** 拍下时刻（注入以便测试得到确定的 id）。 */
  readonly now: Date;
  readonly fs: RollbackFs;
  readonly log: RollbackLog;
}

/** 恢复的输入。 */
export interface RestoreInput {
  readonly repo: string;
  readonly dir: string;
  readonly id: string;
  readonly dataRoot: string;
  /** 是否连 `config/` 一起恢复（必须与快照内容无关：快照里有才恢复）。 */
  readonly includeConfig: boolean;
  readonly now: Date;
  readonly fs: RollbackFs;
  readonly log: RollbackLog;
}

/** 恢复计划里的一条：从快照哪来、覆盖到哪。 */
export interface RestoreTarget {
  readonly rel: string;
  readonly from: string;
  readonly to: string;
}

/** 列表里的一项：写得出来的给 manifest，写不出来的给一句原因。 */
export interface SnapshotListing {
  readonly id: string;
  readonly manifest?: SnapshotManifest;
  readonly error?: string;
}

/** 两位补零。 */
const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * 把标签规整成能当目录名的形状。
 *
 * @param label - 用户给的标签。
 * @returns `[a-z0-9-]` 组成的串；全空时 `snap`。
 */
export function normalizeLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'snap' : slug;
}

/**
 * 由时刻与标签算快照 id。
 *
 * @param now - 拍下时刻（本地时区，给人看的）。
 * @param label - 已规整的标签。
 * @returns `YYYYMMDD-HHmmss-<label>`。
 */
export function snapshotIdOf(now: Date, label: string): string {
  const stamp =
    String(now.getFullYear()) +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '-' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());
  return stamp + '-' + label;
}

/** 快照目录。 */
const snapshotDirOf = (dir: string, id: string): string => join(dir, id);

/** 清单路径。 */
const manifestPathOf = (dir: string, id: string): string => join(snapshotDirOf(dir, id), MANIFEST_FILE);

/**
 * 递归走一棵树，把文件收进条目表。
 *
 * @param base - 待收的绝对路径。
 * @param prefix - 条目里用的相对前缀（如 `lib`）。
 * @param fs - 文件系统。
 * @param out - 收集器。
 */
function collect(base: string, prefix: string, fs: RollbackFs, out: RollbackEntry[]): void {
  if (!fs.existsSync(base)) return;
  if (!fs.isDirectory(base)) {
    out.push({ rel: prefix, bytes: fs.sizeOf(base) });
    return;
  }
  for (const name of fs.readdirSync(base)) {
    const abs = join(base, name);
    const rel = prefix + '/' + name;
    if (fs.isDirectory(abs)) collect(abs, rel, fs, out);
    else out.push({ rel, bytes: fs.sizeOf(abs) });
  }
}

/**
 * 收拢一份快照的条目（不含复制）。
 *
 * @param input - 拍快照的输入。
 * @returns 条目与总字节数；超上限时抛错（不截断，截断的快照比没有更糟）。
 */
export function planSnapshot(input: SnapshotInput): { entries: RollbackEntry[]; totalBytes: number } {
  const entries: RollbackEntry[] = [];
  const sources: Array<{ base: string; prefix: string }> = SNAPSHOT_ITEMS.map((item) => ({
    base: join(input.repo, item),
    prefix: item,
  }));
  if (input.includeConfig) {
    sources.push({ base: join(input.dataRoot, CONFIG_ITEM), prefix: CONFIG_ITEM });
  }
  for (const source of sources) {
    if (!input.fs.existsSync(source.base)) {
      input.log.warn('跳过（不存在）：' + source.base);
      continue;
    }
    collect(source.base, source.prefix, input.fs, entries);
  }
  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.bytes > MAX_FILE_BYTES) {
      throw new Error('文件太大，拒绝拍快照：' + entry.rel + '（' + entry.bytes + ' B）');
    }
    totalBytes += entry.bytes;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error('快照超过 ' + Math.round(MAX_TOTAL_BYTES / 1024 / 1024) + ' MiB，拒绝：' + totalBytes + ' B');
  }
  return { entries, totalBytes };
}

/**
 * 拍一份快照。
 *
 * @param input - 拍快照的输入。
 * @returns 刚落盘的清单。
 */
export function createSnapshot(input: SnapshotInput): SnapshotManifest {
  const label = normalizeLabel(input.label);
  const id = snapshotIdOf(input.now, label);
  const dir = snapshotDirOf(input.dir, id);
  if (input.fs.existsSync(dir)) throw new Error('快照已存在，换一个 label：' + id);
  const { entries, totalBytes } = planSnapshot(input);
  if (entries.length === 0) throw new Error('没有可收的东西（lib/ 与 package.json 都不在）：' + input.repo);

  input.fs.mkdirSync(join(dir, FILES_DIR), { recursive: true });
  for (const item of SNAPSHOT_ITEMS) {
    const from = join(input.repo, item);
    if (input.fs.existsSync(from)) input.fs.copyTree(from, join(dir, FILES_DIR, item));
  }
  if (input.includeConfig) {
    const from = join(input.dataRoot, CONFIG_ITEM);
    if (input.fs.existsSync(from)) input.fs.copyTree(from, join(dir, FILES_DIR, CONFIG_ITEM));
  }

  const manifest: SnapshotManifest = {
    id,
    label,
    createdAt: input.now.toISOString(),
    commit: input.commit,
    version: input.version,
    includeConfig: input.includeConfig,
    entries,
    totalBytes,
  };
  input.fs.writeFileSync(manifestPathOf(input.dir, id), JSON.stringify(manifest, null, 2));
  input.log.info(
    '快照 ' +
      id +
      '：' +
      entries.length +
      ' 个文件 / ' +
      Math.round(totalBytes / 1024) +
      ' KiB' +
      (input.includeConfig ? '（含 config/）' : ''),
  );
  return manifest;
}

/**
 * 校验一份读回来的清单。
 *
 * @param raw - `JSON.parse` 的结果。
 * @returns 合法清单。
 */
export function validateManifest(raw: unknown): SnapshotManifest {
  if (typeof raw !== 'object' || raw === null) throw new Error('清单不是对象');
  const bag = raw as Record<string, unknown>;
  for (const key of ['id', 'label', 'createdAt', 'version']) {
    if (typeof bag[key] !== 'string' || bag[key] === '') throw new Error('清单缺字段：' + key);
  }
  if (typeof bag.includeConfig !== 'boolean') throw new Error('清单缺字段：includeConfig');
  if (!Array.isArray(bag.entries) || bag.entries.length === 0) throw new Error('清单里没有条目');
  const entries: RollbackEntry[] = bag.entries.map((item: unknown) => {
    const entry = (item ?? {}) as Record<string, unknown>;
    if (typeof entry.rel !== 'string' || entry.rel === '') throw new Error('条目缺 rel');
    if (typeof entry.bytes !== 'number' || !Number.isFinite(entry.bytes)) throw new Error('条目缺 bytes：' + entry.rel);
    return { rel: entry.rel, bytes: entry.bytes };
  });
  if (typeof bag.totalBytes !== 'number' || !Number.isFinite(bag.totalBytes)) throw new Error('清单缺 totalBytes');
  return {
    id: bag.id as string,
    label: bag.label as string,
    createdAt: bag.createdAt as string,
    commit: typeof bag.commit === 'string' ? bag.commit : '',
    version: bag.version as string,
    includeConfig: bag.includeConfig as boolean,
    entries,
    totalBytes: bag.totalBytes as number,
  };
}

/**
 * 读一份清单。
 *
 * @param dir - 快照根目录。
 * @param id - 快照 id。
 * @param fs - 文件系统。
 * @returns 合法清单（不合法时抛错，调用方决定是跳过还是中止）。
 */
export function readManifest(dir: string, id: string, fs: RollbackFs = NODE_FS): SnapshotManifest {
  const path = manifestPathOf(dir, id);
  if (!fs.existsSync(path)) throw new Error('没有清单：' + path);
  return validateManifest(JSON.parse(fs.readFileSync(path)) as unknown);
}

/**
 * 列出快照根目录下的全部快照。
 *
 * 坏清单不静默丢掉：给它一条 `error`，CLI 照常打印——「这里有个拍坏了的快照」本身就是排障信息。
 *
 * @param dir - 快照根目录。
 * @param fs - 文件系统。
 * @returns 按 id 倒序（时间新的在前）的列表。
 */
export function listSnapshots(dir: string, fs: RollbackFs = NODE_FS): SnapshotListing[] {
  if (!fs.existsSync(dir)) return [];
  const ids = fs.readdirSync(dir).filter((name) => fs.isDirectory(join(dir, name)));
  const out: SnapshotListing[] = ids.map((id) => {
    try {
      return { id, manifest: readManifest(dir, id, fs) };
    } catch (error) {
      return { id, error: error instanceof Error ? error.message : String(error) };
    }
  });
  return out.sort((left, right) => right.id.localeCompare(left.id));
}

/**
 * 快照目录名是否允许被恢复到某个目标根下。
 *
 * 只认白名单前缀，并挡掉 `..` 与绝对路径：清单是磁盘上的数据，不该被拿来拼出任意写入。
 *
 * @param rel - 条目相对路径。
 * @returns 允许恢复时为 `true`。
 */
export function restorableRel(rel: string): boolean {
  if (rel === '' || isAbsolute(rel)) return false;
  if (rel.split('/').includes('..')) return false;
  return (
    SNAPSHOT_ITEMS.some((item) => rel === item || rel.startsWith(item + '/')) ||
    rel === CONFIG_ITEM ||
    rel.startsWith(CONFIG_ITEM + '/')
  );
}

/**
 * 算一份恢复计划（不写盘）。
 *
 * @param manifest - 快照清单。
 * @param dir - 快照根目录。
 * @param repo - 插件目录（代码产物的落点）。
 * @param dataRoot - 数据根（`config/` 的落点）。
 * @param includeConfig - 是否连配置一起恢复；快照里没有 config 时自动忽略。
 * @returns 每条要覆盖的目标；条目非法时抛错。
 */
export function planRestore(
  manifest: SnapshotManifest,
  dir: string,
  repo: string,
  dataRoot: string,
  includeConfig: boolean,
): RestoreTarget[] {
  const fromRoot = join(snapshotDirOf(dir, manifest.id), FILES_DIR);
  const targets: RestoreTarget[] = [];
  for (const entry of manifest.entries) {
    if (!restorableRel(entry.rel)) throw new Error('清单里有不该恢复的路径：' + entry.rel);
    const isConfig = entry.rel === CONFIG_ITEM || entry.rel.startsWith(CONFIG_ITEM + '/');
    if (isConfig && !(includeConfig && manifest.includeConfig)) continue;
    targets.push({
      rel: entry.rel,
      from: join(fromRoot, entry.rel.split('/').join(sep)),
      to: join(isConfig ? dataRoot : repo, entry.rel.split('/').join(sep)),
    });
  }
  return targets;
}

/**
 * 恢复一份快照：先自拍 `pre-restore`，再把白名单条目逐条覆盖回去。
 *
 * 只覆盖、不删除：旧文件多出来的东西留给用户自己处理——回滚脚本不该顺手清理用户目录。
 *
 * @param input - 恢复的输入。
 * @returns 恢复的条目数与自拍快照 id。
 */
export function restoreSnapshot(input: RestoreInput): { restored: readonly string[]; preRestore: string } {
  const manifest = readManifest(input.dir, input.id, input.fs);
  if (manifest.includeConfig && !input.includeConfig) {
    input.log.warn('这份快照含 config/，但这次没带 --with-config：只恢复代码产物。');
  }
  // 自拍放在最前面：回滚本身出错时，这份「回滚前」的快照还能再救回来。
  const preRestore = createSnapshot({
    repo: input.repo,
    dir: input.dir,
    label: 'pre-restore',
    commit: '',
    version: manifest.version,
    dataRoot: input.dataRoot,
    includeConfig: input.includeConfig,
    now: input.now,
    fs: input.fs,
    log: input.log,
  });
  const targets = planRestore(manifest, input.dir, input.repo, input.dataRoot, input.includeConfig);
  const restored: string[] = [];
  for (const target of targets) {
    if (!input.fs.existsSync(target.from)) {
      input.log.warn('跳过（快照里没有这个文件）：' + target.rel);
      continue;
    }
    input.fs.mkdirSync(dirname(target.to), { recursive: true });
    input.fs.copyTree(target.from, target.to);
    restored.push(target.rel);
  }
  input.log.info('已从 ' + manifest.id + ' 恢复 ' + restored.length + ' 项（回滚前快照：' + preRestore.id + '）');
  return { restored, preRestore: preRestore.id };
}

/**
 * 删掉一份快照（只给 CLI 的 `prune` 用，恢复流程不调它）。
 *
 * @param dir - 快照根目录。
 * @param id - 快照 id。
 * @param fs - 文件系统。
 */
export function removeSnapshot(dir: string, id: string, fs: RollbackFs = NODE_FS): void {
  const target = snapshotDirOf(dir, id);
  if (!fs.existsSync(target)) throw new Error('没有这份快照：' + id);
  fs.removeSync(target);
}
