/**
 * 池的目录枚举：把 `<池>/layered`、`<池>/live2d`、`<池>/webm` 读成一份可用的资源清单。
 *
 * 只读目录、不判定音效优先级（归 host/sfx/index-build），不碰 HTTP。任何一层读不了都退化成空，
 * 所以「池还没建」与「池是空的」走同一条路径，调用方不必分支。
 * 扫描不做文件监听：{@link createPoolReader} 给一次请求内的复用，改盘后下一次请求自然读到新内容。
 * @module dsh-fish-body/src/host/pool/scan
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { warnOnce } from '../config/constants.ts';
import { POOL_SOUND_DIR } from '../../shared/pool.ts';
import { poolGlobalSoundDir, poolLayerDir, poolRendererSoundDir } from './resolve.ts';
import type { RendererKind } from '../../shared/types.ts';

/** 池里的一个 layered 资源（一级子目录）。 */
export interface PoolLayeredEntry {
  /** 皮肤 id（`pets[].model` 写它）。 */
  id: string;
  /** 资源目录的绝对路径。 */
  dir: string;
  /** 结构文件（`manifest.json` / 含 rig|schema 的 json / 唯一 json）的绝对路径；都没有时不出现该键。 */
  structureFile?: string;
  /** 结构文件基名（`xxx.json` → `xxx`），音效第 1 级的前缀。 */
  structureBase?: string;
}

/** 池里的一个 live2d 资源（一级子目录里的第一个 `.model3.json`）。 */
export interface PoolLive2dEntry {
  /** 相对 `<池>/live2d` 的模型路径（`pets[].model` 写它）。 */
  id: string;
  /** 模型所在目录的绝对路径。 */
  dir: string;
  /** `.model3.json` 的绝对路径。 */
  modelFile: string;
  /** 模型文件基名（`xx.model3.json` → `xx`），音效第 1 级的前缀。 */
  structureBase: string;
}

/** 池里的一部平铺 webm。 */
export interface PoolWebmEntry {
  /** 动画名（基名，与 `animations` 池同一口径）。 */
  id: string;
  /** 文件绝对路径。 */
  file: string;
}

/** 一次扫描的结果。 */
export interface PoolScan {
  /** 池根绝对路径。 */
  root: string;
  /** 池根是否存在（不存在 = 空池，不算错误）。 */
  exists: boolean;
  layered: readonly PoolLayeredEntry[];
  live2d: readonly PoolLive2dEntry[];
  webm: readonly PoolWebmEntry[];
  /** 全局音效目录（`<池>/sound`）。 */
  globalSoundDir: string;
  /** 渲染方式资源目录（`<池>/layered|live2d|webm`）。 */
  rendererDirs: Readonly<Record<RendererKind, string>>;
  /** 渲染方式兜底音效目录（`<池>/<渲染方式>/sound`）。 */
  rendererSoundDirs: Readonly<Record<RendererKind, string>>;
}

/** 目录项是目录还是文件：符号链接按真实类型判定（Windows junction 的 isDirectory() 为假）。 */
function kindOf(path: string): 'dir' | 'file' | undefined {
  try {
    const stat = statSync(path);
    return stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : undefined;
  } catch {
    return undefined;
  }
}

/** 列目录里的条目（读不了返回空）。 */
function entriesOf(dir: string): Array<{ name: string; kind: 'dir' | 'file' }> {
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

/** 文件名基名去掉 `.json`（`xx.model3.json` 再去掉 `.model3`）：音效第 1 级的前缀。 */
export function structureBaseOf(file: string): string {
  const name = basename(file).replace(/\.json$/i, '');
  return name.replace(/\.model3$/i, '');
}

/**
 * 读一份 json 并返回顶层对象；解析失败 / 不是对象时告警一次并返回 `undefined`。
 *
 * 坏 json 不该让整个目录从清单里消失，但也不该被当成结构文件（那会让第 1 级前缀取错）。
 *
 * @param file - json 文件绝对路径。
 * @returns 顶层对象；不是合法对象时返回 undefined。
 */
function readJsonObject(file: string): Record<string, unknown> | undefined {
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
function pickStructure(dir: string): string | undefined {
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

/**
 * 单个池资源目录的结构文件基名（音效第 1 级前缀）。
 *
 * 与 {@link readPool} 用同一套判定，只是不扫整池：`soundDirsFor` 每次请求都要它，
 * 一个目录里读几个文件名比整池扫描便宜得多。
 *
 * @param dir - 资源目录的绝对路径。
 * @returns 结构文件基名；目录里没有可用的结构文件时返回 `undefined`。
 */
export function poolStructureBaseOf(dir: string): string | undefined {
  const structureFile = pickStructure(dir);
  return structureFile === undefined ? undefined : structureBaseOf(structureFile);
}

/** 列出目录内（递归）全部 `.model3.json`，posix 相对路径、排序稳定。 */ function listModel3Files(
  dir: string,
): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of entriesOf(current)) {
      const full = join(current, entry.name);
      if (entry.kind === 'dir') {
        walk(full);
        continue;
      }
      if (entry.name.toLowerCase().endsWith('.model3.json')) {
        out.push(relative(dir, full).replace(/\\/g, '/'));
      }
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * 扫一遍池。
 *
 * @param poolRoot - 池根（绝对路径，来自 `resolvePoolRoot`）。
 * @returns 资源清单与三个目录；池根不存在时只有目录字段，三份列表为空。
 */
export function readPool(poolRoot: string): PoolScan {
  const rendererDirs: Record<RendererKind, string> = {
    layered: poolLayerDir(poolRoot, 'layered'),
    live2d: poolLayerDir(poolRoot, 'live2d'),
    webm: poolLayerDir(poolRoot, 'webm'),
  };
  const rendererSoundDirs: Record<RendererKind, string> = {
    layered: poolRendererSoundDir(poolRoot, 'layered'),
    live2d: poolRendererSoundDir(poolRoot, 'live2d'),
    webm: poolRendererSoundDir(poolRoot, 'webm'),
  };
  const base: PoolScan = {
    exists: kindOf(poolRoot) === 'dir',
    globalSoundDir: poolGlobalSoundDir(poolRoot),
    layered: [],
    live2d: [],
    rendererDirs,
    rendererSoundDirs,
    root: poolRoot,
    webm: [],
  };
  if (!base.exists) return base;

  const layered: PoolLayeredEntry[] = [];
  const live2d: PoolLive2dEntry[] = [];
  const webm: PoolWebmEntry[] = [];

  for (const entry of entriesOf(rendererDirs.layered)) {
    if (entry.kind !== 'dir' || entry.name.startsWith('.')) continue;
    // `sound/` 是该渲染方式的兜底音效目录（文档 §3 第 3 级），不是一套皮肤。
    if (entry.name === POOL_SOUND_DIR) continue;
    const dir = join(rendererDirs.layered, entry.name);
    const structureFile = pickStructure(dir);
    if (structureFile === undefined) {
      warnOnce(
        'pool:layered:' + dir,
        '池里的 layered 目录没有结构文件（manifest.json 或含 rig/schema 的 json），已跳过：' + dir,
      );
      continue;
    }
    layered.push({ dir, id: entry.name, structureBase: structureBaseOf(structureFile), structureFile });
  }

  for (const entry of entriesOf(rendererDirs.live2d)) {
    if (entry.kind !== 'dir' || entry.name.startsWith('.')) continue;
    // `sound/` 同上：兜底音效目录，不是模型资源。
    if (entry.name === POOL_SOUND_DIR) continue;
    const dir = join(rendererDirs.live2d, entry.name);
    const models = listModel3Files(dir);
    if (models.length === 0) continue; // 没有 .model3.json = 不是 live2d 资源，静默跳过
    // id 是相对 `<池>/live2d` 的路径（`pets[].model` 写什么，这里就是什么）；
    // dir 是模型文件所在目录（音效第 1/2 级用它）。
    const id = entry.name + '/' + models[0];
    live2d.push({
      dir: dirname(join(dir, models[0])),
      id,
      modelFile: join(dir, models[0]),
      structureBase: structureBaseOf(models[0]),
    });
  }

  for (const entry of entriesOf(rendererDirs.webm)) {
    if (entry.kind !== 'file' || entry.name.startsWith('.')) continue;
    if (!entry.name.toLowerCase().endsWith('.webm')) continue;
    webm.push({ file: join(rendererDirs.webm, entry.name), id: entry.name.replace(/\.webm$/i, '') });
  }

  return { ...base, layered, live2d, webm };
}

/** 一次请求内复用的池读取器（同一个实例只扫一次）。 */
export interface PoolReader {
  /** 读一次并缓存；同实例后续调用返回同一份结果。 */
  scan(): PoolScan;
}

/**
 * 造一个惰性池读取器。
 *
 * 为什么不做时间缓存：池是用户随时会改的目录，跨请求缓存等于让「放完文件刷新就好了」失效；
 * 而同一请求里音效索引、取文件、清单三处都要扫，重复扫盘纯属浪费。一请求一实例正好。
 *
 * @param poolRoot - 池根。
 * @returns 带 `scan()` 的读取器。
 */
export function createPoolReader(poolRoot: string): PoolReader {
  let cached: PoolScan | undefined;
  return {
    scan: () => (cached ??= readPool(poolRoot)),
  };
}

/**
 * 列出某个渲染方式在池里的资源 id（供清单接口合并「旧皮肤 ∪ 池资源」）。
 *
 * @param scan - 一次扫描结果。
 * @param renderer - 渲染方式。
 * @returns 资源 id 列表（layered：目录名；live2d：`.model3.json` 相对路径；webm：基名）。
 */
export function poolIdsOf(scan: PoolScan, renderer: RendererKind): string[] {
  if (renderer === 'layered') return scan.layered.map((entry) => entry.id);
  if (renderer === 'live2d') return scan.live2d.map((entry) => entry.id);
  return scan.webm.map((entry) => entry.id);
}
