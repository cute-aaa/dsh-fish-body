/**
 * 边界阻力：越界位移按一条饱和曲线收窄，越拖越沉但不锁死，松手后仍由夹取把落点收进合法范围。
 *
 * 形状：`bound + over*dim*c/(dim + c*over)`，`dim = hi-lo` 是区间长度、`over` 是越界量。
 * `over → 0` 时位移 ≈ `c*over`（一上手就能感觉到重量），`over → ∞` 时位移趋近 `dim`（永不到达下一屏）。
 *
 * 为什么是纯函数：浏览器与桌面 Helper 的界限算法完全不同（视口内盒 vs 窗口坐标 + 本体偏移 + 多屏工作区），
 * 必须共享的只有这条阻力曲线本身；界限各自在自己那侧算（浏览器 `reachableLimits`，Helper `reachLimits`）。
 *
 * 兜底与 `pet/motion/geometry.ts` 的 `clampAxis` 同口径：区间反向、非有限输入一律原值返回，
 * 由调用方决定回落（夹取 / 直接用），这里绝不猜一个「更安全」的数。
 * @module dsh-fish-body/src/shared/physics/rubberband
 */

/** 阻力系数：0.55 下拖出 1px 只走约 0.55px，出区一半长度时约走四成——手感偏沉但跟手。 */
export const RUBBER_C = 0.55;

/**
 * 把越界坐标压成带阻力的坐标。
 *
 * @param value - 待处理的坐标（px）。
 * @param lo - 允许下限（px）。
 * @param hi - 允许上限（px）。
 * @param c - 阻力系数；越小越沉，缺省 {@link RUBBER_C}。
 * @returns 区间内原值；越界按饱和曲线收窄；输入非法时原值。
 */
export function rubberband(value: number, lo: number, hi: number, c = RUBBER_C): number {
  if (!Number.isFinite(value) || !Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(c)) return value;
  const dim = hi - lo;
  if (dim <= 0 || c <= 0) return value;
  if (value < lo) {
    const over = lo - value;
    return lo - (over * dim * c) / (dim + c * over);
  }
  if (value > hi) {
    const over = value - hi;
    return hi + (over * dim * c) / (dim + c * over);
  }
  return value;
}
