/**
 * GSV（GPT-SoVITS api_v2）作为语音回退链的一环：扫描音色、按音色切权重、调 `/tts` 拿 wav。
 *
 * 三件必须成立的事：
 * 1. `availability()` 是**同步**的（链每次合成都现查一次），所以探活结论缓存在这里，
 *    由「注册时探一次 + 每 20s 重探 + 合成失败即标不可用」维护，绝不在里面 await。
 * 2. 权重是**服务端全局状态**：只在新音色的权重与「当前已加载」不同时才调 `/set_*_weights`，
 *    并且切换过程串行化——两条语句同时合成时不能让 A 切到一半被 B 抢走。
 * 3. 产出是 wav 字节，扩展名与 Content-Type 由 speak/audio 那套表推出来，这里不转码。
 *
 * 音色口径：清单来自**音色包目录**（`voices.ts`，一个子目录一个音色，权重是真文件），
 * 缺权重/缺参考音频的音色**仍然列出**，只是不可合成并带 `reason`——设置页与右键菜单据此置灰，
 * 用户能看见「差哪一份文件」。音色目录由「导入音色」流程造出来，不再有第二、第三个扫描源。
 * 另外记一件事：合成失败的原因留在 `lastError()` 里。回退链的设计是「静默落到 edge」，
 * 用户只会觉得「换了个嗓子」，所以「服务通着却念不出来」必须有一处能看见（设置页接入卡显示它）。
 * @module dsh-fish-body/src/host/voice/gsv/provider
 */
import type { AudioClip } from '../audio.ts';
import { VoiceSynthError } from '../edge.ts';
import type { VoiceField, VoiceProvider, VoiceProviderAvailability } from '../registry.ts';
import { gsvHttp, type GsvHttp, type GsvTtsRequest } from './client.ts';
import { gsvMissingFields, type GsvSettings } from './settings.ts';
import { scanGsvVoiceLibrary, voiceById, voiceTag, weightsTag, type GsvVoice, type GsvVoiceScan } from './voices.ts';

/** 探活间隔（ms）：本地服务起停都在秒级，20s 足够让菜单在起服务后自动可用。 */
const PROBE_INTERVAL_MS = 20_000;
/** 探活超时（ms）：本机连接失败是立刻的，给 2.5s 只为挡住「端口在接受但服务卡住」。 */
const PROBE_TIMEOUT_MS = 2_500;
/** 单句合成上限（ms）：链上还有 edge 兜底，卡太久不如早点让步。 */
const TTS_TIMEOUT_MS = 60_000;
/**
 * 切权重上限（ms）：同版本加载 ckpt 实测 0.3~0.6s，但跨版本（v2 ↔ v5turbo）会重载
 * BERT/HuBERT 与整条推理管线，实测到十几秒；留足冷启动余量。
 */
const WEIGHTS_TIMEOUT_MS = 120_000;
/** 音色目录扫描结果的软过期（ms）：加一个音色/权重不用重启插件。 */
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
  /** 扫到的全部音色（含不可合成的，带 `reason`；最多滞后 {@link SCAN_TTL_MS}）。 */
  voices(): readonly GsvVoice[];
  /** 扫描诊断（来源计数、目录缺失、版本错配、回落说明）。 */
  notes(): readonly string[];
  /** 立刻探一次服务；返回是否连通。 */
  refresh(): Promise<boolean>;
  /** 丢掉扫描缓存后重扫 + 重探（导入参考/改了目录后立刻生效）。 */
  rescan(): Promise<boolean>;
  /** 停止后台探活。 */
  dispose(): void;
  /** 当前音色的缓存指纹（换音色/换 epoch/换参考文本换缓存键）。 */
  cacheTag(): string;
  /**
   * 最近一次合成失败的原因；合成成功即清空。
   *
   * 「连得通但念不出来」（参考音频坏了、服务端 stdout 失效让 `/tts` 400）在回退链里只会表现为
   * 「换了嗓子」——这句话是唯一能让人看见它出在哪的地方。
   */
  lastError(): string | undefined;
}

/** 语速表达式 `+20%` → `speed_factor` 1.2；解析不了按 1.0（不改速）。 */
function speedFactorOf(rate: string): number {
  const percent = Number(rate.slice(1, -1));
  if (!Number.isFinite(percent)) return 1;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, 1 + percent / 100));
}

/** 配置指纹：目录或语种变了就重扫（音色包里的文件是用户在磁盘上加的，靠 TTL 兜）。 */
function scanKeyOf(settings: GsvSettings): string {
  return [settings.voicesDir, settings.textLang, settings.promptLang].join('|');
}

/**
 * 造 GSV provider。注册后立刻后台探一次，之后按间隔重探。
 * @param options - 配置读取器、日志与可注入的 HTTP。
 * @returns provider 本体（含音色清单、诊断与 dispose）。
 */
export function createGsvProvider(options: GsvProviderOptions): GsvProvider {
  const http = options.http ?? gsvHttp;
  const log = options.log;
  const probeIntervalMs = options.probeIntervalMs ?? PROBE_INTERVAL_MS;
  const scanTtlMs = options.scanTtlMs ?? SCAN_TTL_MS;
  /** 最近一次探活结论（`availability()` 只能同步读它）。 */
  let verdict: VoiceProviderAvailability = { ok: false, reason: 'GSV 尚未探测' };
  /** 上一轮**探活**是否通过：用来区分「探活失败」与「探活通着但合成失败」，两者的清理条件不同。 */
  let probedOk = false;
  /** 最近一次合成失败的原因（给设置页看的警告）；合成成功即清空。 */
  let lastError: string | undefined;
  /** 音色扫描缓存（含诊断）。 */
  let scan: { key: string; at: number; library: GsvVoiceScan } | undefined;
  /** 配置里的音色扫不到/不可用时的回落说明（只保留本轮的那一条）。 */
  let fallbackNote: string | undefined;
  /** 服务端当前已加载的权重（进程内记录：换音色才切，同一音色连说多句不重复切）。 */
  let applied: { gpt?: string; sovits?: string } = {};
  /** 切权重串行链：全局状态不能被两句并发合成交错切换。 */
  let switchQueue: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | undefined;

  /** 当前扫描结果（软过期，避免每次合成读一遍目录）。 */
  function currentLibrary(): GsvVoiceScan {
    const settings = options.settings();
    const key = scanKeyOf(settings);
    const now = Date.now();
    if (scan && scan.key === key && now - scan.at < scanTtlMs) return scan.library;
    const library = scanGsvVoiceLibrary(settings);
    scan = { key, at: now, library };
    return library;
  }

  /** 全部候选音色（含不可用）。 */
  function voices(): readonly GsvVoice[] {
    return currentLibrary().voices;
  }

  /** 能真的交给 `/tts` 的音色。 */
  function synthesizable(): GsvVoice[] {
    return voices().filter((voice) => voice.available);
  }

  /**
   * 本次合成用哪个音色：配置项优先；它不可用（或没扫到）时回落第一个可合成音色并留一句说明。
   *
   * 为什么允许回落：链上还有 edge 兜底，让整句失败只会让用户听不到本地音色；
   * 而「换了嗓子」这件事写进设置页的 notes，用户看得到，不会以为配置生效了。
   */
  function resolveVoice(): GsvVoice | undefined {
    const settings = options.settings();
    const wanted = settings.voice;
    const usable = synthesizable();
    if (wanted) {
      const hit = voiceById(voices(), wanted);
      if (hit?.available) {
        fallbackNote = undefined;
        return hit;
      }
      const fallback = usable[0];
      fallbackNote = fallback
        ? hit
          ? `音色「${wanted}」不可用（${hit.reason ?? '未知原因'}），已改用「${fallback.id}」`
          : `配置的音色「${wanted}」没有扫到，已改用「${fallback.id}」`
        : `配置的音色「${wanted}」不可用：${hit?.reason ?? '没有扫到，且没有其他可合成音色'}`;
      return fallback;
    }
    fallbackNote = undefined;
    return usable[0];
  }

  /** 设置页要看的诊断：扫描诊断 + 本轮的回落说明。 */
  function notes(): readonly string[] {
    const list = [...currentLibrary().notes];
    if (fallbackNote) list.push(fallbackNote);
    return list;
  }

  async function refresh(): Promise<boolean> {
    const settings = options.settings();
    const missing = gsvMissingFields(settings);
    if (missing.length > 0) {
      verdict = { ok: false, reason: `GSV 未配置：${missing.join(' / ')}` };
      probedOk = false;
      return false;
    }
    const alive = await http.probe(settings.baseURL, PROBE_TIMEOUT_MS);
    // 探活从「不通」回到「通」= 服务被重起过，上一轮合成失败的理由（进程状态）不再作数。
    // 反过来「探活一直通着、只是合不出来」（例如服务端 stdout 失效让 /tts 400）**不能**清——
    // 那句话正是要给用户看的，探活永远通也修不好它。
    if (alive && !probedOk) lastError = undefined;
    probedOk = alive;
    if (!alive) {
      verdict = { ok: false, reason: `连不上 ${settings.baseURL}` };
      return false;
    }
    // 服务通着却一个能合成都列不出来：直接判不可用并说清缺什么，别让每句话都失败一次再落到 edge。
    const library = currentLibrary();
    const ready = library.voices.find((voice) => voice.available);
    verdict = ready
      ? { ok: true }
      : { ok: false, reason: library.notes[0] ?? 'GSV 没有可合成的音色（音色包目录里缺权重或参考音频）' };
    return ready !== undefined;
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
        log?.info?.(`[fish-body] gsv: 切 GPT 权重 ${voice.gptWeights}`);
      }
      if (voice.sovitsWeights && applied.sovits !== voice.sovitsWeights) {
        await http.setWeights(settings.baseURL, 'sovits', voice.sovitsWeights, WEIGHTS_TIMEOUT_MS);
        applied = { ...applied, sovits: voice.sovitsWeights };
        log?.info?.(`[fish-body] gsv: 切 SoVITS 权重 ${voice.sovitsWeights}`);
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
    const voice = resolveVoice();
    if (!voice) {
      throw new VoiceSynthError(notes()[0] ?? 'GSV 没有可合成的音色');
    }
    if (!voice.refAudioPath) throw new VoiceSynthError(`GSV 音色「${voice.id}」缺少参考音频`);
    await applyWeights(settings, voice);
    const request: GsvTtsRequest = {
      text: input.text,
      textLang: settings.textLang,
      refAudioPath: voice.refAudioPath,
      promptText: voice.refText,
      promptLang: voice.promptLang,
      // 切句法：音色包不再逐音色声明，统一按标点切（`cut5`）；采样参数交给 api_v2 的默认值。
      textSplitMethod: 'cut5',
      speedFactor: speedFactorOf(input.rate),
    };
    try {
      const clip = await http.tts(settings.baseURL, request, TTS_TIMEOUT_MS);
      verdict = { ok: true };
      lastError = undefined;
      return clip;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      verdict = { ok: false, reason: message };
      // 记下来给设置页看：链会自动重试（20s 后探活翻回来），用户耳朵里只会听到换了嗓子。
      lastError = message;
      throw error instanceof VoiceSynthError ? error : new VoiceSynthError(message);
    }
  }

  const fields: readonly VoiceField[] = [
    {
      key: 'baseURL',
      label: 'GSV 服务地址',
      kind: 'text',
      required: true,
      placeholder: 'http://127.0.0.1:9880',
      description: 'api_v2 的根地址；原生 GPT-SoVITS 的 api_v2.py 默认监听 9880。',
    },
    // 音色不在 fields 里：它是「运行时选谁」，走右键/设置页的音色下拉（/voice/provider-voice），
    // 与「怎么连上这个服务」是两件事；混进表单只会让人手打一个扫不到的 id。
    {
      key: 'voicesDir',
      label: '音色包目录',
      kind: 'text',
      placeholder: 'D:/AI/GSV-voices',
      description: [
        '每个子目录 = 一个音色（导入时自动生成），清单与音色来源都以这里为准。',
        '<id>/',
        '  ref.wav        参考音频（也可 <id>.wav 或目录里唯一的音频；3–10 秒最稳）',
        '  ref.txt        参考文本（也可 <id>.txt 或目录里唯一的 .txt；缺省 = 零样本）',
        '  *.ckpt         GPT 权重（引用 = 硬链接，或复制）',
        '  *.pth          SoVITS 权重（同上）',
      ].join('\n'),
    },
    { key: 'textLang', label: '合成语种', kind: 'text', placeholder: 'zh', description: 'api_v2 的 text_lang，必填。' },
    {
      key: 'promptLang',
      label: '参考文本语种',
      kind: 'text',
      placeholder: 'zh',
      description: 'api_v2 的 prompt_lang，必填（全局生效，音色包里不再逐音色覆盖）。',
    },
    // 启停脚本：只由设置页的「启动 / 停止」按钮触发，插件不会自动跑它们（GPU 加载几十秒，
    // 拖慢 profile 启动；失败还得退避重试，那是另一套机制）。空着就是没有这个能力。
    { key: 'startScript', label: '启动脚本', kind: 'text', placeholder: 'D:/AI/GSV/start-gsv.bat' },
    {
      key: 'stopScript',
      label: '停止脚本（可选）',
      kind: 'text',
      placeholder: '留空则用 api_v2 的 /control?command=exit',
    },
  ];

  const provider: GsvProvider = {
    id: 'gsv',
    name: 'GSV（GPT-SoVITS api_v2）',
    fields,
    availability: () => verdict,
    synthesize,
    lastError: () => lastError,
    voices,
    notes,
    refresh,
    rescan: async () => {
      // 清扫描缓存：新导入的音色不能等 15s 软过期，菜单必须马上看得见。
      scan = undefined;
      return refresh();
    },
    cacheTag: () => {
      try {
        return weightsTag(resolveVoice());
      } catch {
        return '';
      }
    },
    listVoices: () =>
      voices().map((voice) => ({
        id: voice.id,
        name: voice.id,
        ...(voiceTag(voice) ? { tag: voiceTag(voice) } : {}),
        available: voice.available,
        ...(voice.reason === undefined ? {} : { reason: voice.reason }),
      })),
    activeVoice: () => {
      try {
        return resolveVoice()?.id ?? '';
      } catch {
        return '';
      }
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
