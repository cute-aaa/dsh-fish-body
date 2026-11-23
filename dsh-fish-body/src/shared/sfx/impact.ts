/**
 * 撞击速度 → 碰撞音增益。
 *
 * 与 haptics.ts 用同一组速度锚点（软碰 300、硬砸 1500 px/s），但输出不是时长而是响度系数：
 * 轻碰几乎听不见、硬砸满响，规则可脱离 DOM 断言。
 * @module dsh-fish-body/src/shared/sfx/impact
 */

/** 低于这个撞击速度完全不响（px/s）：贴地抖动与轻放都不该出声。 */
export const IMPACT_MIN_SPEED = 150;

/** 软碰锚点（px/s）：从这里开始有声音。 */
const SOFT_SPEED = 300;

/** 硬砸锚点（px/s）：到这里满响。 */
const HARD_SPEED = 1500;

/** 刚好过阈值时的起始响度：给一点存在感，又不至于「碰一下就砸桌子」。 */
const MIN_GAIN = 0.35;

/**
 * 撞击速度 → 音量系数。
 *
 * @param speed - 撞击法向速度（px/s）。
 * @returns 0–1 的增益；不该响时返回 `null`（调用方据此跳过本次播放）。
 */
export function impactGain(speed: number): number | null {
  if (!Number.isFinite(speed) || speed < IMPACT_MIN_SPEED) return null;
  const t = Math.min(1, Math.max(0, (speed - SOFT_SPEED) / (HARD_SPEED - SOFT_SPEED)));
  return MIN_GAIN + (1 - MIN_GAIN) * t;
}
