/**
 * 会话活动时间戳：识屏「只在 DSH 空闲时才拍」的唯一依据。
 *
 * 刻意做成进程级单例：`session/event` 的监听装在 `plugin/session-watch`，而判定在路由层，
 * 两边相隔好几层装配——把一对时间戳穿过三层依赖，比在模块里存一个数字更容易出错。
 *
 * 必须始终成立：这里记的是**最近一次会话事件**的时刻，不是「宠物说过话」的时刻；
 * 时钟回拨时 `agentIdleForMs` 归零（宁可判成刚活动过，也别判成永久空闲）。
 * @module dsh-fish-body/src/host/agent-activity
 */

/** 最近一次会话事件的时间戳（毫秒）；0 = 插件起来之后还没见过任何事件。 */
let lastEventMs = 0;

/**
 * 记一次会话活动（由 `session/event` 监听调用，每个事件一次）。
 *
 * @param nowMs - 便于测试注入的当前时刻。
 */
export function markAgentActivity(nowMs: number = Date.now()): void {
  lastEventMs = Math.round(Number(nowMs) || 0);
}

/**
 * 距最近一次会话活动过了多久。
 *
 * @param nowMs - 当前时刻。
 * @returns 毫秒数；从未见过任何事件时返回 `Number.POSITIVE_INFINITY`（当作一直空闲）。
 */
export function agentIdleForMs(nowMs: number = Date.now()): number {
  if (lastEventMs === 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round(Number(nowMs) || 0) - lastEventMs);
}

/**
 * 清空（插件卸载 / 测试用）：下次 `agentIdleForMs` 又回到「从未见过事件」。
 */
export function resetAgentActivity(): void {
  lastEventMs = 0;
}
