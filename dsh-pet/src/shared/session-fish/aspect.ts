/**
 * 会话鱼皮肤的宽高比：素材尺寸只有加载后才知道，量到就记进缓存。
 *
 * 为什么单独一份：网页与桌面各有自己的 `<video>` / `<img>`，但「按显示宽度算高度」的口径
 * 必须一致——否则同一条鱼在两处大小不同，桌面上撑出来的窗口余量也对不上。
 * 缓存按皮肤 id 存：换皮肤不用重新量，量到的值也不会因为鱼被移除而丢。
 * @module dsh-pet/src/shared/session-fish/aspect
 */

/** 默认宽高比（素材 640×360）：量到真实尺寸前按它排。 */
export const SESSION_FISH_ASPECT = 16 / 9;

/** 高度相对宽度的允许区间：太扁或太长的图都不会把鱼群挤成一列。 */
const HEIGHT_RATIO_MIN = 0.5;
const HEIGHT_RATIO_MAX = 2;

/** 皮肤 id → 量到的宽高比；没有记录时用默认值。 */
const aspectCache = new Map<string, number>();

/**
 * 读某个皮肤已知的宽高比。
 *
 * @param skin - 皮肤 id。
 * @returns 宽 / 高；没量过时 {@link SESSION_FISH_ASPECT}。
 */
export function sessionFishAspectOf(skin: string): number {
  const known = aspectCache.get(skin);
  return known === undefined ? SESSION_FISH_ASPECT : known;
}

/**
 * 记一个皮肤的宽高比（量到合法尺寸才记）。
 *
 * @param skin - 皮肤 id。
 * @param width - 素材宽（px）。
 * @param height - 素材高（px）。
 * @returns 与已知比例相比是否变了（调用方据此决定要不要重排一次）。
 */
export function rememberSessionFishAspect(skin: string, width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  const aspect = width / height;
  const before = aspectCache.get(skin);
  if (before !== undefined && Math.abs(before - aspect) < 0.01) return false;
  aspectCache.set(skin, aspect);
  return true;
}

/**
 * 按宽度与宽高比算显示高度。
 *
 * @param widthPx - 显示宽度（px）。
 * @param aspect - 宽 / 高；缺省用默认比例。
 * @returns 夹在 `[0.5×宽, 2×宽]` 内的高度（px）。
 */
export function sessionFishHeightOf(widthPx: number, aspect: number = SESSION_FISH_ASPECT): number {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : SESSION_FISH_ASPECT;
  const ratio = Math.min(HEIGHT_RATIO_MAX, Math.max(HEIGHT_RATIO_MIN, 1 / safeAspect));
  return Math.max(1, Math.round(widthPx * ratio));
}
