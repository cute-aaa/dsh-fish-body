/**
 * Live2D 的三处采样/缓冲口径：贴图 mipmap、画布后备分辨率、裁剪掩膜缓冲区。浏览器半侧与桌面 Helper 共用。
 *
 * 三处都是对着 VTube Studio（Unity，模型贴图不开 mipmap）与 Cubism 官方渲染器的默认值定的：
 * - 贴图必须关 mipmap：模型贴图几乎都是 2 的幂，PIXI 默认给它们建 mip 链，缩小十几倍时线稿被低通糊掉；
 * - 关掉 mipmap 就没有低通兜底，欠采样的锯齿靠画布超采样补——但后备分辨率的下限永远是设备像素比：
 *   我们只往「更清晰」的方向加，绝不低于显示器本身的要求（分辨率是用户与设备的，不由我们决定）；
 * - 官方渲染器的裁剪掩膜缓冲区默认 256²，要按画布实际像素放大，否则被掩膜裁的部件边缘是一圈软边。
 *
 * 前两项都必须在贴图 / 掩膜第一次上传之前生效，见两个渲染后端的调用点。
 * @module dsh-fish-body/src/shared/live2d-sampling
 */

/** 画布相对设备像素比的抗锯齿超采样倍数：只加一档，再多没有肉眼收益。 */
export const LIVE2D_SUPERSAMPLE = 2;

/** 画布后备边长预算（px）：超采样后超过它就不再往上加，填充率换不来细节。 */
export const LIVE2D_RENDER_SIDE_MAX = 2048;

/** 裁剪掩膜缓冲区边长下限（px）：低于它对大画布来说仍是一圈软边。 */
export const LIVE2D_MASK_SIDE_MIN = 512;

/** 裁剪掩膜缓冲区边长上限（px）：桌面 Helper 走软件光栅化，2048²（16MB）每帧多花约 7ms，
 *  而 1024² 与 2048² 的尾巴边缘肉眼看不出差别——这一档是拿实测帧耗时换的。 */
export const LIVE2D_MASK_SIDE_MAX = 1024;

/** PIXI 里我们真正用到的那几个成员（桌面侧是 classic JS，没有类型检查，这里只描述用到的那几个）。 */
export interface Live2dPixiFace {
  readonly MIPMAP_MODES: { readonly OFF: number };
  readonly SCALE_MODES: { readonly LINEAR: number };
  /** PIXI 全局设置；缺失时只走逐张贴图兜底。 */
  readonly settings?: { MIPMAP_TEXTURES: number };
}

/** PIXI 贴图里我们改得到的两个字段。 */
export interface Live2dTextureFace {
  readonly baseTexture: { mipmap: number; scaleMode: number };
}

/**
 * Cubism 官方渲染器里的裁剪管理器（本包 vendor 的版本字段名稳定，`updateWebGLContext` 也这么用）。
 *
 * 不走 `setClippingMaskBufferSize()`：它会重建管理器并丢掉 GL 上下文，而这段代码必须跑在
 * 第一次渲染之前（那时 `renderer.gl` 还没拿到），所以直接改字段、丢掉旧尺寸的掩膜贴图。
 */
export interface Live2dRendererFace {
  readonly _clippingManager?: {
    _clippingMaskBufferSize?: number;
    _maskTexture?: unknown;
  };
}

/** 设备像素比的读法统一在这里：非正数、NaN、非数字一律按 1（等于「不缩放」）。 */
function ratioOf(devicePixelRatio: number | undefined): number {
  return typeof devicePixelRatio === 'number' && Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
}

/** 边长向上取整到 2 的幂：掩膜贴图是 POT 更省，也避免某些驱动对 NPOT 的降级路径。 */
function ceilPowerOfTwo(value: number): number {
  let side = 1;
  while (side < value) side *= 2;
  return side;
}

/**
 * 画布分辨率：设备像素比是**下限**，往上加一档超采样，直到碰上 {@link LIVE2D_RENDER_SIDE_MAX} 预算。
 *
 * 不设「绝对上限」：上限若低于设备像素比，等于替用户把分辨率压到显示器之下（4× 屏会被压成 3×）；
 * 预算只削我们加的那一档，削不到设备像素比本身——画框大到预算不够时，仍是设备像素比的原始清晰度。
 *
 * @param devicePixelRatio - `window.devicePixelRatio`；缺失或非法时按 1 算。
 * @param frameSizePx - 画框边长（CSS px）；缺失或非法时只按超采样算，不受预算限制。
 * @returns 给 PIXI `Application` 的 `resolution`，不小于设备像素比。
 */
export function live2dRenderResolution(devicePixelRatio: number | undefined, frameSizePx?: number): number {
  const ratio = ratioOf(devicePixelRatio);
  const frame = typeof frameSizePx === 'number' && Number.isFinite(frameSizePx) && frameSizePx > 0 ? frameSizePx : 0;
  const byBudget = frame > 0 ? LIVE2D_RENDER_SIDE_MAX / frame : Number.POSITIVE_INFINITY;
  const wanted = Math.min(ratio * LIVE2D_SUPERSAMPLE, byBudget);
  return Math.max(ratio, Math.round(wanted * 100) / 100);
}

/**
 * 裁剪掩膜缓冲区边长：跟着**画布实际像素**走（画框 × 分辨率），取 2 的幂后夹在上下限之间。
 *
 * 掩膜按整个模型画布归一化，四个通道还会再各分四分之一，所以 256² 摊到单个通道只剩 128² ——
 * 被掩膜裁的部件（尾巴、鬓发）边缘因此是一圈被放大的软边，和同屏的其它部件锐度对不上。
 *
 * @param frameSizePx - 画框边长（CSS px）。
 * @param resolution - 画布分辨率（见 {@link live2dRenderResolution}）。
 * @returns 掩膜缓冲区边长（px）。
 */
export function live2dMaskBufferSide(frameSizePx: number, resolution: number): number {
  const frame = Number.isFinite(frameSizePx) && frameSizePx > 0 ? frameSizePx : LIVE2D_MASK_SIDE_MIN;
  const ratio = ratioOf(resolution);
  const need = Math.ceil(frame * ratio);
  return Math.min(LIVE2D_MASK_SIDE_MAX, Math.max(LIVE2D_MASK_SIDE_MIN, ceilPowerOfTwo(need)));
}

/**
 * 关掉模型贴图的 mipmap，并保持双线性过滤。
 *
 * 先关 PIXI 的全局开关（这样之后才创建的贴图也不会生成 mip 链），再逐张贴图兜一次——
 * 两者顺序不能反：全局开关只对**尚未上传**的贴图生效。
 *
 * @param textures - 模型持有的 PIXI 贴图数组（`Live2DModel.textures`）。
 * @param pixi - PIXI 命名空间（取 `MIPMAP_MODES` / `SCALE_MODES` / `settings`）。
 * @returns 实际改动了 mipmap 标志的贴图数（已经是 OFF 时为 0）。
 */
export function applyLive2dTextureSampling(
  textures: readonly Live2dTextureFace[] | undefined,
  pixi: Live2dPixiFace,
): number {
  if (pixi.settings !== undefined) pixi.settings.MIPMAP_TEXTURES = pixi.MIPMAP_MODES.OFF;
  if (!Array.isArray(textures)) return 0;
  let changed = 0;
  for (const texture of textures) {
    const base = texture?.baseTexture;
    if (!base) continue;
    if (base.mipmap !== pixi.MIPMAP_MODES.OFF) {
      base.mipmap = pixi.MIPMAP_MODES.OFF;
      changed++;
    }
    base.scaleMode = pixi.SCALE_MODES.LINEAR;
  }
  return changed;
}

/**
 * 把裁剪掩膜缓冲区放到不至于糊的尺寸。
 *
 * 必须在第一次渲染之前调用；换尺寸时顺手丢掉已缓存的掩膜贴图，否则会沿用旧尺寸。
 *
 * @param renderer - `model.internalModel.renderer`（Cubism 官方 WebGL 渲染器）。
 * @param side - 掩膜缓冲区边长，见 {@link live2dMaskBufferSide}。
 * @returns 真的改到了 true；渲染器不是预期形状时 false（保持原样，不半改）。
 */
export function applyLive2dMaskBuffer(renderer: Live2dRendererFace | undefined, side: number): boolean {
  const manager = renderer?._clippingManager;
  if (!manager || typeof manager._clippingMaskBufferSize !== 'number') return false;
  if (manager._clippingMaskBufferSize === side) return false;
  manager._clippingMaskBufferSize = side;
  manager._maskTexture = undefined;
  return true;
}
