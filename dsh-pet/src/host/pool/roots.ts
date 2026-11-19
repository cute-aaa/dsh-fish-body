/**
 * 多素材根（`assets.pool` + `assets.resourceDirs`）的池视图：合并扫描、一次请求内复用、按根序定位资源。
 *
 * 为什么要有这一层：`scan.ts` 只认一个目录，而「主池根 + 若干外部素材根」需要**顺序**——
 * 同名资源先到先得（主根优先），取文件时按同一个顺序试，否则会出现「清单里有一套、点下去 404」。
 * 合并只做两件事：拼接三份清单（同 id 去重，先出现的赢）与记住根序；不判音效优先级。
 *
 * 为什么外部根允许 `bare` 布局：用户手里的皮肤库几乎都是「一级子目录 = 一套皮肤」
 * （`D:\AI\FishChi\body\skins\feiyu-01\manifest.json`），硬要求再套一层 `layered/` 等于让人先搬文件。
 * 主池根不受影响：它必须带 `layered/live2d/webm`，缺了就是空池。
 * @module dsh-fish-body/src/host/pool/roots
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { POOL_LAYER_DIR } from '../../shared/pool.ts';
import { warnOnce } from '../config/constants.ts';
import { insideRoot, poolEntryDir, poolLayerDir } from './resolve.ts';
import {
  readPool,
  type PoolLayout,
  type PoolLive2dEntry,
  type PoolLayeredEntry,
  type PoolReader,
  type PoolScan,
  type PoolWebmEntry,
} from './scan.ts';
import type { RendererKind } from '../../shared/types.ts';

/** 三个渲染方式的探测顺序（`/skin/pool/<file>` 不带桶时按它试）。 */
const RENDERER_LAYERS: readonly RendererKind[] = ['layered', 'live2d', 'webm'];

/**
 * 一个根的布局：有任一渲染方式子目录就按标准池布局，否则当成资源集合目录。
 *
 * @param root - 根绝对路径。
 * @returns 布局形态。
 */
function layoutOf(root: string): PoolLayout {
  for (const layer of RENDERER_LAYERS) {
    if (existsSync(join(root, POOL_LAYER_DIR[layer]))) return 'pool';
  }
  return 'bare';
}

/** 某个根里某条宠物的资源目录（按布局算；webm 没有资源目录）。 */
function entryDirIn(
  root: string,
  layout: PoolLayout,
  renderer: RendererKind,
  model: string | undefined | null,
): string | undefined {
  if (layout === 'pool') return poolEntryDir(root, renderer, model);
  if (renderer === 'webm') return undefined;
  const raw = (model ?? '').trim().replace(/\\/g, '/');
  if (raw === '') return undefined;
  if (renderer === 'layered') return insideRoot(root, raw);
  // live2d：model 是 `.model3.json` 的相对路径，资源目录是它所在的那一层
  const cut = raw.lastIndexOf('/');
  return cut < 0 ? root : insideRoot(root, raw.slice(0, cut));
}

/**
 * 追加一个资源条目；同 id 已在表里时跳过并告警一次。
 *
 * @param target - 目标列表。
 * @param seen - 已出现过的 id（小写）。
 * @param entry - 候选条目。
 * @param kind - 资源种类（只用于告警文案与去重键前缀）。
 */
function takeEntry<T extends { id: string; root: string }>(
  target: T[],
  seen: Set<string>,
  entry: T,
  kind: string,
): void {
  const key = entry.id.toLowerCase();
  if (seen.has(key)) {
    // 同一套皮肤出现在多个根里：用先出现的那个（主根在前），但要让人知道有重复
    warnOnce(
      'pool:dup:' + kind + ':' + key,
      `多个素材根里都有 ${kind}「${entry.id}」，已用先出现的那个（${entry.root}）`,
    );
    return;
  }
  seen.add(key);
  target.push(entry);
}

/**
 * 合并多个根的扫描结果。
 *
 * @param scans - 按根序排列的扫描结果（第一份是主根）。
 * @param roots - 全部根（写进结果，供路由按根序取文件）。
 * @returns 合并后的池视图：目录字段取主根，三份清单按根序拼接去重。
 */
export function readPoolRoots(scans: readonly PoolScan[], roots: readonly string[]): PoolScan {
  const base: PoolScan = scans[0] ?? readPool('');
  const layered: PoolLayeredEntry[] = [];
  const live2d: PoolLive2dEntry[] = [];
  const webm: PoolWebmEntry[] = [];
  const seenLayered = new Set<string>();
  const seenLive2d = new Set<string>();
  const seenWebm = new Set<string>();
  for (const scan of scans) {
    for (const entry of scan.layered) takeEntry(layered, seenLayered, entry, 'layered');
    for (const entry of scan.live2d) takeEntry(live2d, seenLive2d, entry, 'live2d');
    for (const entry of scan.webm) takeEntry(webm, seenWebm, entry, 'webm');
  }
  return { ...base, exists: scans.some((scan) => scan.exists), layered, live2d, roots, webm };
}

/**
 * 扫一组根并合并（单根时退化成 `readPool`，不额外分配）。
 *
 * @param roots - 根序（主根在前）；空数组按空池处理。
 * @returns 合并后的池视图。
 */
export function readPoolRootsOf(roots: readonly string[]): PoolScan {
  const list = roots.filter((root) => root !== '');
  if (list.length === 0) return readPool('');
  if (list.length === 1) return readPool(list[0]!);
  return readPoolRoots(
    list.map((root, index) => readPool(root, index === 0 ? 'pool' : layoutOf(root))),
    list,
  );
}

/**
 * 造一个惰性池读取器（一次请求内只扫一次）。
 *
 * 为什么不做时间缓存：池是用户随时会改的目录，跨请求缓存等于让「放完文件刷新就好了」失效；
 * 而同一请求里音效索引、取文件、清单三处都要扫，重复扫盘纯属浪费。一请求一实例正好。
 *
 * @param roots - 根序，或单个根（老调用方传字符串）。
 * @returns 带 `scan()` 的读取器。
 */
export function createPoolReader(roots: string | readonly string[]): PoolReader {
  const list = typeof roots === 'string' ? [roots] : [...roots];
  let cached: PoolScan | undefined;
  return {
    scan: () => (cached ??= readPoolRootsOf(list)),
  };
}

/**
 * 某个渲染方式在各根里的候选目录（按根序）。
 *
 * 取文件时用它：`pool` 布局是 `<根>/<渲染方式>`，`bare` 布局就是根本身（皮肤集合目录）。
 * 主根永远按 `pool` 布局算——它是本插件自己的池，不该因为暂时没建目录就被当成皮肤集合。
 *
 * @param roots - 根序（主根在前）。
 * @param renderer - 渲染方式。
 * @returns 目录列表（顺序即优先级）。
 */
export function poolLayerDirs(roots: readonly string[], renderer: RendererKind): string[] {
  const out: string[] = [];
  for (const [index, root] of roots.entries()) {
    if (root === '') continue;
    out.push(index === 0 || layoutOf(root) === 'pool' ? poolLayerDir(root, renderer) : root);
  }
  return out;
}

/**
 * 某条宠物在某渲染方式下的**真实**资源目录：按根序找第一个存在的。
 *
 * 为什么逐根 `existsSync` 而不是先整池扫描：`soundDirsFor` 每个请求都要它，
 * 而池可能有很多资源；这里只关心「这个 model 落在哪个根」，几次目录探测就够，
 * 整池扫描是清单接口才需要的开销。
 *
 * @param roots - 根序（主根在前）。
 * @param renderer - 渲染方式。
 * @param model - `pets[].model` 原值。
 * @returns 第一个存在的资源目录；都不存在（或渲染方式不适用）返回 `undefined`。
 */
export function poolEntryDirAcross(
  roots: readonly string[],
  renderer: RendererKind,
  model: string | undefined | null,
): string | undefined {
  for (const [index, root] of roots.entries()) {
    if (root === '') continue;
    const dir = entryDirIn(root, index === 0 ? 'pool' : layoutOf(root), renderer, model);
    if (dir !== undefined && existsSync(dir)) return dir;
  }
  return undefined;
}
