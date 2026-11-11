/**
 * 气泡锚点：气泡尾巴该落在「宠物头顶」的哪一行（相对舞台顶的 px，负值 = 舞台顶以上）。
 *
 * webm 的 640×360 视频盒子自带上下留白，气泡固定锚在舞台顶下方 10.8%（CSS 回退值）就够用了；
 * layered / live2d 的画布是**方形**且底部对齐舞台，宠物头顶跑到舞台顶以上，
 * 死锚在 10.8% 会正好盖在脸上，只能按渲染器实测的内容顶重算。
 * 两端（浏览器 PetCard / 桌面 Helper）共用这一份判据，桌面还要用它撑开窗口上边距。
 * @module dsh-pet/src/shared/bubble-anchor
 */

/** 舞台盒宽高比：`.dsh-pet-stage` / `.pet-stage` 都是 `width × 9/16`。 */
export const STAGE_ASPECT = 9 / 16;

/** webm 的默认锚点：气泡底边在舞台顶下方 10.8%（与两侧 CSS 的兜底值一致）。 */
export const BUBBLE_ANCHOR_RATIO = 0.108;

/** 方形画布高 = 宠物宽度，减去舞台高度即它相对舞台顶的上溢比例。 */
export const CANVAS_OVERHANG_RATIO = 1 - STAGE_ASPECT;

/** 气泡尾巴与头顶之间留的缝（相对宠物宽度）：贴着头发太挤，留一档看得到箭头。 */
export const BUBBLE_HEAD_GAP_RATIO = 0.02;

/** 量不到内容顶时的兜底比例：多数 live2d / 分层皮肤的画布顶部有 5%~15% 透明留白。 */
export const VISUAL_TOP_FALLBACK_RATIO = 0.1;

/**
 * 画布内实测的内容顶比例 → 气泡底边的偏移。
 *
 * @param insideRatio - 画布内最上方不透明像素的相对高度（0 = 画布顶）。
 * @param size - 宠物宽度 px（画布边长、舞台高度的基准）。
 * @returns 相对舞台顶的偏移 px：负值表示气泡底边要落到舞台顶以上。
 */
export function bubbleAnchorY(insideRatio: number, size: number): number {
  const ratio = Number.isFinite(insideRatio) ? Math.min(Math.max(insideRatio, 0), 1) : VISUAL_TOP_FALLBACK_RATIO;
  return (ratio - CANVAS_OVERHANG_RATIO - BUBBLE_HEAD_GAP_RATIO) * size;
}

/**
 * 方形画布上的宠物头顶相对舞台顶的偏移（px，负值）。
 *
 * @param insideRatio - 画布内实测的内容顶比例。
 * @param size - 宠物宽度 px。
 * @returns 头顶那一行相对舞台顶的偏移。
 */
export function visualTopY(insideRatio: number, size: number): number {
  return (insideRatio - CANVAS_OVERHANG_RATIO) * size;
}
