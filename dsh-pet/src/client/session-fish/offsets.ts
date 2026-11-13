/**
 * 会话鱼相对槽位的偏移：按会话 id 记在 localStorage，刷新后鱼还在你放它的那个方向。
 *
 * 存的是「偏移」而不是绝对坐标：鱼围着桌宠转，坐标会随桌宠移动，只有相对槽位的差值是稳定的。
 * 值在读取后由运动引擎再钳一次上限（见 `roam.ts`），所以这里只做形状清洗与条数裁剪——
 * 手改存储或旧版本写脏了，最坏也只是那条鱼回到默认环位。
 * @module dsh-pet/src/client/session-fish/offsets
 */
import type { FishOffset } from './roam.ts';

export type { FishOffset };

/** 存储键：`{ [sessionId]: { dx, dy } }`（px，相对该鱼的槽位）。 */
const STORAGE_KEY = 'dsh-pet:session-fish-offsets';

/** 旧版本（绝对视口坐标）的键：升级后直接作废，重置时一并删掉。 */
const LEGACY_POSITIONS_KEY = 'dsh-pet:session-fish-positions';

/** 一次存储里最多保留多少条。 */
const MAX_STORED = 60;

/** 「重置鱼的位置」的窗口事件名：设置页发，浮层听（两个组件没有父子关系）。 */
export const SESSION_FISH_POSITIONS_RESET_EVENT = 'dsh-pet:session-fish-positions-reset';

/** 安全取 localStorage（隐私模式/测试环境可能没有）。 */
function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** 把任意值收窄成偏移；非法返回 undefined。 */
function offsetOf(value: unknown): FishOffset | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as { dx?: unknown; dy?: unknown };
  if (typeof record.dx !== 'number' || !Number.isFinite(record.dx)) return undefined;
  if (typeof record.dy !== 'number' || !Number.isFinite(record.dy)) return undefined;
  return { dx: record.dx, dy: record.dy };
}

/**
 * 读全部偏移；存储缺失/损坏返回空表。
 *
 * @returns 会话 id → 偏移。
 */
export function readOffsets(): Record<string, FishOffset> {
  const store = storage();
  if (!store) return {};
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, FishOffset> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const offset = offsetOf(value);
      if (offset) out[id] = offset;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 记一条偏移（其他会话的保留，最多 {@link MAX_STORED} 条）。
 *
 * @param sessionId - 会话 id。
 * @param offset - 相对槽位的偏移（px）。
 */
export function writeFishOffset(sessionId: string, offset: FishOffset): void {
  const store = storage();
  if (!store) return;
  const current = readOffsets();
  const next: Record<string, FishOffset> = { [sessionId]: offset };
  for (const [id, value] of Object.entries(current)) {
    if (id === sessionId) continue;
    if (Object.keys(next).length >= MAX_STORED) break;
    next[id] = value;
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 存储满/被禁用：这次拖拽仍生效到本次刷新为止 */
  }
}

/** 清空全部偏移（含旧版本的绝对坐标），并通知浮层把当前渲染位置复位。 */
export function clearFishOffsets(): void {
  try {
    const store = storage();
    store?.removeItem(STORAGE_KEY);
    store?.removeItem(LEGACY_POSITIONS_KEY);
  } catch {
    /* 清不掉也不影响本次广播 */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_FISH_POSITIONS_RESET_EVENT));
}
