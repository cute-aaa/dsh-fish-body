/**
 * GSV（GPT-SoVITS api_v2）作为语音回退链的一环：扫描音色、按音色切权重、调 `/tts` 拿 wav。
 *
 * 三件必须成立的事：
 * 1. `availability()` 是**同步**的（链每次合成都现查一次），所以探活结论缓存在这里，
 *    由「注册时探一次 + 每 20s 重探 + 合成失败即标不可用」维护，绝不在里面 await。
 * 2. 权重是**服务端全局状态**：只在新音色的权重与「当前已加载」不同时才调 `/set_*_weights`，
 *    并且切换过程串行化——两条语句同时合成时不能让 A 切到一半被 B 抢走。
 * 3. 产出是 wav 字节，扩展名与 Content-Type 由 speak/audio 那套表推出来，这里不转码。
 * @module dsh-pet/src/host/voice/gsv/provider
 */
import type { AudioClip } from '../audio.ts';
import { VoiceSynthError } from '../edge.ts';
import type { VoiceField, VoiceProvider, VoiceProviderAvailability } from '../registry.ts';
import { gsvHttp, type GsvHttp, type GsvTtsRequest } from './client.ts';
import { gsvMissingFields, type GsvSettings } from './settings.ts';
import { scanGsvVoices, voiceById, weightsTag, type GsvVoice } from './voices.ts';

/** 探活间隔（ms）：本地服务起停都在秒级，20s 足够让菜单在起服务后自动可用。 */
const PROBE_INTERVAL_MS = 20_000;
/** 探活超时（ms）：本机连接失败是立刻的，给 2.5s 只为挡住「端口在接受但服务卡住」。 */
const PROBE_TIMEOUT_MS = 2_500;
/** 单句合成上限（ms）：链上还有 edge 兜底，卡太久不如早点让步。 */
const TTS_TIMEOUT_MS = 60_000;
/** 切权重上限（ms）：加载 148MB ckpt 实测 0.3~0.6s，留足冷启动余量。 */
const WEIGHTS_TIMEOUT_MS = 30_000;
/** 音色目录扫描结果的软过期（ms）：加一个音色包不用重启插件。 */
const SCAN_TTL_MS = 15_000;
/** 语速换算法因子的上下界：与 api_v2 的 `speed_factor` 合理区间一致。 */
const SPEED_MIN = 0.5;
const SPEED_MAX = 2;

/** 造 provider 需要的依赖（`settings` 现读现用，配置改了下一句就生效）。 */
export interface GsvProviderOptions {
  readonly settings: () => GsvSettings;
  readonly log?: { info?(message: string): void; warn?(message: string): void };
  /** HTTP 替身（测试注入）；缺省走真实 fetch。 */
  readonly http?: GsvHttp;
  readonly probeIntervalMs?: number;
  readonly scanTtlMs?: number;
}

/** 对外的 GSV provider：除回退链契约外，额外给路由/设置页提供音色清单与缓存指纹。 */
export interface GsvProvider extends VoiceProvider {
  /** 探活结论（同步读缓存，链每次合成都现查一次）。 */
  availability(): VoiceProviderAvailability;
  /** 当前扫到的音色（带缓存，最多滞后 {@link SCAN_TTL_MS}）。 */
  voices(): readonly GsvVoice[];
  /** 立刻探一次服务；返回是否连通。 */
  refresh(): Promise<boolean>;
  /** 停止后台探活。 */
  dispose(): void;
  /** 当前音色的缓存指纹（换音色/换 epoch 换缓存键）。 */
  cacheTag(): string;
}

/** 语速表达式 `+20%` → `speed_factor` 1.2；解析不了按 1.0（不改速）。 */
function speedFactorOf(rate: string): number {
  const percent = Number(rate.slice(1, -1));
  if (!Number.isFinite(percent)) return 1;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, 1 + percent / 100));
}

/** 配置指纹：任一目录变了就重扫（音色包与权重都是用户在磁盘上加的）。 */
function scanKeyOf(settings: GsvSettings): string {
  return [settings.voicesDir, settings.gptWeightsDir, settings.sovitsWeightsDir, settings.promptLang].join('|');
}

/**
 * 造 GSV provider。注册后立刻后台探一次，之后按间隔重探。
 * @param options - 配置读取器、日志与可注入的 HTTP。
 * @returns provider 本体（含音色清单与 dispose）。
 */
export function createGsvProvider(options: GsvProviderOptions): GsvProvider {
  const http = options.http ?? gsvHttp;
  const log = options.log;
  const probeIntervalMs = options.probeIntervalMs ?? PROBE_INTERVAL_MS;
  const scanTtlMs = options.scanTtlMs ?? SCAN_TTL_MS;
  /** 最近一次探活结论（`availability()` 只能同步读它）。 */
  let verdict: VoiceProviderAvailability = { ok: false, reason: 'GSV 尚未探测' };
  /** 音色扫描缓存。 */
  let scan: { key: string; at: number; voices: readonly GsvVoice[] } | undefined;
  /** 服务端当前已加载的权重（进程内记录：换音色才切，同一音色连说多句不重复切）。 */
  let applied: { gpt?: string; sovits?: string } = {};
  /** 切权重串行链：全局状态不能被两句并发合成交错切换。 */
  let switchQueue: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | undefined;

  /** 当前音色清单（软过期，避免每次合成读一遍目录）。 */
  function currentVoices(): readonly GsvVoice[] {
    const settings = options.settings();
    const key = scanKeyOf(settings);
    const now = Date.now();
    if (scan && scan.key === key && now - scan.at < scanTtlMs) return scan.voices;
    const voices = scanGsvVoices(settings);
    scan = { key, at: now, voices };
    return voices;
  }

  /** 当前生效的音色：配置里指定的那个；没指定就用扫描到的第一个。 */
  function currentVoice(): GsvVoice | undefined {
    const settings = options.settings();
    const voices = currentVoices();
    return voiceById(voices, settings.voice) ?? (settings.voice ? undefined : voices[0]);
  }

  async function refresh(): Promise<boolean> {
    const settings = options.settings();
    const missing = gsvMissingFields(settings);
    if (missing.length > 0) {
      verdict = { ok: false, reason: `GSV 未配置：${missing.join(' / ')}` };
      return false;
    }
    const alive = await http.probe(settings.baseURL, PROBE_TIMEOUT_MS);
    verdict = alive ? { ok: true } : { ok: false, reason: `连不上 ${settings.baseURL}` };
    return alive;
  }

  /**
   * 需要时切权重，并把「已加载」记账。
   *
   * 失败要清账：切到一半失败时服务端可能是旧权重，下一次必须重切，不能因为「记录里写着已加载」
   * 就拿旧嗓子念新音色。
   */
  async function applyWeights(settings: GsvSettings, voice: GsvVoice): Promise<void> {
    const run = switchQueue.then(async () => {
      if (voice.gptWeights && applied.gpt !== voice.gptWeights) {
        await http.setWeights(settings.baseURL, 'gpt', voice.gptWeights, WEIGHTS_TIMEOUT_MS);
        applied = { ...applied, gpt: voice.gptWeights };
        log?.info?.(`[dsh-pet] gsv: 切 GPT 权重 ${voice.gptWeights}`);
      }
      if (voice.sovitsWeights && applied.sovits !== voice.sovitsWeights) {
        await http.setWeights(settings.baseURL, 'sovits', voice.sovitsWeights, WEIGHTS_TIMEOUT_MS);
        applied = { ...applied, sovits: voice.sovitsWeights };
        log?.info?.(`[dsh-pet] gsv: 切 SoVITS 权重 ${voice.sovitsWeights}`);
      }
    });
    switchQueue = run.catch(() => {
      applied = {};
    });
    await run;
  }

  async function synthesize(input: { text: string; rate: string }): Promise<AudioClip> {
    const settings = options.settings();
    const missing = gsvMissingFields(settings);
    if (missing.length > 0) throw new VoiceSynthError(`GSV 未配置：${missing.join(' / ')}`);
    const voice = currentVoice();
    if (!voice) {
      throw new VoiceSynthError(settings.voice ? `GSV 音色不存在：${settings.voice}` : 'GSV 音色未选择');
    }
    await applyWeights(settings, voice);
    const request: GsvTtsRequest = {
      text: input.text,
      textLang: settings.textLang,
      refAudioPath: voice.refAudioPath,
      promptText: voice.refText,
      promptLang: voice.promptLang,
      textSplitMethod: voice.textSplitMethod,
      speedFactor: speedFactorOf(input.rate),
      ...(voice.temperature === undefined ? {} : { temperature: voice.temperature }),
      ...(voice.topK === undefined ? {} : { topK: voice.topK }),
      ...(voice.topP === undefined ? {} : { topP: voice.topP }),
      ...(voice.seed === undefined ? {} : { seed: voice.seed }),
    };
    try {
      const clip = await http.tts(settings.baseURL, request, TTS_TIMEOUT_MS);
      verdict = { ok: true };
      return clip;
    } catch (error) {
      verdict = { ok: false, reason: error instanceof Error ? error.message : String(error) };
      throw error instanceof VoiceSynthError ? error : new VoiceSynthError(String(error));
    }
  }

  const fields: readonly VoiceField[] = [
    { key: 'baseURL', label: 'GSV 服务地址', kind: 'text', placeholder: 'http://127.0.0.1:9880' },
    // 音色不在 fields 里：它是「运行时选谁」，走右键/设置页的音色下拉（/voice/provider-voice），
    // 与「怎么连上这个服务」是两件事；混进表单只会让人手打一个扫不到的 id。
    {
      key: 'voicesDir',
      label: '音色目录',
      kind: 'text',
      required: true,
      placeholder: 'D:/AI/FishChi/voice-local/voices',
    },
    { key: 'gptWeightsDir', label: 'GPT 权重目录', kind: 'text', placeholder: '…/GPT_weights_v2' },
    { key: 'sovitsWeightsDir', label: 'SoVITS 权重目录', kind: 'text', placeholder: '…/SoVITS_weights_v2' },
    { key: 'textLang', label: '合成语种', kind: 'text', placeholder: 'zh' },
    // 启停脚本：只由设置页的「启动 / 停止」按钮触发，插件不会自动跑它们（GPU 加载几十秒，
    // 拖慢 profile 启动；失败还得退避重试，那是另一套机制）。空着就是没有这个能力。
    { key: 'startScript', label: '启动脚本', kind: 'text', placeholder: 'D:/AI/FishChi/voice-local/gsv.bat' },
    { key: 'stopScript', label: '停止脚本', kind: 'text', placeholder: 'D:/AI/FishChi/voice-local/stop.bat' },
  ];

  const provider: GsvProvider = {
    id: 'gsv',
    name: 'GSV（本地 GPT-SoVITS）',
    fields,
    availability: () => verdict,
    synthesize,
    voices: currentVoices,
    refresh,
    cacheTag: () => {
      try {
        const settings = options.settings();
        return weightsTag(currentVoice()) || settings.voice;
      } catch {
        return '';
      }
    },
    listVoices: () =>
      currentVoices().map((voice) => ({
        id: voice.id,
        name: voice.id,
        ...(voice.desc ? { tag: voice.desc } : {}),
      })),
    activeVoice: () => {
      const settings = options.settings();
      return settings.voice || (currentVoice()?.id ?? '');
    },
    dispose: () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };

  void refresh();
  timer = setInterval(() => void refresh(), probeIntervalMs);
  timer.unref?.();
  return provider;
}
