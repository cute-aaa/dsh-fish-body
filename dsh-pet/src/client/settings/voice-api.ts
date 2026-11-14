/**
 * 语音分区的三个接口：`/voice/voices` 的探活与清单、接入配置的读取与保存、启停脚本。
 *
 * 与状态机分开：这一层只做「请求 + 解析 + 归一化错误」，不碰 react、不碰轮询节奏。
 * 失败一律翻译成 `null`（读）或抛错（写）——调用方决定是保留原值还是把原因显示在卡里。
 * 凭据类字段不过这里：接入配置只透传宿主的 `values`，不做日志与回显。
 * @module dsh-fish-body/src/client/settings/voice-api
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { VoiceOption } from './picker/voice-picker.ts';

/** `/voice/voices` 里本页用到的两段。 */
export interface VoicesBody {
  /** 内置实现的音色清单。 */
  readonly voices?: VoiceOption[];
  /** 第三方实现的原始数组（由 `readVoiceProviders` 解析）。 */
  readonly providers?: unknown;
}

/**
 * 把网络值过滤成「字符串 → 字符串」的草稿表。
 *
 * @param raw - 响应体里的 `values`（可能是任意值）。
 * @returns 只含字符串值的表；不是对象时返回 `null`（调用方保留手里的草稿）。
 */
export function readStringRecord(raw: unknown): Record<string, string> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}

/**
 * 拉一次 `/voice/voices`。
 *
 * @returns 解析后的响应体；非 2xx 或网络/解析失败返回 `null`（调用方保持原状，不清空已有清单）。
 */
export async function fetchVoices(): Promise<VoicesBody | null> {
  try {
    const response = await fetch(ROUTE_PATH + '/voice/voices');
    if (!response.ok) return null;
    return (await response.json()) as VoicesBody | null;
  } catch {
    return null;
  }
}

/**
 * POST 一份 JSON 并解析响应。
 *
 * @param path - 相对 `ROUTE_PATH` 的路径。
 * @param body - 请求体（会被 JSON 序列化）。
 * @param rejection - 宿主回 `ok: false` 且没带 message 时的兜底文案。
 * @returns 解析后的响应体。
 * @throws HTTP 非 2xx、响应体不可解析或宿主拒绝（`ok: false`）。
 */
export async function postJson(path: string, body: unknown, rejection: string): Promise<Record<string, unknown>> {
  const response = await fetch(ROUTE_PATH + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || parsed === null) throw new Error('HTTP ' + response.status);
  if (parsed.ok === false) {
    throw new Error(typeof parsed.message === 'string' && parsed.message !== '' ? parsed.message : rejection);
  }
  return parsed;
}

/**
 * 拉一个实现的接入配置值。
 *
 * @param providerId - 实现 id。
 * @returns 草稿表；请求失败或值不合法时 `null`。
 */
export async function fetchProviderConfig(providerId: string): Promise<Record<string, string> | null> {
  try {
    const response = await fetch(ROUTE_PATH + '/voice/provider-config?provider=' + encodeURIComponent(providerId));
    if (!response.ok) return null;
    const body = (await response.json()) as { values?: unknown } | null;
    return body === null ? null : readStringRecord(body.values);
  } catch {
    return null;
  }
}
