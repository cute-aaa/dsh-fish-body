/**
 * 云端 TTS：DeepSeek 的 `POST /v1/tools/tts`，**按量计费，不进自动回退链**。
 *
 * 为什么不进链：链的语义是「自动挑一个能出声的实现」。云端按字符收钱，混进链里等于在本地服务
 * 没起时静默花用户的钱。所以它标 `billable: true`，只有用户在设置页打开「使用云端语音」时，
 * 才由 `speak.ts` 通过 `voiceChainWithPreferred` 排到链首；失败后可回落免费链（失败请求不计费）。
 *
 * 为什么字段里没有「模型」：DeepSeek TTS 没有 model 参数（音色由 `voice_id` 决定），
 * 留着它只会永远判「缺必填」。语速同理——接口不支持，`rate` 被忽略，说明写在字段描述里。
 *
 * `availability()` 必须同步（链每次合成都现查一次），而密钥在凭据库要异步读，
 * 所以沿用 GSV 的做法：探活结论缓存在 `verdict` 里，由 `refresh()` 异步更新。
 * 探活**不发网络请求**——TTS 没有廉价 ping，拿一句话去试就等于花钱。
 * @module dsh-fish-body/src/host/voice/cloud/provider
 */
import type { VoiceField, VoiceProvider, VoiceProviderAvailability, ProviderVoiceInfo } from '../registry.ts';
import type { AudioClip } from '../audio.ts';

/** 实现 id；参与缓存键，写成 `cloud` 便于日后按服务商拆成 `cloud-openai` 之类。 */
export const CLOUD_PROVIDER_ID = 'cloud';

/**
 * 密钥在 DSH 凭据库里的引用名。
 *
 * 用固定的环境变量式标识而不是「配置里存引用名」：这一项是本插件自己的密钥，不是用户从别处
 * 抄来得引用；固定下来，`credentials set` 与设置页填的是同一个名字，换机器也只需重填一次。
 */
export const CLOUD_API_KEY_REF = 'DSH_FISH_BODY_CLOUD_TTS_KEY';

/**
 * 主引用没值时复用的宿主凭据（DSH 自己的 DeepSeek provider 用的就是它）。
 *
 * 只读：保存与清除永远只动 {@link CLOUD_API_KEY_REF}，否则用户在设置页点一次「清除」
 * 就会顺手删掉整个 DSH 的模型凭据。
 */
export const CLOUD_API_KEY_FALLBACK = 'DEEPSEEK_API_KEY';

/** 官方接口根地址；`baseURL` 留空时用它。 */
export const DEFAULT_CLOUD_BASE_URL = 'https://api.deepseek.com';

/** 合成路径（相对根地址，固定）。 */
const TTS_PATH = '/v1/tools/tts';

/** 单次合成超时（ms）：链外层给 15s，这里留出收尾余量。 */
const REQUEST_TIMEOUT_MS = 12_000;

/** 服务端错误文案的截断长度：只留够定位的一句话，不把整页 HTML 灌进日志。 */
const MAX_ERROR_DETAIL = 512;

/** 一个合法 wav 头的最小字节数；比它还短说明返回了空壳。 */
const MIN_WAV_BYTES = 44;

/** 主引用没值、需要密钥时的人话。 */
const MISSING_KEY_REASON = `未配置 API Key（可复用 ${CLOUD_API_KEY_FALLBACK}）`;

/** 这个实现能念的音色（设置页下拉的选项）。 */
const CLOUD_VOICES: readonly ProviderVoiceInfo[] = [
  { id: 'stella', name: 'stella 海星', tag: '女声（默认）' },
  { id: 'tide', name: 'tide 暗潮', tag: '男声' },
];

/** 一段云端配置（全是字符串/布尔；密钥不在这里，它在 DSH 凭据库）。 */
export interface CloudSettings {
  /** 接口根地址（末尾不带 `/v1/tools/tts`）；空串按官方默认。 */
  readonly baseURL: string;
  /** 音色 id（`stella` / `tide`）；非法值按默认音色处理。 */
  readonly voice: string;
  /** 用户是否显式开启（按量计费的总开关）；关着时它完全不参与合成。 */
  readonly useCloud: boolean;
}

/** 全空配置：未配置时的初值（地址留空 = 用官方默认）。 */
export const EMPTY_CLOUD_SETTINGS: CloudSettings = { baseURL: '', voice: '', useCloud: false };

/**
 * 云端语音的配置项声明。
 *
 * `apiKey` 是 `password` + `credentialRef`：值不进 `voice-providers.json`，写进 DSH 凭据库
 * （见 `../provider-secrets.ts`）——配置文件会被备份、会被贴进 issue，密钥不该在那里面。
 * `credentialFallbacks` 让它能直接复用宿主已有的 DeepSeek 凭据，省一次粘贴。
 */
export const CLOUD_FIELDS: readonly VoiceField[] = [
  {
    key: 'useCloud',
    label: '使用云端语音',
    kind: 'select',
    options: ['off', 'on'],
    description:
      '开启后每句都请求 DeepSeek 并按字符计费（汉字算 2 字符，每万字符 3 元、限时 1.5 元）；' +
      '它不参与自动回退，但自己失败时会回落本地免费语音',
  },
  {
    key: 'baseURL',
    label: '服务地址',
    kind: 'text',
    placeholder: DEFAULT_CLOUD_BASE_URL,
    description: '接口根地址，路径固定 /v1/tools/tts；留空用官方地址',
  },
  {
    key: 'voice',
    label: '音色',
    kind: 'select',
    options: ['stella', 'tide'],
    description: 'stella 海星女声（默认）/ tide 暗潮男声；该接口不支持调节语速，语速滑块对它无效',
  },
  {
    key: 'apiKey',
    label: 'API Key',
    kind: 'password',
    required: true,
    placeholder: 'sk-…',
    credentialRef: CLOUD_API_KEY_REF,
    credentialFallbacks: [CLOUD_API_KEY_FALLBACK],
    description: `存进 DSH 凭据库，不写进配置文件；本机已有 ${CLOUD_API_KEY_FALLBACK} 时可直接复用`,
  },
];

/** 造这个实现的依赖（测试注入假 fetch，单测不打真网）。 */
export interface CloudProviderDeps {
  /** 现读配置（改完不必重启插件）。 */
  settings(): CloudSettings;
  /** 按主引用 → 回退引用取密钥；没有时回 undefined。每次合成现读，不缓存值。 */
  readKey(): Promise<string | undefined>;
  /** 传输层替身；缺省用全局 fetch。 */
  fetch?: typeof fetch;
  /** 留痕；不传则静默。 */
  log?: { info?(message: string): void; warn?(message: string): void };
}

/** 把一个 unknown 当对象看；不是对象就当空对象（配置被写坏时不炸）。 */
function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 取字符串字段并 trim；非字符串一律当空串。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 从 `voice-providers.json` 的解析结果里取云端设置。
 *
 * @param source - 整个 provider 配置对象（`{ cloud: {...} }`），可以是 undefined。
 * @returns 三个值；缺项给空串 / false（由 {@link cloudConfigured} 变成一句人话）。
 */
export function cloudSettingsOf(source: unknown): CloudSettings {
  const conf = recordOf(recordOf(source).cloud);
  return { baseURL: str(conf.baseURL), voice: str(conf.voice), useCloud: str(conf.useCloud) === 'on' };
}

/** 生效的接口根地址：留空用官方默认，末尾斜杠去掉（否则拼出 `//v1/tools/tts`）。 */
export function cloudBaseURL(settings: CloudSettings): string {
  const raw = settings.baseURL.trim();
  return (raw === '' ? DEFAULT_CLOUD_BASE_URL : raw).replace(/\/+$/, '');
}

/** 生效的音色 id：只认 stella / tide，其它一律按默认（服务端认不出别的东西）。 */
export function cloudVoiceId(settings: CloudSettings): string {
  return settings.voice === 'tide' ? 'tide' : 'stella';
}

/** 根地址是否像话（写个非 URL 进去，请求必然失败而界面看不出原因）。 */
function baseURLValid(settings: CloudSettings): boolean {
  return /^https?:\/\//i.test(cloudBaseURL(settings));
}

/**
 * 读服务端错误详情：优先取 `error.message`，非 JSON 就截断原样。
 *
 * @param res - 非 2xx 的响应。
 * @returns 一段可直接进日志与人话的文案。
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

  /** 探一次「能不能用」：只看配置，不发请求（TTS 没有免费探活）。 */
  async function refresh(): Promise<boolean> {
    const settings = safeSettings();
    if (!baseURLValid(settings)) {
      verdict = { ok: false, reason: '服务地址必须以 http:// 或 https:// 开头' };
      return false;
    }
    let key: string | undefined;
    try {
      key = await deps.readKey();
    } catch {
      key = undefined;
    }
    const ready = typeof key === 'string' && key !== '';
    verdict = ready ? { ok: true } : { ok: false, reason: MISSING_KEY_REASON };
    if (ready) lastError = undefined;
    return ready;
  }

  /** 真合成一次：文本 → wav 字节。 */
  async function synthesizeOnce(text: string): Promise<AudioClip> {
    const settings = safeSettings();
    const key = await deps.readKey();
    if (typeof key !== 'string' || key === '') {
      lastError = MISSING_KEY_REASON;
      throw new Error(`cloud tts: ${MISSING_KEY_REASON}`);
    }
    const body = {
      text,
      voice_id: cloudVoiceId(settings),
      // 只收 wav / pcm；pcm 是裸流（无容器），缓存与播放链路都认不了，所以只要 wav
      format: 'wav',
      // 台词里常带 markdown 强调符，念出来是「星号」；交给服务端在合成前摘掉
      filter_markdown: true,
    };
    let res: Response;
    try {
      res = await transport(cloudBaseURL(settings) + TTS_PATH, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      lastError = `请求失败：${detail}`;
      throw new Error(`cloud tts 请求失败：${detail}`, { cause: error });
    }
    if (!res.ok) {
      const detail = await readErrorDetail(res);
      lastError = `${res.status}：${detail}`;
      throw new Error(`cloud tts ${res.status}: ${detail}`);
    }
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.length < MIN_WAV_BYTES) {
      lastError = '返回的音频为空';
      throw new Error('cloud tts: 返回的音频为空');
    }
    lastError = undefined;
    deps.log?.info?.(
      `[fish-body] voice cloud: chars=${text.length} bytes=${data.length} voice=${cloudVoiceId(settings)}`,
    );
    return { data, mime: 'audio/wav' };
  }

  return {
    id: CLOUD_PROVIDER_ID,
    name: 'DeepSeek 云端语音（按量计费）',
    fields: CLOUD_FIELDS,
    billable: true,
    availability: () => verdict,
    listVoices: () => CLOUD_VOICES,
    activeVoice: () => cloudVoiceId(safeSettings()),
    // 指纹进缓存键：换音色不该命中旧嗓子合成的音频
    cacheTag: () => cloudVoiceId(safeSettings()),
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
