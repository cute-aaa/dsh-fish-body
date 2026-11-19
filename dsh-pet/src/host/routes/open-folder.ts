/**
 * 打开素材 / 数据文件夹：`POST /open-folder?pet=<id>&which=…`（素材目录）或 `?which=pool-root|animations|memes|user-root`（全局目录）。
 *
 * 存在的意义是「设置页只给类别名」：目录属于哪个素材根、当前皮肤在哪一层、池里该落到哪，
 * 只有宿主知道。路径不存在时不猜、不创建，直接把算出来的路径回给调用方，由设置页提示「先放个文件」。
 * 全局类别不需要 `pet`：它们与宠物无关（池根 / 用户动画 / 表情包 / 插件数据根）。
 * @module dsh-fish-body/src/host/routes/open-folder
 */
import { existsSync, mkdirSync } from 'node:fs';
import { readAllConfig } from '../config.ts';
import { resolveFolderTarget, resolveGlobalFolder } from '../open-folder.ts';
import { isGlobalFolderTarget, isPetFolderTarget, type FolderTarget } from '../../shared/folders.ts';
import { pathsOf } from './paths.ts';
import { skinIdOfModel } from '../sfx/scan.ts';
import type { RendererKind, SfxFolderTarget } from '../../shared/types.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, methodNotAllowed, okResult } from './result.ts';

/** 类别白名单的一句话说明：报错时原样告诉调用方有哪些可选值。 */
const WHICH_HINT =
  'which 只能是 sound / skin / animation / user / package / pool-layered / pool-live2d / pool-webm / pool-sound / pool-global-sound / root / config / data / cache / runtime / skin-root / pets / assets / pool-root / animations / memes / fish-skin / user-root / pool-bucket-layered / pool-bucket-live2d / pool-bucket-webm';

/**
 * 打开文件夹领域：未命中返回 undefined，命中返回应答。
 *
 * `create=1` 时目录不存在就先建出来再打开（设置页那个「还未创建，是否创建」的气泡点「是」走这条）；
 * 不带它则只回 `not-found` 与算出来的路径，由调用方决定要不要建。
 */
export async function handleOpenFolderRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { rest } = input;
  // 匹配口径只有这一处：分发器按 rest 精确匹配，未命中就交回给下一个处理器。
  if (rest === 'open-folder') return openFolderRequest(deps, input);
  return undefined;
}

/** 命中 `open-folder` 之后的全部逻辑（与上面的路由匹配分开，匹配口径只有一处）。 */
async function openFolderRequest(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult> {
  const { method, url } = input;
  if (method !== 'POST') return methodNotAllowed();
  const which = (url.searchParams.get('which') ?? '').trim();
  const create = url.searchParams.get('create') === '1';
  try {
    // 全局类别先判：它不需要 pet，失败原因也不该被「未知宠物」冒名顶替。
    if (isGlobalFolderTarget(which)) {
      const paths = pathsOf(deps);
      const target = resolveGlobalFolder(which, {
        paths,
        pool: typeof deps.poolRoot === 'function' ? deps.poolRoot() : paths.poolDir,
      });
      return openTarget(deps, target, which, create);
    }
    if (!isPetFolderTarget(which)) return failResult('bad-request', WHICH_HINT);
    return openPetTarget(deps, input, which, create);
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
}

/**
 * 素材目录分支：按宠物与皮肤算出目录。
 *
 * @param deps - 路由依赖。
 * @param input - 请求（用 `?pet=` 定位）。
 * @param which - 素材目录类别。
 * @param create - 目录不存在时是否先创建。
 * @returns 应答。
 */
function openPetTarget(deps: PetRouteDeps, input: RouteInput, which: SfxFolderTarget, create: boolean): RouteResult {
  const cfg = readAllConfig(deps.configPaths);
  const who = deps.requirePet(input.url.searchParams, () => cfg);
  if (!who.ok) return who.res;
  const model = String(who.pet.model ?? '');
  const renderer = String(who.pet.renderer ?? 'webm') as RendererKind;
  const dirs = deps.soundDirsFor(who.entry, '.webm', { model, renderer });
  const target = resolveFolderTarget(dirs, which, skinIdOfModel(model), renderer);
  if (target === null) {
    return failResult('not-found', '这只宠物没有「' + which + '」这一类目录');
  }
  return openTarget(deps, target, which, create);
}

/**
 * 打开一个已经算好的目录（不存在且 `create` 时先递归创建）。
 *
 * @param deps - 路由依赖（只用到 `openDir`）。
 * @param target - 目录绝对路径。
 * @param which - 类别（原样回声给调用方）。
 * @param create - 目录不存在时是否先创建。
 * @returns 应答：`ok` 或 `not-found`（带 `path`）。
 */
function openTarget(deps: PetRouteDeps, target: string, which: FolderTarget, create: boolean): RouteResult {
  if (!existsSync(target)) {
    if (!create) {
      return failResult('not-found', '目录还不存在：' + target, { path: target });
    }
    mkdirSync(target, { recursive: true });
    deps.openDir(target);
    return okResult({ ok: true, which, path: target, created: true });
  }
  deps.openDir(target);
  return okResult({ ok: true, which, path: target });
}
