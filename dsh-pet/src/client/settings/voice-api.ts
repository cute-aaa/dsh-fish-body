/**
 * 语音分区的三个接口：`/voice/voices` 的探活与清单、接入配置的读取与保存、启停脚本。
 *
 * 与状态机分开：这一层只做「请求 + 解析 + 归一化错误」，不碰 react、不碰轮询节奏。
 * 失败一律翻译成 `null`（读）或抛错（写）——调用方决定是保留原值还是把原因显示在卡里。
 * 密钥字段只回「配没配」（`secrets`），值本身永远不经这里：宿主从不把凭据回传给浏览器。
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

/** 一个实现的接入配置：普通值 + 密钥的在场情况。 */
export interface ProviderConfigBody {
  /** 普通配置项（键 = `fields[].key`，不含密钥字段）。 */
  readonly values: Record<string, string>;
  /** 密钥字段配没配（键 = 密钥字段的 key）。 */
  readonly secrets: Record<string, boolean>;
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
 * 把网络值过滤成「字符串 → 布尔」的表（密钥在场情况）。
 *
 * @param raw - 响应体里的 `secrets`（可能是任意值）。
 * @returns 只含布尔值的表；不是对象时返回空对象（当作「都没配」，与老宿主一致）。
 */
export function readBooleanRecord(raw: unknown): Record<string, boolean> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const values: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'boolean') values[key] = value;
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
 * 拉一个实现的接入配置（普通值 + 密钥在场情况）。
 *
 * @param providerId - 实现 id。
 * @returns 配置；请求失败或值不合法时 `null`。
 */
export async function fetchProviderConfig(providerId: string): Promise<ProviderConfigBody | null> {
  try {
    const response = await fetch(ROUTE_PATH + '/voice/provider-config?provider=' + encodeURIComponent(providerId));
    if (!response.ok) return null;
    const body = (await response.json()) as { values?: unknown; secrets?: unknown } | null;
    if (body === null) return null;
    const values = readStringRecord(body.values);
    return values === null ? null : { values, secrets: readBooleanRecord(body.secrets) };
  } catch {
    return null;
  }
}

/** 重新扫描一次音色清单的结论。 */
export interface RescanResult {
  /** 现在能真的合成的音色数。 */
  readonly ready: number;
  /** 列出来的音色总数（含缺文件的）。 */
  readonly total: number;
  /** 扫描诊断（目录不存在、缺参考音频…）；空数组表示没什么可说的。 */
  readonly notes: readonly string[];
}

/**
 * 让宿主丢掉扫描缓存、重扫一遍音色包目录。
 *
 * 设置页「扫描音色」按钮用它：音色包里的文件是用户在磁盘上加删的，宿主侧那份扫描结果有软过期，
 * 不主动重扫就要等 TTL 到点才看得见新嗓子。
 *
 * @param providerId - 实现 id（目前只有 `gsv` 有可扫描的音色目录）。
 * @param rejection - 宿主拒绝且没带原因时的兜底文案。
 * @returns 扫描结论（可合成数 / 总数 / 诊断）。
 * @throws HTTP 非 2xx、响应体不可解析或宿主拒绝。
 */
export async function rescanVoiceProvider(providerId: string, rejection: string): Promise<RescanResult> {
  const body = await postJson('/voice/rescan', { provider: providerId }, rejection);
  const ready = typeof body.ready === 'number' ? body.ready : 0;
  const total = typeof body.total === 'number' ? body.total : 0;
  const notes = Array.isArray(body.notes) ? body.notes.filter((item): item is string => typeof item === 'string') : [];
  return { ready, total, notes };
}
