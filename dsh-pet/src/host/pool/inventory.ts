/**
 * 渲染资源清单：把「分层皮肤 / live2d 模型 / webm 动画」三个桶读成一份设置页能直接吃的清单。
 *
 * 只读盘、不碰 HTTP；扫描规则与 `/skin/{root}/skins`、`/skin/{root}/models` 共用同一套判定，
 * 避免「同一个目录在右键菜单里有一套资源、在设置页里是另一套」。
 *
 * 依赖方向必须保持单向：只依赖 `./resolve` / `./scan` / `shared/*`，不 import `routes/*`（否则 check:cycles 报环）。
 * @module dsh-fish-body/src/host/pool/inventory
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LAYERED_MANIFEST_PATHS, layeredBaseOf } from '../../shared/layered-paths.ts';
import { POOL_LAYER_DIR } from '../../shared/pool.ts';
import { createPoolReader } from './roots.ts';
import type { PoolScan } from './scan.ts';
import type { RendererKind } from '../../shared/types.ts';

/** 一个桶的存在性：ok = 有资源；empty = 目录在但没有结构文件；missing = 目录不在。 */
export type RenderResourceStatus = 'ok' | 'empty' | 'missing';

/** 清单里的一条资源（`id` 就是 `pets[].model` / 动画名该写什么）。 */
export interface RenderResourceItem {
  readonly id: string;
  /** 展示用名字（现在与 id 同形；留一个字段是为了将来能显示人读的标签）。 */
  readonly label: string;
  readonly source: 'pack' | 'pool';
}

/** 一个渲染方式桶。 */
export interface RenderResourceBucket {
  readonly status: RenderResourceStatus;
  /** 该桶的主目录绝对路径（pack 目录存在时给 pack 目录，否则给池桶目录）。 */
  readonly dir: string;
  /** `= items.length`。 */
  readonly count: number;
  readonly items: readonly RenderResourceItem[];
  /** 这个桶认什么结构文件（插值进缺文件文案的 `{file}`）。 */
  readonly expect: readonly string[];
  /** 空桶时缺的具体文件名；非空桶为 `[]`。**只有这一个名字**（没有 `missing`）。 */
  readonly missingFiles: readonly string[];
}

/** 三桶清单。 */
export interface RenderResources {
  readonly layered: RenderResourceBucket;
  readonly live2d: RenderResourceBucket;
  readonly webm: RenderResourceBucket;
}

/** 一个动画候选目录（`findAnim` 的候选链按顺序给）。 */
export interface RenderAnimDir {
  readonly dir: string;
  readonly source: 'pack' | 'pool';
}

/** 读一次清单的输入。 */
export interface RenderResourcesInput {
  /** 池根绝对路径（`resolvePoolRoot` 的结果）。 */
  readonly poolRoot: string;
  /** 全部皮肤根（用户 `skin/` 在前、内置池在后）；给了就按根序合并，`dir` 报第一个根。 */
  readonly poolRoots?: readonly string[];
  /** 用户的皮肤目录（`pet/<素材根>-skin/`）；不存在时按 undefined 传。 */
  readonly packSkinDir?: string;
  /** 平铺动画（webm）的候选目录，按「先 pack 后池」顺序。 */
  readonly animDirs?: readonly RenderAnimDir[];
}

/** 目录在不在（不抛；符号链接按真实类型判）。 */
function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** 列目录项（读不了返回空）。 */
function namesIn(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * 列出分层皮肤 id：根布局记空串，一级子目录里有 `manifest.json` 的记目录名。
 *
 * 与 `/skin/<root>/skins` 的判定逐字相同（那边现在调用这里）。
 *
 * @param dir - 皮肤目录（绝对路径）。
 * @returns 皮肤 id 列表；根布局在前，其后按目录名排序。
 */
export function listLayeredIds(dir: string): string[] {
  const out: string[] = [];
  for (const path of LAYERED_MANIFEST_PATHS) {
    if (existsSync(join(dir, path))) out.push(layeredBaseOf(path).replace(/\/$/, ''));
  }
  for (const name of namesIn(dir)) {
    if (!existsSync(join(dir, name, 'manifest.json'))) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * 递归列出 live2d 的 `.model3.json`（相对路径、posix 分隔符、排序稳定）。
 *
 * @param dir - 皮肤目录（绝对路径）。
 * @returns 模型相对路径；目录不存在时为空数组。
 */
export function listModelIds(dir: string): string[] {
  const out: string[] = [];
  try {
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.model3.json')) {
        const rel = entry.parentPath ? entry.parentPath.slice(dir.length).replace(/\\/g, '/') : '';
        out.push((rel ? rel.replace(/^\//, '') + '/' : '') + entry.name);
      }
    }
  } catch {
    return []; // 目录不存在 / 读失败：当作无模型。
  }
  return out.sort();
}

/**
 * 合并「旧布局（pack）∪ 池」的 id 清单：pack 在前、池在后，同名只留 pack 那一份。
 *
 * 与右键菜单的清单同一口径（`/skin/<root>/skins` / `/models`）。
 *
 * @param packIds - pack 目录里的 id。
 * @param poolIds - 池里的 id。
 * @returns 带来源标注的条目。
 */
export function mergeRenderItems(packIds: readonly string[], poolIds: readonly string[]): RenderResourceItem[] {
  const out: RenderResourceItem[] = [];
  const seen = new Set<string>();
  for (const id of packIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: id, source: 'pack' });
  }
  for (const id of poolIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: id, source: 'pool' });
  }
  return out;
}

/** 需要一个桶时把它拼出来（status / dir / missingFiles 的判定集中在这里）。 */
function bucket(input: {
  readonly items: readonly RenderResourceItem[];
  readonly dir: string;
  readonly dirExists: boolean;
  readonly expect: readonly string[];
  readonly canBeEmpty: boolean;
}): RenderResourceBucket {
  const status: RenderResourceStatus =
    input.items.length > 0 ? 'ok' : input.canBeEmpty && input.dirExists ? 'empty' : 'missing';
  return {
    status,
    dir: input.dir,
    count: input.items.length,
    items: input.items,
    expect: input.expect,
    missingFiles: status === 'ok' ? [] : [...input.expect],
  };
}

/** 平铺动画的文件名 → id（去 `.webm`）。 */
function webmItems(dirs: readonly RenderAnimDir[]): RenderResourceItem[] {
  const out: RenderResourceItem[] = [];
  const seen = new Set<string>();
  for (const entry of dirs) {
    for (const name of namesIn(entry.dir).sort()) {
      if (!name.toLowerCase().endsWith('.webm') || name.startsWith('.')) continue;
      const id = name.replace(/\.webm$/i, '');
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, label: id, source: entry.source });
    }
  }
  return out;
}

/**
 * 读三个桶的渲染资源清单。
 *
 * `dir` 的口径是「这个桶的主目录」：pack 目录存在就给 pack 目录（用户皮肤优先），否则给池桶目录——
 * 设置页只展示宿主给的 `dir`，自己拼路径会在池根改成绝对路径后说谎。
 *
 * @param input - 池根、皮肤目录与动画候选目录。
 * @returns 三桶清单；目录不存在时 status = missing，不会抛。
 */
export function readRenderResources(input: RenderResourcesInput): RenderResources {
  // 多个皮肤根（用户 `skin/` 在前、内置池在后）：`dir` 只报**第一个**根（用户目录，
  // 因为那是用户真正该往里放东西的地方），资源清单则把所有根合并去重后一起给。
  const roots = (input.poolRoots ?? [input.poolRoot]).filter((root) => root !== '');
  const poolRoot = roots[0] ?? '';
  const scans = roots.map((root) => createPoolReader(root).scan());
  const packDir = input.packSkinDir !== undefined && isDir(input.packSkinDir) ? input.packSkinDir : undefined;
  /** 各根里某渲染方式的 id 合起来（顺序即根的优先级）。 */
  const idsAcross = (pick: (scan: PoolScan) => string[]): string[] =>
    scans.flatMap((scan) => pick(scan));

  const layeredDir = packDir ?? join(poolRoot, POOL_LAYER_DIR.layered);
  const layered = bucket({
    items: mergeRenderItems(
      packDir === undefined ? [] : listLayeredIds(packDir),
      idsAcross((scan) => scan.layered.map((entry) => entry.id)),
    ),
    dir: layeredDir,
    dirExists: packDir !== undefined || roots.some((root) => isDir(join(root, POOL_LAYER_DIR.layered))),
    expect: ['manifest.json'],
    canBeEmpty: true,
  });

  const live2dDir = packDir ?? join(poolRoot, POOL_LAYER_DIR.live2d);
  const live2d = bucket({
    items: mergeRenderItems(
      packDir === undefined ? [] : listModelIds(packDir),
      idsAcross((scan) => scan.live2d.map((entry) => entry.id)),
    ),
    dir: live2dDir,
    dirExists: packDir !== undefined || roots.some((root) => isDir(join(root, POOL_LAYER_DIR.live2d))),
    expect: ['*.model3.json'],
    canBeEmpty: false,
  });

  const animDirs: readonly RenderAnimDir[] =
    input.animDirs !== undefined && input.animDirs.length > 0
      ? input.animDirs
      : [{ dir: join(poolRoot, POOL_LAYER_DIR.webm), source: 'pool' }];
  const animPrimary = animDirs.find((entry) => isDir(entry.dir))?.dir ?? join(poolRoot, POOL_LAYER_DIR.webm);
  const webm = bucket({
    items: webmItems(animDirs),
    dir: animPrimary,
    dirExists: isDir(animPrimary),
    expect: ['*.webm'],
    canBeEmpty: false,
  });

  return { layered, live2d, webm };
}

/** 三桶的固定顺序（设置页三行按它排）。@internal */
export const RENDER_BUCKETS: readonly RendererKind[] = ['layered', 'live2d', 'webm'];
