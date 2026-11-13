/**
 * 插件自重启（`POST /plugin-restart`）：让宿主重新组合本插件，改完宿主代码不必重启整个 profile。
 *
 * 有 HMR 时宿主换掉「已加载文件变过」的插件（本插件就是 link 进来的包），浏览器刷一次即拿到新的 client.js；
 * 没有 HMR 时进程内换不掉已加载的 ESM，只有桌面 Helper 会被重建。两种模式都如实回给调用方，
 * 由它决定提示什么——右键菜单走控制台告警，设置页走底部栏文案。
 * owns only 一次请求与模式判定，never 提示文案与页面状态。
 * @module dsh-pet/src/client/plugin-restart
 */
import { ROUTE_PATH } from '../shared/constants.ts';

/** 重启生效方式：`hmr` = 宿主已重新组合，刷新页面即可；`helper` = 只重建了桌面窗口。 */
export type RestartMode = 'hmr' | 'helper';

/** 刷新页面前的等待：重新组合会先拆掉本插件的路由，立刻 reload 可能拿到旧 bundle。 */
export const RESTART_RELOAD_MS = 1200;

/**
 * 触发一次插件重启。
 *
 * @returns 生效模式；请求失败或宿主回了不合法的响应时 `null`。
 */
export async function requestPluginRestart(): Promise<RestartMode | null> {
  try {
    const response = await fetch(ROUTE_PATH + '/plugin-restart', { method: 'POST' });
    const body = (await response.json().catch(() => null)) as { ok?: unknown; mode?: unknown } | null;
    if (!response.ok || !body || body.ok === false) return null;
    return body.mode === 'hmr' ? 'hmr' : 'helper';
  } catch {
    return null;
  }
}

/**
 * 过一小会儿刷新页面（只在 HMR 模式下有意义）。
 *
 * @param delayMs - 等待时间；缺省 {@link RESTART_RELOAD_MS}。
 */
export function schedulePageReload(delayMs: number = RESTART_RELOAD_MS): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => window.location.reload(), delayMs);
}
