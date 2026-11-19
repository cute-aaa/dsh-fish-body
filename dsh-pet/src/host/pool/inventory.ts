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

/** 一个桶的存在性：ok = 有资源可用；empty = 目录在但没有结构文件；missing = 目录不在且没有回落。 */
export type RenderResourceStatus = 'ok' | 'empty' | 'missing';

/**
 * 一条资源的来源：
 * - `pool`：该行的行目录（`skin/<渲染方式>`，用户往里放东西的地方）；
 * - `pack`：这只宠物自己的皮肤目录（`<素材根>-skin/`）；
 * - `builtin`：其它池根 / 包内共享素材（默认配置里就是内置素材库）。
 */
export type RenderResourceSource = 'pack' | 'pool' | 'builtin';

/** 清单里的一条资源（`id` 就是 `pets[].model` / 动画名该写什么）。 */
export interface RenderResourceItem {
  readonly id: string;
  /** 展示用名字（现在与 id 同形；留一个字段是为了将来能显示人读的标签）。 */
  readonly label: string;
  readonly source: RenderResourceSource;
}

/**
 * 行目录之外的可用资源（回落）：**数量单独给，混进 `count` 就会让「行上写的目录」和「数出来的数」不符**。
 *
 * 只报一个来源：按各来源的条数取最多的那个（并列时 builtin > pack > pool），
 * 让文案能说一句人话（「另有 114 项来自内置素材」），而不是给用户四个数字。
 */
export interface RenderResourceFallback {
  readonly count: number;
  readonly source: RenderResourceSource;
}

/** 一个渲染方式桶。 */
export interface RenderResourceBucket {
  readonly status: RenderResourceStatus;
  /** 该行的用户目录绝对路径：`<用户皮肤根>/<layered|live2d|webm>`（行名写的就是它）。 */
  readonly dir: string;
  /** `= items.length`，**只数 `dir` 里的资源**。 */
  readonly count: number;
  /** `dir` 里的资源；其它来源见 {@link RenderResourceBucket.fallback}。 */
  readonly items: readonly RenderResourceItem[];
  /**
   * 选择器可用的**全部**资源（`dir` 在前，其后是回落来源）。
   *
   * `count` / `items` 只服务「这一行有几个」；模型/皮肤下拉要的是「用户能选什么」，
   * 少了回落项，正在用的内置皮肤就会被判成「已失效」。
   */
  readonly available: readonly RenderResourceItem[];
  /** 这个桶认什么结构文件（插值进缺文件文案的 `{file}`）。 */
  readonly expect: readonly string[];
  /** 空桶时缺的具体文件名；非空桶为 `[]`。**只有这一个名字**（没有 `missing`）。 */
  readonly missingFiles: readonly string[];
  /** 行目录之外还能用的资源；没有时缺省（不渲染这一段）。 */
  readonly fallback?: RenderResourceFallback;
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
 * 合并多来源的 id 清单：按给定顺序去重，先出现的那份赢。
 *
 * 与右键菜单的清单同一口径（`/skin/<root>/skins` / `/models`）。
 *
 * @param groups - 逐组的 {ids, source}；顺序即优先级。
 * @returns 带来源标注的条目。
 */
export function mergeRenderItems(
  groups: readonly { readonly ids: readonly string[]; readonly source: RenderResourceSource }[],
): RenderResourceItem[] {
  const out: RenderResourceItem[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const id of group.ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, label: id, source: group.source });
    }
  }
  return out;
}

/** 需要一个桶时把它拼出来（status / dir / missingFiles / fallback 的判定集中在这里）。 */
function bucket(input: {
  readonly dir: string;
  readonly dirExists: boolean;
  readonly local: readonly RenderResourceItem[];
  /** 行目录之外的全部候选（按来源分组，顺序即优先级）。 */
  readonly others: readonly { readonly ids: readonly string[]; readonly source: RenderResourceSource }[];
  readonly expect: readonly string[];
  readonly canBeEmpty: boolean;
}): RenderResourceBucket {
  const localIds = new Set(input.local.map((item) => item.id));
  const extra = mergeRenderItems(input.others).filter((item) => !localIds.has(item.id));
  // 行目录空但别处有货：仍算「可用」（不弹缺文件横幅），数量靠 fallback 单独说。
  const status: RenderResourceStatus =
    input.local.length > 0 || extra.length > 0 ? 'ok' : input.canBeEmpty && input.dirExists ? 'empty' : 'missing';
  const fallback = extra.length === 0 ? undefined : { count: extra.length, source: dominantSource(extra) };
  return {
    status,
    dir: input.dir,
    count: input.local.length,
    items: input.local,
    available: [...input.local, ...extra],
    expect: input.expect,
    missingFiles: status === 'ok' ? [] : [...input.expect],
    ...(fallback === undefined ? {} : { fallback }),
  };
}

/** 一组回落条目里条数最多的来源（并列时 builtin > pack > pool，避免「内置」被用户目录盖掉）。 */
function dominantSource(items: readonly RenderResourceItem[]): RenderResourceSource {
  const order: readonly RenderResourceSource[] = ['builtin', 'pack', 'pool'];
  const tally = new Map<RenderResourceSource, number>();
  for (const item of items) tally.set(item.source, (tally.get(item.source) ?? 0) + 1);
  let best: RenderResourceSource = 'pool';
  let bestCount = -1;
  for (const source of order) {
    const count = tally.get(source) ?? 0;
    if (count > bestCount) {
      best = source;
      bestCount = count;
    }
  }
  return best;
}

/** 平铺动画的文件名 → id（去 `.webm`）。 */
function webmIds(dir: string): string[] {
  return namesIn(dir)
    .filter((name) => name.toLowerCase().endsWith('.webm') && !name.startsWith('.'))
    .map((name) => name.replace(/\.webm$/i, ''))
    .sort();
}

/**
 * 读三个桶的渲染资源清单。
 *
 * 口径（验收 3 / QA-16 / QA-31 的共同判据）：
 * - `dir` 是本行的**用户目录** `<用户皮肤根>/<layered|live2d|webm>`——行名写的是 `skin/<桶>`，
 *   数出来的数就必须是那个目录里的数；
 * - `count` / `items` **只数 `dir`**；
 * - 这只宠物自己的皮肤目录（`<素材根>-skin/`）、其它池根与包内共享素材只能进 `fallback`，
 *   让设置页说「另有 N 项来自 X」，而不是把别人的资源算进这一行。
 *
 * 设置页只展示宿主给的 `dir`（不自己拼路径），池根改成绝对路径后三行仍然说真话。
 *
 * @param input - 池根、皮肤目录与动画候选目录。
 * @returns 三桶清单；三个来源都没有时 status = missing，不会抛。
 */
export function readRenderResources(input: RenderResourcesInput): RenderResources {
  // 多个皮肤根（用户 `skin/` 在前、内置池在后）：行目录取**第一个**根（用户真正往里放东西的地方）。
  const roots = (input.poolRoots ?? [input.poolRoot]).filter((root) => root !== '');
  const poolRoot = roots[0] ?? '';
  const scans = roots.map((root) => createPoolReader(root).scan());
  const packDir = input.packSkinDir !== undefined && isDir(input.packSkinDir) ? input.packSkinDir : undefined;
  /** 某个根里某渲染方式的 id（顺序即根的优先级）。 */
  const idsIn = (scan: PoolScan, pick: (scan: PoolScan) => string[]): string[] => pick(scan);
  /** 第 2 个及以后的根（默认配置里就是包内内置池）→ `builtin`。 */
  const builtinIds = (pick: (scan: PoolScan) => string[]): readonly string[] =>
    scans.slice(1).flatMap((s) => idsIn(s, pick));

  /** 路径是否在 `parent` 目录下（都按 Windows 分隔符归一后比前缀）。 */
  const under = (child: string, parent: string): boolean => {
    const c = child.replace(/\//g, '\\').toLowerCase();
    const p = parent.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '');
    return c === p || c.startsWith(p + '\\');
  };

  /**
   * 行目录里的条目 / 第一个根其余条目。
   *
   * 判定用**第一个根的池扫描结果**（`createPoolReader(root).scan()`）按路径过滤，而不是重新扫行目录：
   * 扫描认三种结构（manifest / rig+schema / 目录里唯一 json），只认 manifest 会把
   * 「用户把无 manifest 的 rig 皮肤放进 skin/layered/x」数成 0；而直接扫 `skin/layered`
   * 又会被标准池布局再套一层 `layered/` 目录。按父扫描结果 + 路径前缀过滤，两个坑都绕开。
   */
  const scanEntriesOf = (
    scan: PoolScan | undefined,
    kind: 'layered' | 'live2d',
  ): readonly { id: string; dir: string }[] =>
    scan === undefined ? [] : kind === 'layered' ? scan.layered : scan.live2d;
  const localItems = (rowDir: string, kind: RendererKind): RenderResourceItem[] => {
    if (kind === 'webm') {
      return webmIds(rowDir).map((id) => ({ id, label: id, source: 'pool' as const }));
    }
    return scanEntriesOf(scans[0], kind)
      .filter((entry) => under(entry.dir, rowDir))
      .map((entry) => ({ id: entry.id, label: entry.id, source: 'pool' as const }));
  };
  /** 第一个根里**不在行目录**的条目（根布局皮肤）→ `pool`。 */
  const firstRootIds = (rowDir: string, kind: 'layered' | 'live2d'): readonly string[] =>
    scanEntriesOf(scans[0], kind)
      .filter((entry) => !under(entry.dir, rowDir))
      .map((entry) => entry.id);

  const layeredDir = join(poolRoot, POOL_LAYER_DIR.layered);
  const layered = bucket({
    dir: layeredDir,
    dirExists: roots.some((root) => isDir(join(root, POOL_LAYER_DIR.layered))),
    local: localItems(layeredDir, 'layered'),
    others: [
      { ids: packDir === undefined ? [] : listLayeredIds(packDir), source: 'pack' },
      { ids: firstRootIds(layeredDir, 'layered'), source: 'pool' },
      { ids: builtinIds((scan) => scan.layered.map((entry) => entry.id)), source: 'builtin' },
    ],
    expect: ['manifest.json'],
    canBeEmpty: true,
  });

  const live2dDir = join(poolRoot, POOL_LAYER_DIR.live2d);
  const live2d = bucket({
    dir: live2dDir,
    dirExists: roots.some((root) => isDir(join(root, POOL_LAYER_DIR.live2d))),
    local: localItems(live2dDir, 'live2d'),
    others: [
      { ids: packDir === undefined ? [] : listModelIds(packDir), source: 'pack' },
      { ids: firstRootIds(live2dDir, 'live2d'), source: 'pool' },
      { ids: builtinIds((scan) => scan.live2d.map((entry) => entry.id)), source: 'builtin' },
    ],
    expect: ['*.model3.json'],
    canBeEmpty: false,
  });

  const animDirs: readonly RenderAnimDir[] =
    input.animDirs !== undefined && input.animDirs.length > 0
      ? input.animDirs
      : [{ dir: join(poolRoot, POOL_LAYER_DIR.webm), source: 'pool' }];
  const webmDir = join(poolRoot, POOL_LAYER_DIR.webm);
  const webm = bucket({
    dir: webmDir,
    dirExists: isDir(webmDir),
    local: localItems(webmDir, 'webm'),
    // 候选链里排在行目录之前的专属目录算 pack，其余共享/包内目录算 builtin。
    others: [
      {
        ids: animDirs.filter((entry) => entry.source === 'pack').flatMap((entry) => webmIds(entry.dir)),
        source: 'pack',
      },
      {
        ids: animDirs
          .filter((entry) => entry.source !== 'pack' && entry.dir !== webmDir)
          .flatMap((entry) => webmIds(entry.dir)),
        source: 'builtin',
      },
    ],
    expect: ['*.webm'],
    canBeEmpty: false,
  });

  return { layered, live2d, webm };
}

/** 三桶的固定顺序（设置页三行按它排）。@internal */
export const RENDER_BUCKETS: readonly RendererKind[] = ['layered', 'live2d', 'webm'];
