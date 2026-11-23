/**
 * 宠物实际渲染宽度的解析：把「像素上限 + 人物占屏百分比」合成画框宽度（px）。
 *
 * 百分比说的是**人物本体**占屏宽多少，而 stage 是 16:9 画框、两侧各留透明边，
 * 所以换算要除以人物占画框的比例（见 shared/body-box 的 {@link bodyWidthRatio}）——
 * 这个比例随渲染方式变（webm 0.375、画布后端 0.84），不能写成常量。纯函数，不读 DOM。
 * @module dsh-fish-body/src/shared/pet-size
 */
import { bodyWidthRatio } from './body-box.ts';
import type { RendererKind, RenderSizes } from './types.ts';

/** 百分比下限（%）：小于它等于没写。不设上限——填 150 就是「人物比屏还宽」，由 `size` 决定画框最终多大。 */
export const SIZE_PERCENT_MIN = 1;

/** 默认值：人物占屏宽的 20%——小屏不糊脸，宽屏下实际仍被 `size` 这个画框上限夹住。 */
export const SIZE_PERCENT_DEFAULT = 20;

/** 画框宽度下限（px）：再小连气泡都摆不下，设置页的输入框也用它。 */
export const SIZE_MIN = 120;

/** 画框宽度上限（px）：4096 纹理的 live2d 再往上纯属浪费显存，桌面窗口也铺不满。 */
export const SIZE_MAX = 2048;

/** 尺寸滑块的步长（px）：取 1 而不是 10——`size` 常是 462 这类非整十数，
 *  步长 10 会让「拖回基准值 = 删掉按渲染方式的覆盖」这条规则永远做不到。 */
export const SIZE_STEP = 1;

/**
 * 百分比是否可用：必须是有限数字，且不小于下限。
 *
 * @param value - 配置里的原始值，可能未定义。
 * @returns 可用时 true 并把类型收窄为 number；`undefined`、字符串、`NaN`、`< 1` 均为 false。
 */
export function isValidSizePercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= SIZE_PERCENT_MIN;
}

/**
 * 画框宽度（px）是否可用：有限数字且落在 {@link SIZE_MIN}~{@link SIZE_MAX} 内。
 *
 * @param value - 待判定的值（配置、请求体、表单输入都可能不是数字）。
 * @returns 可用时 true 并把类型收窄为 number。
 */
export function isValidSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= SIZE_MIN && value <= SIZE_MAX;
}

/**
 * 取某个渲染方式实际用的画框宽度。
 *
 * 入参刻意是 `unknown`：成品聚合里的宠物是 `Record<string, unknown>`，写盘前的原始值更不可信，
 * 而这里只需要「读得出数字就用、读不出就回落」，不必让每个调用方先做一次收窄。
 *
 * @param pet - 至少要有 `size`；`sizes` 与 `renderer` 可缺（老配置）。
 * @returns `sizes[renderer]` 合法就用它，否则回落 `size`（两者都读不出时给 {@link SIZE_MIN}）。
 */
export function renderSizeOf(pet: unknown): number {
  const source = (pet !== null && typeof pet === 'object' ? pet : {}) as {
    size?: unknown;
    sizes?: unknown;
    renderer?: unknown;
  };
  const own = sizeOverrideOf(source.sizes, source.renderer);
  if (own !== undefined) return own;
  const base = Number(source.size);
  return Number.isFinite(base) ? base : SIZE_MIN;
}

/**
 * 从 `sizes` 里取出某个渲染方式的覆盖值。
 *
 * @param sizes - 配置里的 `pets[].sizes`（可能不是对象）。
 * @param renderer - 渲染方式（可能是任意值）。
 * @returns 合法覆盖值；缺键或非法时为 undefined。
 */
function sizeOverrideOf(sizes: unknown, renderer: unknown): number | undefined {
  if (typeof renderer !== 'string') return undefined;
  const perRenderer = sizes as RenderSizes | undefined;
  const own = perRenderer?.[renderer as RendererKind];
  return isValidSize(own) ? own : undefined;
}

/**
 * 画布后端（layered，以及将来任何按素材原生画布绘制的后端）该用多大的后备像素边。
 *
 * 三条约束一次夹掉：
 * 1. **跟随显示尺寸与 DPR**：CSS 宽 462 的宠物在 DPR 1 下画 462²，而不是素材的 1024²
 *    （整幅绘制的像素量差 4.9 倍，实测就是「拖动和动画都卡」的主因之一）；
 * 2. **不超过素材原生边**：原生 1024² 的图放大到 2000² 不会有更多细节，只是白烧一次全幅采样；
 * 3. **至少 1 像素**：画布边为 0 会让 `getContext`/`drawImage` 直接失效。
 *
 * DPR 不设上限：3×／4× 屏上封顶到 2 等于把画布压到设备像素之下（浏览器再放大回去就是糊的），
 * 分辨率该由显示器和用户决定——素材原生边那一条已经兜住了成本。
 *
 * @param cssSize - 画框宽度（CSS px，已按渲染方式解析过）。
 * @param nativeSide - 素材画布的原生边（清单 `canvas.w`，方形）。
 * @param dpr - `window.devicePixelRatio`；非法值按 1 处理。
 * @returns 后备画布的边长（px，整数）。
 */
export function renderPixelSide(cssSize: number, nativeSide: number, dpr: number): number {
  const css = Number.isFinite(cssSize) && cssSize > 0 ? cssSize : SIZE_MIN;
  const native = Number.isFinite(nativeSide) && nativeSide > 0 ? Math.round(nativeSide) : Math.round(css);
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.max(1, Math.min(native, Math.round(css * scale)));
}

/**
 * 取本次挂载使用的宽度。
 *
 * @param sizePx - 画框宽度（已按渲染方式解析过，见 {@link renderSizeOf}），同时是百分比的上限。
 * @param sizePercent - 人物占屏宽的百分比；缺省按 {@link SIZE_PERCENT_DEFAULT} 处理。
 * @param viewportWidthPx - 调用时刻的视口宽（CSS 像素）；非正数表示拿不到，直接回落到 `sizePx`。
 * @param renderer - 当前渲染方式：人物占框比例与它有关，缺省按 webm。
 * @returns 实际渲染的画框宽度，单位 px。
 */
export function resolvePetSizePx(
  sizePx: number,
  sizePercent: number | undefined,
  viewportWidthPx: number,
  renderer?: RendererKind | undefined,
): number {
  const percent = sizePercent ?? SIZE_PERCENT_DEFAULT;
  if (!isValidSizePercent(percent)) return sizePx;
  if (!Number.isFinite(viewportWidthPx) || viewportWidthPx <= 0) return sizePx;
  const bodyWidthPx = (viewportWidthPx * percent) / 100;
  return Math.min(sizePx, bodyWidthPx / bodyWidthRatio(renderer));
}
