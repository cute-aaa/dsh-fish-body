/**
 * live2d 动作时长：菜单点一个 motion 之后，多久把它收掉、回到静息。
 *
 * 模型里的 motion 多数不是一次性动作（举手 / 竖手指这类是「切到某个姿态」的循环片段），
 * 点完一直挂着会把宠物钉在那个姿态上；所以按宿主注入的 `Duration` 计时收尾。
 * `Duration` 不是 Cubism 标准字段，由宿主在 `/skin` 路由里从 `.motion3.json` 的 `Meta.Duration` 抄进清单；
 * 缺它（用户自带的 model3 声明）时按 {@link DEFAULT_MOTION_SECONDS} 兜底。
 * 两端（浏览器 / 桌面 Helper）共用这一份判据。
 * @module dsh-pet/src/shared/live2d-motions
 */

/** 清单没写时长时用的兜底秒数：够看清动作，又不至于长时间占着姿态。 */
export const DEFAULT_MOTION_SECONDS = 2;

/** 收尾留白（秒）：动作播完到复位之间空一拍，避免最后一帧被直接切掉。 */
export const MOTION_TAIL_SECONDS = 0.25;

/** 取对象（非数组）。 */
function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * model3.json → `组:序号` → 时长（秒）。
 *
 * @param settings - 模型清单原始值（unknown）。
 * @returns 时长表；没有 Motions 或字段缺失的条目不出现在表里。
 */
export function motionDurationsOf(settings: unknown): Readonly<Record<string, number>> {
  const motions = obj(obj(obj(settings)?.FileReferences)?.Motions);
  if (motions === undefined) return {};
  const out: Record<string, number> = {};
  for (const [group, list] of Object.entries(motions)) {
    if (!Array.isArray(list)) continue;
    list.forEach((item, index) => {
      const duration = Number(obj(item)?.Duration);
      if (Number.isFinite(duration) && duration > 0) out[group + ':' + String(index)] = duration;
    });
  }
  return out;
}

/**
 * 这份时长表里有没有待机动作（组名 `Idle`）。
 *
 * 有就说明模型带常驻待机：一次性动作收尾后要把它接回去，否则宠物停在静息姿态不动。
 * @param durations - {@link motionDurationsOf} 的结果。
 * @returns 带待机组时为 true。
 */
export function hasIdleMotion(durations: Readonly<Record<string, number>>): boolean {
  return Object.keys(durations).some((key) => key.startsWith('Idle:'));
}

/**
 * 一次 motion 从起播到复位要等多久。
 *
 * @param durations - {@link motionDurationsOf} 的结果。
 * @param group - motion 组名。
 * @param index - 组内序号。
 * @returns 毫秒（含收尾留白）。
 */
export function motionHoldMs(durations: Readonly<Record<string, number>>, group: string, index: number): number {
  const seconds = durations[group + ':' + String(index)] ?? DEFAULT_MOTION_SECONDS;
  return Math.round((seconds + MOTION_TAIL_SECONDS) * 1000);
}
