/**
 * 位置指针：数据根、用户皮肤目录与 Electron 运行时目录都可以被用户改到别处，这里负责读写与解析。
 *
 * 为什么是「指针文件」而不是普通配置项：这三样东西在读配置**之前**就要知道——
 * 主配置本身就在数据根里、皮肤目录决定了配置扫描的输入、运行时目录决定了能不能开桌面窗口。
 * 把它们的当前值塞进配置会成为先有鸡先有蛋，所以分层放：
 * - 数据根：`$DSH_HOME/fish-body-root.json`（在数据根之外，最外层）；
 * - 皮肤目录 / 运行时目录：`<数据根>/config/locations.json`（在数据根之内、配置读取之前）。
 *
 * 只做「读—解析—写」，不搬目录（搬动归 ./move-tree），不判断图形环境（归 ./pick-folder）。
 * 解析顺序固定且只有这一处：环境变量 > 指针文件 > 默认值。
 * @module dsh-fish-body/src/host/locations
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

/** 数据根指针文件名（放在 `$DSH_HOME` 下，与数据根目录平级）。 */
export const ROOT_POINTER_FILE = 'fish-body-root.json';

/** 数据根目录名（默认值；= npm 包名，刻意与 dsh-pet 区分开）。 */
export const DEFAULT_ROOT_DIR_NAME = 'fish-body';

/** 指针文件的结构版本。 */
const SCHEMA = 1;

/** 位置指针（`config/locations.json` 的内容）。 */
export interface Locations {
  /** 用户皮肤目录（缺省 `<根>/skin`）。 */
  readonly skin?: string;
  /** Electron 运行时目录（缺省 `<根>/runtime/electron`）。 */
  readonly runtime?: string;
}

/** 只读场景用到的能力（解析数据根只需要「能不能 stat + 读文件」）。 */
export interface ReadLocationFs {
  existsSync(path: string): boolean;
  readFileSync(path: string): string;
}

/** 读写指针用到的文件系统能力（测试注入替身）。 */
export interface LocationFs extends ReadLocationFs {
  writeFileSync(path: string, data: string): void;
  mkdirSync(path: string, options: { recursive: boolean }): void;
}

/** 生产实现。 */
const NODE_FS: LocationFs = {
  existsSync,
  mkdirSync: (path, options) => mkdirSync(path, options),
  readFileSync: (path) => readFileSync(path, 'utf8'),
  writeFileSync,
};

/** 把配置里的路径字符串整理成绝对路径形态；空/非字符串/纯空白一律 undefined。 */
function dirOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : normalize(trimmed);
}

/** 读一份 JSON 对象；不存在、坏文件、非对象都返回 `{}`（位置指针坏了只该回默认值，不该让插件起不来）。 */
function readJsonObject(path: string, fs: ReadLocationFs): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 写一份 JSON（自动建父目录；失败抛给调用方，由它决定是报错还是只告警）。 */
function writeJson(path: string, value: unknown, fs: LocationFs): void {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

/**
 * 读 `config/locations.json`。
 *
 * @param root - 数据根。
 * @param fs - 文件系统替身。
 * @returns 皮肤 / 运行时目录覆盖；没有指针文件时是空对象。
 */
export function readLocations(root: string, fs: ReadLocationFs = NODE_FS): Locations {
  const data = readJsonObject(join(root, 'config', 'locations.json'), fs);
  const skin = dirOf(data.skin);
  const runtime = dirOf(data.runtime);
  return { ...(skin === undefined ? {} : { skin }), ...(runtime === undefined ? {} : { runtime }) };
}

/**
 * 写 `config/locations.json`（整份覆盖；传 undefined 的字段等于删掉该覆盖）。
 *
 * @param root - 数据根。
 * @param next - 目标状态。
 * @param fs - 文件系统替身。
 */
export function writeLocations(root: string, next: Locations, fs: LocationFs = NODE_FS): void {
  writeJson(
    join(root, 'config', 'locations.json'),
    {
      schema: SCHEMA,
      ...(next.skin === undefined ? {} : { skin: next.skin }),
      ...(next.runtime === undefined ? {} : { runtime: next.runtime }),
    },
    fs,
  );
}

/**
 * 改一部分位置指针：读 → 合并 → 写回（`null` 表示删掉该项覆盖，回到默认值）。
 *
 * @param root - 数据根。
 * @param patch - 要改的字段。
 * @param fs - 文件系统替身。
 * @returns 写后的完整状态。
 */
export function patchLocations(
  root: string,
  patch: { readonly skin?: string | null; readonly runtime?: string | null },
  fs: LocationFs = NODE_FS,
): Locations {
  const current = readLocations(root, fs);
  // 统一走 dirOf：写出去的字符串与之后读回来的形状必须一致，否则「刚设完就显示成另一个样子」。
  const pick = (next: string | null | undefined, old: string | undefined): { value?: string } =>
    next === undefined
      ? old === undefined
        ? {}
        : { value: old }
      : next === null
        ? {}
        : dirOf(next) === undefined
          ? {}
          : { value: dirOf(next) };
  const skin = pick(patch.skin, current.skin).value;
  const runtime = pick(patch.runtime, current.runtime).value;
  const next: Locations = { ...(skin === undefined ? {} : { skin }), ...(runtime === undefined ? {} : { runtime }) };
  writeLocations(root, next, fs);
  return next;
}

/**
 * 用户皮肤目录：指针优先，否则 `<根>/skin`。
 *
 * @param root - 数据根。
 * @param locations - {@link readLocations} 的结果。
 * @returns 绝对路径。
 */
export function resolveSkinDir(root: string, locations: Locations): string {
  return locations.skin ?? join(root, 'skin');
}

/**
 * Electron 运行时目录：指针优先，否则 `<根>/runtime/electron`。
 *
 * @param root - 数据根。
 * @param locations - {@link readLocations} 的结果。
 * @returns 绝对路径。
 */
export function resolveRuntimeDir(root: string, locations: Locations): string {
  return locations.runtime ?? join(root, 'runtime', 'electron');
}

/**
 * 读数据根指针（`$DSH_HOME/fish-body-root.json`）。
 *
 * @param dshHome - `$DSH_HOME`。
 * @param fs - 文件系统替身。
 * @returns 指针里的数据根；没有指针、坏文件或指向空串时 undefined。
 */
export function readRootPointer(dshHome: string, fs: ReadLocationFs = NODE_FS): string | undefined {
  const path = join(dshHome, ROOT_POINTER_FILE);
  if (!fs.existsSync(path)) return undefined;
  return dirOf(readJsonObject(path, fs).root);
}

/**
 * 写数据根指针。
 *
 * @param dshHome - `$DSH_HOME`。
 * @param root - 新的数据根绝对路径。
 * @param fs - 文件系统替身。
 */
export function writeRootPointer(dshHome: string, root: string, fs: LocationFs = NODE_FS): void {
  writeJson(
    join(dshHome, ROOT_POINTER_FILE),
    { schema: SCHEMA, root: normalize(root), movedAt: new Date().toISOString() },
    fs,
  );
}

/**
 * 解析本次启动真正要用的数据根：环境变量 > 指针文件 > 默认值。
 *
 * 指针指向的目录不存在时不硬用它（否则等于把「换盘后没挂载」变成一次空数据启动），
 * 而是回默认值并交给调用方记一条 warn。
 *
 * @param input - `$DSH_HOME`、环境变量覆盖与文件系统替身。
 * @returns 解析结果：根路径、来源，以及指针失效时的原因。
 */
export function resolveRootDir(input: {
  readonly dshHome: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fs?: ReadLocationFs;
}): { readonly root: string; readonly source: 'env' | 'pointer' | 'default'; readonly stalePointer?: string } {
  const fs = input.fs ?? NODE_FS;
  const env = input.env ?? process.env;
  const fromEnv = dirOf(env.DSH_PET_USER_ROOT);
  if (fromEnv !== undefined) return { root: fromEnv, source: 'env' };
  const pointer = readRootPointer(input.dshHome, fs);
  if (pointer !== undefined) {
    if (fs.existsSync(pointer)) return { root: pointer, source: 'pointer' };
    return { root: join(input.dshHome, DEFAULT_ROOT_DIR_NAME), source: 'default', stalePointer: pointer };
  }
  return { root: join(input.dshHome, DEFAULT_ROOT_DIR_NAME), source: 'default' };
}
