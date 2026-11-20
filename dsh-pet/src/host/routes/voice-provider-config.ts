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
import { voiceProviderOf, voiceProviderStatuses } from '../voice/registry.ts';
import type { VoiceField } from '../voice/registry.ts';
import { providerConfigPath, readProviderValues, writeProviderFields } from '../voice/gsv/store.ts';
import {
  providerSecretSeamOf,
  readSecretPresence,
  secretFieldsOf,
  secretRefsOf,
  writeSecretFields,
} from '../voice/provider-secrets.ts';
import type { ProviderSecretSeam } from '../voice/provider-secrets.ts';

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
 * @param fields - 该实现声明的全部配置项（含密钥项：多写的键一律拒，而不是静默丢弃）。
 * @param patch - 请求体里的 `patch`。
 * @returns 归一化后的键值；不合法时返回一句可直接回给前端的应答。
 */
function validatePatch(
  fields: readonly VoiceField[],
  patch: unknown,
): { ok: true; value: Record<string, string> } | { ok: false; res: RouteResult } {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, res: failResult('bad-request', 'patch 必须是对象') };
  }
  const keys = fields.map((field) => field.key);
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
    // 声明了候选值的字段（下拉）：写进一个不在列表里的值，界面上会显示成空，用户以为没保存
    const options = fields.find((field) => field.key === key)?.options;
    if (options !== undefined && options.length > 0 && trimmed !== '' && !options.includes(trimmed)) {
      return { ok: false, res: failResult('bad-request', `${key} 只能是 ${options.join(' / ')}`) };
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
 * 「清空用户那把 key 之后，回退引用里还有没有可用的」。
 *
 * 只认**回退**引用（主引用正是要被清掉的那把，不看它）。实现没给 `refs` 时按字段声明的
 * `credentialFallbacks` 判；一个都没有就返回 false（= 清空会让人无 key 可用）。
 *
 * @param seam - 凭据面（不可用时为 undefined）。
 * @param fields - 该实现的配置项声明。
 * @param refs - 实现按生效配置给出的可读引用（主引用在前）。
 * @returns 仍有一把可用 key 时 true。
 */
async function hasFallbackSecret(
  seam: ProviderSecretSeam | null | undefined,
  fields: readonly VoiceField[],
  refs: readonly string[] | undefined,
): Promise<boolean> {
  if (!seam) return false;
  // 按实现声明的密钥字段遍历，不写死 `apiKey`：第三方实现换字段名时不会被无条件拒。
  for (const field of secretFieldsOf(fields)) {
    const primary = (field.credentialRef ?? '').trim();
    const all = refs ?? secretRefsOf(field);
    for (const ref of all) {
      if (ref === primary || ref === '') continue;
      try {
        if (await seam.configured(ref)) return true;
      } catch {
        // 读失败按「没有」处理：宁可让用户补一次 key，也不要把不可用的配置存下去
      }
    }
  }
  return false;
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
  // 实现本体（`needsKey` / `keyRefs` / `expandPatch` 都在它上面，status 只是给设置页的形状）。
  const provider = voiceProviderOf(status.id);

  if (method === 'GET') {
    const secrets = seam ? await readSecretPresence(seam, status.fields) : {};
    return okResult({ ok: true, provider: status.id, values: readProviderValues(file, status.id, plainKeys), secrets });
  }

  const patchRaw = parsed.patch;
  const hasPatch = patchRaw !== undefined && patchRaw !== null;
  const clearRaw = parsed.clear;
  if (!hasPatch && clearRaw === undefined) return failResult('bad-request', 'patch 必填');
  const checkedPatch = hasPatch ? validatePatch(status.fields, patchRaw) : { ok: true as const, value: {} };
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

  // 预设展开（R2）：`patch` 带 `preset` 时由实现把该预设的四轴默认值展开进要写的值。
  // 时机固定在「鉴权判定之前」——`needsKey` 看的是 expandCloudPresetPatch 不能改的生效值，
  // 顺序反了就会出现「preset=mimo 被判成不需要 key」（D-07 的同一条坑）。
  // 展开结果再按 `plainKeys` 过滤一次：实现多写的键一律不落盘（读侧白名单看不见的键最难排查）。
  // 展开只补「用户没手填过的」项，所以这一步不会覆盖用户在表单里改过的值。
  if (provider?.expandPatch !== undefined && Object.keys(plainPatch).length > 0) {
    try {
      const expanded = provider.expandPatch(plainPatch, readProviderValues(file, status.id, plainKeys));
      const allowed = new Set(plainKeys);
      const filtered: Record<string, string> = {};
      for (const [key, value] of Object.entries(expanded)) {
        if (allowed.has(key)) filtered[key] = value;
      }
      // 展开出来的值要跟用户输入走**同一套**形状校验：否则第三方实现能借展开写进
      // `baseURL: "ftp://…"`、超长值或下拉候选之外的值，绕过上面 validatePatch 的所有闸门。
      const rechecked = validatePatch(status.fields, filtered);
      if (!rechecked.ok) return rechecked.res;
      for (const key of Object.keys(plainPatch)) delete plainPatch[key];
      Object.assign(plainPatch, rechecked.value);
    } catch (error) {
      return failResult('generate-error', error instanceof Error ? error.message : String(error));
    }
  }

  // 需要鉴权的协议必须有 key：否则会「保存成功但用不了」——界面说有 key、实际一次都发不出去。
  // 判定用**写入后**的生效值，但结论向实现索取：云端四轴的 `authStyle`/`protocol` 存空串表示
  // 「跟随预设」，路由解析裸值会把「预设要求鉴权」误判成「不需要 key」（D-07 的假修根因）。
  // 实现没声明 `needsKey` 时才退回裸值兜底（老实现与测试桩不声明也不会被拦）。
  {
    const effective = { ...readProviderValues(file, status.id, plainKeys), ...plainPatch };
    // 钩子在**实现**上（`VoiceProvider`），不在 status 快照里：status 只是给设置页的形状。
    const needsKey =
      provider?.needsKey !== undefined
        ? provider.needsKey(effective)
        : (effective.authStyle ?? '') !== ''
          ? (effective.authStyle ?? '') !== 'none'
          : (effective.protocol ?? '') === 'custom';
    const cleared = checkedClear.value.includes('apiKey');
    if (needsKey) {
      const incoming = (secretPatch.apiKey ?? '').trim();
      // 允许的引用同样由实现给：云端只有 deepseek 预设才允许回退宿主 key。
      const refs = provider?.keyRefs === undefined ? undefined : provider.keyRefs(effective);
      // `clear` 的语义是「用户主动删掉这把密钥」，**不是**「这份配置不需要密钥」。
      // 需要鉴权时清空必须被拒——否则会落盘一份永远不可用的配置（D-07 的第四个通道）。
      // 唯一的例外是「实现允许的回退引用里仍有 key」（deepseek + 宿主 key）：那时清掉用户那把仍能用。
      if (cleared) {
        const fallbackOk = await hasFallbackSecret(seam, status.fields, refs);
        if (!fallbackOk) {
          return failResult('bad-request', 'API Key 必填：这一协议需要鉴权，不能清空');
        }
      } else if (incoming === '') {
        const presence = seam
          ? refs === undefined
            ? await readSecretPresence(seam, status.fields)
            : await readSecretPresence(seam, status.fields, refs)
          : {};
        if (presence.apiKey !== true) return failResult('bad-request', 'API Key 未填：这一协议需要鉴权');
      }
    }
  }

  try {
    if (Object.keys(plainPatch).length > 0) await writeProviderFields(file, status.id, plainPatch);
    if (wantsSecretWrite && seam)
      await writeSecretFields(seam, status.fields as readonly VoiceField[], secretPatch, checkedClear.value);
  } catch (error) {
    return failResult('generate-error', error instanceof Error ? error.message : String(error));
  }
  // 配置或密钥刚变：让实现的探活结论立刻翻牌（付费开关打开后要马上能用，不必等它的软过期）。
  // refresh 是可选能力，实现没声明就跳过；它自己失败也不能把「已经写成功」变成失败。
  try {
    await voiceProviderOf(status.id)?.refresh?.();
  } catch {
    // 探活失败只是暂时不可用，写盘本身已经成功
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
