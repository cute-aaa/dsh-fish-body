/**
 * 数据根的选定：默认 `<DSH_HOME>/fish-body`，可以由用户指到别处（`$DSH_HOME/fish-body-root.json`
 * 或环境变量 `DSH_PET_USER_ROOT`），并在默认位置上完成一次性换名 `dsh-pet` → `fish-body`。
 *
 * 为什么必须换：`dsh-pet` 是上游插件的固定数据根，两个插件同时装就是同一个目录——配置互相覆盖、
 * 素材互相串台。本插件包名已经是 `dsh-fish-body`，数据根跟着包名走才是自洽的。
 *
 * 换名的边界（只在默认位置上做）：
 * - 新根已存在 → 用它；旧根仍在时由内层迁移按「同名分组」把它搬进来（不删除旧根）；
 * - 只有旧根 → 同盘 `renameSync`（便宜）；失败（跨盘 / 有进程占用）→ 递归复制后**保留旧根**；
 * - 复制也失败 → 继续用旧根工作（插件照常可用，只是根名还是 dsh-pet），由内层迁移把目录整理成新布局。
 *
 * 用户自己指到别处时不做换名：那个位置上本来就只有一个根，没有历史包袱。
 * 只做「根」这一层：内层目录的搬迁归 ./migrate-layout。
 * @module dsh-fish-body/src/host/user-root
 */
import { cpSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_ROOT_DIR_NAME, readRootPointer, resolveRootDir } from './locations.ts';

/** 本插件的数据根目录名（= npm 包名，刻意与 dsh-pet 区分开）。 */
export const ROOT_DIR_NAME = DEFAULT_ROOT_DIR_NAME;

/** 上游插件的历史数据根目录名：只用于一次性迁移与告警。 */
export const LEGACY_ROOT_DIR_NAME = 'dsh-pet';

/** 迁移过程用到的文件系统能力（测试注入替身，生产用 node:fs）。 */
export interface RootFs {
  existsSync(path: string): boolean;
  renameSync(from: string, to: string): void;
  cpSync(from: string, to: string, options: { recursive: boolean; force?: boolean; errorOnExist?: boolean }): void;
  readFileSync(path: string): string;
}

/** 生产实现：全部来自 node:fs。 */
const NODE_FS: RootFs = {
  cpSync,
  existsSync,
  readFileSync: (path) => readFileSync(path, 'utf8'),
  renameSync,
};

/** 日志出口：只用到两个级别，缺省静默（独立模式的早期调用没有 logger）。 */
export interface RootLog {
  info(message: string): void;
  warn(message: string): void;
}

/** 换名 / 选根的结果。 */
export interface UserRootResult {
  /** 实际使用的数据根（绝对路径）。 */
  readonly root: string;
  /** 旧根路径（迁移来源；没迁移过时也存在，仅用于提示）。 */
  readonly legacyRoot: string;
  /** 根的来源：默认位置 / 指针文件 / 环境变量。 */
  readonly source: 'default' | 'pointer' | 'env';
  /** `rename` 成功：旧根已经不存在。 */
  readonly renamed: boolean;
  /** `rename` 失败但复制成功：旧根仍在，可手动删除。 */
  readonly copied: boolean;
  /** 新根与旧根同时存在（含复制成功的情形）：旧根内容未被读取。 */
  readonly legacyLeftBehind: boolean;
  /** 复制也失败时的原因（此时继续用旧根工作）。 */
  readonly error?: string;
}

/** 选根所需的输入。 */
export interface UserRootInput {
  /** `$DSH_HOME`（调用方传入，避免本模块再读一遍环境变量）。 */
  readonly dshHome: string;
  /** 日志出口；缺省静默。 */
  readonly log?: RootLog;
  /** 环境变量（测试注入；`DSH_PET_USER_ROOT` 优先于指针文件）。 */
  readonly env?: NodeJS.ProcessEnv;
  /** 文件系统替身（测试注入）。 */
  readonly fs?: RootFs;
}

/** 静默日志：没有 logger 时用它，保证调用方不必判空。 */
const SILENT: RootLog = { info: () => undefined, warn: () => undefined };

/**
 * 选定数据根，并在默认位置上按需把旧根换成新根。
 *
 * @param input - `$DSH_HOME`、日志出口与可选文件系统替身。
 * @returns 实际使用的根、根来源、旧根路径与迁移状态。
 */
export function resolveUserRoot(input: UserRootInput): UserRootResult {
  const fs = input.fs ?? NODE_FS;
  const log = input.log ?? SILENT;
  const legacyRoot = join(input.dshHome, LEGACY_ROOT_DIR_NAME);
  const resolved = resolveRootDir({
    dshHome: input.dshHome,
    ...(input.env === undefined ? {} : { env: input.env }),
    fs,
  });
  if (resolved.stalePointer !== undefined) {
    log.warn(`[fish-body] 数据根指针指向的位置不存在（${resolved.stalePointer}），本次使用默认位置`);
  }
  // 用户指到别处：不做换名，也不去碰旧根（那个位置上的内容与我们无关）。
  if (resolved.source !== 'default') {
    return {
      root: resolved.root,
      legacyRoot,
      source: resolved.source,
      renamed: false,
      copied: false,
      legacyLeftBehind: false,
    };
  }

  const root = resolved.root;
  const hasNew = fs.existsSync(root);
  const hasOld = fs.existsSync(legacyRoot);

  if (hasNew) {
    if (hasOld) {
      // 两个都在：不猜谁是权威，也不合并（合并会把两边的配置搅成一份看不懂的东西）。
      log.warn(`[fish-body] 数据根 ${root} 与旧根 ${legacyRoot} 同时存在，本次只用新根；旧根可手动删除`);
    }
    return { root, legacyRoot, source: 'default', renamed: false, copied: false, legacyLeftBehind: hasOld };
  }
  if (!hasOld) return { root, legacyRoot, source: 'default', renamed: false, copied: false, legacyLeftBehind: false };

  // 换名重试一次：Windows 上目录换名会被「刚退出的进程还没放掉的句柄」拦一下（EPERM/EBUSY），
  // 隔一拍再来经常就过了。真过不去才走复制。
  const renameError = tryRename(fs, legacyRoot, root);
  if (renameError === undefined) {
    log.info(`[fish-body] 数据根已从 ${legacyRoot} 换名为 ${root}`);
    return { root, legacyRoot, source: 'default', renamed: true, copied: false, legacyLeftBehind: false };
  }
  log.warn(`[fish-body] 数据根换名失败（${renameError}），改为复制`);
  try {
    // 不预先建父目录：`cpSync` 自己会建（曾经在这里 mkdir 父目录，父目录本来就在 → EEXIST 直接判失败）。
    fs.cpSync(legacyRoot, root, { recursive: true, force: true, errorOnExist: false });
    log.warn(`[fish-body] 数据已复制到 ${root}；旧根 ${legacyRoot} 保留未删，确认无误后可手动删除`);
    return { root, legacyRoot, source: 'default', renamed: false, copied: true, legacyLeftBehind: true };
  } catch (error) {
    const copyReason = error instanceof Error ? error.message : String(error);
    // 复制也失败：继续在旧根上工作。根名不好看，但用户的配置与记忆一个字节都没动。
    log.warn(`[fish-body] 数据复制也失败（${copyReason}），本次继续使用旧根 ${legacyRoot}`);
    return {
      root: legacyRoot,
      legacyRoot,
      source: 'default',
      renamed: false,
      copied: false,
      legacyLeftBehind: false,
      error: copyReason,
    };
  }
}

/**
 * 试一次换名，失败返回原因（不抛）。
 *
 * @param fs - 文件系统。
 * @param from - 旧根。
 * @param to - 新根。
 * @returns 成功时 undefined，失败时错误文本。
 */
function tryRename(fs: RootFs, from: string, to: string): string | undefined {
  try {
    fs.renameSync(from, to);
    return undefined;
  } catch (first) {
    try {
      fs.renameSync(from, to);
      return undefined;
    } catch {
      return first instanceof Error ? first.message : String(first);
    }
  }
}

/** 读数据根指针（重新导出，供装配期判断「用户是不是自己指过位置」）。 */
export { readRootPointer };
