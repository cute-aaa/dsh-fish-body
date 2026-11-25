/**
 * 用户素材导入路由：`POST /assets/import`。
 *
 * 只解析请求、定位宠物和固定目录；复制、冲突、越界与体量判断都在
 * `host/assets-import/import`，路由不直接写文件。
 * @module dsh-fish-body/src/host/routes/assets-import
 */
import { parseAssetImportRequest } from '../assets-import/request.ts';
import { isValidPetId, RENDERER_SET, readAllConfig } from '../config.ts';
import { importAsset, type SlotImportPet } from '../assets-import/import.ts';
import { userPaths } from '../user-layout.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import type { RendererKind } from '../../shared/types.ts';

/** 素材导入领域：未命中返回 undefined。 */
export async function handleAssetsImportRoutes(
  deps: PetRouteDeps,
  input: RouteInput,
): Promise<RouteResult | undefined> {
  const { body, method, rest } = input;
  const isImport = rest === 'assets/import';
  if (!isImport) return undefined;
  if (method !== 'POST') return methodNotAllowed();
  let parsed: unknown;
  try {
    parsed = body === undefined || body.trim() === '' ? null : JSON.parse(body);
  } catch {
    return invalidJson();
  }
  const request = parseAssetImportRequest(parsed);
  if (request === undefined) return failResult('bad-request', '素材导入请求形状不合法');

  let pet: SlotImportPet | undefined;
  if (request.kind === 'sfx' && request.target === 'slot') {
    const found = deps.requirePet(input.url.searchParams, () => readAllConfig(deps.configPaths));
    if (!found.ok) return found.res;
    const assetRoot = String(found.pet.assetRoot ?? found.entry ?? 'main');
    if (!isValidPetId(assetRoot)) return failResult('bad-request', '素材根不合法');
    const renderer = String(found.pet.renderer ?? 'webm') as RendererKind;
    if (!RENDERER_SET.has(renderer)) return failResult('bad-request', '未知渲染方式');
    pet = {
      assetRoot,
      renderer,
      model: String(found.pet.model ?? ''),
    };
  }

  const paths = deps.paths ?? userPaths(deps.userRoot);
  const result = importAsset(
    request,
    {
      userRoot: deps.userRoot,
      skinsDir: paths.skinsDir,
      sessionFishDir: paths.fishSkinDir,
      sharedSoundDir: paths.soundDir,
      soundDirsFor: deps.soundDirsFor,
      log: deps.log,
    },
    pet,
  );
  return result.ok ? okResult({ ok: true, imported: result.imported }) : failResult(result.reason, result.message);
}
