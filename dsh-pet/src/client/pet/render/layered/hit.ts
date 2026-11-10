/**
 * 视口坐标 → 画布坐标的换算与命中区手势解析。
 *
 * 画布是「正方形、按 CSS 宽高缩放、底部居中」摆放的，视口坐标必须先按实际矩形还原到画布像素，
 * 才能和 manifest 里的命中区形状（画布坐标）比较；这一步算错就会「看着点在头上、判到身上」。
 * 抽成纯函数是为了能脱离 canvas 断言（rect 由调用方传入）。
 * @module dsh-pet/src/client/pet/render/layered/hit
 */
import { hitTest } from './rig.ts';
import type { SkinManifest } from './types.ts';

/** 画布的视口矩形（`getBoundingClientRect()` 的最小子集）。 */
export interface CanvasRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 视口坐标 → 命中区手势。
 *
 * @param skin - 皮肤清单（含 canvas 尺寸与 interaction.regions）。
 * @param rect - 画布在视口中的实际矩形。
 * @param clientX - 指针视口 x。
 * @param clientY - 指针视口 y。
 * @returns 区域声明的 gesture（缺省回落区域 id）；矩形无效或没命中返回 undefined。
 */
export function gestureAtPoint(
  skin: SkinManifest,
  rect: CanvasRect,
  clientX: number,
  clientY: number,
): string | undefined {
  if (rect.width === 0 || rect.height === 0) return undefined;
  const x = ((clientX - rect.left) / rect.width) * skin.canvas.w;
  const y = ((clientY - rect.top) / rect.height) * skin.canvas.h;
  const id = hitTest(skin, x, y);
  if (id === undefined) return undefined;
  const region = skin.interaction.regions?.find((item) => item.id === id);
  return region?.gesture ?? id;
}
