/**
 * 打开素材文件夹：`POST /open-folder?pet=<id>&which=sound|skin|animation|user|package`。
 *
 * 存在的意义是「设置页只给类别名」：目录属于哪个素材根、当前皮肤在哪一层，只有宿主知道。
 * 路径不存在时不猜、不创建，直接把算出来的路径回给调用方，由设置页提示「先放个文件」。
 * @module dsh-pet/src/host/routes/open-folder
 */
import { existsSync, mkdirSync } from 'node:fs';
import { readAllConfig } from '../config.ts';
import { parseFolderTarget, resolveFolderTarget } from '../open-folder.ts';
import { skinIdOfModel } from '../sfx/scan.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, methodNotAllowed, okResult } from './result.ts';

/**
 * 目录打开领域：未命中返回 undefined，命中返回应答。
 *
 * `create=1` 时目录不存在就先建出来再打开（设置页那个「还未创建，是否创建」的气泡点「是」走这条）；
 * 不带它则只回 `not-found` 与算出来的路径，由调用方决定要不要建。
 */
export async function handleOpenFolderRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { rest, method, url } = input;
  if (rest !== 'open-folder') return undefined;
  if (method !== 'POST') return methodNotAllowed();
  const which = parseFolderTarget(url.searchParams.get('which'));
  if (which === null) {
    return failResult('bad-request', 'which 只能是 sound / skin / animation / user / package');
  }
  const create = url.searchParams.get('create') === '1';
  try {
    const cfg = readAllConfig(deps.configPaths);
    const who = deps.requirePet(url.searchParams, () => cfg);
    if (!who.ok) return who.res;
    const dirs = deps.soundDirsFor(who.entry, '.webm');
    const target = resolveFolderTarget(dirs, which, skinIdOfModel(String(who.pet.model ?? '')));
    if (target === null) {
      return failResult('not-found', '这只宠物没有「' + which + '」这一类目录');
    }
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
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
}
