/**
 * `/voice/provider-config`：第三方语音实现的接入配置（服务地址、目录、语种，以及**密钥字段**）。
 *
 * 从 `routes/voice.ts` 拆出来单独一份，因为这条路由现在有两条写入路径：普通项写
 * `voice-providers.json`（`voice/gsv/store.ts`），密钥项写 DSH 凭据库（`voice/provider-secrets.ts`）。
 * 两条路径的校验与错误码放在一起才看得清「哪个键该去哪」。
 *
 * 契约见 openapi.yaml；本模块只判定方法、键白名单与取值形状。
 * @module dsh-fish-body/src/host/routes/voice-provider-config
 */
import type { RouteResult } from '../http.ts';
import type { RouteInput } from './types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';
import { voiceProviderStatuses } from '../voice/registry.ts';
import type { VoiceField } from '../voice/registry.ts';
import { providerConfigPath, readProviderValues, writeProviderFields } from '../voice/gsv/store.ts';
import {
  providerSecretSeamOf,
  readSecretPresence,
  secretFieldsOf,
  writeSecretFields,
} from '../voice/provider-secrets.ts';

/** 单个配置项的长度上限（字符）：路径与 URL 都远短于这个，超了基本是粘错内容。 */
const MAX_CONFIG_VALUE_CHARS = 512;

/** 这条路由需要的宿主能力。 */
export interface ProviderConfigDeps {
  /** 插件数据根（`config/voice-providers.json` 在它下面）。 */
  readonly userRoot: string;
  /** 软取宿主可选服务（`credentials`；独立模式没有写入能力）。 */
  readonly optionalService: (name: string) => unknown;
}

/** 解析后的请求体：`patch` 是本次要写的键值，`clear` 是要清除的密钥键。 */
interface ProviderConfigBody {
  readonly provider?: unknown;
  readonly patch?: unknown;
  readonly clear?: unknown;
}

/**
 * 校验并写一批普通配置项。
 *
 * @param keys - 该实现声明的全部键（含密钥键：多写的键一律拒，而不是静默丢弃）。
 * @param patch - 请求体里的 `patch`。
 * @returns 归一化后的键值；不合法时返回一句可直接回给前端的应答。
 */
function validatePatch(
  keys: readonly string[],
  patch: unknown,
): { ok: true; value: Record<string, string> } | { ok: false; res: RouteResult } {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, res: failResult('bad-request', 'patch 必须是对象') };
  }
  const value: Record<string, string> = {};
  for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
    // 只认该实现声明过的键：多写的键静默丢弃会让设置页以为保存成功，所以直接拒。
    if (!keys.includes(key)) return { ok: false, res: failResult('bad-request', `未知配置项：${key}`) };
    if (typeof raw !== 'string') return { ok: false, res: failResult('bad-request', `${key} 必须是字符串`) };
    const trimmed = raw.trim();
    if (trimmed.length > MAX_CONFIG_VALUE_CHARS) {
      return { ok: false, res: failResult('bad-request', `${key} 太长（上限 ${MAX_CONFIG_VALUE_CHARS} 字符）`) };
    }
    // baseURL 只收 http(s)：写个别的东西进去，探活会一直失败而界面看不出原因。
    if (key === 'baseURL' && trimmed !== '' && !/^https?:\/\//i.test(trimmed)) {
      return { ok: false, res: failResult('bad-request', 'baseURL 必须以 http:// 或 https:// 开头') };
    }
    value[key] = trimmed;
  }
  return { ok: true, value };
}

/**
 * 校验 `clear`：只能是该实现的密钥键。
 *
 * @param secretKeys - 该实现的密钥字段键。
 * @param clear - 请求体里的 `clear`。
 * @returns 键数组；不合法时给应答。
 */
function validateClear(
  secretKeys: readonly string[],
  clear: unknown,
): { ok: true; value: string[] } | { ok: false; res: RouteResult } {
  if (clear === undefined || clear === null) return { ok: true, value: [] };
  if (!Array.isArray(clear)) return { ok: false, res: failResult('bad-request', 'clear 必须是数组') };
  const value: string[] = [];
  for (const item of clear) {
    if (typeof item !== 'string') return { ok: false, res: failResult('bad-request', 'clear 里只能放字段名') };
    if (!secretKeys.includes(item)) return { ok: false, res: failResult('bad-request', `只能清除密钥字段：${item}`) };
    value.push(item);
  }
  return { ok: true, value };
}

/**
 * 处理 `/voice/provider-config` 的 GET / POST。
 *
 * @param deps - 数据根与可选服务。
 * @param input - 路由输入（方法、URL、请求体）。
 * @returns 应答；方法不对时 405。
 */
export async function handleProviderConfig(deps: ProviderConfigDeps, input: RouteInput): Promise<RouteResult> {
  const { body, method, url } = input;
  if (method !== 'GET' && method !== 'POST') return methodNotAllowed();
  let parsed: ProviderConfigBody = {};
  if (method === 'POST') {
    try {
      parsed = (JSON.parse(body ?? 'null') ?? {}) as ProviderConfigBody;
    } catch {
      return invalidJson();
    }
  }
  const queryId = (url.searchParams.get('provider') ?? '').trim();
  const bodyId = typeof parsed.provider === 'string' ? parsed.provider.trim() : '';
  const providerId = bodyId || queryId;
  const status = providerId ? voiceProviderStatuses().find((item) => item.id === providerId) : undefined;
  if (!status) return failResult('provider-missing', `没有这个语音实现：${providerId || '(空)'}`);
  if (status.builtin) return failResult('bad-request', '内置实现没有接入配置');

  const file = providerConfigPath(deps.userRoot);
  const keys = status.fields.map((field) => field.key);
  const secretKeys = secretFieldsOf(status.fields).map((field) => field.key);
  // 普通键从 JSON 读；密钥键**永远不从 JSON 读**（那份文件里不该有它们，读到也不回传）。
  const plainKeys = keys.filter((key) => !secretKeys.includes(key));
  const seam = providerSecretSeamOf(deps.optionalService('credentials'));

  if (method === 'GET') {
    const secrets = seam ? await readSecretPresence(seam, status.fields) : {};
    return okResult({ ok: true, provider: status.id, values: readProviderValues(file, status.id, plainKeys), secrets });
  }

  const patchRaw = parsed.patch;
  const hasPatch = patchRaw !== undefined && patchRaw !== null;
  const clearRaw = parsed.clear;
  if (!hasPatch && clearRaw === undefined) return failResult('bad-request', 'patch 必填');
  const checkedPatch = hasPatch ? validatePatch(keys, patchRaw) : { ok: true as const, value: {} };
  if (!checkedPatch.ok) return checkedPatch.res;
  const checkedClear = validateClear(secretKeys, clearRaw);
  if (!checkedClear.ok) return checkedClear.res;

  const plainPatch: Record<string, string> = {};
  const secretPatch: Record<string, string> = {};
  for (const [key, value] of Object.entries(checkedPatch.value)) {
    if (secretKeys.includes(key)) secretPatch[key] = value;
    else plainPatch[key] = value;
  }
  const wantsSecretWrite = Object.values(secretPatch).some((value) => value !== '') || checkedClear.value.length > 0;
  if (wantsSecretWrite && !seam) {
    return failResult('unsupported', '宿主的凭据库不支持写入，密钥字段只能读');
  }
  if (Object.keys(plainPatch).length === 0 && !wantsSecretWrite) {
    return failResult('bad-request', 'patch 是空的');
  }

  try {
    if (Object.keys(plainPatch).length > 0) await writeProviderFields(file, status.id, plainPatch);
    if (wantsSecretWrite && seam)
      await writeSecretFields(seam, status.fields as readonly VoiceField[], secretPatch, checkedClear.value);
  } catch (error) {
    return failResult('generate-error', error instanceof Error ? error.message : String(error));
  }
  // 配置变了要立刻重扫：设置页拿这份新状态刷新音色下拉，不用等 provider 的软过期。
  const secrets = seam ? await readSecretPresence(seam, status.fields) : {};
  return okResult({
    ok: true,
    provider: status.id,
    values: readProviderValues(file, status.id, plainKeys),
    secrets,
    providers: voiceProviderStatuses(),
  });
}
