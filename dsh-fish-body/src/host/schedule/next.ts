/**
 * 时段算术：把 `extractSchedule` 抽出来的 `{from,to}` 换算成「现在在不在这一段」「这一段什么时候结束」。
 *
 * 全是纯函数、按分钟数算，不碰 Date 的时区细节（调用方把 `Date` 拆成当日分钟数传进来）——
 * 作息是「本地钟点」的事，用绝对时间戳做区间判断迟早会在跨午夜与夏令时上翻车。
 * @module dsh-fish-body/src/host/schedule/next
 */
import type { ScheduleEntry } from './extract.ts';

/** 一天的总分钟数。 */
export const MINUTES_PER_DAY = 24 * 60;

/** 一段时段在一天里的分钟区间（`end < start` 表示跨午夜）。 */
export interface MinuteWindow {
  readonly start: number;
  readonly end: number;
}

/**
 * `"HH:MM"` → 当日分钟数。
 *
 * @param clock - `"HH:MM"`（两位补零）。
 * @returns 0..1439；格式非法返回 `undefined`（不猜）。
 */
export function minuteOfDay(clock: string): number | undefined {
  const hit = /^(\d{2}):(\d{2})$/.exec(clock);
  if (hit === null) return undefined;
  const hour = Number(hit[1]);
  const minute = Number(hit[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined;
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}

/**
 * 取一个 Date 的当日分钟数（本地时区）。
 * @param date - 时刻。
 * @returns 0..1439。
 */
export function minuteOf(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * 时段 → 分钟区间。
 * @param entry - 从文本抽出来的一条时段。
 * @returns 区间；时间非法时 `undefined`。
 */
export function windowOf(entry: ScheduleEntry): MinuteWindow | undefined {
  const start = minuteOfDay(entry.from);
  const end = minuteOfDay(entry.to);
  if (start === undefined || end === undefined || start === end) return undefined;
  return { start, end };
}

/**
 * 某一分钟在不在区间里。
 *
 * 跨午夜（`end < start`）按「从 start 到次日 end」算；`end > start` 是普通区间。
 *
 * @param minutes - 当日分钟数。
 * @param window - 区间。
 * @returns 在区间内为 true。
 */
export function isInWindow(minutes: number, window: MinuteWindow): boolean {
  const { start, end } = window;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

/**
 * 当前落在哪一条睡眠时段里（多条重叠时取**最先开始**的那条，结果稳定）。
 *
 * @param entries - 从文本抽出、已去重的时段。
 * @param minutes - 当日分钟数。
 * @returns 命中的时段；都不在时 null。
 */
export function activeEntryAt(entries: readonly ScheduleEntry[], minutes: number): ScheduleEntry | null {
  let best: ScheduleEntry | null = null;
  let bestElapsed = -1;
  for (const entry of entries) {
    const window = windowOf(entry);
    if (window === undefined) continue;
    if (!isInWindow(minutes, window)) continue;
    // 跨午夜段的 start 在「今天」更大，但它昨天就开始了：按"已经持续多久"取最长的那条，
    // 这样 23:00→08:00 与 00:00→02:00 在 01:00 重叠时，答案稳定是前者。
    const elapsed = minutes >= window.start ? minutes - window.start : MINUTES_PER_DAY - window.start + minutes;
    if (elapsed > bestElapsed) {
      bestElapsed = elapsed;
      best = entry;
    }
  }
  return best;
}

/**
 * 这一段结束的绝对时刻。
 *
 * @param entry - 命中或将要开始的时段。
 * @param now - 当前时刻。
 * @returns 结束时刻；时间非法时 undefined。
 */
export function endOfWindow(entry: ScheduleEntry, now: Date): Date | undefined {
  const window = windowOf(entry);
  if (window === undefined) return undefined;
  const end = new Date(now.getTime());
  end.setHours(Math.floor(window.end / 60), window.end % 60, 0, 0);
  // 结束时刻不晚于现在 = 已经跨到次日
  if (end.getTime() <= now.getTime()) end.setDate(end.getDate() + 1);
  return end;
}

/**
 * 距下一个边界还有多少分钟（用于安排下一次检查）。
 *
 * @param entries - 时段表。
 * @param minutes - 当日分钟数。
 * @returns 到最近一次「进段 / 出段」的分钟数；表为空时 undefined。
 */
export function minutesToNextBoundary(entries: readonly ScheduleEntry[], minutes: number): number | undefined {
  let best: number | undefined;
  const consider = (target: number): void => {
    const delta = (target - minutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    if (delta === 0) return;
    if (best === undefined || delta < best) best = delta;
  };
  for (const entry of entries) {
    const window = windowOf(entry);
    if (window === undefined) continue;
    consider(window.start);
    consider(window.end);
  }
  return best;
}
