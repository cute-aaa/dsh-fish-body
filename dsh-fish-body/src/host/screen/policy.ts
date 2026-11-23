/**
 * 识屏时机判定（纯逻辑）：开关、手动请求、DSH 忙闲、静默时段与最短间隔合成一个结论。
 *
 * 不读配置、不看系统时钟——十二个事实由调用方传进来，本模块只回答「这一拍拍不拍、为什么」。
 * 这层分离是为了让「什么时候看屏幕」可被单测钉住：它省钱的地方全在这一段判定里。
 *
 * 判定顺序即优先级：关 → 手动 → 间隔 → 忙 → 静默 → 拍。
 * 手动排在间隔与忙之前是刻意的：用户点了「现在拍一张」，就不该被「还没到 120 秒」拦回来。
 * @module dsh-fish-body/src/host/screen/policy
 */
import { inQuietWindow, type ScreenConfig } from '../../shared/screen-config.ts';

/** 这一拍的结论原因（wire 词汇，设置页与日志都用它）。 */
export type ScreenTickReason = 'disabled' | 'manual' | 'throttled' | 'busy' | 'quiet' | 'ready';

/** 拍 / 不拍 + 原因。 */
export interface ScreenTickDecision {
  readonly capture: boolean;
  readonly reason: ScreenTickReason;
}

/** 判定输入：全局配置 + 四个观测事实。 */
export interface ScreenTickInput {
  /** 该宠物的看屏幕配置（已归一化，见 shared/screen-config 的 screenConfigOf）。 */
  readonly screen: ScreenConfig;
  /** 是否有一个待处理的手动请求（设置页「现在拍一张」/ 右键「看一眼屏幕」）。 */
  readonly manual: boolean;
  /** DSH 此刻是否有回合在跑（由路由按会话状态给）。 */
  readonly busy: boolean;
  /** 距最近一次会话事件过了多久（毫秒，见 host/agent-activity）。 */
  readonly idleForMs: number;
  /** 上次成功识屏的时刻（毫秒）；0 = 从未拍过。 */
  readonly lastMs: number;
  /** 当前时刻（毫秒）。 */
  readonly nowMs: number;
  /** 当前时刻的「当天第几分钟」（0–1439，本地时区）。 */
  readonly minuteOfDay: number;
}

/**
 * 本地时间 → 当天第几分钟（0–1439）。
 *
 * 不用 `getTimezoneOffset` 自己算：`getHours` 已经是本地时区，夏令时也由运行时处理。
 *
 * @param date - 当前时刻。
 * @returns 0–1439 的分钟数。
 */
export function minuteOfDayOf(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * 「现在忙不忙」：开了空闲门才算忙。
 *
 * 两层都要看——`busy` 是「有回合在跑」，`idleForMs` 是「刚干完但还没冷下来」。
 * 只看前者的话，回合刚结束那一秒就拍，模型还在收尾，正好撞上 KV cache。
 *
 * @param screen - 看屏幕配置。
 * @param busy - 是否有回合在跑。
 * @param idleForMs - 距上次会话事件的毫秒数。
 * @returns 是否视为忙（此时不拍）。
 */
export function screenBusyNow(screen: ScreenConfig, busy: boolean, idleForMs: number): boolean {
  if (!screen.idleOnly) return false;
  if (busy) return true;
  return idleForMs < screen.idleSec * 1000;
}

/**
 * 这一拍拍不拍。
 *
 * @param input - 配置与观测事实。
 * @returns 结论；`reason` 在 `capture: false` 时说明为什么没拍（日志与设置页共用）。
 */
export function decideScreenTick(input: ScreenTickInput): ScreenTickDecision {
  const { screen, manual, nowMs, lastMs, minuteOfDay } = input;
  if (!screen.readEnabled) return { capture: false, reason: 'disabled' };
  if (manual) return { capture: true, reason: 'manual' };
  // 时钟回拨（elapsed < 0）按「到点」处理：拦着不放只会让识屏永久停摆，而多拍一次最多花一次钱。
  const elapsed = nowMs - lastMs;
  if (lastMs > 0 && elapsed >= 0 && elapsed < screen.intervalSec * 1000) {
    return { capture: false, reason: 'throttled' };
  }
  if (screenBusyNow(screen, input.busy, input.idleForMs)) return { capture: false, reason: 'busy' };
  if (inQuietWindow(screen.quietFrom, screen.quietTo, minuteOfDay)) return { capture: false, reason: 'quiet' };
  return { capture: true, reason: 'ready' };
}
