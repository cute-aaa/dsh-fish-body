/**
 * 池的目录枚举：把 `<池>/layered`、`<池>/live2d`、`<池>/webm` 读成一份可用的资源清单。
 *
 * 只读目录、不判定音效优先级（归 host/sfx/index-build），不碰 HTTP。任何一层读不了都退化成空，
 * 所以「池还没建」与「池是空的」走同一条路径，调用方不必分支。
 * 本模块只扫**一个**根；`assets.resourceDirs` 的多根合并、一次请求内的复用与「某资源在哪个根」
 * 都在 `./roots.ts`（那边才需要知道根的顺序，这里只认目录）。
 * 扫描不做文件监听：改盘后下一次请求自然读到新内容。
 * @module dsh-fish-body/src/host/pool/scan
 */
import { basename, dirname, join, relative } from 'node:path';
import { warnOnce } from '../config/constants.ts';
import { POOL_SOUND_DIR } from '../../shared/pool.ts';
import { entriesOf, kindOf, pickStructure } from './probe.ts';
import { poolGlobalSoundDir, poolLayerDir, poolRendererSoundDir } from './resolve.ts';
import type { RendererKind } from '../../shared/types.ts';

/**
 * 一个根的布局形态。
 *
 * `pool` = 标准池布局（`<根>/layered|live2d|webm|sound`）；`bare` = 资源集合目录
 * （一级子目录本身就是一套皮肤/模型，`feiyu-01/manifest.json` 这种）。
 * 主池根只认 `pool`（缺目录就是空池）；`assets.resourceDirs` 的外部根两种都认——
 * 用户手里的皮肤库几乎都是 `bare` 形态，硬要求 `layered/` 一层等于让人先搬一遍文件。
 */
export type PoolLayout = 'pool' | 'bare';

/** 按布局算出三类目录（bare 时三个渲染方式都指向根本身）。 */
function dirsOf(
  root: string,
  layout: PoolLayout,
): Pick<PoolScan, 'rendererDirs' | 'rendererSoundDirs' | 'globalSoundDir'> {
  if (layout === 'bare') {
    const same: Record<RendererKind, string> = { layered: root, live2d: root, webm: root };
    return { globalSoundDir: join(root, POOL_SOUND_DIR), rendererDirs: same, rendererSoundDirs: same };
  }
  return {
    globalSoundDir: poolGlobalSoundDir(root),
    rendererDirs: {
      layered: poolLayerDir(root, 'layered'),
      live2d: poolLayerDir(root, 'live2d'),
      webm: poolLayerDir(root, 'webm'),
    },
    rendererSoundDirs: {
      layered: poolRendererSoundDir(root, 'layered'),
      live2d: poolRendererSoundDir(root, 'live2d'),
      webm: poolRendererSoundDir(root, 'webm'),
    },
  };
}

/** 池里的一个 layered 资源（一级子目录）。 */
export interface PoolLayeredEntry {
  /** 皮肤 id（`pets[].model` 写它）。 */
  id: string;
  /** 资源目录的绝对路径。 */
  dir: string;
  /** 这个资源来自哪个素材根（主池根或 `assets.resourceDirs` 里的一项）。 */
  root: string;
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
  /** 这个资源来自哪个素材根。 */
  root: string;
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
  /** 这个文件来自哪个素材根。 */
  root: string;
}

/** 一次扫描的结果。 */
export interface PoolScan {
  /** 主池根绝对路径（多根时是第一个）。 */
  root: string;
  /** 本次参与扫描的全部素材根（主根在前）。 */
  roots: readonly string[];
  /** 主池根是否存在（不存在 = 空池，不算错误）。 */
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

/** 文件名基名去掉 `.json`（`xx.model3.json` 再去掉 `.model3`）：音效第 1 级的前缀。 */
export function structureBaseOf(file: string): string {
  const name = basename(file).replace(/\.json$/i, '');
  return name.replace(/\.model3$/i, '');
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
 * 扫一遍**一个**根。
 *
 * @param poolRoot - 根（绝对路径，来自 `resolvePoolRoot` / `resolvePoolRoots` 的某一项）。
 * @param layout - 布局形态（主池 `pool`；外部素材根可为 `bare`，见 {@link PoolLayout}）。
 * @returns 资源清单与三个目录；根不存在时只有目录字段，三份列表为空。
 */
export function readPool(poolRoot: string, layout: PoolLayout = 'pool'): PoolScan {
  const { rendererDirs, rendererSoundDirs, globalSoundDir } = dirsOf(poolRoot, layout);
  const base: PoolScan = {
    exists: kindOf(poolRoot) === 'dir',
    globalSoundDir,
    layered: [],
    live2d: [],
    rendererDirs,
    rendererSoundDirs,
    root: poolRoot,
    roots: [poolRoot],
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
    layered.push({ dir, id: entry.name, root: poolRoot, structureBase: structureBaseOf(structureFile), structureFile });
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
      root: poolRoot,
      structureBase: structureBaseOf(models[0]),
    });
  }

  for (const entry of entriesOf(rendererDirs.webm)) {
    if (entry.kind !== 'file' || entry.name.startsWith('.')) continue;
    if (!entry.name.toLowerCase().endsWith('.webm')) continue;
    webm.push({ file: join(rendererDirs.webm, entry.name), id: entry.name.replace(/\.webm$/i, ''), root: poolRoot });
  }

  return { ...base, layered, live2d, webm };
}

/** 一次请求内复用的池读取器（同一个实例只扫一次）。 */
export interface PoolReader {
  /** 读一次并缓存；同实例后续调用返回同一份结果。 */
  scan(): PoolScan;
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
