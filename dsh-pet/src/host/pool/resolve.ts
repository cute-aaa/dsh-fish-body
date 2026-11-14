/**
 * 池根的解析与池内路径计算：`assets.pool` → 池根，再派生渲染方式目录、资源目录与声效目录。
 *
 * 只算路径、不查存在性：目录在不在由调用方（open-folder 提示、扫描、路由候选）决定。
 * 必须始终成立：任何从请求/配置来的相对片段都经 {@link insideRoot} 规整，`..` 与绝对路径一律拒绝。
 * @module dsh-fish-body/src/host/pool/resolve
 */
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import {
  MAX_RESOURCE_DIRS,
  POOL_DEFAULT_DIR,
  POOL_LAYER_DIR,
  POOL_LEGACY_DIRS,
  POOL_SOUND_DIR,
} from '../../shared/pool.ts';
import type { RendererKind } from '../../shared/types.ts';

/** 三渲染方式的白名单（顺序即池内目录的探测顺序）。 */
const RENDERER_ORDER: readonly RendererKind[] = ['layered', 'live2d', 'webm'];

/** 历史默认值只提示一次：每次读配置都喊一遍会把日志刷满。 */
let legacyPoolWarned = false;

/**
 * 池根：`assets.pool` 是相对用户根（默认 `assets/pet`）或绝对路径。
 *
 * 缺省、空串、非字符串、写坏了一律回落 `<用户根>/assets/pet`——池是可选布局，配错不该让宿主报错。
 * 命中 {@link POOL_LEGACY_DIRS} 的旧默认值同样按默认处理：那些值是我们自己写进用户配置的，
 * 归一是升级的一部分，不该变成一次「皮肤消失」。
 *
 * @param userRoot - 本插件的用户数据根。
 * @param assets - 成品配置里读到的 `assets` 段（`unknown`：可能来自用户手改）。
 * @returns 规范化的绝对池根。
 */
export function resolvePoolRoot(userRoot: string, assets: unknown): string {
  const raw =
    assets && typeof assets === 'object' && !Array.isArray(assets)
      ? (assets as Record<string, unknown>).pool
      : undefined;
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') return join(userRoot, POOL_DEFAULT_DIR);
  if (POOL_LEGACY_DIRS.includes(value.split('\\').join('/'))) {
    if (!legacyPoolWarned) {
      legacyPoolWarned = true;
      console.warn(`[fish-body] assets.pool=${value} 是旧默认路径，已按新的 ${POOL_DEFAULT_DIR} 处理`);
    }
    return join(userRoot, POOL_DEFAULT_DIR);
  }
  return isAbsolute(value) ? normalize(value) : join(userRoot, value);
}

/**
 * 额外的素材根（`assets.resourceDirs`）：绝对路径或相对用户根，按顺序去重。
 *
 * 语义与 `assets.pool` 同级——都是「这台机器上的共享素材库」，只是主根写在 `pool`、其余排在这里。
 * 手改配置可能绕过校验层，所以这里逐项宽容：非字符串 / 空白项直接跳过（不是错误），
 * 路径只做 `normalize` 不做 `existsSync`（素材盘拔掉时不该让整段配置失效）。
 * 与主根重复的项会被丢掉——同一个目录扫两遍只会让同名资源互相告警。
 *
 * @param userRoot - 本插件的用户数据根。
 * @param assets - 成品配置里读到的 `assets` 段。
 * @param primaryRoot - 已解析好的主根（缺省时现算）；用于去重与顺序基准。
 * @returns 绝对路径列表，最多 {@link MAX_RESOURCE_DIRS} 条；没有额外根时为空数组。
 */
export function resolveResourceDirs(userRoot: string, assets: unknown, primaryRoot?: string): string[] {
  const raw =
    assets && typeof assets === 'object' && !Array.isArray(assets)
      ? (assets as Record<string, unknown>).resourceDirs
      : undefined;
  if (!Array.isArray(raw)) return [];
  const primary = primaryRoot ?? resolvePoolRoot(userRoot, assets);
  const seen = new Set<string>([normalize(primary).toLowerCase()]);
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const value = item.trim();
    if (value === '') continue;
    const absolute = isAbsolute(value) ? normalize(value) : join(userRoot, value);
    const key = absolute.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(absolute);
    if (out.length >= MAX_RESOURCE_DIRS) break;
  }
  return out;
}

/**
 * 池根的**有序表**：主根在前，其后是 `resourceDirs`（同 id 资源先到先得就靠这个顺序）。
 *
 * @param userRoot - 本插件的用户数据根。
 * @param assets - 成品配置里读到的 `assets` 段。
 * @returns 至少一项（主根永远不会缺席）。
 */
export function resolvePoolRoots(userRoot: string, assets: unknown): string[] {
  const primary = resolvePoolRoot(userRoot, assets);
  return [primary, ...resolveResourceDirs(userRoot, assets, primary)];
}

/**
 * 把相对片段拼进根目录并确认没逃出去。
 *
 * 与 `host/http.ts` 的 `resolveAsset` 同一判定（规范化后必须以「根 + 分隔符」开头），
 * 单独留一份是因为池根可能来自绝对路径配置，而 resolveAsset 只接受「根 + 相对」。
 *
 * @param root - 绝对根目录。
 * @param rel - 相对片段（可含 `/` 分层）。
 * @returns 规范化后的绝对路径；片段为空或逃出根目录时返回 `undefined`。
 */
export function insideRoot(root: string, rel: string): string | undefined {
  if (rel.trim() === '') return undefined;
  const rootAbs = normalize(root);
  const candidate = resolve(rootAbs, rel);
  const relFromRoot = relative(rootAbs, candidate);
  if (relFromRoot === '') return candidate;
  if (isAbsolute(relFromRoot) || relFromRoot.startsWith('..')) return undefined;
  return candidate;
}

/**
 * 某个渲染方式在池里的目录（`<池>/layered|live2d|webm`）。
 *
 * @param poolRoot - 池根。
 * @param renderer - 渲染方式。
 * @returns 绝对目录。
 */
export function poolLayerDir(poolRoot: string, renderer: RendererKind): string {
  return join(poolRoot, POOL_LAYER_DIR[renderer]);
}

/**
 * 该渲染方式的兜底音效目录（`<池>/<渲染方式>/sound`）。
 *
 * @param poolRoot - 池根。
 * @param renderer - 渲染方式。
 * @returns 绝对目录。
 */
export function poolRendererSoundDir(poolRoot: string, renderer: RendererKind): string {
  return join(poolLayerDir(poolRoot, renderer), POOL_SOUND_DIR);
}

/**
 * 池的全局音效目录（`<池>/sound`）。
 *
 * @param poolRoot - 池根。
 * @returns 绝对目录。
 */
export function poolGlobalSoundDir(poolRoot: string): string {
  return join(poolRoot, POOL_SOUND_DIR);
}

/**
 * 某条宠物在该渲染方式下的池资源目录。
 *
 * layered：`<池>/layered/<model>`；live2d：`<池>/live2d/<model 所在目录>`（model 是 `.model3.json`
 * 的相对路径）；webm 没有资源目录（平铺），返回 `undefined`。
 *
 * @param poolRoot - 池根。
 * @param renderer - 渲染方式。
 * @param model - `pets[].model` 原值（可为空串）。
 * @returns 绝对目录；渲染方式不适用或路径非法时返回 `undefined`。
 */
export function poolEntryDir(
  poolRoot: string,
  renderer: RendererKind,
  model: string | undefined | null,
): string | undefined {
  if (renderer === 'webm') return undefined;
  const raw = (model ?? '').trim().replace(/\\/g, '/');
  if (raw === '') return undefined;
  const layer = poolLayerDir(poolRoot, renderer);
  if (renderer === 'layered') return insideRoot(layer, raw);
  // live2d：model 是 `.model3.json` 的相对路径，资源目录是它所在的那一层；
  // 模型直接摆在 `<池>/live2d` 下时资源目录就是该层（音效第 1/2 级前缀取文件基名与 `live2d`）。
  const cut = raw.lastIndexOf('/');
  const dirRel = cut < 0 ? '' : raw.slice(0, cut);
  return dirRel === '' ? layer : insideRoot(layer, dirRel);
}

/**
 * 池里的一部平铺动画（webm）文件。
 *
 * @param poolRoot - 池根。
 * @param name - 动画名（不含扩展名）。
 * @param ext - 扩展名（含点，`.webm` / `.mov`）。
 * @returns 绝对路径；名字非法时返回 `undefined`。
 */
export function poolWebmFile(poolRoot: string, name: string, ext: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === '') return undefined;
  return insideRoot(poolLayerDir(poolRoot, 'webm'), trimmed + ext);
}

/**
 * 把绝对路径折回「相对用户根」的 posix 形式，供设置页展示（`skin/layered/x/x-click.wav`）。
 *
 * 池根配成绝对路径且落在用户根之外时，`relative` 会带 `../`——这时原样返回绝对路径，
 * 免得设置页印出一串 `../../../`。
 *
 * @param userRoot - 用户数据根。
 * @param target - 目标绝对路径。
 * @returns 可读路径（posix 分隔符）。
 */
export function displayPathOf(userRoot: string, target: string): string {
  const rel = relative(userRoot, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return target.replace(/\\/g, '/');
  return rel.replace(/\\/g, '/');
}

/** 三渲染方式的探测顺序（池清单接口按它列资源）。@internal */
export const POOL_RENDERERS: readonly RendererKind[] = RENDERER_ORDER;
