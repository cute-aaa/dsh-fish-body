/**
 * 右键菜单的公开出口：树构建、样式与 DOM 挂载。
 *
 * 只做再导出；判据在 ./menu/tree，挂载在 ./menu/mount。
 * 必须始终成立：数据与判据是纯函数，浏览器与桌面两端共用同一份。
 * @module dsh-pet/src/shared/menu
 */
export type { ContextMenuMount, MenuBranch, MenuLeaf, MenuMoreItem, MenuNode } from './menu/types.ts';
export type { MemeGroups, MemeGroupSource } from './menu/memes.ts';
export type { RendererAction, RendererActionGroup } from './menu/renderer-actions.ts';
export {
  EXPRESSION_RESET,
  MORE_MENU_LABEL,
  accessoryMenuBranch,
  buildMenuTree,
  buildMoreBranch,
  displayMenuBranch,
  isNoMirrorAnimation,
  isSleepAllowedAction,
  modelMenuBranch,
  readMenuItems,
  rendererMenuBranch,
  skinMenuBranch,
} from './menu/tree.ts';
export {
  actionMenuTree,
  model3ActionGroups,
  model3Expressions,
  rendererActionTree,
  skinMenuGroups,
} from './menu/renderer-actions.ts';
export { buildMemeBranch, groupMemes, memeThumbUrl } from './menu/memes.ts';
export { MENU_CSS } from './menu/css.ts';
export { mountContextMenu } from './menu/mount.ts';
