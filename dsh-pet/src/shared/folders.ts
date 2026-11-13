/**
 * 「打开文件夹」的类别表：与宠物无关的全局目录 + 由宿主按素材根算出的素材目录。
 *
 * 设置页只传类别名、不拼路径；两端的白名单必须同一份，否则会出现「设置页收得下、宿主回 bad-request」。
 * 不读盘、不拼绝对路径（归 host/open-folder）。
 * @module dsh-pet/src/shared/folders
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
 * `pool-root` 是池根（`assets.pool` 的解析结果），`animations` / `memes` / `fish-skin` 是用户级素材目录，
 * `user-root` 是本插件的数据根（`pet/` 与 `main-sound/` 都在里面）。
 */
export const GLOBAL_FOLDER_TARGETS = ['pool-root', 'animations', 'memes', 'fish-skin', 'user-root'] as const;

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
