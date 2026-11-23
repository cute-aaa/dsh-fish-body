/**
 * 宠物「身体命中框」：按渲染方式给出人物真正占多大一块，几何只有这一份。
 *
 * 三种渲染方式的舞台盒都是 `size × size×9/16`，但人物的实际位置完全不同：
 * webm 的视频盒自带左右透明边与上下留白，人物只占中间 37.5% 宽；
 * layered / live2d 的画布是**方形**、底部对齐舞台，人物几乎铺满整块，头顶还跑到舞台顶以上。
 * 把 webm 那套比例套到画布后端，就是「看得见、点不到头」——所以这里是唯一口径，
 * 网页端（命中层 CSS、拖拽夹取、碰撞）与桌面端（`hitRect`、穿透判定、窗口落位）都读它。
 *
 * 坐标单位一律是「宠物宽度 size」：`y0/y1` 以舞台顶为 0、向下为正，画布后端会是负数。
 * @module dsh-fish-body/src/shared/body-box
 */
import { STAGE_ASPECT } from './bubble-anchor.ts';
import { CANVAS_H, HIT_BOX } from './constants.ts';
import type { RendererKind } from './types.ts';

/** 命中框：四边相对舞台盒的位置，单位 = 宠物宽度（`y` 可为负 = 舞台顶以上）。 */
export interface BodyUnitBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** 命中框的像素矩形：相对舞台盒左上角，未含舞台的 `bottomPad` 位移（由调用方补）。 */
export interface BodyRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 命中框相对舞台盒的百分比矩形（0..1，画布后端 top 为负、height 大于 1）；CSS 命中层用它。 */
export interface BodyPercentBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** 画布内容框：后端实测出的不透明包围盒，四边都是相对**画布**的 0..1 比例。 */
export interface CanvasBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * 画布后端命中框的横向内缩（相对宠物宽度）。
 *
 * 方形画布四角是透明像素：整块可点会把透明角落也算成宠物，桌面端连带挡住下层窗口的点击。
 * 留 8% 的边既能覆盖到手臂/尾巴，也不至于把「点击穿透」做成一个大方块。
 */
const CANVAS_INSET = 0.08;

/** webm：沿用 640×360 视频盒的命中框，换算成「以 size 为单位」的比例。 */
const WEBM_BODY: BodyUnitBox = {
  x0: HIT_BOX.x0 / 640,
  y0: (HIT_BOX.y0 / CANVAS_H) * STAGE_ASPECT,
  x1: HIT_BOX.x1 / 640,
  y1: (HIT_BOX.y1 / CANVAS_H) * STAGE_ASPECT,
};

/** layered / live2d：方形画布内缩一圈，纵向从「舞台顶以上」一直到底边（脚下不缩）。 */
const CANVAS_BODY: BodyUnitBox = {
  x0: CANVAS_INSET,
  y0: -(1 - STAGE_ASPECT) + CANVAS_INSET,
  x1: 1 - CANVAS_INSET,
  y1: STAGE_ASPECT,
};

/**
 * 该渲染方式的命中框（单位 = 宠物宽度）。
 *
 * @param renderer - 当前渲染方式；缺省 / 未知值按 webm 处理（旧配置没有这个字段）。
 * @returns 命中框比例；调用方自己乘 `size`。
 */
export function bodyUnitBox(renderer: RendererKind | undefined): BodyUnitBox {
  return renderer === 'layered' || renderer === 'live2d' ? CANVAS_BODY : WEBM_BODY;
}

/**
 * 人物本体宽度占画框宽度的比例：`sizePercent`（占屏宽）换算成画框宽时要用它。
 *
 * @param renderer - 当前渲染方式。
 * @returns 0..1；webm 是 0.375，画布后端是内缩后的 0.84。
 */
export function bodyWidthRatio(renderer: RendererKind | undefined): number {
  const box = bodyUnitBox(renderer);
  return box.x1 - box.x0;
}

/**
 * 命中框的像素矩形（相对舞台盒左上角）。
 *
 * @param renderer - 当前渲染方式。
 * @param size - 宠物画框宽度 px。
 * @returns `x/y/w/h`，未含舞台的 `bottomPad`；纵向 `y` 可为负。
 */
export function bodyBoxPx(renderer: RendererKind | undefined, size: number): BodyRect {
  return unitBoxPx(bodyUnitBox(renderer), size);
}

/** 把「以宠物宽度为单位」的框换成像素矩形。 */
export function unitBoxPx(box: BodyUnitBox, size: number): BodyRect {
  return {
    x: box.x0 * size,
    y: box.y0 * size,
    w: (box.x1 - box.x0) * size,
    h: (box.y1 - box.y0) * size,
  };
}

/**
 * 两个单位框的交集：用于「实测内容框不得超出理论命中框」。
 *
 * @param a - 理论命中框（上限）。
 * @param b - 实测内容框。
 * @returns 交集；完全不相交时 null（调用方保留理论框，绝不把命中区缩成 0）。
 */
export function intersectUnitBox(a: BodyUnitBox, b: BodyUnitBox): BodyUnitBox | null {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { x0, y0, x1, y1 };
}

/** 画布内容框外扩量（画布比例）：探测图被缩小过，边缘会各吃进一个像素。 */
const CONTENT_PAD = 0.015;

/**
 * 画布内容框 → 舞台坐标下的单位框。
 *
 * 方形画布在舞台里是「宽 = size、底部对齐」：x 直接照搬，纵向要减掉画布探出舞台顶的那一段。
 *
 * @param renderer - 当前渲染方式。
 * @param content - 实测内容框（相对画布）。
 * @returns 单位框；webm 等非方形画布后端返回 null。
 */
export function contentUnitBox(renderer: RendererKind | undefined, content: CanvasBox): BodyUnitBox | null {
  if (renderer !== 'layered' && renderer !== 'live2d') return null;
  const clamp = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  const top = -(1 - STAGE_ASPECT);
  return {
    x0: clamp(content.x0 - CONTENT_PAD),
    x1: clamp(content.x1 + CONTENT_PAD),
    y0: top + clamp(content.y0 - CONTENT_PAD),
    y1: top + clamp(content.y1 + CONTENT_PAD),
  };
}

/**
 * 命中框占舞台盒的百分比（0..1）：CSS 命中层要的是「相对包含块的百分比」。
 *
 * 横向除以舞台宽（= `size`），纵向除以舞台高（= `size × 9/16`）——两轴比例不同，
 * 直接拿 `bodyUnitBox` 的 y 当百分比会让画布的命中框缩小 9/16。
 *
 * @param renderer - 当前渲染方式。
 * @returns 可直接乘 100 写成 `%` 的四个比例。
 */
export function bodyBoxPercent(renderer: RendererKind | undefined): BodyPercentBox {
  return unitBoxPercent(bodyUnitBox(renderer));
}

/**
 * 单位框 → CSS 百分比（两轴分别归一：横向除以 `size`、纵向除以 `size × 9/16`）。
 *
 * @param box - 单位框（与 {@link bodyUnitBox} 同口径）。
 * @returns 可直接乘 100 写成 `%` 的四个比例。
 */
export function unitBoxPercent(box: BodyUnitBox): BodyPercentBox {
  return {
    left: box.x0,
    top: box.y0 / STAGE_ASPECT,
    width: box.x1 - box.x0,
    height: (box.y1 - box.y0) / STAGE_ASPECT,
  };
}
