/**
 * 音效播放器：常热 WebAudio + 预解码 + 按需回退，供网页端与桌面 Helper 共用。
 *
 * 为什么不是 `<audio>`：每次播放都伴随一次输出流冷启动，被丢掉的 60–100ms 正好是素材开头的攻击段
 * （包内音效都按「攻击段压在 t=0」制作）。这里让常驻 AudioContext 保持设备流打开、素材解码一次缓存，
 * 每次发声只新建 BufferSource，起点精确到样本 0；常驻保活用一个 1 LSB 的循环音源防止 sink 被判静音。
 * WebAudio 不可用、上下文迟迟起不来或素材解码失败时回退 `<audio>`，失败一律静默。
 * 单例：网页端全页一份、桌面端一窗一份；节流按 key 在模块内收口。
 * @module dsh-fish-body/src/shared/sfx/player
 */

/** 总音量缺省值：与其余提示音同一档，不抢对话内容。 */
const DEFAULT_VOLUME = 0.5;
/** 素材上限：正常几十 KB；超过说明给错了文件，直接走回退。 */
const MAX_SFX_BYTES = 1024 * 1024;
/** 等上下文恢复的上限：超时就不再等，用回退路径补这一声。 */
const RESUME_WAIT_MS = 120;
/** 等素材解码完的上限：刚启动就触发的那一下宁可晚几毫秒，也别退回会丢音头的 `<audio>`。 */
const DECODE_WAIT_MS = 150;
/** 保活信号的幅度：1 个 16bit LSB（约 -90dBFS）。不能是精确 0——全零会被判静音，输出流照旧关掉。 */
const KEEPALIVE_AMPLITUDE = 1 / 32768;
/** 保活缓冲长度（秒）：循环播放，够短就够便宜。 */
const KEEPALIVE_SECONDS = 0.25;
/** 解码缓存上限：满一套皮肤的十几个文件远够用，超出按最久未用淘汰。 */
const DECODE_CACHE_LIMIT = 32;
/** 诊断日志条数：前几次播放记下来，够定位就停，不把日志刷满。 */
const PLAY_LOG_LIMIT = 6;

/** 播放器总开关与总音量：配置到手时写入，之后每次播放现读。 */
export interface SfxPlayerOptions {
  /** 总开关；关掉时挂起上下文，让出音频设备。 */
  readonly enabled: boolean;
  /** 总音量 0–1，缺省 0.5；与分项音量相乘。 */
  readonly volume?: number;
  /** 常驻预热：用一个听不见的极小音源一直占着输出流，久不发声后第一下也不缺音头。 */
  readonly keepAlive?: boolean;
}

/** 单次播放的附加参数。 */
export interface SfxPlayOptions {
  /** 分项音量 0–1，乘在总音量上。 */
  readonly volume?: number;
  /** 节流窗口毫秒；缺省 0（不节流）。 */
  readonly throttleMs?: number;
  /** 节流键：同一个键共用冷却窗口（同一段动画的多个时间线点不要互相吃掉就各给一个键）。 */
  readonly throttleKey?: string;
}

/** 定时播放的一条：动作音的时间线点。 */
export interface SfxScheduleCue {
  /** 素材地址。 */
  readonly url: string;
  /** 相对创建时刻的偏移毫秒。 */
  readonly at?: number;
  /** 重复间隔毫秒；给了就按它循环，直到 {@link stopScheduledSfx}。 */
  readonly everyMs?: number;
  /** 分项音量 0–1。 */
  readonly volume?: number;
}

/** 生效中的总参数。 */
interface ResolvedOptions {
  readonly enabled: boolean;
  readonly volume: number;
  readonly keepAlive: boolean;
}

/** 已经生效的总参数；配置写入前为空，此时一律不响。 */
let options: ResolvedOptions | null = null;
/** 唯一 WebAudio 上下文；建不起来就一直为 null（只剩回退路径）。 */
let context: AudioContext | null = null;
/** 解码缓存：URL → AudioBuffer；插入序即 LRU 序。 */
const decoded = new Map<string, AudioBuffer>();
/** 正在解码的 URL：避免连点触发多次 fetch。 */
const decoding = new Map<string, Promise<void>>();
/** 解码失败过的 URL：不再重试，免得每次播放都打一次坏请求。 */
const decodeFailed = new Set<string>();
/** 节流键 → 上次播放时刻（ms）。 */
const lastPlayAt = new Map<string, number>();
/** 回退路径的单例 `<audio>` 元素。 */
let fallbackAudio: HTMLAudioElement | null = null;
/** 已经打过的那条路径日志；避免每一下都刷屏。 */
const loggedPaths = new Set<string>();
/** 是否挂了上下文自愈监听。 */
let resumeBound = false;
/** 常驻的保活音源。 */
let keepalive: AudioBufferSourceNode | null = null;
/** 时间线定时器（timeout 与 interval 各自清理）。 */
let scheduled: Array<{ timeout?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval> }> = [];
/** 剩下的诊断日志条数。 */
let playLogsLeft = PLAY_LOG_LIMIT;

/**
 * 写入总开关、总音量与常驻预热；幂等，配置反复刷新不会重复建上下文。
 *
 * @param next - 配置里的三件套。
 */
export function configureSfx(next: SfxPlayerOptions): void {
  const volume = typeof next.volume === 'number' && next.volume >= 0 && next.volume <= 1 ? next.volume : DEFAULT_VOLUME;
  options = { enabled: next.enabled, volume, keepAlive: next.keepAlive === true };
  if (!next.enabled) {
    stopScheduledSfx();
    suspendContext();
    return;
  }
  const audio = ensureContext();
  if (audio === null) {
    logPath('fallback');
    return;
  }
  // 自动播放策略拦着的上下文一开始是 suspended：这里 resume 不受手势限制，
  // 可能在页面收到第一个手势后才真正兑现；兑现前播放会走「先 resume 再起播」或回退路径。
  if (audio.state !== 'running') void audio.resume().catch(() => {});
  if (options.keepAlive) startKeepalive(audio);
  else stopKeepalive();
  logPath('web-audio');
}

/**
 * 预热一个素材（配置到手时对常用音效调用；已缓存或已失败的直接跳过）。
 *
 * @param url - 素材地址。
 */
export function preloadSfx(url: string): void {
  const audio = context;
  if (audio === null || url === '') return;
  startDecode(audio, url);
}

/**
 * 播一个音效。
 *
 * @param url - 素材地址。
 * @param playOptions - 分项音量与节流。
 * @returns 这一下是否真的发起了播放（总开关关着、节流中、地址为空时为 `false`）。
 */
export function playSfx(url: string, playOptions?: SfxPlayOptions): boolean {
  const current = options;
  if (current === null || !current.enabled || url === '') return false;
  const throttleMs = playOptions?.throttleMs ?? 0;
  const key = playOptions?.throttleKey ?? url;
  const now = Date.now();
  if (throttleMs > 0) {
    const last = lastPlayAt.get(key);
    if (last !== undefined && now - last < throttleMs) return false;
  }
  lastPlayAt.set(key, now);
  const volume = current.volume * (playOptions?.volume ?? 1);
  const audio = context;
  if (audio === null) {
    logPlay(url, 'fallback:no-context');
    playFallback(url, volume);
    return true;
  }
  const buffer = readDecoded(url);
  if (buffer === null) return playWhileDecoding(audio, url, volume);
  if (audio.state !== 'running') {
    // 被系统挂断（换设备、蓝牙切编码）后恢复要几毫秒：等它起来再补播，宁可晚一点也别丢这一声。
    logPlay(url, 'web-audio:resume');
    void Promise.race([audio.resume(), wait(RESUME_WAIT_MS)])
      .then(() => {
        if (audio.state !== 'running') return playFallback(url, volume);
        if (options?.keepAlive === true) startKeepalive(audio);
        return startSource(audio, buffer, volume);
      })
      .catch(() => playFallback(url, volume));
    return true;
  }
  logPlay(url, 'web-audio');
  if (current.keepAlive) startKeepalive(audio);
  startSource(audio, buffer, volume);
  return true;
}

/**
 * 排一条动作音时间线（先清掉上一条：同一时刻只有一段动画在前台）。
 *
 * @param cues - 时间线点；空数组等于只清空。
 */
export function scheduleSfx(cues: readonly SfxScheduleCue[]): void {
  stopScheduledSfx();
  for (const cue of cues) {
    const at = cue.at ?? 0;
    const everyMs = cue.everyMs ?? null;
    const entry: { timeout?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval> } = {};
    const fire = (): boolean => playSfx(cue.url, { volume: cue.volume, throttleMs: 0 });
    // 每次起播都挂一个超时：循环靠 interval 而不是递归，清理时一处就够。
    entry.timeout = globalThis.setTimeout(() => {
      fire();
      if (everyMs === null) return;
      entry.interval = globalThis.setInterval(() => {
        fire();
      }, everyMs);
    }, at);
    scheduled.push(entry);
  }
}

/**
 * 停掉全部已排的时间线点（切动画、冻结、卸载时调用）。
 */
export function stopScheduledSfx(): void {
  for (const entry of scheduled) {
    if (entry.timeout !== undefined) globalThis.clearTimeout(entry.timeout);
    if (entry.interval !== undefined) globalThis.clearInterval(entry.interval);
  }
  scheduled = [];
}

/**
 * 等预热完成（测试与「刚开就点」的用例用）：解码链的终点，不靠定时器猜就绪时机。
 *
 * @internal
 */
export async function whenSfxReady(): Promise<void> {
  await Promise.all([...decoding.values()]);
}

/**
 * 清空模块状态（测试与页面重载用）；不保证已经发出的声音停下。
 *
 * @internal
 */
export function resetSfx(): void {
  stopScheduledSfx();
  options = null;
  context = null;
  decoded.clear();
  decoding.clear();
  decodeFailed.clear();
  lastPlayAt.clear();
  fallbackAudio = null;
  loggedPaths.clear();
  resumeBound = false;
  keepalive = null;
  playLogsLeft = PLAY_LOG_LIMIT;
}

/** 读缓存并把命中项移到 LRU 尾；未命中返回 null。 */
function readDecoded(url: string): AudioBuffer | null {
  const buffer = decoded.get(url);
  if (buffer === undefined) return null;
  decoded.delete(url);
  decoded.set(url, buffer);
  return buffer;
}

/** 素材还在解码时的那一下：等解码完（上限 {@link DECODE_WAIT_MS}）再用 WebAudio 起播。 */
function playWhileDecoding(audio: AudioContext, url: string, volume: number): boolean {
  const pending = decoding.get(url);
  if (pending === undefined) {
    if (decodeFailed.has(url)) {
      logPlay(url, 'fallback:decode-failed');
      playFallback(url, volume);
      return true;
    }
    preloadSfx(url);
    const started = decoding.get(url);
    if (started === undefined) {
      logPlay(url, 'fallback:no-buffer');
      playFallback(url, volume);
      return true;
    }
  }
  logPlay(url, 'web-audio:await-decode');
  const wait0 = pending ?? decoding.get(url);
  void Promise.race([wait0, wait(DECODE_WAIT_MS)])
    .then(() => {
      const ready = readDecoded(url);
      if (ready === null) return playFallback(url, volume);
      if (options?.keepAlive === true) startKeepalive(audio);
      return startSource(audio, ready, volume);
    })
    .catch(() => playFallback(url, volume));
  return true;
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

/** 挂上下文自愈：系统挂断后自动恢复，否则会一直静默到下次配置刷新。 */
function bindAutoResume(audio: AudioContext): void {
  if (resumeBound) return;
  resumeBound = true;
  audio.addEventListener('statechange', () => {
    if (options === null || !options.enabled) return;
    if (audio.state === 'running') {
      if (options.keepAlive) startKeepalive(audio);
      return;
    }
    if (audio.state === 'suspended') void audio.resume().catch(() => {});
  });
}

/** 关掉开关时挂起上下文：省设备占用，但不 close，下次打开立刻能用。 */
function suspendContext(): void {
  stopKeepalive();
  const audio = context;
  if (audio === null || audio.state === 'suspended') return;
  void audio.suspend().catch(() => {});
}

/**
 * 起常驻保活音源：幅度一个 LSB 的白噪声，听不见，但输出流里始终有非零样本。
 *
 * 只创建上下文不发声时，输出端（sink）会被判成静音而关掉，下一次发声又变成「开流 + 起播」
 * 的冷启动，音头照样丢。
 */
function startKeepalive(audio: AudioContext): void {
  if (keepalive !== null) return;
  try {
    const frames = Math.max(1, Math.round(audio.sampleRate * KEEPALIVE_SECONDS));
    const buffer = audio.createBuffer(1, frames, audio.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < frames; index += 1) {
      channel[index] = (Math.random() < 0.5 ? -1 : 1) * KEEPALIVE_AMPLITUDE;
    }
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(audio.destination);
    source.start(0);
    keepalive = source;
  } catch {
    keepalive = null;
  }
}

/** 停掉保活音源（关开关、挂起上下文时）。 */
function stopKeepalive(): void {
  const source = keepalive;
  keepalive = null;
  if (source === null) return;
  try {
    source.stop();
    source.disconnect();
  } catch {
    /* 已经停过：忽略 */
  }
}

/** 取素材并解码；失败只标一次，绝不外抛。 */
function startDecode(audio: AudioContext, url: string): void {
  if (decoded.has(url) || decoding.has(url) || decodeFailed.has(url)) return;
  const task = (async () => {
    try {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error('sfx http ' + response.status);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_SFX_BYTES) throw new Error('sfx too large');
      const buffer = await audio.decodeAudioData(bytes);
      if (decoded.size >= DECODE_CACHE_LIMIT) {
        const oldest = decoded.keys().next();
        if (!oldest.done) decoded.delete(oldest.value);
      }
      decoded.set(url, buffer);
    } catch (error) {
      // 解码失败就永久降级到 `<audio>`：不报出来，用户只会觉得"没声音"而查无实据。
      decodeFailed.add(url);
      console.warn('[fish-body] sfx decode failed url=' + url + '：' + String(error));
    } finally {
      decoding.delete(url);
    }
  })();
  decoding.set(url, task);
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

/** 回退路径：单例 `<audio>`，与加入 WebAudio 之前的行为一致。 */
function playFallback(url: string, volume: number): void {
  try {
    if (fallbackAudio !== null && fallbackAudio.src !== url) fallbackAudio.src = url;
    fallbackAudio ??= new Audio(url);
    fallbackAudio.volume = volume;
    fallbackAudio.currentTime = 0;
    void fallbackAudio.play().catch(() => {});
  } catch {
    /* 音频不可用：静默忽略。 */
  }
}

/** 记一次实际走的播放路径：桌面端只转发带 `[fish-body]` 的 console，这条能落盘取证。 */
function logPlay(url: string, path: string): void {
  if (playLogsLeft <= 0) return;
  playLogsLeft -= 1;
  const audio = context;
  console.info(
    '[fish-body] sfx play path=' +
      path +
      ' url=' +
      url +
      ' ctx=' +
      (audio === null ? 'none' : audio.state) +
      ' keepalive=' +
      (keepalive === null ? 'off' : 'on') +
      ' decoded=' +
      (decoded.has(url) ? 'yes' : 'no'),
  );
}

/** 记一次实际走的上下文路径。 */
function logPath(path: 'web-audio' | 'fallback'): void {
  if (loggedPaths.has(path)) return;
  loggedPaths.add(path);
  console.info('[fish-body] sfx path=' + path);
}

/** 等指定毫秒；只用于「上下文恢复 / 解码」的兜底超时。 */
function wait(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
