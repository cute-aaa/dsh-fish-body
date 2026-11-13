/**
 * 音效搜索顺序的唯一真源：把 `SfxDirs` 摊成一条有序的 `{origin, dir}` 列表。
 *
 * 存在意义有两条：索引（host/sfx/index-build 指文件名）与取文件（host/routes/assets 找文件）
 * 必须**同一顺序**，否则会出现「索引指了名、路由 404」；设置页的「实际命中路径」也按它回查。
 * 只做顺序编排，不读盘、不判命中；目录不存在由消费方各自退化成「这一层没有」。
 * @module dsh-pet/src/host/sfx/order
 */
import { join } from 'node:path';
import type { SfxDirs } from './scan.ts';
import type { SfxOrigin } from '../../shared/types.ts';

/** 一层的用途：池的资源目录按「前缀」解释，旧皮肤目录按「位置即身份」解释，其余是扁平目录。 */
export type SoundLayerKind = 'pool-entry' | 'pool-flat' | 'legacy-skin' | 'legacy-flat' | 'animation';

/** 有序的一层。 */
export interface SoundLayer {
  /** 命中这一层时给索引的 `origin`。 */
  readonly origin: SfxOrigin;
  /** 这一层怎么解释文件名。 */
  readonly kind: SoundLayerKind;
  /** 目录绝对路径。 */
  readonly dir: string;
}

/**
 * 文档 §3 的顺序标签（`config` 是覆盖层，不在目录序列里）。
 *
 * 加/减层时必须同步 {@link soundLayerDirs} 与 `index-build` 的步骤——两者是同一件事的两面。
 */
export const SOUND_ORIGIN_ORDER: readonly SfxOrigin[] = [
  'pool-skin',
  'pool-renderer',
  'pool-global',
  'skin',
  'sound',
  'animation',
  'user',
  'package-default',
];

/**
 * 把目录集摊成有序层表。
 *
 * 同一个 `origin` 可能出现多次（池的 webm 平铺目录与 `<渲染方式>/sound` 都算 `pool-renderer`，
 * 旧皮肤目录的 `<皮肤>/` 与皮肤根都算 `skin`）——顺序即优先级，先出现的赢。
 *
 * @param dirs - 该宠物的音效目录集（`soundDirsFor` 的产物）。
 * @param model - 皮肤 id（`skinIdOfModel` 的结果；空串 = 根布局）。
 * @returns 从高到低的有序层表。
 */
export function soundLayerDirs(dirs: SfxDirs, model: string): SoundLayer[] {
  const out: SoundLayer[] = [];
  if (dirs.poolSkinDir !== undefined) out.push({ dir: dirs.poolSkinDir, kind: 'pool-entry', origin: 'pool-skin' });
  // webm 没有资源目录，兜底音效直接平铺在 `<池>/webm/`（与 `<池>/webm/sound/` 并列，平铺优先）。
  if (dirs.poolWebmDir !== undefined) out.push({ dir: dirs.poolWebmDir, kind: 'pool-flat', origin: 'pool-renderer' });
  if (dirs.poolRendererSoundDir !== undefined) {
    out.push({ dir: dirs.poolRendererSoundDir, kind: 'pool-flat', origin: 'pool-renderer' });
  }
  if (dirs.poolGlobalSoundDir !== undefined) {
    out.push({ dir: dirs.poolGlobalSoundDir, kind: 'pool-flat', origin: 'pool-global' });
  }
  if (dirs.skinDir !== undefined) {
    if (model !== '') out.push({ dir: join(dirs.skinDir, model), kind: 'legacy-skin', origin: 'skin' });
    out.push({ dir: dirs.skinDir, kind: 'legacy-flat', origin: 'skin' });
  }
  if (dirs.soundDir !== undefined) out.push({ dir: dirs.soundDir, kind: 'legacy-flat', origin: 'sound' });
  if (dirs.userSoundDir !== undefined) out.push({ dir: dirs.userSoundDir, kind: 'legacy-flat', origin: 'user' });
  for (const dir of dirs.animationDirs) out.push({ dir, kind: 'animation', origin: 'animation' });
  out.push({ dir: dirs.packageSoundDir, kind: 'legacy-flat', origin: 'package-default' });
  return out;
}

/**
 * 摊成纯目录序列（取文件用）。
 *
 * @param dirs - 音效目录集。
 * @param model - 皮肤 id。
 * @returns 目录绝对路径，按优先级排列。
 */
export function soundCandidateDirs(dirs: SfxDirs, model: string): string[] {
  return soundLayerDirs(dirs, model).map((layer) => layer.dir);
}
