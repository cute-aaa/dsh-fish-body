/**
 * 画布内容顶探测：把画面缩到 64×64 量一下「最上方不透明像素」落在哪一行。
 *
 * 为什么不在渲染器里硬编码比例：live2d 模型和分层皮肤的画布留白差别很大
 * （实测同一批皮肤的内容顶从 0% 到 22%），写死任何一个数都会让气泡盖脸或者飘太高。
 * 缩到 64px 再读一次像素：误差 ≤1.6%（宠物宽度 462px 时约 7px），一次挂载只跑一遍，代价可以忽略。
 * @module dsh-pet/src/client/pet/render/visual-top
 */

/** 探测画布边长（px）：够分辨 1.5% 的位置，又把像素读回压到 4096 个。 */
const PROBE_PX = 64;

/** alpha 阈值（0~255）：低于它的算透明，避免把羽化边缘当成内容顶。 */
const ALPHA_MIN = 24;

/** 往探测画布上作画的回调：调用方按自己的画布口径铺图。 */
export type VisualProbe = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

/**
 * 量内容顶比例。
 *
 * @param draw - 在探测画布上铺一次画面的回调。
 * @returns 内容顶相对画布高度的比例（0~1）；整幅全透明或 canvas 不可用时返回 null。
 */
export function measureVisualTopRatio(draw: VisualProbe): number | null {
  const canvas = document.createElement('canvas');
  canvas.width = PROBE_PX;
  canvas.height = PROBE_PX;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;
  try {
    draw(ctx, PROBE_PX, PROBE_PX);
    const data = ctx.getImageData(0, 0, PROBE_PX, PROBE_PX).data;
    for (let y = 0; y < PROBE_PX; y++) {
      for (let x = 0; x < PROBE_PX; x++) {
        if (data[(y * PROBE_PX + x) * 4 + 3] >= ALPHA_MIN) return (y + 0.5) / PROBE_PX;
      }
    }
  } catch {
    // 画布被污染（跨源图片没开 CORS）/ getImageData 失败：交给调用方走兜底比例。
    return null;
  }
  return null;
}
