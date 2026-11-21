/**
 * 宠物盒的几何：由宽度推出半宽半高、脚垫与左右余量，并换算归一化中心 ↔ 包围盒左上角。
 * 位置指令用归一化比例、拖拽与抛掷用左上角像素，两个方向必须互逆，否则松手会跳位。
 * 纯计算：视口、盒尺寸与画布基准都由调用方传入，不读 `window`。
 * 换算本身不夹取；越界摆放的可见下限由 {@link clampReachableBox} 在提交位置时保证。
 * @module dsh-fish-body/src/client/pet/motion/geometry
 */
import { CANVAS_H, FEET_Y, MIN_REACHABLE_PX } from '../../../shared/constants.ts';
import { bodyBoxPercent, bodyUnitBox } from '../../../shared/body-box.ts';
import { bodyPixelBox } from '../../../shared/physics.ts';
import type { RendererKind } from '../../../shared/types.ts';
import type { CSSProperties } from 'react';

/** 视口尺寸。 */
export interface Viewport {
  width: number;
  height: number;
}

/** 宠物盒的半宽与半高（高度按 16:9 由宽度推出）。 */
export interface HalfSize {
  w: number;
  h: number;
}

/** 归一化中心（0..1，相对视口）。 */
export interface Center {
  rx: number;
  ry: number;
}

/** 包围盒左上角像素坐标。 */
export interface BoxPoint {
  x: number;
  y: number;
}

/** 宠物盒的派生度量（px），全部由宽度按固定画布基准推出。 */
export interface PetMetrics {
  /** 盒半宽。 */
  halfW: number;
  /** 盒半高，按 16:9 由宽度推出。 */
  halfH: number;
  /** 舞台脚底垫高：命中框与碰撞 body 框都按它上移。 */
  bottomPad: number;
  /** 左右透明边余量：漫游夹取按身体贴边，宠物能走到屏幕边缘而身体不越界。 */
  sideAllow: number;
}

/**
 * 按宠物宽度算出盒子度量。
 *
 * @param size - 宠物宽度 px。
 * @param renderer - 当前渲染方式：左右透明边随它变（方形画布没有左右留白，见 shared/body-box）。
 * @returns 四个派生量，随宽度线性缩放。
 */
export function derivePetMetrics(size: number, renderer?: RendererKind): PetMetrics {
  return {
    halfW: size / 2,
    halfH: (size * 9) / 16 / 2,
    bottomPad: (size * (9 / 16) * (CANVAS_H - FEET_Y)) / CANVAS_H,
    sideAllow: bodyUnitBox(renderer).x0 * size,
  };
}

/**
 * 归一化中心 → 包围盒左上角像素。
 *
 * @param center - 宠物中心相对视口的比例。
 * @param viewport - 视口尺寸。
 * @param half - 盒的半宽半高。
 * @returns 根节点 `left`/`top` 该写的像素值。
 */
export function centerToBox(center: Center, viewport: Viewport, half: HalfSize): BoxPoint {
  return { x: center.rx * viewport.width - half.w, y: center.ry * viewport.height - half.h };
}

/**
 * 包围盒左上角像素 → 归一化中心；{@link centerToBox} 的逆运算。
 *
 * @param box - 根节点当前的 `left`/`top`（px）。
 * @param viewport - 视口尺寸。
 * @param half - 盒的半宽半高。
 * @returns 可提交给 `customPos` 的归一化中心。
 */
export function boxToRatio(box: BoxPoint, viewport: Viewport, half: HalfSize): Center {
  return { rx: (box.x + half.w) / viewport.width, ry: (box.y + half.h) / viewport.height };
}

/**
 * 越界摆放的可用界限（与 viewport 同坐标系，px）。
 *
 * 拖拽阻力（`shared/physics/rubberband`）与松手夹取（{@link clampReachableBox}）都用它：
 * 阻力只改变「拖的过程」，松手仍按这条界限夹取，两者不同源就会在松手瞬间跳一下。
 */
export interface BoxLimits {
  /** 盒左上角可到的最小 x。 */
  minX: number;
  /** 盒左上角可到的最大 x。 */
  maxX: number;
  /** 盒左上角可到的最小 y。 */
  minY: number;
  /** 盒左上角可到的最大 y。 */
  maxY: number;
}

/**
 * 算出越界摆放的界限：命中区至少还可见 {@link MIN_REACHABLE_PX}，其余部分可以挂出视口。
 *
 * @param viewport - 视口尺寸。
 * @param body - 命中区的三个输入：宠物宽度、舞台脚垫与渲染方式。
 * @returns 两个轴的闭区间（px）。
 */
export function reachableLimits(
  viewport: Viewport,
  body: { size: number; bottomPad: number; renderer?: RendererKind | undefined },
): BoxLimits {
  // 命中区相对盒原点的偏移直接问 bodyPixelBox：本文件不重复命中框的比例换算。
  const inset = bodyPixelBox({ x: 0, y: 0, size: body.size, bottomPad: body.bottomPad, renderer: body.renderer });
  return {
    minX: MIN_REACHABLE_PX - inset.right,
    maxX: viewport.width - inset.left - MIN_REACHABLE_PX,
    minY: MIN_REACHABLE_PX - inset.bottom,
    maxY: viewport.height - inset.top - MIN_REACHABLE_PX,
  };
}

/**
 * 把越界摆放的盒子收到「命中区至少还可见 {@link MIN_REACHABLE_PX}」。
 *
 * 只压单轴的一侧，不要求完整可见：宠物仍能挂在边缘，只是不会整只消失。
 *
 * @param box - 待提交的盒左上角（px）。
 * @param viewport - 视口尺寸。
 * @param body - 命中区的三个输入：宠物宽度、舞台脚垫与渲染方式。
 * @returns 夹取后的盒左上角；本来就在范围内时原值返回。
 */
export function clampReachableBox(
  box: BoxPoint,
  viewport: Viewport,
  body: { size: number; bottomPad: number; renderer?: RendererKind | undefined },
): BoxPoint {
  const limits = reachableLimits(viewport, body);
  const height = (body.size * 9) / 16;
  return {
    x: clampAxis(box.x, limits.minX, limits.maxX, (viewport.width - body.size) / 2),
    y: clampAxis(box.y, limits.minY, limits.maxY, (viewport.height - height) / 2),
  };
}

/**
 * 单轴夹取：视口与命中区加起来还容不下两倍下限时区间反向，改为居中，避免夹到错误的一侧。
 *
 * @param value - 待夹坐标（px）。
 * @param lo - 允许下限（px）。
 * @param hi - 允许上限（px）。
 * @param centered - 区间反向时的居中坐标（px）。
 * @returns 夹取后的坐标（px）。
 */
function clampAxis(value: number, lo: number, hi: number, centered: number): number {
  return lo > hi ? centered : Math.min(Math.max(value, lo), hi);
}

/**
 * 舞台内联样式：脚底垫高恒定生效，拖拽中也不取消。
 *
 * 拖拽的抓取偏移按根节点包围盒量（不含这段位移），一旦取消，视频会相对光标
 * 整体上跳 bottomPad、松手再落回；位移恒定，抓取点才始终落在光标下。
 */
export function petStageStyle(bottomPad: number): CSSProperties {
  return { transform: 'translateY(' + bottomPad + 'px)' };
}

/**
 * 根节点的定位内联样式。
 *
 * 有 customPos 时按归一化中心换算成 px 定位；没有时返回空对象，交给角落与边距的 CSS 变量定位。
 * 此处只做换算，不夹取：落点保留「挂在边缘」的自由，可见下限在提交位置时由 {@link clampReachableBox} 保证。
 *
 * @param customPos - 用户拖拽后的归一化中心；null 表示仍按角落定位。
 * @param viewport - 视口尺寸。
 * @param half - 盒的半宽半高。
 * @returns 可直接并入根节点 style 的定位字段；未定位时为空对象。
 */
export function petRootStyle(customPos: Center | null, viewport: Viewport, half: HalfSize): CSSProperties {
  if (!customPos) return {};
  return {
    left: customPos.rx * viewport.width - half.w + 'px',
    top: customPos.ry * viewport.height - half.h + 'px',
    // 角落定位按 data-corner 写 left/right 与 top/bottom；另一侧不归零，两套定位会同时生效、位置跳回角落。
    right: 'auto',
    bottom: 'auto',
  };
}

/**
 * 命中区样式：命中框比例换算成相对舞台盒的百分比。
 *
 * 三种渲染方式的比例不同（方形画布的命中框跑到舞台顶以上，所以 `top` 为负、`height` 大于 100%），
 * 唯一来源是 shared/body-box；这里只负责拼成 CSS 能吃的字符串。
 *
 * @param renderer - 当前渲染方式；缺省按 webm。
 * @returns 可直接给命中层 `style` 的四个百分比字段。
 */
export function petHitStyle(renderer?: RendererKind): CSSProperties {
  const box = bodyBoxPercent(renderer);
  return {
    left: box.left * 100 + '%',
    top: box.top * 100 + '%',
    width: box.width * 100 + '%',
    height: box.height * 100 + '%',
  };
}
