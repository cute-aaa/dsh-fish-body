/**
 * 语音合成的回退链：可用的第三方实现按注册顺序在前，内置 edge 永远收尾。
 *
 * 为什么要有链：一句话念不出来比念得难听更糟。第三方（GSV 这类本地服务）没起、没配 key 或者临时报错时，
 * 直接落到下一环，用户只会听到「换了个嗓子」，而不是弹一句失败。
 * 每一环自带超时与错误归一：超时按失败处理，失败的原样抛 VoiceSynthError 给 speak 决定是否继续。
 * 内置 edge 额外重试一次：它偶发「第一次调用失败」（见 docs 交接-P3 踩坑 23）。
 * 不查缓存、不落盘：那些在 speak.ts。
 * @module dsh-fish-body/src/host/voice/chain
 */
import { synthesize, VoiceSynthError, type SynthInput } from './edge.ts';
import { BUILTIN_VOICE_ID, voiceProviderEntries, type VoiceProvider } from './registry.ts';
import type { AudioClip } from './audio.ts';

/** 第三方实现的单次合成上限（ms）：与内置同口径，避免一句卡住串行队列。 */
const PROVIDER_TIMEOUT_MS = 15_000;
/** 内置 edge 合成的总时限（ms）：依赖自带的 15s 只是「静默」超时，每来一帧就重置，不能当总时限用。 */
const BUILTIN_TIMEOUT_MS = 28_000;
/** 内置实现的尝试次数：上游偶发首连失败，重试一次基本必成。 */
const BUILTIN_ATTEMPTS = 2;

/** 一环合成用的输入：音色只对内置实现有意义，第三方自己决定嗓子。 */
export interface VoiceChainInput {
  readonly text: string;
  readonly rate: string;
  readonly voice: string;
}

/** 链上的一环：谁（id）、怎么合成。 */
export interface VoiceChainLink {
  /** 实现 id；参与缓存键。 */
  readonly id: string;
  /** 是否内置实现（内置没有音色/配置概念，缓存键里音色置空）。 */
  readonly builtin: boolean;
  /** 当前嗓子的指纹（第三方换音色/换权重后会变）；内置实现为空串。 */
  readonly timbre: string;
  /**
   * 合成一段音频（已含超时与错误归一）。
   *
   * @param input - 文本与语速。
   * @returns 音频字节与 MIME。
   * @throws {VoiceSynthError} 超时、上游失败或返回空音频时。
   */
  synthesize(input: VoiceChainInput): Promise<AudioClip>;
}

/** 给一个 Promise 套超时；超时 reject，原 Promise 不被取消（provider 自己该处理放弃）。 */
function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('voice provider timed out')), timeoutMs);
    timer.unref?.();
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** 取一个实现的嗓子指纹；它自己抛错只当「没有指纹」，不能让缓存键算不出来。 */
function timbreOf(provider: VoiceProvider): string {
  try {
    return provider.cacheTag?.() ?? '';
  } catch {
    return '';
  }
}

/** 把第三方实现包成链环：超时与错误都归一到 {@link VoiceSynthError}。 */
function providerLink(provider: VoiceProvider): VoiceChainLink {
  return {
    id: provider.id,
    builtin: false,
    timbre: timbreOf(provider),
    synthesize: async (input) => {
      try {
        return await withTimeout(provider.synthesize({ text: input.text, rate: input.rate }), PROVIDER_TIMEOUT_MS);
      } catch (error) {
        throw new VoiceSynthError(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

/** 内置 edge 的链环：带总时限，失败重试一次。 */
function builtinLink(impl: (input: SynthInput) => Promise<AudioClip>): VoiceChainLink {
  return {
    id: BUILTIN_VOICE_ID,
    builtin: true,
    timbre: '',
    synthesize: async (input) => {
      let last: unknown;
      for (let attempt = 0; attempt < BUILTIN_ATTEMPTS; attempt += 1) {
        try {
          return await impl({ ...input, signal: AbortSignal.timeout(BUILTIN_TIMEOUT_MS) });
        } catch (error) {
          last = error;
        }
      }
      throw last instanceof VoiceSynthError ? last : new VoiceSynthError(String(last));
    },
  };
}

/**
 * 造当前的合成链。
 *
 * @param builtin - 内置实现的替身（测试注入）；缺省是真实的 edge。
 * @returns 可用第三方（注册顺序）→ 内置实现；至少总有一环。
 */
export function voiceChain(builtin: (input: SynthInput) => Promise<AudioClip> = synthesize): VoiceChainLink[] {
  const external = voiceProviderEntries()
    .filter((entry) => entry.available)
    .map((entry) => providerLink(entry.provider));
  return [...external, builtinLink(builtin)];
}

/**
 * 链上第一环的 id（缓存键与日志用它）。
 *
 * @param chain - {@link voiceChain} 的结果。
 * @returns 首个实现 id；空链不该出现（内置恒在），兜底返回内置 id。
 */
export function headVoiceId(chain: readonly VoiceChainLink[]): string {
  return chain[0]?.id ?? BUILTIN_VOICE_ID;
}
