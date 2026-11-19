/**
 * 云端 TTS：按量计费、**不进自动回退链**，按 `protocol` 接三种接口形状。
 *
 * 为什么不进链：链的语义是「自动挑一个能出声的实现」。云端按服务商规则收钱，混进链里等于在本地
 * 服务没起时静默花用户的钱。所以它标 `billable: true`，只有用户打开「使用云端语音」时才由
 * `speak.ts` 通过 `voiceChainWithPreferred` 排到链首；失败后回落免费链（失败请求不计费）。
 * 为什么是三协议而不是某一家：TTS 的请求形状只有三类，认下它们就能接绝大多数服务；`deepseek`
 * 是历史形状必须原样保留，所以老配置（没有 `protocol`）按地址推断，见 {@link cloudProtocolOf}。
 * `availability()` 必须同步（链每次合成都现查），密钥在凭据库要异步读，所以结论缓存在 `verdict` 里、
 * 由 `refresh()` 更新；探活**不发网络请求**——TTS 没有廉价 ping，拿一句话去试就等于花钱。
 * 契约见 API.md「语音」一节；本模块不做重试、不计时（超时由 transport 之外的信号与链共同兜）。
 * @module dsh-fish-body/src/host/voice/cloud/provider
 */
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
 * 就会顺手删掉整个 DSH 的模型凭据。
 */
export const CLOUD_API_KEY_FALLBACK = 'DEEPSEEK_API_KEY';

/** 全部协议；数组顺序即下拉候选的缺省顺序（当前生效的那个会被排到最前）。 */
export const CLOUD_PROTOCOLS = ['deepseek', 'openai', 'custom'] as const;

/** 一个协议名。 */
export type CloudProtocol = (typeof CLOUD_PROTOCOLS)[number];

/** 缺省协议：老配置既没有 `protocol` 又没有可判的地址时按它走（等价于改造前的行为）。 */
export const DEFAULT_CLOUD_PROTOCOL: CloudProtocol = 'deepseek';

/** DeepSeek 官方接口根地址；`deepseek` 协议下 `baseURL` 留空时用它。 */
export const DEFAULT_CLOUD_BASE_URL = 'https://api.deepseek.com';

/** OpenAI 官方接口根地址；`openai` 协议下 `baseURL` 留空时的兜底（该协议仍判「必填」）。 */
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';

/** DeepSeek TTS 的默认音色：它只认 stella / tide，空值服务端会拒。 */
export const DEFAULT_DEEPSEEK_VOICE = 'stella';

/** `openai` 协议的 `response_format` 缺省值。 */
export const DEFAULT_RESPONSE_FORMAT = 'mp3';

/** DeepSeek 的合成路径（相对根地址，固定）。 */
const DEEPSEEK_TTS_PATH = '/v1/tools/tts';

/** OpenAI 兼容的语音路径（相对根地址，固定）。 */
const OPENAI_SPEECH_PATH = '/v1/audio/speech';

/** 单次合成超时（ms）：链外层给 15s，这里留出收尾余量。 */
const REQUEST_TIMEOUT_MS = 12_000;

/** 服务端错误文案的截断长度：只留够定位的一句话，不把整页 HTML 灌进日志。 */
const MAX_ERROR_DETAIL = 512;

/** 认不出音频格式时，错误里回显的字节数。 */
const HEX_PREVIEW_BYTES = 16;

/** 主引用没值、需要密钥时的人话。 */
const MISSING_KEY_REASON = `未配置 API Key（可复用 ${CLOUD_API_KEY_FALLBACK}）`;

/** 一段云端配置（全是字符串/布尔；密钥不在这里，它在 DSH 凭据库）。 */
export interface CloudSettings {
  /** 用户是否显式开启（按量计费的总开关）；关着时它完全不参与合成。 */
  readonly useCloud: boolean;
  /** 接口协议；老配置缺这一项时由 {@link cloudProtocolOf} 按地址推断。 */
  readonly protocol: CloudProtocol;
  /** 接口根地址（不含具体路径）；`deepseek` 留空用官方默认。 */
  readonly baseURL: string;
  /** 模型名（`openai` 必填；`deepseek` 忽略）。 */
  readonly model: string;
  /** 音色 id，**自由文本**（各服务商自己的一套名字）；`deepseek` 留空按 stella。 */
  readonly voice: string;
  /** `custom` 协议的合成路径，如 `/tts`；填完整 URL 时直接用它。 */
  readonly path: string;
  /** `custom` 协议的 JSON 请求体模板，可用 `{text}`（必填）/ `{model}` / `{voice}`。 */
  readonly bodyTemplate: string;
  /** `custom` 协议的额外请求头（JSON 串）；缺省只有 `Authorization` 与 `Content-Type`。 */
  readonly headers: string;
  /** `openai` 协议的 `response_format`；留空用 {@link DEFAULT_RESPONSE_FORMAT}。 */
  readonly format: string;
}

/** 全空配置：未配置时的初值（协议按缺省，地址留空）。 */
export const EMPTY_CLOUD_SETTINGS: CloudSettings = {
  useCloud: false,
  protocol: DEFAULT_CLOUD_PROTOCOL,
  baseURL: '',
  model: '',
  voice: '',
  path: '',
  bodyTemplate: '',
  headers: '',
  format: '',
};

/**
 * 配置项声明（静态基线）。
 *
 * `required` 与 `protocol` 的候选值随协议变，权威版本是 {@link cloudFieldsFor}；这里给的是
 * 「未配置时」那一眼（= `deepseek` 协议）。`apiKey` 是 `password` + `credentialRef`：值不进
 * `voice-providers.json`，写进 DSH 凭据库（见 `../provider-secrets.ts`）。
 */
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
    key: 'protocol',
    label: '接口协议',
    kind: 'select',
    options: [...CLOUD_PROTOCOLS],
    description:
      'deepseek = POST {baseURL}/v1/tools/tts（老配置的兼容形状）；openai = POST {baseURL}/v1/audio/speech；' +
      'custom = 自己填路径与请求体模板',
  },
  {
    key: 'baseURL',
    label: '服务地址',
    kind: 'text',
    placeholder: DEFAULT_CLOUD_BASE_URL,
    description: '接口根地址（不带具体路径）；deepseek 留空用官方地址，openai / custom 必填',
  },
  {
    key: 'model',
    label: '模型',
    kind: 'text',
    placeholder: 'gpt-4o-mini',
    description: 'openai 协议必填（如 tts-1 / gpt-4o-mini-tts）；deepseek 协议忽略此项',
  },
  {
    key: 'voice',
    label: '音色',
    kind: 'text',
    placeholder: 'alloy',
    description:
      '按服务商填音色名：openai 如 alloy / nova，DeepSeek 如 stella / tide（留空按 stella），其它服务填它自己的音色 id',
  },
  {
    key: 'path',
    label: '合成路径',
    kind: 'text',
    placeholder: '/tts',
    description: '仅 custom：相对服务地址的路径（如 /tts），也可以直接填完整 URL',
  },
  {
    key: 'bodyTemplate',
    label: '请求体模板',
    kind: 'text',
    placeholder: '{"text":"{text}","voice":"{voice}"}',
    description:
      '仅 custom：JSON 模板，占位符 {text}（必填）/ {model} / {voice} 会被替换成当前值，替换后必须是合法 JSON 对象',
  },
  {
    key: 'format',
    label: '返回格式',
    kind: 'text',
    placeholder: DEFAULT_RESPONSE_FORMAT,
    description: '仅 openai：请求里的 response_format，留空用 mp3（可填 mp3 / opus / aac / flac / wav）',
  },
  {
    key: 'headers',
    label: '额外请求头',
    kind: 'text',
    placeholder: '{"xi-api-key":"…"}',
    description: '仅 custom：JSON 串，例如 {"xi-api-key":"…"}；默认已带 Authorization: Bearer <API Key>',
  },
  {
    key: 'apiKey',
    label: 'API Key',
    kind: 'password',
    required: true,
    placeholder: 'sk-…',
    credentialRef: CLOUD_API_KEY_REF,
    credentialFallbacks: [CLOUD_API_KEY_FALLBACK],
    description:
      `存进 DSH 凭据库，不写进配置文件；deepseek 协议下本机已有 ${CLOUD_API_KEY_FALLBACK} 时可直接复用，` +
      'openai / custom 只认这里填的值（不会把宿主的 DeepSeek key 发给第三方地址）',
  },
];

/** 造这个实现的依赖（测试注入假 fetch，单测不打真网）。 */
export interface CloudProviderDeps {
  /** 现读配置（改完不必重启插件）。 */
  settings(): CloudSettings;
  /**
   * 按协议取密钥：`deepseek` 才允许回退到宿主凭据，其余协议只认主引用（见 {@link cloudKeyRefs}）。
   * 每次合成现读，不缓存值。
   */
  readKey(protocol: CloudProtocol): Promise<string | undefined>;
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

/**
 * 协议归一：显式值优先，缺省或写坏时按地址推断（**向后兼容的唯一入口**）。
 *
 * 老配置只有 `useCloud` / `baseURL` / `voice`：空地址或地址里含 `deepseek` 的按 DeepSeek 处理，
 * 其余按 OpenAI 兼容。判不出来就按 `openai`，因为「别的 TTS 服务」远比「自建 DeepSeek 代理」常见。
 *
 * @param raw - 配置里的 `protocol`（可能是任意值或缺席）。
 * @param baseURL - 已 trim 的 `baseURL`，用于推断。
 * @returns 三种协议之一；永远不会因为缺项而不可用。
 */
export function cloudProtocolOf(raw: unknown, baseURL: string): CloudProtocol {
  const explicit = str(raw).toLowerCase();
  const known = CLOUD_PROTOCOLS.find((item) => item === explicit);
  if (known !== undefined) return known;
  return baseURL === '' || /deepseek/i.test(baseURL) ? 'deepseek' : 'openai';
}

/**
 * 从 `voice-providers.json` 的解析结果里取云端设置。
 *
 * @param source - 整个 provider 配置对象（`{ cloud: {...} }`），可以是 undefined。
 * @returns 九个值；缺项给空串 / 缺省协议（由 {@link cloudConfigProblems} 变成人话）。
 */
export function cloudSettingsOf(source: unknown): CloudSettings {
  const conf = recordOf(recordOf(source).cloud);
  const baseURL = str(conf.baseURL);
  return {
    useCloud: str(conf.useCloud) === 'on',
    protocol: cloudProtocolOf(conf.protocol, baseURL),
    baseURL,
    model: str(conf.model),
    voice: str(conf.voice),
    path: str(conf.path),
    bodyTemplate: str(conf.bodyTemplate),
    headers: str(conf.headers),
    format: str(conf.format),
  };
}

/** 生效的接口根地址：留空按协议取官方默认（custom 没有默认，回空串）；末尾斜杠去掉。 */
export function cloudBaseURL(settings: CloudSettings): string {
  const raw = settings.baseURL.trim().replace(/\/+$/, '');
  if (raw !== '') return raw;
  if (settings.protocol === 'openai') return DEFAULT_OPENAI_BASE_URL;
  if (settings.protocol === 'deepseek') return DEFAULT_CLOUD_BASE_URL;
  return '';
}

/** 生效的音色 id：`deepseek` 的空值按 stella（服务端不认空值），其余协议原样（空串 = 没配）。 */
export function cloudVoiceId(settings: CloudSettings): string {
  const voice = settings.voice.trim();
  if (voice !== '') return voice;
  return settings.protocol === 'deepseek' ? DEFAULT_DEEPSEEK_VOICE : '';
}

/**
 * 生效的合成地址。
 *
 * `openai` 兼容服务常把 `/v1` 写进 `baseURL`，补路径时不能再拼一次（否则是 `/v1/v1/audio/speech`）。
 *
 * @param settings - 当前配置。
 * @returns 完整 URL；`custom` 的 `path` 写成绝对 URL 时直接用它。
 */
export function cloudSpeechURL(settings: CloudSettings): string {
  const base = cloudBaseURL(settings);
  if (settings.protocol === 'deepseek') return base + DEEPSEEK_TTS_PATH;
  if (settings.protocol === 'openai') return base.replace(/\/v1$/i, '') + OPENAI_SPEECH_PATH;
  const path = settings.path.trim();
  if (/^https?:\/\//i.test(path)) return path;
  return base + (path.startsWith('/') ? path : `/${path}`);
}

/**
 * 一个协议允许读的凭据引用（主引用在前，其后是只读回退引用）。
 *
 * 只有 `deepseek` 可以回退到宿主的 `DEEPSEEK_API_KEY`：那把 key 属于 DeepSeek，baseURL 指到第三方
 * 却仍然读它，等于把宿主的模型凭据发给陌生服务。`openai` / `custom` 只认自己填的那一把。
 *
 * @param protocol - 当前生效协议。
 * @returns 可读的引用名；第一个是用户显式填写的那一项。
 */
export function cloudKeyRefs(protocol: CloudProtocol): readonly string[] {
  return protocol === 'deepseek' ? [CLOUD_API_KEY_REF, CLOUD_API_KEY_FALLBACK] : [CLOUD_API_KEY_REF];
}

/**
 * 造「按协议取密钥」的读取器：装配侧只需把宿主凭据服务递给它。
 *
 * 放在这里而不是 `index.ts` 内联，是为了让引用选择这条安全边界可以被测试钉住——回退引用只对
 * `deepseek` 生效（见 {@link cloudKeyRefs}），选错引用就是把宿主的 DeepSeek key 发出去。
 *
 * @param raw - `optionalService('credentials')` 的结果（独立模式的替身也能用，只要它有 `resolve`）。
 * @returns 读函数：拿到可用密钥就返回，没有或凭据库不可用则返回 undefined。
 */
export function createCloudKeyReader(raw: unknown): (protocol: CloudProtocol) => Promise<string | undefined> {
  const service =
    raw !== null && typeof raw === 'object' && typeof (raw as { resolve?: unknown }).resolve === 'function'
      ? (raw as { resolve(ref: ReturnType<typeof credentialRef>): Promise<{ value?: string } | undefined> })
      : undefined;
  return async (protocol) => {
    if (service === undefined) return undefined;
    for (const ref of cloudKeyRefs(protocol)) {
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

/** 某个协议下必填的配置键；`apiKey` 恒在内（三种协议都要密钥）。 */
export function cloudRequiredKeys(protocol: CloudProtocol): readonly string[] {
  switch (protocol) {
    case 'openai':
      return ['baseURL', 'model', 'voice', 'apiKey'];
    case 'custom':
      return ['baseURL', 'path', 'bodyTemplate', 'apiKey'];
    default:
      return ['apiKey'];
  }
}

/**
 * 云端语音的配置项（`required` 与 `protocol` 候选值按当前协议）。
 *
 * `protocol` 的候选值把**当前生效协议**排到最前：老配置没有 `protocol` 字段时，下拉第一项就是
 * 按地址推出来的那个值——否则界面会显示 openai、实际却在走 deepseek。
 *
 * @param settings - 当前配置。
 * @returns 声明列表；顺序固定，只改 `required`、`protocol.options` 与密钥的回退引用。
 */
export function cloudFieldsFor(settings: CloudSettings): readonly VoiceField[] {
  const required = new Set(cloudRequiredKeys(settings.protocol));
  const options = [settings.protocol, ...CLOUD_PROTOCOLS.filter((item) => item !== settings.protocol)];
  return BASE_FIELDS.map((field) => ({
    ...field,
    ...(required.has(field.key) ? { required: true } : {}),
    ...(field.key === 'protocol' ? { options } : {}),
    // 回退引用也要跟着协议收起来：否则设置页会对「只有 DEEPSEEK_API_KEY」的 openai 配置显示「已保存」，
    // 而合成时根本读不到 key（或者更糟：真读到了、把宿主的 key 发给第三方）
    ...(field.key === 'apiKey' && settings.protocol !== 'deepseek' ? { credentialFallbacks: [] } : {}),
  }));
}

/** 未配置时的声明（= `deepseek` 协议那一眼）；运行时的权威版本是 {@link cloudFieldsFor}。 */
export const CLOUD_FIELDS: readonly VoiceField[] = cloudFieldsFor(EMPTY_CLOUD_SETTINGS);

/** 取一个字段当前的字符串值；未知键给空串。 */
function fieldValue(settings: CloudSettings, key: string): string {
  switch (key) {
    case 'baseURL':
      return settings.baseURL.trim();
    case 'model':
      return settings.model.trim();
    case 'voice':
      return settings.voice.trim();
    case 'path':
      return settings.path.trim();
    case 'bodyTemplate':
      return settings.bodyTemplate.trim();
    case 'headers':
      return settings.headers.trim();
    case 'format':
      return settings.format.trim();
    default:
      return '';
  }
}

/** 把值转成可直接嵌进 JSON 字符串的片段（引号、反斜杠、换行都转义掉）。 */
function jsonFragment(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/**
 * 渲染 `custom` 的请求体模板。
 *
 * 占位符的替换值先做 JSON 转义：`{"text":"{text}"}` 里塞进带引号的台词也不会拼坏 JSON。
 *
 * @param template - 用户填的模板。
 * @param values - 三个占位符的取值。
 * @returns 替换后的 JSON 文本（还没解析）。
 * @throws {Error} 模板里没有 `{text}` 时（`{text}` 必填，缺了就是配置错误）。
 */
export function renderBodyTemplate(template: string, values: { text: string; model: string; voice: string }): string {
  if (!template.includes('{text}')) throw new Error('custom 协议的 bodyTemplate 必须包含 {text} 占位符');
  let out = template;
  for (const key of ['text', 'model', 'voice'] as const) {
    out = out.split(`{${key}}`).join(jsonFragment(values[key]));
  }
  return out;
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
 * 解析 `custom` 的额外请求头。
 *
 * @param raw - 用户填的 JSON 串；空串给空对象。
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

/**
 * 还缺什么 / 哪里写坏了（探活与合成共用同一份判据）。
 *
 * @param settings - 当前配置。
 * @param hasKey - 凭据库里有没有取到密钥（值本身不参与判断）。
 * @returns 人话列表；空数组 = 配置齐全可以发请求。
 */
export function cloudConfigProblems(settings: CloudSettings, hasKey: boolean): string[] {
  const problems: string[] = [];
  const base = cloudBaseURL(settings);
  if (base === '') {
    if (settings.protocol !== 'deepseek') problems.push('缺少必填项：baseURL');
  } else if (!/^https?:\/\//i.test(base)) {
    problems.push('服务地址（baseURL）必须以 http:// 或 https:// 开头');
  }
  const missing = cloudRequiredKeys(settings.protocol)
    .filter((key) => key !== 'apiKey' && key !== 'baseURL')
    .filter((key) => fieldValue(settings, key) === '');
  if (missing.length > 0) problems.push(`缺少必填项：${missing.join('、')}`);
  if (settings.protocol === 'custom') {
    const template = settings.bodyTemplate.trim();
    if (template !== '') {
      try {
        // 用探针值先跑一遍：模板缺占位符或本身不是 JSON 对象，都该在探活时就报出来，而不是等用户说话
        parseJSONObject(renderBodyTemplate(template, { text: 'x', model: 'x', voice: 'x' }), 'bodyTemplate');
      } catch (error) {
        problems.push(messageOf(error));
      }
    }
    try {
      cloudHeaderObject(settings.headers);
    } catch (error) {
      problems.push(messageOf(error));
    }
  }
  if (!hasKey) problems.push(MISSING_KEY_REASON);
  return problems;
}

/**
 * 造一次合成请求（三种协议的唯一分岔点）。
 *
 * @param settings - 当前配置（调用方已确认 {@link cloudConfigProblems} 为空）。
 * @param text - 要念的台词。
 * @param key - API Key；只进请求头，绝不进 URL 与日志。
 * @returns 完整 URL 与 fetch 的 init（含 12s 超时信号）。
 * @throws {Error} `custom` 的模板/请求头渲染失败时。
 */
export function cloudRequestOf(settings: CloudSettings, text: string, key: string): CloudRequest {
  const headers: Record<string, string> = {
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  };
  let body: Record<string, unknown>;
  if (settings.protocol === 'deepseek') {
    body = {
      text,
      voice_id: cloudVoiceId(settings),
      // 只收 wav / pcm；pcm 是裸流（无容器），缓存与播放链路都认不了，所以只要 wav
      format: 'wav',
      // 台词里常带 markdown 强调符，念出来是「星号」；交给服务端在合成前摘掉
      filter_markdown: true,
    };
  } else if (settings.protocol === 'openai') {
    body = {
      model: settings.model.trim(),
      input: text,
      voice: cloudVoiceId(settings),
      response_format: settings.format.trim() || DEFAULT_RESPONSE_FORMAT,
    };
  } else {
    body = parseJSONObject(
      renderBodyTemplate(settings.bodyTemplate, {
        text,
        model: settings.model.trim(),
        voice: cloudVoiceId(settings),
      }),
      'bodyTemplate',
    );
    // 额外请求头后合并：用户可以覆盖默认的鉴权方式（自建服务常用别名头）
    Object.assign(headers, cloudHeaderObject(settings.headers));
  }
  return {
    url: cloudSpeechURL(settings),
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  };
}

/**
 * 把 URL 洗成能进日志与人话的样子：去掉 userinfo、查询串与片段。
 *
 * 有人会把 token 塞进 `?key=`，错误文案与 `lastError` 会被贴进 issue，所以一律不原样打印。
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
 * 缓存指纹：换协议 / 换服务 / 换模型 / 换音色 / 换模板都必须是另一个键。
 *
 * @param settings - 当前配置。
 * @returns 可读的指纹串（进 `cacheKey` 后会被 sha1 收掉）。
 */
export function cloudCacheTag(settings: CloudSettings): string {
  return [
    settings.protocol,
    cloudBaseURL(settings),
    settings.path.trim(),
    settings.model.trim(),
    cloudVoiceId(settings),
    settings.format.trim(),
    templateFingerprint(settings.bodyTemplate.trim()),
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
  const transport = deps.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));

  /** 配置读不出来时给一份默认：探活与缓存指纹不该因为一个坏配置文件而抛。 */
  function safeSettings(): CloudSettings {
    try {
      return deps.settings();
    } catch {
      return EMPTY_CLOUD_SETTINGS;
    }
  }

  /** 现读密钥（按协议选引用）；凭据库偶发读失败按「没配」处理，不把整句话打断。 */
  async function readKeyOrUndefined(protocol: CloudProtocol): Promise<string | undefined> {
    try {
      return await deps.readKey(protocol);
    } catch {
      return undefined;
    }
  }

  /** 探一次「能不能用」：只看配置与密钥在场，不发请求（TTS 没有免费探活）。 */
  async function refresh(): Promise<boolean> {
    const settings = safeSettings();
    const key = await readKeyOrUndefined(settings.protocol);
    const problems = cloudConfigProblems(settings, typeof key === 'string' && key !== '');
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
    const key = await readKeyOrUndefined(settings.protocol);
    const problems = cloudConfigProblems(settings, typeof key === 'string' && key !== '');
    if (typeof key !== 'string' || key === '') fail(problems.join('；') || MISSING_KEY_REASON);
    if (problems.length > 0) fail(problems.join('；'));

    const label = `${settings.protocol} ${redactURL(cloudBaseURL(settings))}`;
    let request: CloudRequest;
    try {
      request = cloudRequestOf(settings, text, key);
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

    const data = new Uint8Array(await res.arrayBuffer());
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
      `[fish-body] voice cloud: protocol=${settings.protocol} chars=${text.length} ` +
        `bytes=${data.length} mime=${mime} voice=${cloudVoiceId(settings)}`,
    );
    return { data, mime };
  }

  return {
    id: CLOUD_PROVIDER_ID,
    name: '云端语音 TTS（按量计费）',
    // 动态：设置页靠 `required` 画星号，协议一换它就该跟着换，客户端不做协议判断
    get fields() {
      return cloudFieldsFor(safeSettings());
    },
    billable: true,
    availability: () => verdict,
    // 音色是自由文本、没有可枚举的清单，只把「当前这一个」报出来：右键菜单与设置页据此显示在用什么嗓子，
    // 切到别的音色得改接入卡（/voice/provider-voice 只收清单里的值）
    listVoices: (): readonly ProviderVoiceInfo[] => {
      const settings = safeSettings();
      const voice = cloudVoiceId(settings);
      return voice === '' ? [] : [{ id: voice, name: voice, tag: settings.protocol }];
    },
    activeVoice: () => cloudVoiceId(safeSettings()),
    // 指纹进缓存键：换协议/换服务/换模型/换音色都不能命中旧嗓子合成的音频
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
