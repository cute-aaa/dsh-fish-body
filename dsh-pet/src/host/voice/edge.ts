/**
 * edge 在线语音的封装：按需加载 @andresaya/edge-tts 拿 mp3，把任何失败收敛成一个错误类型。
 *
 * 依赖在真正合成时才 import：语音是可选能力，包缺失只能让这一次合成失败，不能把整个插件
 * 卡在启动阶段（插件加载期缺一个可选依赖 → 宿主判定必需插件未激活 → 整个 DSH 启动失败）。
 * 用动态 import 而不是 createRequire：应用产物把依赖内联进单文件（tsdown 的 noExternal），
 * 打包器只跟踪静态可见的 import；放在 try 里，缺包时照样只失败这一次。
 * SSML 拼装、XML 转义、WebSocket 与 DRM 令牌都由依赖负责——它**已经做了转义**，本模块传
 * 原文即可，再转一次会把 `&` 念成「amp」。协议变动时只需升级依赖，这里不改代码。
 * 不负责缓存、队列与落盘：本模块只保证「给定文本 → 一段 mp3 字节 + MIME」这一件事
 * （落盘与扩展名归 speak.ts，见 voice/audio.ts 的契约）。
 * @module dsh-pet/src/host/voice/edge
 */
import { DEFAULT_AUDIO_MIME, type AudioClip } from './audio.ts';

/** 依赖的模块形状：运行时代码只出现在按需 import 处。 */
type EdgeTtsModule = typeof import('@andresaya/edge-tts');

/** 单次合成超时（ms）：上游长时间无响应就判失败，不拖住串行队列。 */
const SYNTHESIS_TIMEOUT_MS = 15_000;

/** 合成失败：上层据此回 `generate-error`，不区分上游细节。 */
export class VoiceSynthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceSynthError';
  }
}

/** 合成一次需要的参数。 */
export interface SynthInput {
  /** 已通过长度与空白校验的文本，原样交给依赖（转义由它负责）。 */
  readonly text: string;
  /** 白名单内的音色 id。 */
  readonly voice: string;
  /** prosody rate 表达式，如 `+0%`。 */
  readonly rate: string;
  /** 总时限：依赖自带的 timeout 只是「静默」超时（每帧重置），真正的总上限要靠这个信号。 */
  readonly signal?: AbortSignal;
}

/**
 * 把一段文本合成为 mp3 字节。
 *
 * @param input - 文本、音色、语速与总时限。
 * @returns 音频字节与 MIME（内置实现恒为 `audio/mpeg`）。
 * @throws {VoiceSynthError} 上游失败、超时或返回空音频时。
 */
export async function synthesize({ signal, text, voice, rate }: SynthInput): Promise<AudioClip> {
  try {
    // 按需加载：包缺失时这里抛 MODULE_NOT_FOUND，由下面统一归成 VoiceSynthError。
    // CJS 包经 dynamic import 后可能只露 default，两种形状都认。
    const mod = (await import('@andresaya/edge-tts')) as EdgeTtsModule & { default?: EdgeTtsModule };
    const EdgeTTS = mod.EdgeTTS ?? mod.default?.EdgeTTS;
    if (!EdgeTTS) throw new VoiceSynthError('依赖未导出 EdgeTTS');
    const tts = new EdgeTTS();
    const result = await tts.generate(text, voice, { rate, signal, timeout: SYNTHESIS_TIMEOUT_MS });
    const data = new Uint8Array(result.audio);
    if (data.length === 0) throw new VoiceSynthError('edge 返回空音频');
    return { data, mime: DEFAULT_AUDIO_MIME };
  } catch (error) {
    throw new VoiceSynthError(error instanceof Error ? error.message : String(error));
  }
}
