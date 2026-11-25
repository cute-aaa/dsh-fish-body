/**
 * 「兼容」卡的客户端接口：读外部记忆状态、读/写共存模式。
 *
 * 与设置页其它请求同一套口径——**不抛**：拿不到就回 null，卡片据此显示「暂不可用」。
 * 两个端点都是 GET（除了共存模式的 POST），没有副作用，可以放心在挂载时拉一次。
 * @module dsh-fish-body/src/client/settings/compat-api
 */
import { ROUTE_PATH } from '../../shared/constants.ts';

/** 共存模式。 */
export type CoexistMode = 'auto' | 'full' | 'body-only';

/** 检测到的同伴。 */
export interface CoexistPartner {
  readonly id: string;
  readonly label: string;
  readonly evidence: string;
  readonly risk: string;
}

/** `GET /coexist` 的视图。 */
export interface CoexistView {
  readonly mode: CoexistMode;
  readonly partners: readonly CoexistPartner[];
  readonly autoWhisperPaused: boolean;
}

/** 记忆候选。 */
export interface MemoryCandidate {
  readonly id: string;
  readonly label: string;
  readonly dir: string;
  readonly installed: boolean;
  readonly evidence: string;
}

/** 记忆 provider 状态。 */
export interface MemoryProvider {
  readonly id: string;
  readonly dir: string;
  readonly registeredAt: string;
  readonly notes: number;
  readonly skipped: number;
  readonly lastReadAt: string;
}

/** `GET /memory` 的视图。 */
export interface MemoryView {
  readonly provider: MemoryProvider | null;
  readonly candidates: readonly MemoryCandidate[];
  readonly slotTakenByOther: boolean;
}

/** 一次拉取的合并结果；取不到的为 null（卡片显示「暂不可用」）。 */
export interface CompatSnapshot {
  readonly coexist: CoexistView | null;
  readonly memory: MemoryView | null;
}

/** 把 unknown 收成数组（形状不对就当空）。 */
function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** 拉一次共存与记忆状态。 */
export async function loadCompat(): Promise<CompatSnapshot> {
  const [coexist, memory] = await Promise.all([getJson<CoexistView>('/coexist'), getJson<MemoryView>('/memory')]);
  return {
    coexist:
      coexist === null
        ? null
        : {
            mode: coexist.mode,
            partners: arrayOf<CoexistPartner>(coexist.partners),
            autoWhisperPaused: coexist.autoWhisperPaused === true,
          },
    memory:
      memory === null
        ? null
        : {
            provider: memory.provider ?? null,
            candidates: arrayOf<MemoryCandidate>(memory.candidates),
            slotTakenByOther: memory.slotTakenByOther === true,
          },
  };
}

/**
 * 切换共存模式。
 * @param mode - 目标模式。
 * @returns 结论与刷新后的快照；失败带一句可直接显示的话。
 */
export async function setCoexistMode(
  mode: CoexistMode,
): Promise<{ ok: true; snapshot: CompatSnapshot } | { ok: false; message: string }> {
  try {
    const response = await fetch(ROUTE_PATH + '/coexist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (!response.ok) return { ok: false, message: 'HTTP ' + String(response.status) };
    const body: unknown = await response.json();
    const record = body as { ok?: unknown; message?: unknown } | null;
    if (record?.ok !== true) {
      return { ok: false, message: typeof record?.message === 'string' ? record.message : '设置失败' };
    }
    return { ok: true, snapshot: await loadCompat() };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** 读一个 GET 端点；失败 / 形状不对返回 null。 */
async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(ROUTE_PATH + path, { cache: 'no-store' });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const record = body as { ok?: unknown } | null;
    return record?.ok === true ? (record as T) : null;
  } catch {
    return null;
  }
}
