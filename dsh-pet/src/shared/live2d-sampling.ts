/**
 * Live2D 模型贴图的采样设置与画布分辨率：浏览器半侧与桌面 Helper 共用同一份口径。
 *
 * **为什么不能用 PIXI 的默认采样**：PIXI v6 的 `settings.MIPMAP_TEXTURES = MIPMAP_MODES.POW2`，
 * 而 Live2D 模型贴图几乎都是 2 的幂（4096×8192 / 2048² / 8192²），于是每张贴图都会生成 mip 链、
 * 过滤取 `LINEAR_MIPMAP_LINEAR`。人物在桌面上只有两三百像素宽，贴图那边却是近四千 texel 宽——
 * 缩小十几倍时 GPU 取到 mip 3~4（4096 宽的那张已经降到 256~512 宽），头发丝、睫毛、衣褶这类
 * 细线被低通糊成一片。VTube Studio 走 Unity，模型贴图按 Cubism 的惯例**不开 mipmap**，所以线稿
 * 一直锐利；这里跟它对齐。
 *
 * **代价与补法**：关掉 mipmap 就没有低通兜底，欠采样的锯齿会露出来（实测头发成毛刺）。
 * 所以画布分辨率要超采样一档（2×），由浏览器把高分辨率画布缩回显示尺寸——几何边缘与贴图
 * 采样同时上了一层 SSAA，锯齿被缩回时抹平。实测这一档的锐度已经追平 VTube Studio。
 *
 * **改 flag 的时机**：PIXI 只在贴图**第一次上传**时按 `baseTexture.mipmap` 决定要不要生成 mip 链，
 * 之后改 flag 不会重新上传。所以必须在模型建好、第一次渲染之前改（见两个渲染后端的调用点）。
 * @module dsh-fish-body/src/shared/live2d-sampling
 */

/** 画布相对设备像素比的超采样倍数。 */
export const LIVE2D_SUPERSAMPLE = 2;

/** 画布分辨率上限：再高只是白烧填充率，头发细节早已够用。 */
export const LIVE2D_RENDER_RESOLUTION_MAX = 3;

/** PIXI 里我们真正用到的那几个成员（桌面侧是 classic JS，没有类型检查，这里只描述用到的那几个）。 */
export interface Live2dPixiFace {
  readonly MIPMAP_MODES: { readonly OFF: number };
  readonly SCALE_MODES: { readonly LINEAR: number };
}

/** PIXI 贴图里我们改得到的两个字段。 */
export interface Live2dTextureFace {
  readonly baseTexture: { mipmap: number; scaleMode: number };
}

/**
 * 画布分辨率：设备像素比 × 超采样倍数，封顶 {@link LIVE2D_RENDER_RESOLUTION_MAX}。
 *
 * 至少不低于设备像素比——否则比现在还糊；实际取值是它的 2 倍（封顶 3）。
 *
 * @param devicePixelRatio - `window.devicePixelRatio`；缺失或非法时按 1 算。
 * @returns 给 PIXI `Application` 的 `resolution`。
 */
export function live2dRenderResolution(devicePixelRatio: number | undefined): number {
  const ratio =
    typeof devicePixelRatio === 'number' && Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  return Math.min(ratio * LIVE2D_SUPERSAMPLE, LIVE2D_RENDER_RESOLUTION_MAX);
}

/**
 * 关掉模型贴图的 mipmap，并保持双线性过滤。
 *
 * 必须在贴图第一次上传前调用（PIXI 不会因为改 flag 重新上传已上传的贴图）。
 *
 * @param textures - 模型持有的 PIXI 贴图数组（`Live2DModel.textures`）。
 * @param pixi - PIXI 命名空间（取 `MIPMAP_MODES` / `SCALE_MODES`）。
 * @returns 实际改动了 mipmap 标志的贴图数（已经是 OFF 时为 0）。
 */
export function applyLive2dTextureSampling(
  textures: readonly Live2dTextureFace[] | undefined,
  pixi: Live2dPixiFace,
): number {
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
