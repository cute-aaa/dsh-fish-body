/**
 * 分层皮肤的像素探测：内容顶（气泡锚点）与每层不透明包围盒（每帧只画有效子矩形）。
 *
 * 为什么要包围盒：实测一套 19 层的 1024² 皮肤，各层不透明区域合计只有画布面积的 1.64 倍，
 * 平均每层 8.2%。整幅 `drawImage` 等于每帧采样 20 个全幅位图（≈21M 像素），而真正的像素只有 1.64 幅。
 * 包围盒是一次性探测的结果，绘制侧按它做子矩形采样，画面完全等价、每帧工作量降一个数量级。
 *
 * 纯计算（{@link alphaBoxOf} / {@link boxToSource}）与 DOM 探测（{@link measureVisualTopRatio} /
 * {@link measureLayerBox}）分开：前者可脱 canvas 断言，后者只在挂载时跑一次。
 * 本模块同时被浏览器渲染器与桌面 Helper（`layered-core.js`）使用——两端各写一套探测必然漂移。
 * @module dsh-fish-body/src/client/pet/render/layered/probe
 */

/** 内容顶探测的画布边长（px）：够分辨 1.5% 的位置，又把像素读回压到 4096 个。 */
export const TOP_PROBE_PX = 64;

/** 内容顶的 alpha 阈值（0~255）：低于它的算透明，避免把羽化边缘当成内容顶。 */
export const TOP_ALPHA_MIN = 24;

/** 包围盒探测的画布边长上限（px）：256 已能把最小的五官（20×20）留在探测矩阵里。 */
export const BOX_PROBE_PX = 256;

/** 包围盒的 alpha 阈值：探测图是缩小的，羽化边缘被平均后更淡，阈值要比内容顶低一档。 */
export const BOX_ALPHA_MIN = 8;

/** 包围盒外扩的探测像素数：缩放采样会在边界内外各取一像素，留一点透明余量避免边缘被切掉。 */
export const BOX_PAD_PROBE_PX = 2;

/** 一个矩形（源像素或探测像素，由调用方约定）。 */
export interface AlphaBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 画面内容盒的四边比例（相对画布，0..1）：命中框收窄用。 */
export interface CanvasBoxRatios {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** 内容盒探测的画布边长（px）：比内容顶那一档细一档，仍只读 9216 个像素。 */
export const BOX_PROBE_SIDE = 96;

/** 往探测画布上作画的回调：调用方按自己的画布口径铺图。 */
export type VisualProbe = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

/**
 * RGBA 像素里 alpha 不小于阈值的最小包围盒（纯函数）。
 *
 * @param data - `getImageData().data`（每像素 4 字节）。
 * @param width - 像素宽。
 * @param height - 像素高。
 * @param alphaMin - alpha 阈值（0~255）。
 * @returns 包围盒；整幅透明（或尺寸非法）时返回 null。
 */
export function alphaBoxOf(data: ArrayLike<number>, width: number, height: number, alphaMin: number): AlphaBox | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if ((data[(row + x) * 4 + 3] ?? 0) < alphaMin) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * 把探测坐标里的包围盒换算回源像素，并按需外扩。
 *
 * @param box - 探测图上的包围盒（探测像素）。
 * @param xScale - 探测宽 / 源宽。
 * @param yScale - 探测高 / 源高。
 * @param sourceW - 源宽（px）。
 * @param sourceH - 源高（px）。
 * @param padProbe - 外扩量（探测像素），按各自缩放换算并向上取整。
 * @returns 夹进 `[0, sourceW] × [0, sourceH]` 的源包围盒。
 */
export function boxToSource(
  box: AlphaBox,
  xScale: number,
  yScale: number,
  sourceW: number,
  sourceH: number,
  padProbe: number,
): AlphaBox {
  const padX = xScale > 0 ? Math.ceil(padProbe / xScale) : 0;
  const padY = yScale > 0 ? Math.ceil(padProbe / yScale) : 0;
  const x0 = Math.max(0, Math.floor(box.x / (xScale || 1)) - padX);
  const y0 = Math.max(0, Math.floor(box.y / (yScale || 1)) - padY);
  const x1 = Math.min(sourceW, Math.ceil((box.x + box.w) / (xScale || 1)) + padX);
  const y1 = Math.min(sourceH, Math.ceil((box.y + box.h) / (yScale || 1)) + padY);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * 量内容顶比例：把画面缩到 {@link TOP_PROBE_PX} 见方读一次像素，找最上方的不透明行。
 *
 * 为什么不在渲染器里硬编码比例：live2d 模型和分层皮肤的画布留白差别很大
 * （实测同一批皮肤的内容顶从 0% 到 22%），写死任何一个数都会让气泡盖脸或者飘太高。
 *
 * @param draw - 在探测画布上铺一次画面的回调。
 * @returns 内容顶相对画布高度的比例（0~1）；整幅全透明或 canvas 不可用时返回 null。
 */
export function measureVisualTopRatio(draw: VisualProbe): number | null {
  const canvas = document.createElement('canvas');
  canvas.width = TOP_PROBE_PX;
  canvas.height = TOP_PROBE_PX;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;
  try {
    draw(ctx, TOP_PROBE_PX, TOP_PROBE_PX);
    const data = ctx.getImageData(0, 0, TOP_PROBE_PX, TOP_PROBE_PX).data;
    for (let y = 0; y < TOP_PROBE_PX; y += 1) {
      for (let x = 0; x < TOP_PROBE_PX; x += 1) {
        if (data[(y * TOP_PROBE_PX + x) * 4 + 3] >= TOP_ALPHA_MIN) return (y + 0.5) / TOP_PROBE_PX;
      }
    }
  } catch {
    // 画布被污染（跨源图片没开 CORS）/ getImageData 失败：交给调用方走兜底比例。
    return null;
  }
  return null;
}

/**
 * 量画面内容的包围盒（相对画布的 0..1 比例）：方形画布的透明边角不该吃点击。
 *
 * 与 {@link measureVisualTopRatio} 同一套探针，只是一次读回四个边——挂载时跑一次，
 * 结果交给 `body-box` 去收窄命中框（桌面端由主进程据此判定穿透）。
 *
 * @param draw - 在探测画布上铺一次画面的回调。
 * @returns 四边比例；整幅全透明或 canvas 不可用时返回 null。
 */
export function measureVisualBox(draw: VisualProbe): CanvasBoxRatios | null {
  const side = BOX_PROBE_SIDE;
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;
  try {
    draw(ctx, side, side);
    const data = ctx.getImageData(0, 0, side, side).data;
    const box = alphaBoxOf(data, side, side, BOX_ALPHA_MIN);
    if (box === null) return null;
    return {
      x0: box.x / side,
      y0: box.y / side,
      x1: (box.x + box.w) / side,
      y1: (box.y + box.h) / side,
    };
  } catch {
    // 与内容顶探测同理：读不到像素就交给调用方保留理论命中框。
    return null;
  }
}

/**
 * 量一层的不透明包围盒（源像素）。
 *
 * 读不到像素（跨源污染、画布不可用、整层全透明）一律返回 null——调用方按「整幅绘制」处理，
 * 视觉零回归，只是少了这次裁剪的收益。
 *
 * @param image - 已解码的图层。
 * @param sourceW - 源宽（px，= 清单 canvas.w）。
 * @param sourceH - 源高（px，= 清单 canvas.h）。
 * @returns 源像素包围盒；探测失败时为 null。
 */
export function measureLayerBox(image: CanvasImageSource, sourceW: number, sourceH: number): AlphaBox | null {
  if (!(sourceW > 0) || !(sourceH > 0)) return null;
  const longest = Math.max(sourceW, sourceH);
  const scale = Math.min(1, BOX_PROBE_PX / longest);
  const probeW = Math.max(1, Math.round(sourceW * scale));
  const probeH = Math.max(1, Math.round(sourceH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = probeW;
  canvas.height = probeH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;
  try {
    ctx.drawImage(image, 0, 0, probeW, probeH);
    const data = ctx.getImageData(0, 0, probeW, probeH).data;
    const box = alphaBoxOf(data, probeW, probeH, BOX_ALPHA_MIN);
    if (box === null) return null;
    return boxToSource(box, probeW / sourceW, probeH / sourceH, sourceW, sourceH, BOX_PAD_PROBE_PX);
  } catch {
    return null;
  }
}
