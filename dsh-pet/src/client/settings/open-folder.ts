/**
 * 设置页的「打开文件夹」：只发类别名，路径由宿主算。
 *
 * 两类目标：素材目录（需要宠物，宿主按素材根 + 皮肤算）与全局目录（池根 / 用户动画 / 表情包 /
 * 数据根，与宠物无关）。失败不抛，分成两种结论：`not-found`（目录还没建，带出宿主算好的路径，
 * 供气泡问「是否创建」）与 `failed`（其它原因，`message` 直接展示）。
 * @module dsh-fish-body/src/client/settings/open-folder
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import { isGlobalFolderTarget, type FolderTarget } from '../../shared/folders.ts';
import { petBridge } from './bridge.ts';
import type { SfxFolderTarget } from '../../shared/types.ts';

/** 打开结果。 */
export type OpenFolderOutcome =
  | { readonly ok: true; readonly path: string; readonly created: boolean }
  | { readonly ok: false; readonly reason: 'not-found'; readonly path: string; readonly message: string }
  | { readonly ok: false; readonly reason: 'failed'; readonly message: string };

/**
 * 让宿主打开（或创建后打开）一个目录。
 *
 * @param which - 目录类别：素材类（按宠物算）或全局类（与宠物无关）。
 * @param petId - 素材类要指定宠物；缺省用页面上第一只（音效卡的所有展示都按它算）。
 * @param create - 目录不存在时先创建再打开。
 * @returns 打开结果。
 */
export async function openFolderOf(which: FolderTarget, petId?: string, create = false): Promise<OpenFolderOutcome> {
  const global = isGlobalFolderTarget(which);
  let query: string;
  if (global) {
    query = '?which=' + encodeURIComponent(which) + (create ? '&create=1' : '');
  } else {
    const id = petId ?? petBridge.current[0]?.id;
    if (id === undefined) return { ok: false, reason: 'failed', message: '' };
    query = '?pet=' + encodeURIComponent(id) + '&which=' + encodeURIComponent(which) + (create ? '&create=1' : '');
  }
  try {
    const response = await fetch(ROUTE_PATH + '/open-folder' + query, { method: 'POST' });
    const payload = (await response.json().catch(() => null)) as {
      ok?: unknown;
      reason?: unknown;
      path?: unknown;
      message?: unknown;
      created?: unknown;
    } | null;
    if (payload?.ok === true && typeof payload.path === 'string') {
      return { ok: true, path: payload.path, created: payload.created === true };
    }
    const message = typeof payload?.message === 'string' ? payload.message : '';
    if (payload?.reason === 'not-found' && typeof payload.path === 'string') {
      return { ok: false, reason: 'not-found', path: payload.path, message };
    }
    return { ok: false, reason: 'failed', message };
  } catch {
    return { ok: false, reason: 'failed', message: '' };
  }
}

/**
 * 让宿主打开（或创建后打开）当前宠物的某一类素材目录。
 *
 * @param which - 素材目录类别（声音 / 皮肤 / 动画 / 用户共享 / 包内默认 / 池）。
 * @param petId - 指定宠物；缺省用页面上第一只。
 * @param create - 目录不存在时先创建再打开。
 * @returns 打开结果。
 */
export function openAssetFolder(which: SfxFolderTarget, petId?: string, create = false): Promise<OpenFolderOutcome> {
  return openFolderOf(which, petId, create);
}
