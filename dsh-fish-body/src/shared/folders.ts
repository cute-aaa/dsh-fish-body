/**
 * 「打开文件夹」的类别表：与宠物无关的全局目录 + 由宿主按素材根算出的素材目录。
 *
 * 设置页只传类别名、不拼路径；两端的白名单必须同一份，否则会出现「设置页收得下、宿主回 bad-request」。
 * 不读盘、不拼绝对路径（归 host/open-folder）。
 * @module dsh-fish-body/src/shared/folders
 */
import type { SfxFolderTarget } from './types.ts';

/** 素材目录类别：需要 `?pet=`（或取其第一只）才能算出真实目录。 */
export const PET_FOLDER_TARGETS: readonly SfxFolderTarget[] = [
  'sound',
  'skin',
  'animation',
  'user',
  'package',
  'pool-layered',
  'pool-live2d',
  'pool-webm',
  'pool-sound',
  'pool-global-sound',
];

/**
 * 全局目录类别：与宠物无关，宿主直接回一个固定目录。
 *
 * 七个当前取值对应数据根下的分组（`root` / `config` / `data` / `cache` / `runtime` / `assets`）
 * 与用户皮肤目录（`skin-root`，位置可改到数据根之外）；`skin` 这个字面量留给素材级目录
 * （`<皮肤>/<名>-skin/`），两者不能同名，否则素材按钮会被全局分支抢走。
 *
 * 后六个是历史取值（`pets` / `user-root` / `animations` / `memes` / `fish-skin` / `pool-root`），
 * 保留是因为老前端的请求还会带它们——删掉只会让旧页面上的按钮变成 bad-request。
 */
export const GLOBAL_FOLDER_TARGETS = [
  'root',
  'config',
  'data',
  'cache',
  'runtime',
  'skin-root',
  'assets',
  'pets',
  'user-root',
  'animations',
  'memes',
  'fish-skin',
  'pool-root',
  // 三个池桶（渲染卡下方三行的「打开」）：不复用 `pool-layered|live2d|webm` 那三个素材级类别——
  // 那三个按当前宠物的渲染方式门控，三行里总有两行会被拒。
  'pool-bucket-layered',
  'pool-bucket-live2d',
  'pool-bucket-webm',
] as const;

/** 全局目录类别。 */
export type GlobalFolderTarget = (typeof GLOBAL_FOLDER_TARGETS)[number];

/** 「打开文件夹」能打开的全部类别。 */
export type FolderTarget = SfxFolderTarget | GlobalFolderTarget;

/**
 * 这个类别是不是全局目录（不需要宠物）。
 *
 * @param value - 查询参数原值。
 * @returns 是全局类别时收窄类型。
 */
export function isGlobalFolderTarget(value: string): value is GlobalFolderTarget {
  return (GLOBAL_FOLDER_TARGETS as readonly string[]).includes(value);
}

/**
 * 这个类别是不是素材目录（需要宠物上下文）。
 *
 * @param value - 查询参数原值。
 * @returns 是素材类别时收窄类型。
 */
export function isPetFolderTarget(value: string): value is SfxFolderTarget {
  return (PET_FOLDER_TARGETS as readonly string[]).includes(value);
}
