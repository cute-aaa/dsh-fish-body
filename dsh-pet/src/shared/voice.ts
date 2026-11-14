/**
 * 端侧语音播报：按 `say` 叶子决定这一句要不要念，以及合成请求与播放。
 *
 * 两端各判各的：叶子里的 `voiceTo` 指向哪一端，就只有那一端出声；缺省 = 谁都不念。
 * 网页端另加一道「页面可见」——被切到后台的页面没人看，出声只是打扰。
 * 每句的开始与结束经 {@link subscribeVoiceUtterance} 广播出去：说话气泡靠它决定何时收起。
 * 不负责合成与缓存：那些在宿主侧（`/voice/speak`）。
 * @module dsh-fish-body/src/shared/voice
 */
import { ROUTE_PATH } from './constants.ts';
import type { VoiceTarget } from './state.ts';

/** 当前音色；空串 = 不指定，由宿主用默认音色。 */
let voiceName = '';
/** 播放音量系数（0–1，1 = 最大音量）；两端共用，只作用于播放，不影响已合成好的音频。 */
let voiceVolume = 1;
/** 工作状态播报开关；只有成品配置明确为 true 才念。 */
let notifyEnabled = false;
/** 本端是网页端还是桌面端；`null` = 还没声明，此时不按叶子播放。 */
let surface: VoiceTarget | null = null;
/** 接口基址：网页端是同源前缀，桌面端由 `setVoiceBase` 换成 bridge 地址。 */
let voiceBase = ROUTE_PATH;
/** 配置是否已就绪；网页端由 `setVoiceConfig` 置位，桌面端首次播放时懒加载。 */
let configLoaded = false;
/** 当前播报状态；气泡据此显示图标。 */
let voiceState: VoiceState = 'idle';
/** 状态订阅者：两端的说话气泡据此渲染图标。 */
const stateListeners = new Set<(state: VoiceState) => void>();
/** 播报开始/结束的订阅者：说话气泡据此挂起与收尾。 */
const utteranceListeners = new Set<(event: VoiceUtteranceEvent) => void>();
/** 播报序号；每次决定要念一句就自增，用来让气泡丢掉迟到的「上一句播完了」。 */
let utteranceSeq = 0;

/** 语音播报对外的四种状态；只用于展示，不接受外部驱动。`failed` = 这次合成没成功。 */
export type VoiceState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * 一句播报的开始与结束事件。
 *
 * `text` 是气泡上的原文，不是送合成的截断文本——气泡要按它认句：同一页面上的多只宠物
 * 共用这份模块单例状态，不认句就会把别人那一句算到自己头上。
 */
export type VoiceUtteranceEvent =
  | { readonly kind: 'start'; readonly seq: number; readonly text: string }
  | { readonly kind: 'end'; readonly seq: number; readonly text: string };

/**
 * 客户端等合成结果的上限（ms）。
 *
 * 比宿主侧的总超时（28s）再宽一点：让宿主先超时并回结构化失败，
 * 客户端这道只是兜底，避免上游挂住时气泡上的转圈永远停不下来。
 */
const SPEAK_TIMEOUT_MS = 30_000;

/**
 * 等一句播完的上限（ms）。
 *
 * 比气泡自身的挂起上限（50s）再宽一点：正常单句远小于它，到点还没收尾说明播放这条线
 * 已经断了，此时按收尾处理，气泡不至于跟着永久挂住。
 */
export const PLAYBACK_WAIT_MAX_MS = 60_000;

/** 合成请求的超时信号；自动播报与手动点播共用同一份口径。 */
function speakSignal(): AbortSignal {
  return AbortSignal.timeout(SPEAK_TIMEOUT_MS);
}

/** 切换状态并通知订阅者；同值不重复通知。 */
function setVoiceState(next: VoiceState): void {
  if (voiceState === next) return;
  voiceState = next;
  for (const listener of stateListeners) listener(next);
}

/**
 * 读当前播报状态；桌面端在重绘气泡时直接取（它没有 react 的订阅机制）。
 * @returns `idle` / `loading` / `ready`。
 */
export function getVoiceState(): VoiceState {
  return voiceState;
}

/**
 * 订阅播报状态；订阅时会立刻收到当前值。
 * @param listener - 状态变化回调。
 * @returns 取消订阅；组件卸载/气泡关闭时必须调用。
 */
export function subscribeVoiceState(listener: (state: VoiceState) => void): () => void {
  stateListeners.add(listener);
  listener(voiceState);
  return () => {
    stateListeners.delete(listener);
  };
}

/**
 * 订阅每句播报的开始与结束；不补发历史状态，只报后续事件。
 *
 * @param listener - 事件回调：`start` 表示已经决定要念这一句（合成开始），
 *   `end` 表示播完、合成失败或超时——三种结局都会报一次，气泡不必自己判超时。
 * @returns 取消订阅；卡片卸载或气泡关闭时必须调用。
 */
export function subscribeVoiceUtterance(listener: (event: VoiceUtteranceEvent) => void): () => void {
  utteranceListeners.add(listener);
  return () => {
    utteranceListeners.delete(listener);
  };
}

/** 广播一次播报事件；单个订阅者抛错不能挡住其余订阅者。 */
function emitUtterance(event: VoiceUtteranceEvent): void {
  for (const listener of utteranceListeners) listener(event);
}

/**
 * 换掉接口基址；桌面端在模块加载时调一次（`file://` 页面不能用相对路径）。
 * @param base - 已含前缀的地址，如 `dsh-pet-bridge://dsh-pet/dsh-pet-7340`。
 */
export function setVoiceBase(base: unknown): void {
  if (typeof base === 'string' && base) voiceBase = base;
}

/**
 * 声明本端是网页端还是桌面端；两端各自在启动时调一次。
 * 没声明时不按 `say` 叶子播放——宁可没声音，也不替另一端出声。
 * @param next - `web` / `desktop`；其余值忽略。
 */
export function setSurface(next: unknown): void {
  if (next === 'web' || next === 'desktop') surface = next;
}

/**
 * 记录成品配置里的音色与音量；网页端在读到 `/config` 时调一次。
 * 调用即视为配置已就绪，后续播放不再自己去拉。
 *
 * @param name - 音色 id（非字符串按未指定处理）。
 * @param volume - 音量系数（0–1）；缺省或非数值按最大音量播放。
 */
export function setVoiceConfig(name: unknown, volume?: unknown): void {
  voiceName = typeof name === 'string' ? name : '';
  voiceVolume = clampVolume(volume);
  configLoaded = true;
}

/**
 * 记录工作状态播报开关；网页端在读到 `/config` 时调一次。
 *
 * @param on - 成品配置的 `main.voiceNotifyEnabled`；只有严格 `true` 才算开启。
 */
export function setVoiceNotifyEnabled(on: unknown): void {
  notifyEnabled = on === true;
}

/** 工作状态播报是否开启。 */
export function isVoiceNotifyEnabled(): boolean {
  return notifyEnabled;
}

/** 把音量收敛到 0–1；非数值按最大音量（1）处理——脏配置不该把声音悄悄变成 0。 */
function clampVolume(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

/** 懒加载成品配置；失败按「不播」处理，且只试一次（避免每句都发请求）。 */
async function loadConfigOnce(): Promise<void> {
  if (configLoaded) return;
  try {
    const response = await fetch(voiceBase + '/config', { cache: 'no-store' });
    const body = (await response.json()) as { main?: Record<string, unknown> } | null;
    const main = body?.main;
    voiceName = typeof main?.voiceName === 'string' ? main.voiceName : '';
    voiceVolume = clampVolume(main?.voiceVolume);
    setVoiceNotifyEnabled(main?.voiceNotifyEnabled);
    // 只有成功才置位：拉不到（bridge 还没就绪 / 瞬时故障）留给下一句重试——
    // 否则一次失败就把这一端永久静音了。
    configLoaded = true;
  } catch {
    /* 拉不到就保持关闭：宁可没声音，也不乱播 */
  }
}

/**
 * 按 `say` 叶子播放：叶子点名了本端就念。
 *
 * 两道门：叶子有没有点名本端 → 网页端页面是否可见。念不念由宿主在写叶子时决定。
 *
 * @param say - 要念的那一句：`text` 正文，`voiceTo` 该由哪一端念。
 */
export function playSayVoice(say: { readonly text: string; readonly voiceTo?: VoiceTarget }): void {
  const isMine = say.voiceTo !== undefined && say.voiceTo === surface;
  if (!say.text || !isMine) {
    setVoiceState('idle');
    return;
  }
  if (surface === 'web' && typeof document !== 'undefined' && document.hidden) {
    setVoiceState('idle');
    return;
  }
  void speakWhenReady(say.text); // 不 await：播放是旁路，不能挡住气泡与动画
}

/**
 * 配置就绪后开播；桌面端首次调用会顺手拉一次 `/config`。
 *
 * @param text - 要念的整句。
 * @param canPlayHidden - 页面隐藏时是否继续播；缺省 `false`（藏起来就静音）。
 */
async function speakWhenReady(text: string, canPlayHidden = false): Promise<void> {
  await loadConfigOnce();
  const seq = ++utteranceSeq;
  // 先报开始再置 loading：气泡要靠这条事件挂起收起计时，晚一步它就可能已经收了。
  emitUtterance({ kind: 'start', seq, text });
  setVoiceState('loading');
  try {
    await speak(text, canPlayHidden);
  } finally {
    // 成功、失败、超时都走这里：气泡在等这个收尾，漏一次就永远挂着。
    emitUtterance({ kind: 'end', seq, text });
  }
}

/**
 * 念一句与气泡无关的系统提示（工作状态播报）。
 *
 * 念不念由调用方判定。与其它自动播报共用同一个单槽——后一句掐掉前一句。
 *
 * @param text - 要念的整句；空串直接跳过。
 */
export function speakNotice(text: string): void {
  if (text === '') return;
  // 允许后台播：用户正在别的应用里，正是需要它出声的时候。
  void speakWhenReady(text, true);
}

/**
 * 等到这一句真正播完。
 *
 * `play()` 的 Promise 在「开播」时就 resolve，而气泡要的是「播完」：两者的差就是气泡提前
 * 收起的全部原因。所以这里另等收尾信号，并用 {@link PLAYBACK_WAIT_MAX_MS} 兜底。
 *
 * @param audio - 正在播的元素。
 * @param objectUrl - 收尾时要释放的 blob 地址。
 */
function waitForPlaybackEnd(audio: HTMLAudioElement, objectUrl: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (settled) return; // ended 与 pause 会先后到达，只收一次尾
      settled = true;
      if (timer !== null) clearTimeout(timer);
      liveAutoAudios.delete(audio); // 收尾即不可能再出声：从待掐名单里摘掉
      URL.revokeObjectURL(objectUrl);
      stopWarmAudio(); // 正片收尾：预热静音也没必要再响着
      resolve();
    };
    timer = setTimeout(finish, PLAYBACK_WAIT_MAX_MS);
    timer.unref?.(); // 与宿主侧定时器同一策略：别把这个等待钉进事件循环
    audio.onended = finish;
    audio.onerror = finish;
    audio.onpause = finish; // 被下一句顶掉或用户暂停：同样算收尾，气泡不该再等一个不会响的音频
  });
}

/**
 * 自动播报**尚可能出声**的全部音频：单槽纪律的唯一依据。
 *
 * 为什么不能只记一个引用：合成 + 预热是异步的，上一句的音频可能在下一句已经开播之后才落地。
 * 只保留「最后赋值的那个」会让先落地的那条失去引用，pause 不到它，于是两句话叠着响。
 */
const liveAutoAudios = new Set<HTMLAudioElement>();
/** 自动播报当前正在响的那个音频（对外语义）：新的一句进来先掐掉旧的。 */
let autoAudio: HTMLAudioElement | null = null;
/** 自动播报世代号：合成期间可能被更新的一句顶掉，回来的旧结果直接丢弃。 */
let autoSeq = 0;

/** 当前这句是否允许页面隐藏时继续播；跟随 autoAudio 一起换，不做成全局开关。 */
let autoAudioCanPlayHidden = false;

/**
 * 预热用的静音元素：**它才是句首少字的解法**。
 *
 * 一句语音前面通常是几十秒甚至几分钟的静默，浏览器的音频输出流这时候已经关掉了。新开一段音频时，
 * 输出设备要重新拉起来（Windows 上尤其慢），`play()` 之后最先到达的那一小段会被丢掉——
 * 而 edge / GSV 的音频开头恰好就是第一个字的气声，于是听起来「开口少了一个字」。
 * 碎碎念之所以最明显：它是唯一没有用户手势、又隔很久才响一次的自动播报。
 *
 * 这里先起一段音量 0、无限循环的静音，等它真的开始放（输出流热起来）再去播正片，
 * 被丢掉的那一段落在静音上，第一个字完整保留。播完（或被顶掉）时停掉它。
 */
let warmAudio: HTMLAudioElement | null = null;

/** 预热静音的长度：够把输出流拉起来即可，循环播放，所以不必很长。 */
const WARMUP_SILENCE_MS = 400;
/** 等预热开播的上限：设备拉不起来时不能把正片也一起卡住。 */
const WARMUP_WAIT_MS = 400;

/** 浏览器里才有 WebAudio：用它判断「这是真浏览器」，顺带让单测里的假 Audio 走原路径。 */
function hasWebAudio(): boolean {
  const scope = globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown };
  return typeof scope.AudioContext === 'function' || typeof scope.webkitAudioContext === 'function';
}

/**
 * 造一段静音 WAV（8 kHz / 8 bit / 单声道）：数据全为 0x80，就是 8 bit PCM 的静音。
 *
 * 自己拼而不内嵌 base64：几十个字节的构造函数可测、也不会在源码里塞一长串常量。
 *
 * @param durationMs - 时长（毫秒）。
 * @returns 完整的 WAV 文件字节。
 */
export function buildSilentWav(durationMs: number): Uint8Array {
  const sampleRate = 8000;
  const samples = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk 长度
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // 字节率 = 采样率 × 1 声道 × 1 字节
  view.setUint16(32, 1, true); // 块对齐
  view.setUint16(34, 8, true); // 位深
  ascii(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(0x80, 44); // 8 bit PCM 的静音是 0x80（无符号，中点）
  return bytes;
}

/**
 * 把音频输出流热起来；已经在热就不重复起。
 *
 * @returns 预热开始播放（或确认起不来）时 resolve；正片随后再开播，句首丢帧落在静音上。
 */
async function warmAudioSink(): Promise<void> {
  if (!hasWebAudio() || warmAudio !== null) return;
  try {
    const url = URL.createObjectURL(new Blob([buildSilentWav(WARMUP_SILENCE_MS)], { type: 'audio/wav' }));
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0;
    warmAudio = audio;
    // play() 的 Promise 在「真正开播」时 resolve：拿它当「输出流已热」的信号。
    // 起不来（自动播放被拦 / 设备不可用）就直接往下走：宁可按原样播，也不要卡住正片。
    await Promise.race([
      audio.play().catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, WARMUP_WAIT_MS)),
    ]).finally(() => URL.revokeObjectURL(url));
  } catch {
    warmAudio = null;
  }
}

/** 停掉预热静音；正片播完或被顶掉时调用，免得静音一直在放。 */
function stopWarmAudio(): void {
  const audio = warmAudio;
  warmAudio = null;
  if (audio === null) return;
  try {
    audio.pause();
  } catch {
    /* 播放器已销毁：忽略 */
  }
}

/**
 * 掐掉当前自动播报。
 *
 * 暂停的是**集合里全部**尚可能出声的音频，而不只是最后一次赋值的那个：合成与预热是异步的，
 * 上一句可能在新句之后才落地（见 {@link liveAutoAudios}），漏掉它就会两句话叠着响。
 * 用 pause 而不是直接丢掉引用：`waitForPlaybackEnd` 已经挂了 `onpause` 收尾，
 * 气泡能照常收起，不会等一个已经不会响的音频。
 */
function stopAutoAudio(): void {
  const pending = [...liveAutoAudios];
  liveAutoAudios.clear();
  // 标记无条件清掉：没有音频时也要清，否则下一句会被上一句的许可值带偏。
  autoAudio = null;
  autoAudioCanPlayHidden = false;
  for (const audio of pending) {
    try {
      audio.pause();
    } catch {
      /* 播放器已销毁：忽略 */
    }
  }
}

/**
 * 停掉正在响的自动播报（浮层卸载等「没人在看」的场合）。
 *
 * 只停自动播报这一条道：用户点播（`speakText`）与 `say` 气泡的语音不归它管。
 */
export function stopAutoSpeech(): void {
  stopAutoAudio();
}

/**
 * 当前播报序号（只读）。
 *
 * 队列类消费者要靠它认出「这条 start 是不是我自己这一次触发的」：拿不到基线时只能按文本认句，
 * 而文案池里同一句话会被反复使用，别处念到同句就会被误认成自己的收尾。
 *
 * @returns 最近一次「决定要念一句」时分配出去的序号。
 */
export function currentUtteranceSeq(): number {
  return utteranceSeq;
}

// 页面被藏起来（切后台 / 息屏）就静音：回来时不补播。通知类播报自带后台许可，不受这条影响。
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !autoAudioCanPlayHidden) stopAutoAudio();
  });
}

/**
 * 请求合成并播放；任何一步失败都落到 `failed`（气泡上留一个静音喇叭，而不是干脆没图标）。
 *
 * @param text - 要念的整句。
 * @param canPlayHidden - 页面隐藏时是否继续播；缺省 `false`。
 */
async function speak(text: string, canPlayHidden = false): Promise<void> {
  const token = ++autoSeq;
  stopAutoAudio();
  try {
    const response = await fetch(voiceBase + '/voice/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...(voiceName ? { voice: voiceName } : {}) }),
      signal: speakSignal(),
    });
    if (token !== autoSeq) return;
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('audio')) {
      setVoiceState('failed');
      return;
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    if (token !== autoSeq) {
      URL.revokeObjectURL(objectUrl);
      return;
    }
    // 合成期间页面被藏起来：这一句不补播，直接丢掉——除非这句自带后台许可（通知类）。
    if (!canPlayHidden && typeof document !== 'undefined' && document.hidden) {
      URL.revokeObjectURL(objectUrl);
      setVoiceState('idle');
      return;
    }
    // 先把输出流热起来再建正片：冷启动丢掉的那一段落在静音上，句首的字才不会被啃掉。
    await warmAudioSink();
    // 预热是异步的（最长 WARMUP_WAIT_MS）：这段等待里可能已经被新的一句顶掉。
    // 这里必须重新校验世代号——否则本句会把新句刚赋好的 autoAudio 覆盖成自己，两条一起响。
    if (token !== autoSeq) {
      URL.revokeObjectURL(objectUrl);
      return;
    }
    const audio = new Audio(objectUrl);
    audio.volume = voiceVolume;
    // 音频就绪即置 ready：喇叭表示「这句有语音」，不跟播放进度绑定
    setVoiceState('ready');
    autoAudioCanPlayHidden = canPlayHidden;
    autoAudio = audio;
    liveAutoAudios.add(audio);
    try {
      await audio.play(); // 只代表开播：开播就失败要落到 failed，也不必再等收尾
    } catch {
      URL.revokeObjectURL(objectUrl);
      liveAutoAudios.delete(audio);
      stopWarmAudio();
      if (autoAudio === audio) {
        autoAudio = null;
        autoAudioCanPlayHidden = false;
      }
      setVoiceState('failed');
      return;
    }
    // 气泡靠 end 事件收起，所以必须等播完：停在「已经开播」会让气泡提早 1.5 秒消失
    await waitForPlaybackEnd(audio, objectUrl);
    liveAutoAudios.delete(audio);
    if (autoAudio === audio) autoAudio = null;
  } catch {
    /* 含超时：气泡已经显示，失败也不能反过来打断渲染，只把图标换成静音喇叭 */
    // 旧请求的失败晚到不能覆盖新句状态：世代号已变就说明这句已经被顶掉。
    if (token === autoSeq) setVoiceState('failed');
  }
}

/** 手动点播时正在响的那个音频；新的一句先掐掉旧的，避免两句话叠在一起。 */
let manualAudio: HTMLAudioElement | null = null;

/** 手动点播对外暴露的阶段；`idle` = 没在放（含被打断），`failed` = 合成没成功。 */
export type SpeakPhase = 'idle' | 'loading' | 'playing' | 'failed';

/** 手动点播的世代号：新的点播会作废旧请求的阶段回调，避免旧回调清掉新状态。 */
let manualSeq = 0;

/**
 * 手动播报一句（对话面板的喇叭按钮用）。
 *
 * 用户明确点播，拿到正文就合成播放；音色与音量取配置值。
 *
 * @param text - 要念的正文。
 * @param onPhase - 阶段回调：请求合成时 `loading`、音频就绪开始播时 `playing`、播完 `idle`、失败或超时 `failed`。
 * @param options - 覆盖音色与音量：设置页「试听」要用还没保存的那一格，不能拿配置里的旧值。
 */
export function speakText(text: string, onPhase?: (phase: SpeakPhase) => void, options: SpeakOptions = {}): void {
  if (!text) return;
  void playManual(text, onPhase, options);
}

/** 手动点播的覆盖项；缺省一律取已加载的配置值。 */
export interface SpeakOptions {
  /** 覆盖音色 id（设置页试听：当前选中的那一格，可能还没保存）。 */
  readonly voice?: string;
  /** 覆盖播放音量（0–1）。 */
  readonly volume?: number;
}

/** 请求合成并播放手动点播；失败静默，不打断面板交互。 */
async function playManual(
  text: string,
  onPhase?: (phase: SpeakPhase) => void,
  options: SpeakOptions = {},
): Promise<void> {
  const token = ++manualSeq;
  await loadConfigOnce();
  if (manualAudio) {
    manualAudio.pause();
    manualAudio = null;
  }
  if (token !== manualSeq) return; // 等配置期间又被点了一次：这次直接让位
  onPhase?.('loading');
  const voice = options.voice ?? voiceName;
  const volume = options.volume === undefined ? voiceVolume : clampVolume(options.volume);
  try {
    const response = await fetch(voiceBase + '/voice/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...(voice ? { voice } : {}) }),
      signal: speakSignal(),
    });
    if (token !== manualSeq) return;
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('audio')) {
      onPhase?.('failed');
      return;
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    if (token !== manualSeq) return;
    const audio = new Audio(objectUrl);
    audio.volume = volume;
    audio.onended = () => {
      URL.revokeObjectURL(objectUrl);
      stopWarmAudio();
      if (manualAudio === audio) {
        manualAudio = null;
        onPhase?.('idle');
      }
    };
    audio.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      stopWarmAudio();
    };
    manualAudio = audio;
    // 与自动播报同一条保护：试听也要能听到第一个字，否则按钮验不出真问题。
    await warmAudioSink();
    onPhase?.('playing');
    await audio.play();
  } catch {
    /* 含超时：面板里还有文字，不弹错误打断阅读，只把按钮换成失败态 */
    stopWarmAudio();
    if (token === manualSeq) onPhase?.('failed');
  }
}
