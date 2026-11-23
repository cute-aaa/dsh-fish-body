/**
 * 池扫描用的磁盘探测小工具：目录项类型、列目录、读 json、挑结构文件。
 *
 * 单独一份是因为它们与「池有哪些资源」无关，只与「这盘上有什么」有关：
 * `scan.ts` 讲布局，`roots.ts` 讲多根顺序，这一层只负责读盘与容错（读不了就当没有）。
 * 任何一处失败都退化成空，不抛——素材盘拔掉不该让整条路由 500。
 * @module dsh-fish-body/src/host/pool/probe
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { warnOnce } from '../config/constants.ts';

/** 目录项是目录还是文件：符号链接按真实类型判定（Windows junction 的 isDirectory() 为假）。 */
export function kindOf(path: string): 'dir' | 'file' | undefined {
  try {
    const stat = statSync(path);
    return stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : undefined;
  } catch {
    return undefined;
  }
}

/** 列目录里的条目（读不了返回空）。 */
export function entriesOf(dir: string): Array<{ name: string; kind: 'dir' | 'file' }> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: Array<{ name: string; kind: 'dir' | 'file' }> = [];
  for (const name of names) {
    const kind = kindOf(join(dir, name));
    if (kind !== undefined) out.push({ name, kind });
  }
  return out;
}

/**
 * 读一份 json 并返回顶层对象；解析失败 / 不是对象时告警一次并返回 `undefined`。
 *
 * 坏 json 不该让整个目录从清单里消失，但也不该被当成结构文件（那会让第 1 级前缀取错）。
 *
 * @param file - json 文件绝对路径。
 * @returns 顶层对象；不是合法对象时返回 undefined。
 */
export function readJsonObject(file: string): Record<string, unknown> | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    warnOnce('pool:json:' + file, '池里的 json 解析失败，已跳过：' + file);
    return undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return raw as Record<string, unknown>;
}

/**
 * 挑出 layered 资源的结构文件：`manifest.json` > 含 `rig|schema` 的 json > 唯一的**可解析** json。
 *
 * manifest 存在但坏了会告警并继续往后找：一个坏文件不该让整套皮肤从清单里消失。
 *
 * @param dir - 资源目录。
 * @returns 结构文件绝对路径；都没有时返回 `undefined`（调用方跳过该资源并告警）。
 */
export function pickStructure(dir: string): string | undefined {
  const files = entriesOf(dir)
    .filter((entry) => entry.kind === 'file' && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.'))
    .sort();
  const cache = new Map<string, Record<string, unknown> | undefined>();
  const objOf = (name: string): Record<string, unknown> | undefined => {
    if (!cache.has(name)) cache.set(name, readJsonObject(join(dir, name)));
    return cache.get(name);
  };
  if (files.includes('manifest.json') && objOf('manifest.json') !== undefined) return join(dir, 'manifest.json');
  const structured = files.filter((name) => {
    const root = objOf(name);
    return root !== undefined && (root.rig !== undefined || root.schema !== undefined);
  });
  if (structured.length > 0) return join(dir, structured[0]);
  const usable = files.filter((name) => objOf(name) !== undefined);
  if (usable.length === 1) return join(dir, usable[0]);
  return undefined;
}
