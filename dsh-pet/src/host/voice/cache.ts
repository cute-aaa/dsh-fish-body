/**
 * 语音缓存：按「来源 + 音色 + 语速 + 文本」算键，落盘为音频文件，并按总量与条数淘汰最旧的。
 *
 * 命中即免合成——同一句话不管是自动播报还是用户点历史，都只合成一次。缓存只是加速，
 * 删掉任意文件都不影响正确性：下一次请求会重新合成。不负责合成与队列。
 * 扩展名跟着合成产出的 MIME 走（见 voice/audio.ts）：键里不含格式，所以查找要把
 * 已知扩展名都探一遍——GSV 那种 wav 与 edge 那种 mp3 因此能共用一个缓存目录。
 * @module dsh-fish-body/src/host/voice/cache
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { userPaths } from '../user-layout.ts';
import { AUDIO_EXTENSIONS, audioMimeOfExt } from './audio.ts';

/** 缓存总量上限（字节）：超过后从最旧的开始删。 */
export const CACHE_MAX_BYTES = 20 * 1024 * 1024;
/** 缓存文件条数上限。 */
export const CACHE_MAX_FILES = 200;

/** 命中缓存的结论：文件路径与它该回的 Content-Type。 */
export interface CachedClip {
  readonly file: string;
  readonly mime: string;
}

/** 缓存文件的完整路径：`<数据根>/cache/voice/<key>.<ext>`。 */
export function cachePath(userRoot: string, key: string, ext: string): string {
  return join(userPaths(userRoot).voiceCacheDir, `${key}.${ext}`);
}

/**
 * 一个键可能落成的全部路径（按已知扩展名）。
 *
 * @param userRoot - 用户数据根。
 * @param key - 缓存键。
 * @returns 路径列表；查找命中缓存时逐个试。
 */
export function cacheCandidates(userRoot: string, key: string): string[] {
  return AUDIO_EXTENSIONS.map((ext) => cachePath(userRoot, key, ext));
}

/**
 * 查缓存：任一扩展名存在且非空就算命中。
 *
 * 空文件按未命中处理：0 字节音频放不出声，命中它等于每次都白播一次静音。
 * @param userRoot - 用户数据根。
 * @param key - 缓存键。
 * @returns 命中的文件与 MIME；没有可用文件时 undefined。
 */
export async function findCachedClip(userRoot: string, key: string): Promise<CachedClip | undefined> {
  for (const ext of AUDIO_EXTENSIONS) {
    const file = cachePath(userRoot, key, ext);
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size <= 0) continue;
      const mime = audioMimeOfExt(ext);
      if (mime !== undefined) return { file, mime };
    } catch {
      /* 这个扩展名没有：试下一个 */
    }
  }
  return undefined;
}

/**
 * 计算缓存键。
 *
 * 四个输入都影响音频内容。`source` 是合成来源——内置实现的 id 或第三方 provider 的 id：
 * 不含它的话，切换实现后会命中上一家的旧音频，听起来像「注册了没生效」。
 * `text` 不做归一化——同一句话多一个空格就是另一份音频，宁可多存也不冒「听起来不对」的风险。
 * @param source - 合成来源。
 * @param voice - 音色 id；第三方实现没有音色概念，传空串。
 * @param rate - 语速表达式（如 `+0%`）。
 * @param text - 待合成文本。
 * @returns 十六进制 sha1。
 */
export function cacheKey(source: string, voice: string, rate: string, text: string): string {
  return createHash('sha1').update(`${source}\n${voice}\n${rate}\n${text}`).digest('hex');
}

/**
 * 确保缓存目录存在。
 * @param userRoot - 用户数据根。
 * @returns 缓存目录绝对路径。
 */
export async function ensureCacheDir(userRoot: string): Promise<string> {
  const dir = userPaths(userRoot).voiceCacheDir;
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * 按「总量 + 条数」淘汰最旧的文件；两个上限都满足时立刻停手。
 * @param dir - 缓存目录。
 * @param limits - 上限，缺省用模块常量。
 * @returns 实际删除的文件数。
 */
export async function pruneCache(dir: string, limits: { maxBytes?: number; maxFiles?: number } = {}): Promise<number> {
  const maxBytes = limits.maxBytes ?? CACHE_MAX_BYTES;
  const maxFiles = limits.maxFiles ?? CACHE_MAX_FILES;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0; // 目录还不存在：没有可淘汰的
  }
  const entries: { file: string; size: number; mtimeMs: number }[] = [];
  for (const name of names) {
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    // 只统计已知音频扩展名：`.part` 这类半成品不参与淘汰（它要么马上改名，要么被清掉）。
    if (!AUDIO_EXTENSIONS.includes(ext)) continue;
    const file = join(dir, name);
    try {
      const info = await stat(file);
      entries.push({ file, size: info.size, mtimeMs: info.mtimeMs });
    } catch {
      /* 这条正被别的请求删掉，跳过 */
    }
  }
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  let totalFiles = entries.length;
  let removed = 0;
  for (const entry of entries) {
    if (totalBytes <= maxBytes && totalFiles <= maxFiles) break;
    try {
      await rm(entry.file, { force: true });
      removed += 1;
      totalBytes -= entry.size;
      totalFiles -= 1;
    } catch {
      /* 删不掉就留着，不影响本次请求 */
    }
  }
  return removed;
}
