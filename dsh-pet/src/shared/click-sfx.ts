/**
 * 点击音效播放器：常热 WebAudio + 预解码，只为让首声不丢音头。
 *
 * 素材 click-duck.wav 的攻击段压在 t=0，没有任何前置静音；`<audio>` 每次播放都伴随一次输出流
 * 冷启动，被丢掉的 60–100ms 正好是这一声的起头。这里让常驻 AudioContext 保持设备流打开、
 * 素材解码一次缓存成 AudioBuffer，每次点击只新建 BufferSource，起点精确到样本 0。
 * WebAudio 不可用、上下文迟迟起不来或还没解码完时回退到 `<audio>`（旧行为），失败一律静默。
 * 单例：web 端全页一份、桌面端一窗一份；连点节流在这里统一收口。
 * @module dsh-pet/src/shared/click-sfx
 */

/** 音量缺省值：与其余提示音同一档，不抢对话内容。 */
const DEFAULT_VOLUME = 0.5;
/** 节流缺省值：100ms 内只响一次，连点不变成噪音。 */
const DEFAULT_THROTTLE_MS = 100;
/** 素材上限：正常 30KB；超过说明给错了文件，直接走回退。 */
const MAX_SFX_BYTES = 1024 * 1024;
/** 等上下文恢复的上限：超时就不再等，用回退路径补这一声。 */
const RESUME_WAIT_MS = 120;

/** 播放参数。 */
export interface ClickSfxOptions {
  /** 素材地址；变了就丢掉旧的解码结果。 */
  readonly url: string;
  /** 音量 0–1，缺省 0.5。 */
  readonly volume?: number;
  /** 连点节流窗口（毫秒），缺省 100。 */
  readonly throttleMs?: number;
}

/** 生效中的参数：可选值已填默认，播放路径不必再兜。 */
interface ResolvedClickSfx {
  readonly url: string;
  readonly volume: number;
  readonly throttleMs: number;
}

/** 已经生效的播放参数；开关打开前为空，此时点击一律不响。 */
let options: ResolvedClickSfx | null = null;
/** 点击音效开关；成品配置未加载前保守静音。 */
let sfxEnabled = false;
/** 唯一 WebAudio 上下文；建不起来就一直为 null（只剩回退路径）。 */
let context: AudioContext | null = null;
/** 解码好的素材；null 表示还没好，此时点击走回退。 */
let decoded: AudioBuffer | null = null;
/** 正在进行的解码，避免连点触发多次 fetch。 */
let decoding: Promise<void> | null = null;
/** 解码失败过就不再试，免得每次点击都打一次坏请求。 */
let decodeFailed = false;
/** 上一次真正播放的时间戳（ms）。 */
let lastPlayAt = 0;
/** 回退路径复用的 `<audio>` 元素。 */
let fallbackAudio: HTMLAudioElement | null = null;
/** 已经打过的那条路径日志；配置反复刷新时不重复打。 */
let loggedPath = '';
/** 是否挂了上下文自愈监听。 */
let resumeBound = false;

/**
 * 打开或关闭点击音效；打开时顺带预热播放器。
 *
 * @param enabled - 成品配置里的 `clickSoundEnabled`。
 * @param nextOptions - 素材地址、音量与节流；关闭时可以省略。
 */
export function setClickSfxEnabled(enabled: boolean, nextOptions?: ClickSfxOptions): void {
  sfxEnabled = enabled;
  if (!enabled) {
    suspendContext();
    return;
  }
  if (nextOptions !== undefined) applyOptions(nextOptions);
  const audio = ensureContext();
  if (audio === null) {
    logPath('fallback');
    return;
  }
  // 自动播放策略拦着的上下文一开始是 suspended：这里 resume 不受手势限制，可能在页面收到
  // 第一个手势后才真正兑现。兑现前点击会走「先 resume 再起播」或回退路径，都不会静默丢声。
  if (audio.state !== 'running') void audio.resume().catch(() => {});
  if (options !== null) startDecode(audio, options.url);
  logPath('web-audio');
}

/**
 * 播放点击音效。
 *
 * @returns 这一下是否真的发起了播放（开关关闭、节流中、素材未就绪且无回退能力时为 `false`）。
 */
export function playClickSfx(): boolean {
  const current = options;
  if (!sfxEnabled || current === null) return false;
  const now = Date.now();
  if (now - lastPlayAt < current.throttleMs) return false;
  lastPlayAt = now;
  const audio = context;
  const buffer = decoded;
  if (audio === null || buffer === null) {
    playFallback(current);
    return true;
  }
  const volume = current.volume;
  if (audio.state === 'running') {
    startSource(audio, buffer, volume);
    return true;
  }
  // 被系统挂断（换设备、蓝牙切编码）后恢复要几毫秒：等它起来再补播，宁可晚一点也别丢这一声；
  // 等不到就退回 `<audio>`，那一路至少能出声。
  void Promise.race([audio.resume(), wait(RESUME_WAIT_MS)])
    .then(() => {
      if (audio.state === 'running') startSource(audio, buffer, volume);
      else playFallback(current);
    })
    .catch(() => playFallback(current));
  return true;
}

/**
 * 等预热完成（测试用）：解码链的终点，避免用例靠定时器猜就绪时机。
 *
 * @internal
 */
export async function whenClickSfxReady(): Promise<void> {
  await decoding;
}

/**
 * 清空模块状态（测试与页面重载用）；不保证已经发出的声音停下。
 *
 * @internal
 */
export function resetClickSfx(): void {
  options = null;
  sfxEnabled = false;
  context = null;
  decoded = null;
  decoding = null;
  decodeFailed = false;
  lastPlayAt = 0;
  fallbackAudio = null;
  loggedPath = '';
  resumeBound = false;
}

/** 写入播放参数；地址变了就把解码结果与回退元素一起作废。 */
function applyOptions(next: ClickSfxOptions): void {
  const url = next.url;
  const volume = next.volume ?? DEFAULT_VOLUME;
  const throttleMs = next.throttleMs ?? DEFAULT_THROTTLE_MS;
  const isNewUrl = options !== null && options.url !== url;
  const resolved: ResolvedClickSfx = { url, volume, throttleMs };
  options = resolved;
  if (!isNewUrl) return;
  decoded = null;
  decoding = null;
  decodeFailed = false;
  fallbackAudio = null;
}

/** 建上下文（幂等）；环境没有 WebAudio 时返回 null。 */
function ensureContext(): AudioContext | null {
  if (context !== null) return context;
  const scope = globalThis as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (Ctor === undefined) return null;
  try {
    context = new Ctor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
  bindAutoResume(context);
  return context;
}

/** 挂上下文自愈：系统挂断后自动恢复，否则会一直静默到下次开关。 */
function bindAutoResume(audio: AudioContext): void {
  if (resumeBound) return;
  resumeBound = true;
  audio.addEventListener('statechange', () => {
    if (!sfxEnabled || audio.state !== 'suspended') return;
    void audio.resume().catch(() => {});
  });
}

/** 关掉开关时挂起上下文：省设备占用，但不 close，下次打开立刻能用。 */
function suspendContext(): void {
  const audio = context;
  if (audio === null || audio.state === 'suspended') return;
  void audio.suspend().catch(() => {});
}

/** 取素材并解码；失败只标一次，绝不外抛。 */
function startDecode(audio: AudioContext, url: string): void {
  if (decoding !== null || decoded !== null || decodeFailed) return;
  decoding = (async () => {
    try {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error('click sfx http ' + response.status);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_SFX_BYTES) throw new Error('click sfx too large');
      decoded = await audio.decodeAudioData(bytes);
    } catch (error) {
      // 解码失败就永久降级到 `<audio>`：不报出来，用户只会觉得"又变回原来那样"而查无实据。
      decodeFailed = true;
      console.warn('[dsh-pet] click-sfx decode failed: ' + String(error));
    } finally {
      decoding = null;
    }
  })();
}

/** 起一个 BufferSource；失败静默（没有声音也不该有报错）。 */
function startSource(audio: AudioContext, buffer: AudioBuffer, volume: number): void {
  try {
    const gain = audio.createGain();
    gain.gain.value = volume;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(audio.destination);
    source.start(0);
  } catch {
    /* 设备不可用：静默忽略。 */
  }
}

/** 回退路径：单例 `<audio>`，与 WebAudio 加入之前的行为一致。 */
function playFallback(current: ResolvedClickSfx): void {
  try {
    fallbackAudio ??= new Audio(current.url);
    fallbackAudio.volume = current.volume;
    fallbackAudio.currentTime = 0;
    void fallbackAudio.play().catch(() => {});
  } catch {
    /* 音频不可用：静默忽略。 */
  }
}

/** 记一次实际走的播放路径：桌面端只转发带 `[dsh-pet]` 的 console，这条能落盘取证。 */
function logPath(path: 'web-audio' | 'fallback'): void {
  if (loggedPath === path) return;
  loggedPath = path;
  console.info('[dsh-pet] click-sfx path=' + path);
}

/** 等指定毫秒；只用于「上下文恢复」的兜底超时。 */
function wait(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
