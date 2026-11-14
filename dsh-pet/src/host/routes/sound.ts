/**
 * 音效索引路由：`GET /sound/<素材根>/index?renderer=&model=`。
 *
 * 只做参数校验与拼装：扫目录在 ../sfx/scan，优先级与内置默认在 ../sfx/index-build，
 * 命中路径与「建议放这里」在 ../sfx/paths。素材根写 `pool` 时只查共享资源池（保留虚拟根）。
 * 索引是「这台机器上实际有什么」的唯一出口——客户端据此决定播哪个文件，不做任何 404 探测。
 * @module dsh-fish-body/src/host/routes/sound
 */
import { isValidPetId, RENDERER_SET } from '../config.ts';
import { warnOnce } from '../config/constants.ts';
import { buildSfxIndex } from '../sfx/index-build.ts';
import { sfxPathsOf } from '../sfx/paths.ts';
import { isValidModelPath, readSfxSources, skinIdOfModel } from '../sfx/scan.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import type { RendererKind } from '../../shared/types.ts';
import { failResult, methodNotAllowed, okResult } from './result.ts';

/** 音效领域：未命中返回 undefined，命中返回应答。 */
export async function handleSoundRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { rest, method, url } = input;
  if (rest !== 'sound' && !rest.startsWith('sound/')) return undefined;
  const parts = rest.split('/');
  // 索引是唯一由本处理器负责的形状；文件取用归 assets（同一 scope 的另一种路径）。
  if (parts.length !== 3 || parts[2] !== 'index') return undefined;
  if (method !== 'GET') return methodNotAllowed();
  const assetRoot = parts[1];
  if (!isValidPetId(assetRoot)) return failResult('bad-request', 'invalid asset root');
  const renderer = (url.searchParams.get('renderer') ?? 'webm') as RendererKind;
  if (!RENDERER_SET.has(renderer)) return failResult('bad-request', '未知渲染方式：' + renderer);
  const model = url.searchParams.get('model') ?? '';
  if (!isValidModelPath(model)) return failResult('bad-request', 'model 路径非法');
  const dirs = deps.soundDirsFor(assetRoot, '.webm', { model, renderer });
  const sources = readSfxSources(dirs);
  const index = buildSfxIndex({
    model: skinIdOfModel(model),
    poolSkinName: dirs.poolSkinName,
    poolSkinStructures: dirs.poolSkinStructures,
    renderer,
    sources,
    warn: (message) => warnOnce('sfx:' + assetRoot + ':' + model + ':' + message, message),
  });
  const landed = sfxPathsOf({ dirs, index, model: skinIdOfModel(model), renderer, userRoot: deps.userRoot });
  return okResult({
    ok: true,
    assetRoot,
    renderer,
    model,
    poolRoot: typeof deps.poolRoot === 'function' ? deps.poolRoot() : '',
    ...index,
    ...landed,
  });
}
