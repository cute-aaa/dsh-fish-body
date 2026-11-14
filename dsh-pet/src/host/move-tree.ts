/**
 * 整棵目录的搬迁：算总大小 → 逐文件复制（带进度）→ 核对目标 → 只有核对通过才删源。
 *
 * 为什么不用 `renameSync`：跨盘 rename 必然 `EXDEV`，而「改位置」这个功能最常见的用法就是把数据根
 * 搬到另一块盘上。为什么要自己走目录而不是 `cpSync` 一把梭：几百 MB 的复制要能在界面上显示进度，
 * `cpSync` 没有任何回调。
 *
 * 唯一的硬约束：**核对不通过就留两份**。已复制的内容不删、源也不删，错误原样回给调用方——
 * 用户看到的应该是「移动没完成，两个位置都在」，而不是「磁盘满了，配置也没了」。
 * @module dsh-fish-body/src/host/move-tree
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** 搬迁进度（节流后回调，不逐文件刷界面）。 */
export interface MoveProgress {
  /** 已复制的字节数。 */
  readonly copiedBytes: number;
  /** 源目录总字节数（扫描阶段算定）。 */
  readonly totalBytes: number;
  /** 已复制的文件数。 */
  readonly copiedFiles: number;
  /** 源目录总文件数。 */
  readonly totalFiles: number;
  /** 正在复制的相对路径（给界面的一行「现在在搬什么」）。 */
  readonly current: string;
}

/** 搬迁结果：成功带搬了多少，失败带原因。 */
export type MoveResult =
  | { readonly ok: true; readonly bytes: number; readonly files: number }
  | { readonly ok: false; readonly reason: MoveFailure; readonly message: string };

/** 失败原因分类（调用方按它选文案；`verify` 与 `io` 的区别是「要不要提示用户去看两个目录」）。 */
export type MoveFailure = 'bad-request' | 'io' | 'verify';

/** 搬迁选项。 */
export interface MoveTreeOptions {
  /** 进度回调；内部按 {@link PROGRESS_INTERVAL_MS} 节流。 */
  readonly onProgress?: (progress: MoveProgress) => void;
  /** 进度回调的最小间隔（ms，默认 250）；测试里设 0 拿到每一次。 */
  readonly progressIntervalMs?: number;
}

/** 默认进度节流间隔。 */
export const PROGRESS_INTERVAL_MS = 250;

/** 一次目录扫描的统计。 */
interface TreeEntry {
  readonly rel: string;
  readonly abs: string;
  readonly size: number;
  /** 符号链接的目标（Electron 的 macOS 包里有；按链接复制，不跟进去）。 */
  readonly link?: string;
}

interface TreeStats {
  readonly bytes: number;
  readonly files: number;
  readonly entries: readonly TreeEntry[];
}

/** 递归统计一个目录（不跟随符号链接：链接按 0 字节算、按链接复制，避免指回自己时无限递归）。 */
function scan(dir: string): TreeStats {
  let bytes = 0;
  let files = 0;
  const entries: TreeEntry[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const name of readdirSync(current)) {
      const abs = join(current, name);
      const rel = prefix === '' ? name : prefix + '/' + name;
      const stat = lstatSync(abs);
      if (stat.isSymbolicLink()) {
        files += 1;
        entries.push({ rel, abs, size: 0, link: readlinkSync(abs) });
        continue;
      }
      if (stat.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      const size = stat.isFile() ? stat.size : 0;
      bytes += size;
      files += 1;
      entries.push({ rel, abs, size });
    }
  };
  walk(dir, '');
  return { bytes, files, entries };
}

/**
 * 数一个目录有多大（文件数 + 字节数）。
 *
 * 用来在「更改位置」之前把「这次要搬多少」先讲清楚——用户看不到数量级时，
 * 「会整体迁移」只是一句空话。目录不存在时不报错、报 0：那正是「还没建」的正常状态。
 *
 * @param dir - 目录的绝对路径。
 * @returns 文件数与字节数；目录不存在时两者都是 0。
 */
export function dirSize(dir: string): { readonly files: number; readonly bytes: number } {
  if (!existsSync(dir)) return { files: 0, bytes: 0 };
  const stats = scan(dir);
  return { files: stats.files, bytes: stats.bytes };
}

/**
 * 目标与源的关系检查：不能相同、不能互相包含（否则复制会把源写进自己的子树里）。
 *
 * @param from - 源目录。
 * @param to - 目标目录。
 * @returns 通过时 `undefined`，否则一句给用户看的原因。
 */
export function checkMoveTarget(from: string, to: string): string | undefined {
  const src = resolve(from);
  const dst = resolve(to);
  if (src === dst) return '目标位置和当前位置相同';
  if (!isAbsolute(dst)) return '目标位置必须是绝对路径';
  const inside = relative(src, dst);
  if (inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)) return '目标位置在源目录内部';
  const outside = relative(dst, src);
  if (outside !== '' && !outside.startsWith('..') && !isAbsolute(outside)) return '源目录在目标位置内部';
  return undefined;
}

/**
 * 把整棵目录搬到新位置（复制 → 核对 → 删源）。
 *
 * @param from - 源目录（必须存在且是目录）。
 * @param to - 目标目录（不允许已存在且非空）。
 * @param options - 进度回调与节流间隔。
 * @returns 结果；任何一步失败都不删源。
 */
export function moveTree(from: string, to: string, options: MoveTreeOptions = {}): MoveResult {
  const invalid = checkMoveTarget(from, to);
  if (invalid !== undefined) return { ok: false, reason: 'bad-request', message: invalid };
  if (!existsSync(from)) return { ok: false, reason: 'bad-request', message: '当前位置不存在：' + from };
  try {
    if (!statSync(from).isDirectory())
      return { ok: false, reason: 'bad-request', message: '当前位置不是目录：' + from };
  } catch (error) {
    return { ok: false, reason: 'io', message: messageOf(error) };
  }
  if (existsSync(to) && readdirSync(to).length > 0) {
    return { ok: false, reason: 'bad-request', message: '目标目录已有内容：' + to };
  }

  let stats: TreeStats;
  try {
    stats = scan(from);
  } catch (error) {
    return { ok: false, reason: 'io', message: messageOf(error) };
  }

  const interval = options.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
  let copiedBytes = 0;
  let copiedFiles = 0;
  let lastReport = 0;
  const report = (current: string, force = false): void => {
    const now = Date.now();
    if (!force && interval > 0 && now - lastReport < interval) return;
    lastReport = now;
    options.onProgress?.({ copiedBytes, copiedFiles, current, totalBytes: stats.bytes, totalFiles: stats.files });
  };

  try {
    mkdirSync(to, { recursive: true });
    report('', true);
    for (const entry of stats.entries) {
      const target = join(to, entry.rel.split('/').join(sep));
      mkdirSync(dirname(target), { recursive: true });
      if (entry.link === undefined) copyFileSync(entry.abs, target);
      else symlinkSync(entry.link, target);
      copiedBytes += entry.size;
      copiedFiles += 1;
      report(entry.rel);
    }
  } catch (error) {
    return { ok: false, reason: 'io', message: messageOf(error) };
  }

  // 核对：文件数与字节数都必须对得上。少一个文件就可能是「复制到一半出错」，这时删源等于丢数据。
  let verify: TreeStats;
  try {
    verify = scan(to);
  } catch (error) {
    return { ok: false, reason: 'verify', message: messageOf(error) };
  }
  if (verify.files !== stats.files || verify.bytes !== stats.bytes) {
    return {
      ok: false,
      reason: 'verify',
      message: `新位置核对不上（文件 ${verify.files}/${stats.files}，字节 ${verify.bytes}/${stats.bytes}）；旧位置保留未删`,
    };
  }

  try {
    rmSync(from, { recursive: true, force: true });
  } catch (error) {
    // 删不掉源只是「两个位置都在」，内容本身是完整的：按失败回报，但不说成数据丢失。
    return {
      ok: false,
      reason: 'io',
      message: `已复制到新位置，但旧位置删不掉（${messageOf(error)}）；两处内容都在`,
    };
  }
  return { ok: true, bytes: stats.bytes, files: stats.files };
}

/** 错误 → 一句话。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
