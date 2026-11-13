/**
 * 会话鱼的显示面判定：鱼的显示位置跟着桌宠走（桌宠在网页，鱼才在网页）。
 *
 * 为什么不各判各的：`display` 是桌宠的显示方式（`web` / `desktop` / `both` / `none`），
 * 会话鱼是「围在桌宠旁边」的东西——桌宠不在这一端时，鱼既没有环绕目标、也不该单独出现
 * （以前会退化成右下角竖排，看起来像多出来的一堆小人）。桌面端天然一致：窗口只在桌宠
 * 桌面可见时才会被建出来。
 * @module dsh-pet/src/client/session-fish/surface
 */
import { isWebVisible, pickSurfacePet } from '../../shared/config.ts';
import { petBridge } from '../settings/bridge.ts';

/**
 * 桌宠是否显示在本页（= 会话鱼要不要在本页出现）。
 *
 * 配置还没拍平过时按 `true` 处理：宁可先按「有桌宠」排一次，也不要让浮层先闪一下再回来。
 *
 * @returns 本页应当渲染会话鱼时 true。
 */
export function webPetVisible(): boolean {
  if (!petBridge.ready) return true;
  return pickSurfacePet(petBridge.current, (pet) => isWebVisible(pet.display)).pet !== undefined;
}
