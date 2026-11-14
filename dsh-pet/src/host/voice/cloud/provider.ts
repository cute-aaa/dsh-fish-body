/**
 * 云端 TTS 的**配置骨架**（T3.5）：只声明「接一个云端语音服务需要填什么」与「尚未接入」，
 * 一个网络请求都不发。
 *
 * 为什么先落骨架而不是直接接一家：云端的差异全在协议（OpenAI 兼容 / 各家私有），
 * 而这里真正缺的从来不是代码，是「地址、模型、音色、密钥」这四个值以及它们该存在哪。
 * 把这四项目做成声明式 `fields` 之后，接入具体协议只剩 `synthesize()` 一个函数要写，
 * 设置页与密钥存储一行都不用改。
 *
 * 为什么 `availability()` 恒为假：骨架期一旦让它「可用」，回退链就会把它排在本地语音之前，
 * 每句话都先失败一次再落到下一环——多一次 400、多一行 `link cloud failed`，用户只觉得变慢了。
 * 所以骨架期明确报「尚未接入」，让链直接跳过。
 * @module dsh-fish-body/src/host/voice/cloud/provider
 */
import type { VoiceField, VoiceProvider, VoiceProviderAvailability } from '../registry.ts';

/** 实现 id；参与缓存键，写成 `cloud` 便于日后按服务商拆成 `cloud-openai` 之类。 */
export const CLOUD_PROVIDER_ID = 'cloud';

/**
 * 密钥在 DSH 凭据库里的引用名。
 *
 * 用固定的环境变量式标识而不是「配置里存引用名」：这一项是本插件自己的密钥，不是用户从别处
 * 抄来得引用；固定下来，`credentials set` 与设置页填的是同一个名字，换机器也只需重填一次。
 */
export const CLOUD_API_KEY_REF = 'DSH_FISH_BODY_CLOUD_TTS_KEY';

/** 一段云端配置（全是字符串；密钥不在这里，它在 DSH 凭据库）。 */
export interface CloudSettings {
  /** OpenAI 兼容的接口根地址（末尾不带 `/audio/speech`）。 */
  readonly baseURL: string;
  /** 模型名（服务商定义的标识，如 `tts-1`）。 */
  readonly model: string;
  /** 音色名（服务商定义，如 `alloy`）。 */
  readonly voice: string;
}

/** 全空配置：未配置时的初值。 */
export const EMPTY_CLOUD_SETTINGS: CloudSettings = { baseURL: '', model: '', voice: '' };

/**
 * 云端语音的配置项声明。
 *
 * `apiKey` 是 `password` + `credentialRef`：值不进 `voice-providers.json`，写进 DSH 凭据库
 * （见 `../provider-secrets.ts`）——配置文件会被备份、会被贴进 issue，密钥不该在那里面。
 */
export const CLOUD_FIELDS: readonly VoiceField[] = [
  {
    key: 'baseURL',
    label: '服务地址',
    kind: 'text',
    required: true,
    placeholder: 'https://api.example.com/v1',
    description: 'OpenAI 兼容接口的根地址；骨架期只保存，不会真的请求',
  },
  {
    key: 'model',
    label: '模型',
    kind: 'text',
    required: true,
    placeholder: 'tts-1',
    description: '服务商定义的模型标识',
  },
  {
    key: 'voice',
    label: '音色',
    kind: 'text',
    placeholder: 'alloy',
    description: '服务商定义的音色名；留空表示用服务端默认音色',
  },
  {
    key: 'apiKey',
    label: 'API Key',
    kind: 'password',
    required: true,
    placeholder: 'sk-…',
    credentialRef: CLOUD_API_KEY_REF,
    description: '存进 DSH 凭据库，不写进配置文件',
  },
];

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
 * @returns 三个字符串；缺项为空串（由 {@link cloudMissingFields} 变成一句人话）。
 */
export function cloudSettingsOf(source: unknown): CloudSettings {
  const conf = recordOf(recordOf(source).cloud);
  return { baseURL: str(conf.baseURL), model: str(conf.model), voice: str(conf.voice) };
}

/**
 * 还缺哪些必填项（给人话用的字段名，直接进不可用理由）。
 *
 * @param settings - {@link cloudSettingsOf} 的结果。
 * @returns 缺失字段的配置键（不含密钥：密钥的在场由凭据库回答，不在这份同步快照里）。
 */
export function cloudMissingFields(settings: CloudSettings): string[] {
  const missing: string[] = [];
  if (!settings.baseURL) missing.push('服务地址');
  if (!settings.model) missing.push('模型');
  return missing;
}

/**
 * 造云端语音实现（骨架）。
 *
 * @param opts.settings - 现读配置（改完不必重启插件）。
 * @returns 注册用的实现：`fields` 齐全、`synthesize` 明确抛「尚未接入」。
 */
export function createCloudProvider(opts: { readonly settings: () => CloudSettings }): VoiceProvider {
  return {
    id: CLOUD_PROVIDER_ID,
    name: '云端语音（骨架）',
    fields: CLOUD_FIELDS,
    availability(): VoiceProviderAvailability {
      const missing = cloudMissingFields(opts.settings());
      if (missing.length > 0) return { ok: false, reason: `未配置云端语音：还缺 ${missing.join(' / ')}` };
      // 配置齐了也不放行：放行等于让每句话都先失败一次（见模块头）。
      return { ok: false, reason: '云端 TTS 尚未接入（骨架）：配置已保存，合成会落到本地语音或 edge' };
    },
    async synthesize(): Promise<never> {
      throw new Error('云端 TTS 尚未接入（T3.5 骨架）');
    },
  };
}
