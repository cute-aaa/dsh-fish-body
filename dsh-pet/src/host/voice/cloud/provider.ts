/**
 * 云端 TTS：按量计费、**不进自动回退链**，按「四轴 + 预设」接任意接口形状。
 *
 * 为什么不进链：链的语义是「自动挑一个能出声的实现」。云端按服务商规则收钱，混进链里等于在本地
 * 服务没起时静默花用户的钱。所以它标 `billable: true`，只有用户打开「使用云端语音」时才由
 * `speak.ts` 通过 `voiceChainWithPreferred` 排到链首；失败后回落免费链（失败请求不计费）。
 *
 * 为什么是四轴而不是「一家一个协议」：TTS 的请求形状只有四个正交维度——
 *   endpoint（`baseURL` + 可含 `{voice}` / `{key}` 的 `path` 模板）、
 *   auth（`authStyle`：bearer / api-key-header / x-api-key / query / none）、
 *   body（`bodyKind`：json / form / ssml）、
 *   response（`responseKind`：audio / json-base64 / json-hex / json-url + `responsePath`）。
 * 预设只是把这四轴**预填**好的一组默认值，用户仍可逐项覆盖；代码里不再出现「按服务名分支」。
 *
 * `protocol` 只剩两个：`openai`（OpenAI 家族的 `/v1/audio/speech` 与 MiMo 的 chat-completions 形态）
 * 与 `custom`（其余一律四轴声明）。历史配置里的 `protocol: 'deepseek'` 仍然可用——它被归一成
 * `preset: 'deepseek'` + `protocol: 'custom'`，请求逐字节与改造前一致（见 {@link cloudPresetOf}）。
 *
 * `availability()` 必须同步（链每次合成都现查），密钥在凭据库要异步读，所以结论缓存在 `verdict` 里、
 * 由 `refresh()` 更新；探活**不发网络请求**——TTS 没有廉价 ping，拿一句话去试就等于花钱。
 * 契约见 API.md「语音」一节；本模块不做重试、不计时（超时由 transport 之外的信号与链共同兜）。
 * @module dsh-fish-body/src/host/voice/cloud/provider
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import type { ProviderVoiceInfo, VoiceField, VoiceProvider, VoiceProviderAvailability } from '../registry.ts';
import type { AudioClip } from '../audio.ts';

/** 实现 id；参与缓存键。 */
export const CLOUD_PROVIDER_ID = 'cloud';

/**
 * 密钥在 DSH 凭据库里的引用名。
 *
 * 用固定的环境变量式标识而不是「配置里存引用名」：这一项是本插件自己的密钥，不是用户从别处
 * 抄来的引用；固定下来，`credentials set` 与设置页填的是同一个名字，换机器也只需重填一次。
 */
export const CLOUD_API_KEY_REF = 'DSH_FISH_BODY_CLOUD_TTS_KEY';

/**
 * 主引用没值时复用的宿主凭据（DSH 自己的 DeepSeek provider 用的就是它）。
 *
 * 只读：保存与清除永远只动 {@link CLOUD_API_KEY_REF}，否则用户在设置页点一次「清除」
 * 就会顺手删掉整个 DSH 的模型凭据。回退**只对最终生效预设为 `deepseek` 生效**（见 {@link cloudKeyRefs}）。
 */
export const CLOUD_API_KEY_FALLBACK = 'DEEPSEEK_API_KEY';

/** 收敛后的两个协议；数组顺序即下拉候选的缺省顺序（当前生效的那个会被排到最前）。 */
export const CLOUD_PROTOCOLS = ['openai', 'custom'] as const;

/** 一个协议名。 */
export type CloudProtocol = (typeof CLOUD_PROTOCOLS)[number];

/** 预设清单；`none` = 不预填，完全按四轴手填。 */
export const CLOUD_PRESETS = ['none', 'openai-speech', 'mimo', 'deepseek', 'azure', 'elevenlabs', 'google'] as const;

/**
 * `preset` 下拉里「不预填」的显示值。
 *
 * 设置页的下拉直接把字符串当显示文本（`voice-provider-card.ts` 不做 label 映射），所以这里用
 * **显示值承载中文**：配置里存的就是这一整串，解析时按 `none` 前缀归一（见 {@link cloudPresetOf}）。
 */
export const CLOUD_PRESET_NONE_LABEL = 'none（手动填四轴）';

/** 一个预设名。 */
export type CloudPreset = (typeof CLOUD_PRESETS)[number];

/** 四轴之鉴权：密钥放在哪里。 */
export const CLOUD_AUTH_STYLES = ['bearer', 'api-key-header', 'x-api-key', 'query', 'none'] as const;

/** 一种鉴权方式。 */
export type CloudAuthStyle = (typeof CLOUD_AUTH_STYLES)[number];

/** 四轴之请求体：怎么编码。 */
export const CLOUD_BODY_KINDS = ['json', 'form', 'ssml'] as const;

/** 一种请求体编码。 */
export type CloudBodyKind = (typeof CLOUD_BODY_KINDS)[number];

/** 四轴之响应：音频字节从哪里取。 */
export const CLOUD_RESPONSE_KINDS = ['audio', 'json-base64', 'json-hex', 'json-url'] as const;

/** 一种响应取值方式。 */
export type CloudResponseKind = (typeof CLOUD_RESPONSE_KINDS)[number];

/** 缺省预设：老配置既没有 `protocol` 又没有可判的地址时按它走（等价于改造前的行为）。 */
export const DEFAULT_CLOUD_PRESET: CloudPreset = 'deepseek';

/** DeepSeek 官方接口根地址；`deepseek` 预设下 `baseURL` 留空时用它。 */
export const DEFAULT_CLOUD_BASE_URL = 'https://api.deepseek.com';

/** OpenAI 官方接口根地址；`openai` 协议下 `baseURL` 留空时的兜底（该协议仍判「必填」）。 */
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';

/** DeepSeek TTS 的默认音色：它只认 stella / tide，空值服务端会拒。 */
export const DEFAULT_DEEPSEEK_VOICE = 'stella';

/** `openai-speech` 预设的 `response_format` 缺省值。 */
export const DEFAULT_RESPONSE_FORMAT = 'mp3';

/** 单次合成超时（ms）：链外层给 15s，这里留出收尾余量。 */
const REQUEST_TIMEOUT_MS = 12_000;

/** 服务端错误文案的截断长度：只留够定位的一句话，不把整页 HTML 灌进日志。 */
const MAX_ERROR_DETAIL = 512;

/** 认不出音频格式时，错误里回显的字节数。 */
const HEX_PREVIEW_BYTES = 16;

/** 主引用没值、需要密钥时的人话（只有 deepseek 预设能复用宿主凭据）。 */
const MISSING_KEY_REASON = `未配置 API Key（可复用 ${CLOUD_API_KEY_FALLBACK}）`;

/** 其余预设缺密钥时的人话：不允许复用宿主凭据，也就不提它。 */
const GENERIC_MISSING_KEY_REASON = '未配置 API Key';

/** 请求体的 `Content-Type`（用户仍可用 `headers` 覆盖）。 */
const CONTENT_TYPES: Readonly<Record<CloudBodyKind, string>> = {
  json: 'application/json',
  form: 'application/x-www-form-urlencoded',
  ssml: 'application/ssml+xml',
};

/** 一段云端配置（全是字符串/布尔；密钥不在这里，它在 DSH 凭据库）。 */
export interface CloudSettings {
  /** 用户是否显式开启（按量计费的总开关）；关着时它完全不参与合成。 */
  readonly useCloud: boolean;
  /** 预设：选一个自动填四轴；`none` = 不预填。老配置缺这一项时由 {@link cloudPresetOf} 推断。 */
  readonly preset: CloudPreset;
  /** 接口协议（只剩两个）；老配置的 `deepseek` 被归一成 `custom` + `preset: 'deepseek'`。 */
  readonly protocol: CloudProtocol;
  /** 接口根地址（不含具体路径）；`deepseek` 预设留空用官方默认。 */
  readonly baseURL: string;
  /** 合成路径模板（相对根地址），可含 `{voice}` 与 `{key}`；填完整 URL 时直接用它。 */
  readonly path: string;
  /** 鉴权方式；空串 = 用预设的默认值。 */
  readonly authStyle: string;
  /** 自定义鉴权头名（如 `Ocp-Apim-Subscription-Key`）；空串 = 用 `api-key`。 */
  readonly authHeader: string;
  /** 模型名（`openai` 家族必填；`deepseek` 忽略）。 */
  readonly model: string;
  /** 音色 id，**自由文本**（各服务商自己的一套名字）；空串 = 用预设的默认值。 */
  readonly voice: string;
  /** 返回格式（`response_format` / `audioEncoding` 等）；空串 = 用预设的默认值。 */
  readonly format: string;
  /** 请求体编码；空串 = 用预设的默认值。 */
  readonly bodyKind: string;
  /** 请求体模板，可用 `{text}`（必填）/ `{model}` / `{voice}` / `{key}`。 */
  readonly bodyTemplate: string;
  /** 响应取值方式；空串 = 用预设的默认值。 */
  readonly responseKind: string;
  /** 响应取值路径（点号 + 数组下标，如 `choices.0.message.audio.data`）。 */
  readonly responsePath: string;
  /** 额外请求头（JSON 串）；空串 = 用预设的默认值。 */
  readonly headers: string;
}

/** 一个预设预填的四轴默认值 + 动态必填项。 */
export interface CloudPresetSpec {
  /** 路径模板（可含 `{voice}` / `{key}`）。 */
  readonly path: string;
  /** 鉴权方式。 */
  readonly authStyle: CloudAuthStyle;
  /** 自定义鉴权头名（仅 `api-key-header` 有意义）。 */
  readonly authHeader?: string;
  /** 请求体编码。 */
  readonly bodyKind: CloudBodyKind;
  /** 请求体模板。 */
  readonly bodyTemplate: string;
  /** 响应取值方式。 */
  readonly responseKind: CloudResponseKind;
  /** 响应取值路径（`audio` 用不到）。 */
  readonly responsePath?: string;
  /** 缺省返回格式。 */
  readonly format: string;
  /** 缺省音色。 */
  readonly voice: string;
  /** 缺省额外请求头（JSON 串）。 */
  readonly headers?: string;
  /** 缺省根地址。 */
  readonly baseURL?: string;
  /** 这个预设下必填的普通项（`apiKey` 由鉴权方式决定，不写在这里）。 */
  readonly required: readonly string[];
}

/**
 * 六个预设的四轴参数。
 *
 * MiMo 的响应路径来自官方「语音合成（MiMo-TTS 系列）- OpenAI API 兼容」文档
 * （https://mimo.mi.com/docs/zh-CN/api/audio/tts-post）：它沿用 OpenAI 多模态 chat completions
 * 的返回形状，音频 base64 在 `choices[0].message.audio.data`。文档若改字段，改这一处即可，
 * 用户也可以在自己的配置里用 `responsePath` 覆盖。
 *
 * 待实测：若真机返回路径不是 `choices.0.message.audio.data`，改预设这一处即可（取值取不到时错误会
 * 直接列出响应 JSON 的实际顶层键，见 {@link digPath} 的调用处）。
 */
export const CLOUD_PRESET_SPECS: Readonly<Record<Exclude<CloudPreset, 'none'>, CloudPresetSpec>> = {
  'openai-speech': {
    path: '/v1/audio/speech',
    authStyle: 'bearer',
    bodyKind: 'json',
    bodyTemplate: '{"model":"{model}","input":"{text}","voice":"{voice}","response_format":"{format}"}',
    responseKind: 'audio',
    format: DEFAULT_RESPONSE_FORMAT,
    voice: '',
    required: ['baseURL', 'model', 'voice'],
  },
  mimo: {
    path: '/v1/chat/completions',
    authStyle: 'api-key-header',
    authHeader: 'api-key',
    bodyKind: 'json',
    bodyTemplate:
      '{"model":"{model}","messages":[{"role":"assistant","content":"{text}"}],' +
      '"audio":{"format":"{format}","voice":"{voice}"}}',
    responseKind: 'json-base64',
    responsePath: 'choices.0.message.audio.data',
    // 官方示例默认 wav；mp3 在部分兼容实现上还要额外协商，先用容器最稳的那个
    format: 'wav',
    voice: '',
    required: ['baseURL', 'model', 'voice'],
  },
  deepseek: {
    path: '/v1/tools/tts',
    authStyle: 'bearer',
    bodyKind: 'json',
    bodyTemplate: '{"text":"{text}","voice_id":"{voice}","format":"wav","filter_markdown":true}',
    responseKind: 'audio',
    // 只收 wav / pcm；pcm 是裸流（无容器），缓存与播放链路都认不了，所以只要 wav
    format: 'wav',
    voice: DEFAULT_DEEPSEEK_VOICE,
    baseURL: DEFAULT_CLOUD_BASE_URL,
    required: [],
  },
  azure: {
    path: '/cognitiveservices/v1',
    authStyle: 'api-key-header',
    authHeader: 'Ocp-Apim-Subscription-Key',
    bodyKind: 'ssml',
    // SSML 整段就是请求体：`{text}` 会被 `<speak>…</speak>` 替换
    bodyTemplate: '{text}',
    responseKind: 'audio',
    format: '',
    voice: '',
    // Azure 的输出格式走固定头而不是 body；换码率就改这一项（用户 headers 非空时整体覆盖）
    headers: '{"X-Microsoft-OutputFormat":"audio-24khz-48kbitrate-mono-mp3"}',
    required: ['baseURL', 'voice'],
  },
  elevenlabs: {
    path: '/v1/text-to-speech/{voice}',
    authStyle: 'x-api-key',
    bodyKind: 'json',
    bodyTemplate: '{"text":"{text}","model_id":"{model}"}',
    responseKind: 'audio',
    format: '',
    voice: '',
    required: ['baseURL', 'model', 'voice'],
  },
  google: {
    // key 直接进查询串；`{key}` 与 authStyle=query 二选一，模板里写了就不再追加第二个
    path: '/v1/text:synthesize?key={key}',
    authStyle: 'query',
    bodyKind: 'json',
    bodyTemplate:
      '{"input":{"text":"{text}"},"voice":{"languageCode":"{model}"},' + '"audioConfig":{"audioEncoding":"{format}"}}',
    responseKind: 'json-base64',
    responsePath: 'audioContent',
    format: 'MP3',
    voice: '',
    required: ['baseURL', 'model'],
  },
};

/** `preset: 'none'` 且 `protocol: 'custom'` 时的空默认值（四轴全靠用户填）。 */
const EMPTY_PRESET_SPEC: CloudPresetSpec = {
  path: '',
  authStyle: 'bearer',
  bodyKind: 'json',
  bodyTemplate: '',
  responseKind: 'audio',
  format: '',
  voice: '',
  required: ['baseURL'],
};

/** 四轴解析后的最终值（预设默认值 + 用户覆盖）。 */
export interface CloudAxes {
  /** 生效预设。 */
  readonly preset: CloudPreset;
  /** 生效协议。 */
  readonly protocol: CloudProtocol;
  /** 生效根地址（已去末尾斜杠）。 */
  readonly baseURL: string;
  /** 生效路径模板（`{voice}` / `{key}` 尚未替换）。 */
  readonly path: string;
  /** 生效鉴权方式。 */
  readonly authStyle: CloudAuthStyle;
  /** 生效鉴权头名（`api-key-header` 用）。 */
  readonly authHeader: string;
  /** 生效请求体编码。 */
  readonly bodyKind: CloudBodyKind;
  /** 生效请求体模板。 */
  readonly bodyTemplate: string;
  /** 生效响应取值方式。 */
  readonly responseKind: CloudResponseKind;
  /** 生效响应取值路径。 */
  readonly responsePath: string;
  /** 生效额外请求头（JSON 串）。 */
  readonly headers: string;
  /** 生效返回格式。 */
  readonly format: string;
  /** 生效模型名。 */
  readonly model: string;
  /** 生效音色（预设默认值只在用户留空时补）。 */
  readonly voice: string;
}

/** 造这个实现的依赖（测试注入假 fetch，单测不打真网）。 */
export interface CloudProviderDeps {
  /** 现读配置（改完不必重启插件）。 */
  settings(): CloudSettings;
  /**
   * 按**最终生效预设**取密钥：只有 `deepseek` 允许回退到宿主凭据，其余只认主引用
   * （见 {@link cloudKeyRefs}）。每次合成现读，不缓存值。
   */
  readKey(settings: CloudSettings): Promise<string | undefined>;
  /** 传输层替身；缺省用全局 fetch。 */
  fetch?: typeof fetch;
  /** 留痕；不传则静默。 */
  log?: { info?(message: string): void; warn?(message: string): void };
}

/** 一次合成要发的请求（拆出来是为了让测试只看形状、不打网络）。 */
export interface CloudRequest {
  readonly url: string;
  readonly init: RequestInit;
}

/** 请求体模板里可用的占位符取值。 */
export interface CloudTemplateValues {
  readonly text: string;
  readonly model: string;
  readonly voice: string;
  readonly format: string;
  readonly key: string;
}

/** 把一个 unknown 当对象看；不是对象就当空对象（配置被写坏时不炸）。 */
function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 取字符串字段并 trim；非字符串一律当空串。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 取错误消息；非 Error 一律 String()。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 是不是一个认识的预设名。 */
function isPreset(value: string): value is CloudPreset {
  return (CLOUD_PRESETS as readonly string[]).includes(value);
}

/** 预设在下拉里的显示值：`none` 用带中文说明的那一串，其余就是预设名。 */
function presetOptionOf(preset: CloudPreset): string {
  return preset === 'none' ? CLOUD_PRESET_NONE_LABEL : preset;
}

/** 是不是一种认识的鉴权方式。 */
function authStyleOf(raw: string): CloudAuthStyle | undefined {
  const value = raw.trim().toLowerCase();
  return (CLOUD_AUTH_STYLES as readonly string[]).includes(value) ? (value as CloudAuthStyle) : undefined;
}

/** 是不是一种认识的请求体编码。 */
function bodyKindOf(raw: string): CloudBodyKind | undefined {
  const value = raw.trim().toLowerCase();
  return (CLOUD_BODY_KINDS as readonly string[]).includes(value) ? (value as CloudBodyKind) : undefined;
}

/** 是不是一种认识的响应取值方式。 */
function responseKindOf(raw: string): CloudResponseKind | undefined {
  const value = raw.trim().toLowerCase();
  return (CLOUD_RESPONSE_KINDS as readonly string[]).includes(value) ? (value as CloudResponseKind) : undefined;
}

/** 第一个非空值（都空就用 fallback）。 */
function firstNonEmpty(primary: string, fallback: string): string {
  const value = primary.trim();
  return value !== '' ? value : fallback;
}

/**
 * 显式协议归一：只有认识的值算显式，`deepseek` 是历史名、归一到 `custom`。
 *
 * @param raw - 配置里的 `protocol`（可能是任意值或缺席）。
 * @returns 两个协议之一；不认识时 undefined（交给调用方按预设/地址推断）。
 */
function explicitProtocolOf(raw: unknown): CloudProtocol | undefined {
  const value = str(raw).toLowerCase();
  if (value === 'openai') return 'openai';
  if (value === 'custom' || value === 'deepseek') return 'custom';
  return undefined;
}

/** 预设所属的协议族：OpenAI 家族两形态归 `openai`，其余全走四轴 `custom`。 */
function protocolOfPreset(preset: CloudPreset): CloudProtocol {
  return preset === 'openai-speech' || preset === 'mimo' ? 'openai' : 'custom';
}

/**
 * 协议归一：显式值优先，缺省或写坏时按地址推断（**向后兼容的唯一入口**）。
 *
 * 老配置只有 `useCloud` / `baseURL` / `voice`：空地址或地址里含 `deepseek` 的按 DeepSeek 处理
 * （`custom` + `deepseek` 预设），其余按 OpenAI 兼容。判不出来就按 `openai`，因为「别的 TTS 服务」
 * 远比「自建 DeepSeek 代理」常见。
 *
 * @param raw - 配置里的 `protocol`（可能是任意值或缺席）。
 * @param baseURL - 已 trim 的 `baseURL`，用于推断。
 * @returns 两个协议之一；永远不会因为缺项而不可用。
 */
export function cloudProtocolOf(raw: unknown, baseURL: string): CloudProtocol {
  return explicitProtocolOf(raw) ?? (baseURL === '' || /deepseek/i.test(baseURL) ? 'custom' : 'openai');
}

/**
 * 预设归一：显式预设优先；否则按历史 `protocol` 与地址推断。
 *
 * 历史映射（老配置不改一个字节也必须照旧跑）：
 * - `protocol: 'deepseek'` → `deepseek` 预设（请求逐字节与改造前一致）；
 * - `protocol: 'openai'` → `openai-speech` 预设；
 * - `protocol: 'custom'` → `none`（四轴全靠配置）；
 * - 没有 `protocol`：空地址或含 `deepseek` → `deepseek`，否则 → `openai-speech`。
 *
 * `preset` 值按 `none` 前缀容忍：下拉把显示值 `none（手动填四轴）` 原样存盘，历史值 `none` 也照收。
 *
 * @param rawPreset - 配置里的 `preset`（可能是任意值或缺席）。
 * @param rawProtocol - 配置里的 `protocol`（历史值也认）。
 * @param baseURL - 已 trim 的 `baseURL`，用于推断。
 * @returns 七个预设名之一。
 */
export function cloudPresetOf(rawPreset: unknown, rawProtocol: unknown, baseURL: string): CloudPreset {
  const preset = str(rawPreset).toLowerCase();
  // 下拉把显示值原样存进配置：`none（手动填四轴）` 与历史值 `none` 都按「不预填」处理
  if (preset.startsWith('none')) return 'none';
  if (isPreset(preset)) return preset;
  const protocol = str(rawProtocol).toLowerCase();
  if (protocol === 'deepseek') return 'deepseek';
  if (protocol === 'openai') return 'openai-speech';
  if (protocol === 'custom') return 'none';
  return baseURL === '' || /deepseek/i.test(baseURL) ? DEFAULT_CLOUD_PRESET : 'openai-speech';
}

/**
 * 从 `voice-providers.json` 的解析结果里取云端设置。
 *
 * @param source - 整个 provider 配置对象（`{ cloud: {...} }`），可以是 undefined。
 * @returns 全部字段；缺项给空串 / 推断出的预设（由 {@link cloudConfigProblems} 变成人话）。
 */
export function cloudSettingsOf(source: unknown): CloudSettings {
  const conf = recordOf(recordOf(source).cloud);
  const baseURL = str(conf.baseURL);
  const preset = cloudPresetOf(conf.preset, conf.protocol, baseURL);
  return {
    useCloud: str(conf.useCloud) === 'on',
    preset,
    protocol: explicitProtocolOf(conf.protocol) ?? protocolOfPreset(preset),
    baseURL,
    path: str(conf.path),
    authStyle: str(conf.authStyle).toLowerCase(),
    authHeader: str(conf.authHeader),
    model: str(conf.model),
    voice: str(conf.voice),
    format: str(conf.format),
    bodyKind: str(conf.bodyKind).toLowerCase(),
    bodyTemplate: str(conf.bodyTemplate),
    responseKind: str(conf.responseKind).toLowerCase(),
    responsePath: str(conf.responsePath),
    headers: str(conf.headers),
  };
}

/** 全空配置：未配置时的初值（预设按缺省 deepseek，四轴留空交给预设）。 */
export const EMPTY_CLOUD_SETTINGS: CloudSettings = {
  useCloud: false,
  preset: DEFAULT_CLOUD_PRESET,
  protocol: protocolOfPreset(DEFAULT_CLOUD_PRESET),
  baseURL: '',
  path: '',
  authStyle: '',
  authHeader: '',
  model: '',
  voice: '',
  format: '',
  bodyKind: '',
  bodyTemplate: '',
  responseKind: '',
  responsePath: '',
  headers: '',
};

/** 取一个预设（`none` + `openai` 时按 `openai-speech` 预填，让老 `openai` 配置形状不变）。 */
function specOf(settings: CloudSettings): CloudPresetSpec {
  if (settings.preset === 'none') {
    return settings.protocol === 'openai' ? CLOUD_PRESET_SPECS['openai-speech'] : EMPTY_PRESET_SPEC;
  }
  return CLOUD_PRESET_SPECS[settings.preset];
}

/**
 * 解析四轴：预设默认值 + 用户非空覆盖。
 *
 * 「空字符串 = 没设」是这套配置的全部约定：清空某一项就回到预设默认值，而不是变成一个
 * 字面意义上的空值（否则清掉 `format` 会拼出 `"response_format":""`）。
 *
 * @param settings - 当前配置。
 * @returns 四轴 + 模型/音色/格式的最终值。
 */
export function cloudAxesOf(settings: CloudSettings): CloudAxes {
  const spec = specOf(settings);
  return {
    preset: settings.preset,
    protocol: settings.protocol,
    baseURL: cloudBaseURL(settings),
    path: firstNonEmpty(settings.path, spec.path),
    authStyle: authStyleOf(settings.authStyle) ?? spec.authStyle,
    authHeader: firstNonEmpty(settings.authHeader, spec.authHeader ?? ''),
    bodyKind: bodyKindOf(settings.bodyKind) ?? spec.bodyKind,
    bodyTemplate: firstNonEmpty(settings.bodyTemplate, spec.bodyTemplate),
    responseKind: responseKindOf(settings.responseKind) ?? spec.responseKind,
    responsePath: firstNonEmpty(settings.responsePath, spec.responsePath ?? ''),
    headers: firstNonEmpty(settings.headers, spec.headers ?? ''),
    format: firstNonEmpty(settings.format, spec.format),
    model: settings.model.trim(),
    voice: firstNonEmpty(settings.voice, spec.voice),
  };
}

/** 生效的接口根地址：留空按预设/协议取默认（custom 没有默认，回空串）；末尾斜杠去掉。 */
export function cloudBaseURL(settings: CloudSettings): string {
  const raw = settings.baseURL.trim().replace(/\/+$/, '');
  if (raw !== '') return raw;
  const presetBase = specOf(settings).baseURL ?? '';
  if (presetBase !== '') return presetBase;
  if (settings.protocol === 'openai') return DEFAULT_OPENAI_BASE_URL;
  return '';
}

/** 生效的音色 id：deepseek 的空值按 stella（服务端不认空值），其余预设按各自的默认值。 */
export function cloudVoiceId(settings: CloudSettings): string {
  return cloudAxesOf(settings).voice;
}

/** 拼根地址与路径；`path` 写成绝对 URL 时直接用它，根地址已带 `/v1` 时不重复拼。 */
function joinURL(base: string, path: string): string {
  const raw = path.trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (base === '') return raw;
  const tail = raw.startsWith('/') ? raw : `/${raw}`;
  if (/\/v1$/i.test(base) && /^\/v1\//.test(tail)) return base.slice(0, -3) + tail;
  return base + tail;
}

/** 把 `{voice}` / `{key}` 填进路径模板（两者都做 URL 编码）。 */
function pathOf(axes: CloudAxes, key: string): string {
  return axes.path.split('{voice}').join(encodeURIComponent(axes.voice)).split('{key}').join(encodeURIComponent(key));
}

/**
 * 生效的合成地址。
 *
 * `{voice}` 与 `{key}` 在这里替换；`authStyle: 'query'` 且模板里没写 `{key}` 时把 key 追加成
 * `?key=…`。错误文案不会打印它——{@link redactURL} 会去掉查询串。
 *
 * @param settings - 当前配置。
 * @param key - API Key；只用于路径/查询串占位（缺省空串，便于只断言形状）。
 * @returns 完整 URL；`path` 写成绝对 URL 时直接用它。
 */
export function cloudSpeechURL(settings: CloudSettings, key = ''): string {
  const axes = cloudAxesOf(settings);
  let url = joinURL(axes.baseURL, pathOf(axes, key));
  if (axes.authStyle === 'query' && !axes.path.includes('{key}') && key !== '') {
    url += `${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`;
  }
  return url;
}

/**
 * 这个配置是否允许复用宿主的 `DEEPSEEK_API_KEY`。
 *
 * 按**最终生效预设**判：只有 `deepseek`（预设或老配置映射来的）可以。`baseURL` 指到第三方却仍然
 * 读宿主凭据，等于把宿主的模型凭据发给陌生服务；`custom` / 其它预设一律只认用户自己填的那把。
 *
 * @param settings - 当前配置。
 * @returns 允许回退为 true。
 */
export function cloudAllowsHostKey(settings: CloudSettings): boolean {
  return settings.preset === 'deepseek';
}

/**
 * 一个配置允许读的凭据引用（主引用在前，其后是只读回退引用）。
 *
 * @param settings - 当前配置（按最终生效预设判，见 {@link cloudAllowsHostKey}）。
 * @returns 可读的引用名；第一个是用户显式填写的那一项。
 */
export function cloudKeyRefs(settings: CloudSettings): readonly string[] {
  return cloudAllowsHostKey(settings) ? [CLOUD_API_KEY_REF, CLOUD_API_KEY_FALLBACK] : [CLOUD_API_KEY_REF];
}

/**
 * 造「按生效预设取密钥」的读取器：装配侧只需把宿主凭据服务递给它。
 *
 * 放在这里而不是 `index.ts` 内联，是为了让引用选择这条安全边界可以被测试钉住——回退引用只对
 * `deepseek` 生效（见 {@link cloudKeyRefs}），选错引用就是把宿主的 DeepSeek key 发出去。
 *
 * @param raw - `optionalService('credentials')` 的结果（独立模式的替身也能用，只要它有 `resolve`）。
 * @returns 读函数：拿到可用密钥就返回，没有或凭据库不可用则返回 undefined。
 */
export function createCloudKeyReader(raw: unknown): (settings: CloudSettings) => Promise<string | undefined> {
  const service =
    raw !== null && typeof raw === 'object' && typeof (raw as { resolve?: unknown }).resolve === 'function'
      ? (raw as { resolve(ref: ReturnType<typeof credentialRef>): Promise<{ value?: string } | undefined> })
      : undefined;
  return async (settings) => {
    if (service === undefined) return undefined;
    for (const ref of cloudKeyRefs(settings)) {
      try {
        const resolved = await service.resolve(credentialRef(ref));
        if (resolved?.value) return resolved.value;
      } catch {
        // 凭据库偶发读失败不该让合成抛：换下一个引用试，最后仍算「没配」
      }
    }
    return undefined;
  };
}

/**
 * 一个配置下必填的配置键。
 *
 * 预设把 path / bodyTemplate / responsePath 都预填了，所以只有 `custom`（`preset: 'none'`）才会
 * 要求 path 与模板；`apiKey` 由鉴权方式决定（`authStyle: 'none'` 不要密钥）。
 *
 * @param settings - 当前配置。
 * @returns 必填键（顺序不影响设置页，只画星号）。
 */
export function cloudRequiredKeys(settings: CloudSettings): readonly string[] {
  const axes = cloudAxesOf(settings);
  const keys = new Set<string>(specOf(settings).required);
  if (axes.authStyle !== 'none') keys.add('apiKey');
  if (axes.baseURL === '') keys.add('baseURL');
  if (axes.path === '') keys.add('path');
  if (axes.bodyTemplate === '') keys.add('bodyTemplate');
  if (axes.responseKind !== 'audio' && axes.responsePath === '') keys.add('responsePath');
  return [...keys];
}

/** 下拉候选：当前生效值排最前（老配置没写这一项时，界面显示的必须是真的在用的那个）。 */
function rotate(options: readonly string[], current: string): readonly string[] {
  if (!options.includes(current)) return options;
  return [current, ...options.filter((item) => item !== current)];
}

/** 设置页上一共有哪些控件（顺序固定；`required`/候选顺序由 {@link cloudFieldsFor} 动态补）。 */
const BASE_FIELDS: readonly VoiceField[] = [
  {
    key: 'useCloud',
    label: '使用云端语音',
    kind: 'select',
    options: ['off', 'on'],
    description:
      '开启后每句话都会请求这里配置的 TTS 服务，并按该服务商的规则计费；它不参与自动回退，但自己失败时会回落本地免费语音',
  },
  {
    key: 'preset',
    label: '服务预设',
    kind: 'select',
    options: [CLOUD_PRESET_NONE_LABEL, ...CLOUD_PRESETS.filter((preset) => preset !== 'none')],
    description:
      '选一个预填四轴（路径、鉴权、请求体、响应取值）；预设只是默认值，下面的字段可以逐项覆盖，' +
      'none（手动填四轴）= 完全手填',
  },
  {
    key: 'protocol',
    label: '接口协议',
    kind: 'select',
    options: [...CLOUD_PROTOCOLS],
    description:
      'openai = OpenAI 家族（/v1/audio/speech 与 chat-completions 形态）；custom = 其余全部按四轴声明。' +
      '历史配置里的 deepseek 会自动映射到同名预设',
  },
  {
    key: 'baseURL',
    label: '服务地址',
    kind: 'text',
    placeholder: DEFAULT_CLOUD_BASE_URL,
    description: '接口根地址（不带具体路径）；deepseek 预设留空用官方地址，其余预设必填',
  },
  {
    key: 'path',
    label: '合成路径',
    kind: 'text',
    placeholder: '/v1/audio/speech',
    description:
      '相对服务地址的路径模板，可用 {voice}（部分服务把音色放在路径里）与 {key}（查询串鉴权）；' +
      '也可以直接填完整 URL。留空用预设的默认值',
  },
  {
    key: 'authStyle',
    label: '鉴权方式',
    kind: 'select',
    options: [...CLOUD_AUTH_STYLES],
    description:
      'bearer = Authorization: Bearer <key>；api-key-header = api-key: <key>（MiMo 用这个）；' +
      'x-api-key = xi-api-key: <key>；query = ?key=<key>；none = 本机服务无需鉴权。留空用预设默认',
  },
  {
    key: 'authHeader',
    label: '鉴权头名',
    kind: 'text',
    placeholder: 'Ocp-Apim-Subscription-Key',
    description: '仅 authStyle = api-key-header 时有效：填自定义头名（Azure 用它）；留空 = api-key',
  },
  {
    key: 'model',
    label: '模型',
    kind: 'text',
    placeholder: 'gpt-4o-mini',
    description: 'openai 家族必填（如 tts-1 / gpt-4o-mini-tts）；Google 预设把它当 languageCode；deepseek 忽略此项',
  },
  {
    key: 'voice',
    label: '音色',
    kind: 'text',
    placeholder: 'alloy',
    description:
      '按服务商填音色名：openai 如 alloy / nova，DeepSeek 如 stella / tide（留空按 stella），' +
      'ElevenLabs 会进路径；其它服务填它自己的音色 id',
  },
  {
    key: 'format',
    label: '返回格式',
    kind: 'text',
    placeholder: DEFAULT_RESPONSE_FORMAT,
    description:
      '请求里的格式参数（response_format / audioEncoding / audio.format）；留空用预设默认' +
      '（openai-speech 是 mp3、mimo 是 wav、google 是 MP3）。' +
      '注意 MiMo 在 stream: true 时会把输出格式强制成 pcm，本实现固定走非流式，所以这里填的格式才是最终格式',
  },
  {
    key: 'bodyKind',
    label: '请求体编码',
    kind: 'select',
    options: [...CLOUD_BODY_KINDS],
    description:
      'json = 按 JSON 模板渲染（替换值做 JSON 转义）；form = application/x-www-form-urlencoded；' +
      'ssml = 把台词包进 <speak> 再放进模板（Azure 那类）。留空用预设默认',
  },
  {
    key: 'bodyTemplate',
    label: '请求体模板',
    kind: 'text',
    placeholder: '{"text":"{text}","voice":"{voice}"}',
    description:
      '占位符 {text}（必填）/ {model} / {voice} / {key} 会被替换成当前值；json 下替换后必须是合法 JSON 对象。' +
      '留空用预设的默认值',
  },
  {
    key: 'responseKind',
    label: '响应取值',
    kind: 'select',
    options: [...CLOUD_RESPONSE_KINDS],
    description:
      'audio = 响应体就是音频字节；json-base64 / json-hex = 从 JSON 取编码字符串再解码；' +
      'json-url = 从 JSON 取地址再 GET 一次。留空用预设默认',
  },
  {
    key: 'responsePath',
    label: '响应取值路径',
    kind: 'text',
    placeholder: 'choices.0.message.audio.data',
    description: '点号路径，支持数组下标（如 choices.0.message.audio.data）；responseKind = audio 时不用填',
  },
  {
    key: 'headers',
    label: '额外请求头',
    kind: 'text',
    placeholder: '{"X-Microsoft-OutputFormat":"audio-24khz-48kbitrate-mono-mp3"}',
    description: 'JSON 串，与默认鉴权头合并（同名覆盖）；Azure 的输出格式这类固定头就写在这。留空用预设的默认值',
  },
  {
    key: 'apiKey',
    label: 'API Key',
    kind: 'password',
    placeholder: 'sk-…',
    credentialRef: CLOUD_API_KEY_REF,
    credentialFallbacks: [CLOUD_API_KEY_FALLBACK],
    description:
      `存进 DSH 凭据库，不写进配置文件；只有 deepseek 预设能复用本机已有的 ${CLOUD_API_KEY_FALLBACK}，` +
      '其它预设只认这里填的值（不会把宿主的 DeepSeek key 发给第三方地址）。' +
      '鉴权方式选 none（本机服务无需密钥）时这一项不必填',
  },
];

/** 下拉字段当前生效值（其余键返回 undefined）。 */
function currentOptionOf(key: string, settings: CloudSettings, axes: CloudAxes): string | undefined {
  switch (key) {
    case 'preset':
      return presetOptionOf(settings.preset);
    case 'protocol':
      return settings.protocol;
    case 'authStyle':
      return axes.authStyle;
    case 'bodyKind':
      return axes.bodyKind;
    case 'responseKind':
      return axes.responseKind;
    default:
      return undefined;
  }
}

/**
 * 云端语音的配置项（`required`、下拉顺序与密钥回退引用随配置变）。
 *
 * `protocol` / `preset` 的当前值排到候选最前：老配置没有这两个字段时，下拉第一项就是实际生效的那个
 * 值——否则界面会显示 openai、实际却在走 deepseek。
 *
 * @param settings - 当前配置。
 * @returns 声明列表；顺序固定，只改 `required`、候选顺序与密钥的回退引用。
 */
export function cloudFieldsFor(settings: CloudSettings): readonly VoiceField[] {
  const axes = cloudAxesOf(settings);
  const required = new Set(cloudRequiredKeys(settings));
  return BASE_FIELDS.map((field) => {
    const current = currentOptionOf(field.key, settings, axes);
    return {
      ...field,
      ...(required.has(field.key) ? { required: true } : {}),
      ...(field.options !== undefined && current !== undefined ? { options: rotate(field.options, current) } : {}),
      // 回退引用也要跟着生效预设收起来：否则设置页会对「只有 DEEPSEEK_API_KEY」的第三方配置显示
      // 「已保存」，而合成时根本读不到 key（或者更糟：真读到了、把宿主的 key 发给第三方）
      ...(field.key === 'apiKey' && !cloudAllowsHostKey(settings)
        ? { credentialFallbacks: [] as readonly string[] }
        : {}),
    };
  });
}

/** 未配置时的声明（= deepseek 预设那一眼）；运行时的权威版本是 {@link cloudFieldsFor}。 */
export const CLOUD_FIELDS: readonly VoiceField[] = cloudFieldsFor(EMPTY_CLOUD_SETTINGS);

/** 把值转成可直接嵌进 JSON 字符串的片段（引号、反斜杠、换行都转义掉）。 */
function jsonFragment(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/** 把值转成可嵌进 XML 文本/属性的片段。 */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 把台词包成 SSML（Azure 这类要 `<speak>` 的服务）。
 *
 * @param text - 原始台词（内部会做 XML 转义）。
 * @param voice - 音色名；空串时只包 `<speak>`，不写 `<voice>`。
 * @returns 一段可整体放进 `{text}` 位置的 SSML。
 */
function ssmlOf(text: string, voice: string): string {
  const inner = xmlEscape(text);
  const wrapped = voice === '' ? inner : `<voice name="${xmlEscape(voice)}">${inner}</voice>`;
  return '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">' + `${wrapped}</speak>`;
}

/**
 * 渲染请求体模板。
 *
 * 占位符的替换值按 `bodyKind` 编码：json 先做 JSON 转义（`{"text":"{text}"}` 里塞进带引号的台词
 * 也不会拼坏 JSON）、form 做 URL 编码、ssml 做 XML 转义。`ssml` 的 `{text}` 会被整段 `<speak>`
 * 替换（台词已在里面转义过）。单次正则替换：台词里恰好写着 `{model}` 也不会被二次替换。
 *
 * @param template - 用户填的模板（或预设的）。
 * @param kind - 请求体编码。
 * @param values - 四个占位符的取值。
 * @returns 替换后的文本（json 下还没解析）。
 * @throws {Error} 模板里没有 `{text}` 时（`{text}` 必填，缺了就是配置错误）。
 */
export function renderTemplate(template: string, kind: CloudBodyKind, values: CloudTemplateValues): string {
  if (!template.includes('{text}')) throw new Error('请求体模板（bodyTemplate）必须包含 {text} 占位符');
  const encode = (value: string): string => {
    if (kind === 'json') return jsonFragment(value);
    if (kind === 'form') return encodeURIComponent(value);
    return xmlEscape(value);
  };
  const replaced: Record<string, string> = {
    text: kind === 'ssml' ? ssmlOf(values.text, values.voice) : encode(values.text),
    model: encode(values.model),
    voice: encode(values.voice),
    format: encode(values.format),
    key: encode(values.key),
  };
  return template.replace(/\{(text|model|voice|format|key)\}/g, (_match, name: string) => replaced[name] ?? '');
}

/** 解析一个 JSON 对象；不是对象时抛出带字段名的人话。 */
function parseJSONObject(raw: string, what: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${what} 不是合法的 JSON 对象`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${what} 不是合法的 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * 解析额外请求头。
 *
 * @param raw - 用户填的 JSON 串（可能是预设默认值）；空串给空对象。
 * @returns 头名 → 头值（数字/布尔按字符串发，对象与数组直接判错）。
 * @throws {Error} 不是 JSON 对象、或某个值不是标量时。
 */
export function cloudHeaderObject(raw: string): Record<string, string> {
  if (raw.trim() === '') return {};
  const parsed = parseJSONObject(raw, 'headers');
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
      continue;
    }
    throw new Error(`headers 的 ${key} 必须是字符串`);
  }
  return out;
}

/** 取四轴里某个键的最终值（只覆盖必填清单里会出现的那几个）。 */
function axisValue(axes: CloudAxes, key: string): string {
  switch (key) {
    case 'model':
      return axes.model;
    case 'voice':
      return axes.voice;
    case 'format':
      return axes.format;
    case 'path':
      return axes.path;
    case 'bodyTemplate':
      return axes.bodyTemplate;
    case 'responsePath':
      return axes.responsePath;
    default:
      return '';
  }
}

/** 缺密钥时的人话：只有 deepseek 预设才提「可复用宿主凭据」。 */
function keyReason(settings: CloudSettings): string {
  return cloudAllowsHostKey(settings) ? MISSING_KEY_REASON : GENERIC_MISSING_KEY_REASON;
}

/**
 * 还缺什么 / 哪里写坏了（探活与合成共用同一份判据）。
 *
 * @param settings - 当前配置。
 * @param hasKey - 凭据库里有没有取到密钥（值本身不参与判断；`authStyle: 'none'` 时传 true）。
 * @returns 人话列表；空数组 = 配置齐全可以发请求。
 */
export function cloudConfigProblems(settings: CloudSettings, hasKey: boolean): string[] {
  const axes = cloudAxesOf(settings);
  const required = cloudRequiredKeys(settings);
  const problems: string[] = [];
  if (axes.baseURL === '') {
    if (required.includes('baseURL')) problems.push('缺少必填项：baseURL');
  } else if (!/^https?:\/\//i.test(axes.baseURL)) {
    problems.push('服务地址（baseURL）必须以 http:// 或 https:// 开头');
  }
  const missing = required
    .filter((key) => key !== 'apiKey' && key !== 'baseURL')
    .filter((key) => axisValue(axes, key) === '');
  if (missing.length > 0) problems.push(`缺少必填项：${missing.join('、')}`);
  if (axes.bodyTemplate !== '') {
    try {
      // 用探针值先跑一遍：模板缺占位符或本身不是 JSON 对象，都该在探活时就报出来，而不是等用户说话
      const rendered = renderTemplate(axes.bodyTemplate, axes.bodyKind, {
        text: 'x',
        model: 'x',
        voice: 'x',
        format: 'x',
        key: 'x',
      });
      if (axes.bodyKind === 'json') parseJSONObject(rendered, 'bodyTemplate');
    } catch (error) {
      problems.push(messageOf(error));
    }
  }
  try {
    cloudHeaderObject(axes.headers);
  } catch (error) {
    problems.push(messageOf(error));
  }
  if (!hasKey) problems.push(keyReason(settings));
  return problems;
}

/** 按鉴权方式造请求头（`query` 不进头）。 */
function authHeadersOf(axes: CloudAxes, key: string): Record<string, string> {
  if (key === '') return {};
  switch (axes.authStyle) {
    case 'bearer':
      return { authorization: `Bearer ${key}` };
    case 'api-key-header':
      return { [axes.authHeader === '' ? 'api-key' : axes.authHeader]: key };
    case 'x-api-key':
      return { 'xi-api-key': key };
    default:
      return {};
  }
}

/**
 * 造一次合成请求（四轴的唯一落地点，代码里没有按服务名分支）。
 *
 * @param settings - 当前配置（调用方已确认 {@link cloudConfigProblems} 为空）。
 * @param text - 要念的台词。
 * @param key - API Key；进鉴权头/查询串，绝不进日志。
 * @returns 完整 URL 与 fetch 的 init（含 12s 超时信号）。
 * @throws {Error} 模板渲染失败或不是合法 JSON 时。
 */
export function cloudRequestOf(settings: CloudSettings, text: string, key: string): CloudRequest {
  const axes = cloudAxesOf(settings);
  const headers: Record<string, string> = {
    ...authHeadersOf(axes, key),
    'content-type': CONTENT_TYPES[axes.bodyKind],
  };
  const values: CloudTemplateValues = { text, model: axes.model, voice: axes.voice, format: axes.format, key };
  let body: string;
  if (axes.bodyKind === 'json') {
    body = JSON.stringify(parseJSONObject(renderTemplate(axes.bodyTemplate, 'json', values), 'bodyTemplate'));
  } else if (axes.bodyKind === 'form') {
    body = renderTemplate(axes.bodyTemplate, 'form', values);
  } else {
    body = renderTemplate(axes.bodyTemplate, 'ssml', values);
  }
  // 额外请求头最后合并：用户可以覆盖默认的鉴权方式（自建服务常用别名头）或 Content-Type
  Object.assign(headers, cloudHeaderObject(axes.headers));
  return {
    url: cloudSpeechURL(settings, key),
    init: {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  };
}

/**
 * 按点号路径取值，支持数组下标。
 *
 * @param root - 解析后的 JSON。
 * @param path - 如 `choices.0.message.audio.data`。
 * @returns 取到的值；路径为空或中途类型不对时 undefined。
 */
export function digPath(root: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (trimmed === '') return undefined;
  let current: unknown = root;
  for (const segment of trimmed.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined;
      current = current[Number(segment)];
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current;
}

/** 解 base64（容忍换行与 URL-safe 变体）。 */
function decodeBase64(raw: string): Uint8Array {
  const normalized = raw.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (normalized === '' || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error('响应里的 base64 不合法');
  }
  return new Uint8Array(Buffer.from(normalized, 'base64'));
}

/** 解十六进制（容忍空白与冒号分隔）。 */
function decodeHex(raw: string): Uint8Array {
  const normalized = raw.replace(/[\s:]/g, '');
  if (normalized === '' || normalized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error('响应里的十六进制不合法');
  }
  return new Uint8Array(Buffer.from(normalized, 'hex'));
}

/** 取 URL 的 origin；解析不了回空串。 */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * 响应 JSON 的顶层键，用于 `responsePath` 取不到值时的人话。
 *
 * @param root - 解析后的 JSON。
 * @returns 形如 `choices、id` 的一行；数组说长度、标量说类型。
 */
function topLevelKeysOf(root: unknown): string {
  if (Array.isArray(root)) return `[数组，长度 ${root.length}]`;
  if (root !== null && typeof root === 'object') {
    const keys = Object.keys(root as Record<string, unknown>);
    if (keys.length === 0) return '(空对象)';
    const shown = keys.slice(0, 10);
    return shown.join('、') + (keys.length > shown.length ? ` …（共 ${keys.length} 个）` : '');
  }
  return `(${root === null ? 'null' : typeof root})`;
}

/** 读 JSON 响应体；空或不是 JSON 都给一句人话。 */
async function readJSON(res: Response, what: string): Promise<unknown> {
  const raw = (await res.text()).trim();
  if (raw === '') throw new Error(`${what} 响应为空`);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${what} 响应不是合法 JSON`);
  }
}

/**
 * 按 `responseKind` 取出音频字节。
 *
 * @param res - 2xx 的响应。
 * @param axes - 四轴（需要 `responseKind` / `responsePath` / `baseURL`）。
 * @param transport - 传输层（`json-url` 要再 GET 一次）。
 * @param auth - 本次请求的鉴权头（只在第二次 GET 与接口同源时带上，避免破坏签名 URL）。
 * @returns 音频字节（类型由调用方嗅探）。
 * @throws {Error} JSON 解析失败、路径取不到值、编码不合法或二次请求失败时。
 */
async function audioFromResponse(
  res: Response,
  axes: CloudAxes,
  transport: typeof fetch,
  auth: Record<string, string>,
): Promise<Uint8Array> {
  if (axes.responseKind === 'audio') return new Uint8Array(await res.arrayBuffer());
  const parsed = await readJSON(res, axes.responseKind);
  const path = axes.responsePath === '' ? '(未配置 responsePath)' : axes.responsePath;
  const picked = digPath(parsed, axes.responsePath);
  if (picked === undefined) {
    // 路径写错是配置问题，别让用户对着「返回的不是音频」猜：把 JSON 实际有什么摆出来
    throw new Error(`JSON 里找不到 ${path}（实际顶层键：${topLevelKeysOf(parsed)}）`);
  }
  if (typeof picked !== 'string' || picked.trim() === '') {
    throw new Error(`响应里 ${path} 不是非空字符串（实际类型：${picked === null ? 'null' : typeof picked}）`);
  }
  if (axes.responseKind === 'json-base64') return decodeBase64(picked);
  if (axes.responseKind === 'json-hex') return decodeHex(picked);
  if (!/^https?:\/\//i.test(picked.trim())) throw new Error('json-url 返回的不是 http(s) 地址');
  const target = picked.trim();
  const sameOrigin = originOf(target) !== '' && originOf(target) === originOf(axes.baseURL);
  // 跨源不带鉴权头：S3 这类预签名 URL 多带一个 Authorization 会直接 403。若某些 CDN 反而需要自定义头，
  // 用配置里的 `headers` 手动加（它会覆盖这里的空对象），不要把宿主密钥无条件发出去。
  const audioRes = await transport(target, {
    method: 'GET',
    headers: sameOrigin ? auth : {},
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!audioRes.ok) throw new Error(`取音频地址返回 ${audioRes.status}`);
  return new Uint8Array(await audioRes.arrayBuffer());
}

/**
 * 把 URL 洗成能进日志与人话的样子：去掉 userinfo、查询串与片段。
 *
 * 有人会把 token 塞进 `?key=`（Google 预设就是），错误文案与 `lastError` 会被贴进 issue，
 * 所以一律不原样打印。
 *
 * @param raw - 任意 URL（可能是空串或写坏的）。
 * @returns 脱敏后的地址；解析不了就退回「问号之前的部分」。
 */
export function redactURL(raw: string): string {
  if (raw.trim() === '') return '(未配置)';
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return raw.split('?')[0] ?? raw;
  }
}

/**
 * 按魔数嗅探音频类型（服务端回什么类型不看 `Content-Type`）。
 *
 * @param data - 响应体字节。
 * @returns 对应的 MIME；认不出时 undefined（调用方把前 16 字节打进错误）。
 */
export function sniffAudioMime(data: Uint8Array): string | undefined {
  const at = (index: number): number => data[index] ?? -1;
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46) return 'audio/wav'; // RIFF
  if (at(0) === 0x49 && at(1) === 0x44 && at(2) === 0x33) return 'audio/mpeg'; // ID3
  if (at(0) === 0xff && (at(1) & 0xe0) === 0xe0) return 'audio/mpeg'; // MPEG 帧同步 0xFF Ex
  if (at(0) === 0x4f && at(1) === 0x67 && at(2) === 0x67 && at(3) === 0x53) return 'audio/ogg'; // OggS
  if (at(4) === 0x66 && at(5) === 0x74 && at(6) === 0x79 && at(7) === 0x70) return 'audio/mp4'; // ftyp（m4a）
  return undefined;
}

/**
 * 前若干字节的十六进制，供错误文案定位「服务端到底回了什么」。
 *
 * @param data - 响应体字节。
 * @param limit - 最多回显多少字节，缺省 {@link HEX_PREVIEW_BYTES}。
 * @returns 空格分隔的小写两位十六进制。
 */
export function hexPreview(data: Uint8Array, limit: number = HEX_PREVIEW_BYTES): string {
  return [...data.slice(0, limit)].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

/** 取响应头的 `Content-Type`；读不到就说「未提供」（不让一个坏头把错误路径也炸掉）。 */
function contentTypeOf(res: Response): string {
  try {
    return res.headers.get('content-type') ?? '未提供';
  } catch {
    return '未提供';
  }
}

/** 模板指纹：只进缓存键，取前 12 位够用且不把整段模板写进日志。 */
function templateFingerprint(template: string): string {
  if (template === '') return '';
  return createHash('sha1').update(template).digest('hex').slice(0, 12);
}

/**
 * 缓存指纹：换预设 / 换协议 / 换服务 / 换路径 / 换鉴权 / 换模型 / 换音色 / 换请求体 / 换响应取值
 * 都必须是另一个键。
 *
 * @param settings - 当前配置。
 * @returns 可读的指纹串（进 `cacheKey` 后会被 sha1 收掉）。
 */
export function cloudCacheTag(settings: CloudSettings): string {
  const axes = cloudAxesOf(settings);
  return [
    settings.protocol,
    settings.preset,
    axes.baseURL,
    axes.path,
    axes.authStyle,
    axes.authHeader,
    axes.model,
    axes.voice,
    axes.format,
    axes.bodyKind,
    axes.responseKind,
    axes.responsePath,
    templateFingerprint(axes.bodyTemplate),
    templateFingerprint(axes.headers),
  ].join('|');
}

/**
 * 读服务端错误详情：优先取 `error.message`，非 JSON 就截断原样。
 *
 * @param res - 非 2xx 的响应。
 * @returns 一段可直接进日志与人话的文案（已截到 {@link MAX_ERROR_DETAIL}）。
 */
async function readErrorDetail(res: Response): Promise<string> {
  try {
    const raw = (await res.text()).trim();
    if (raw === '') return res.statusText || '无内容';
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: unknown } };
      const message = parsed.error?.message;
      if (typeof message === 'string' && message.trim() !== '') return message.trim().slice(0, MAX_ERROR_DETAIL);
    } catch {
      // 不是 JSON：落到下面的原样截断
    }
    return raw.slice(0, MAX_ERROR_DETAIL);
  } catch {
    return res.statusText || '读取响应失败';
  }
}

/**
 * 造云端语音实现。
 *
 * @param deps - 现读配置、取密钥、可注入的传输层与日志。
 * @returns 注册用的实现：`billable: true`，`availability()` 读探活缓存，`synthesize()` 真请求。
 */
export function createCloudProvider(deps: CloudProviderDeps): VoiceProvider {
  /** 最近一次探活结论（`availability()` 只能同步读它）。 */
  let verdict: VoiceProviderAvailability = { ok: false, reason: '云端语音尚未探活' };
  /** 最近一次合成失败的原因；合成成功即清空。 */
  let lastError: string | undefined;
  const transport: typeof fetch = deps.fetch ?? fetch;

  /** 配置读不出来时给一份默认：探活与缓存指纹不该因为一个坏配置文件而抛。 */
  function safeSettings(): CloudSettings {
    try {
      return deps.settings();
    } catch {
      return EMPTY_CLOUD_SETTINGS;
    }
  }

  /** 现读密钥（按生效预设选引用）；凭据库偶发读失败按「没配」处理，不把整句话打断。 */
  async function readKeyOrUndefined(settings: CloudSettings): Promise<string | undefined> {
    try {
      return await deps.readKey(settings);
    } catch {
      return undefined;
    }
  }

  /** 现在需不需要密钥（`authStyle: 'none'` 的本机服务不要）。 */
  function keyNeeded(axes: CloudAxes): boolean {
    return axes.authStyle !== 'none';
  }

  /** 探一次「能不能用」：只看配置与密钥在场，不发请求（TTS 没有免费探活）。 */
  async function refresh(): Promise<boolean> {
    const settings = safeSettings();
    const axes = cloudAxesOf(settings);
    const key = keyNeeded(axes) ? await readKeyOrUndefined(settings) : '';
    const problems = cloudConfigProblems(settings, !keyNeeded(axes) || (key ?? '') !== '');
    verdict = problems.length === 0 ? { ok: true } : { ok: false, reason: problems.join('；') };
    if (verdict.ok) lastError = undefined;
    return verdict.ok;
  }

  /** 把一次失败收进 `lastError` 再抛：回退链会静默换嗓子，这里是唯一能看见原因的地方。 */
  function fail(message: string, cause?: unknown): never {
    lastError = message;
    throw cause === undefined ? new Error(`cloud tts: ${message}`) : new Error(`cloud tts: ${message}`, { cause });
  }

  /** 真合成一次：文本 → 音频字节（类型由魔数决定）。 */
  async function synthesizeOnce(text: string): Promise<AudioClip> {
    const settings = safeSettings();
    const axes = cloudAxesOf(settings);
    const needsKey = keyNeeded(axes);
    const key = needsKey ? await readKeyOrUndefined(settings) : '';
    const problems = cloudConfigProblems(settings, !needsKey || (key ?? '') !== '');
    if (needsKey && (key ?? '') === '') fail(problems.join('；') || keyReason(settings));
    if (problems.length > 0) fail(problems.join('；'));

    const label = `${settings.protocol} ${settings.preset} ${redactURL(cloudBaseURL(settings))}`;
    let request: CloudRequest;
    try {
      request = cloudRequestOf(settings, text, key ?? '');
    } catch (error) {
      fail(`${label}：${messageOf(error)}`, error);
    }

    let res: Response;
    try {
      res = await transport(request.url, request.init);
    } catch (error) {
      fail(`请求失败（${label}）：${messageOf(error)}`, error);
    }
    if (!res.ok) {
      const detail = await readErrorDetail(res);
      fail(`${res.status}（${label}）：${detail}`);
    }

    let data: Uint8Array;
    try {
      data = await audioFromResponse(res, axes, transport, authHeadersOf(axes, key ?? ''));
    } catch (error) {
      fail(`${label}：${messageOf(error)}`, error);
    }
    if (data.length === 0) fail(`返回的音频为空（content-type: ${contentTypeOf(res)}）`);
    const mime = sniffAudioMime(data);
    if (mime === undefined) {
      fail(
        `${label}：返回的不是音频（前 ${HEX_PREVIEW_BYTES} 字节：${hexPreview(data)}；` +
          `content-type: ${contentTypeOf(res)}）`,
      );
    }
    lastError = undefined;
    deps.log?.info?.(
      `[fish-body] voice cloud: protocol=${settings.protocol} preset=${settings.preset} chars=${text.length} ` +
        `bytes=${data.length} mime=${mime} voice=${axes.voice}`,
    );
    return { data, mime };
  }

  return {
    id: CLOUD_PROVIDER_ID,
    name: '云端语音 TTS（按量计费）',
    // 动态：设置页靠 `required` 画星号，预设/协议一换它就该跟着换，客户端不做协议判断
    get fields() {
      return cloudFieldsFor(safeSettings());
    },
    billable: true,
    // 路由保存接入配置时只问这两项，不自己解析裸值：`authStyle`/`protocol` 存空串表示「跟随预设」，
    // 裸值判断会把「预设要求鉴权」误判成「不需要 key」（D-07 的假修根因）。
    // 生效值统一走 `cloudAxesOf`（预设默认 + 非空覆盖），与合成时用的是同一套口径。
    // cloudSettingsOf 读的是整份 provider 配置（{ cloud: {...} }）；这里拿到的是 cloud 段的扁平值。
    // 只在「云端开着」时才要 key：关掉云端是用户的逃生口，没配 key 也必须能存（P2-9）。
    needsKey: (values) => {
      const settings = cloudSettingsOf({ cloud: values });
      return settings.useCloud && cloudAxesOf(settings).authStyle !== 'none';
    },
    // 允许读的引用同样按生效预设收窄：只有 deepseek 才允许回退宿主 `DEEPSEEK_API_KEY`，
    // 否则「baseURL 指到第三方却读宿主 key」等于把宿主的模型凭据发给陌生服务。
    keyRefs: (values) => cloudKeyRefs(cloudSettingsOf({ cloud: values })),
    availability: () => verdict,
    // 音色是自由文本、没有可枚举的清单，只把「当前这一个」报出来：右键菜单与设置页据此显示在用什么嗓子，
    // 切到别的音色得改接入卡（/voice/provider-voice 只收清单里的值）
    listVoices: (): readonly ProviderVoiceInfo[] => {
      const settings = safeSettings();
      const voice = cloudVoiceId(settings);
      return voice === '' ? [] : [{ id: voice, name: voice, tag: settings.preset }];
    },
    activeVoice: () => cloudVoiceId(safeSettings()),
    // 指纹进缓存键：换预设/换协议/换服务/换模型/换音色/换四轴都不能命中旧嗓子合成的音频
    cacheTag: () => cloudCacheTag(safeSettings()),
    lastError: () => lastError,
    refresh,
    synthesize: (input) => synthesizeOnce(input.text),
  };
}

/**
 * 这个实现是否被用户显式开启（`useCloud === 'on'`）。
 *
 * 单独抽出来是给装配侧用的：`index.ts` 只关心「该不该把它排到链首」，
 * 不该为此构造整个实现或读密钥。
 *
 * @param settings - {@link cloudSettingsOf} 的结果。
 * @returns 开启为 true。
 */
export function cloudConfigured(settings: CloudSettings): boolean {
  return settings.useCloud === true;
}
