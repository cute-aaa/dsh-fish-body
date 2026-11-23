/**
 * 会话鱼的播报队列：多条鱼同时说话时，一句一句念、同句不重念。
 *
 * 为什么需要它：语音链的自动播报是**单槽**的（`shared/voice.ts` 的 `speakNotice` 新句会 `pause()` 旧句），
 * 而会话鱼的文案池每种状态只有两句，两个会话同时收工时几乎必然念同一句——不排队就会互相截断，
 * 不按文本去重就会把同一句话念两遍。桌宠自己的「工作状态播报」与会话鱼共用同一个单槽，
 * 所以两边必须只有一边在说话（谁说话由 `ownsSessionFishSpeech` 裁决，见 `shared/session-fish`）。
 *
 * 三条规则，按顺序生效：
 * 1. **串行**：同一时刻只有一句在播；下一句等 `end` 事件（播完 / 合成失败 / 超时都会发）再开。
 * 2. **去重**：同一条鱼的同一条播报（`sessionId|kind|文本`）8s 内不重入；同样的文本 4s 内跨会话只念一次
 *    （气泡仍各自显示，只是不重复出声）。
 * 3. **有界**：积压最多 {@link MAX_PENDING} 条，超了先丢最旧的进度句；排队超过 {@link MAX_STALE_MS}
 *    的旧句直接作废——用户不需要三分钟前的「我在想啦」。
 *
 * 认句按**序号**而不是文本（见 {@link onUtterance}）：文案池每档只有两句，别处念到同一句
 * 会被误判成自己的收尾。跨显示面「只念一次」不在这里，由宿主的 `/session-fish/claim` 裁决。
 * @module dsh-fish-body/src/client/session-fish/speech
 */
import {
  currentUtteranceSeq,
  speakNotice,
  stopAutoSpeech,
  subscribeVoiceUtterance,
  type VoiceUtteranceEvent,
} from '../../shared/voice.ts';
import type { SessionFishLineKind } from '../../shared/session-fish.ts';

/** 一条待播报。 */
export interface FishSpeechLine {
  /** 哪条鱼说的。 */
  readonly sessionId: string;
  /** 播报正文（宿主生成的整句）。 */
  readonly text: string;
  /** 播报类型：决定优先级。 */
  readonly kind: SessionFishLineKind;
  /** 宿主写入这条播报的时间（ms）；排队太久就作废。 */
  readonly lineAt: number;
}

/** 语音链的最小接口（测试注入假实现，生产用 `shared/voice`）。 */
export interface FishSpeechPort {
  /** 开始念一句（单槽，调用即抢占）。 */
  speak(text: string): void;
  /** 订阅每句的开始/结束。 */
  subscribe(listener: (event: VoiceUtteranceEvent) => void): () => void;
  /** 当前时间（ms）。 */
  now(): number;
  /** 当前播报序号：用来认出「这次的 start 是不是我」；缺省时退化为按文本认句。 */
  currentSeq?(): number;
  /** 停掉正在响的自动播报（浮层卸载时用）；缺省不处理。 */
  stop?(): void;
}

/** 同一个 key 的重复窗口（ms）。 */
const DEDUPE_MS = 8_000;
/** 同样文本的跨会话重复窗口（ms）。 */
const DUPLICATE_TEXT_MS = 4_000;
/** 允许积压的条数。 */
const MAX_PENDING = 3;
/** 一条播报最多等多久（ms）：超过就当过期，念出来只会更让人困惑。 */
const MAX_STALE_MS = 20_000;
/** 等一句念完的上限（ms）；与语音链自己的播放上限一致，它不发 end 时兜底放行。 */
const END_TIMEOUT_MS = 60_000;

/** 进度句的优先级（低）；其余类型都算「要事」。 */
const PRIORITY_PROGRESS = 1;
const PRIORITY_IMPORTANT = 2;

/** 优先级：轮次结束 / 完成 / 等待确认都比「读到哪一步」重要。 */
function priorityOf(kind: SessionFishLineKind): number {
  return kind === 'progress' ? PRIORITY_PROGRESS : PRIORITY_IMPORTANT;
}

/** 默认端口：真实语音链。 */
function defaultPort(): FishSpeechPort {
  return {
    speak: (text) => speakNotice(text),
    subscribe: (listener) => subscribeVoiceUtterance(listener),
    now: () => Date.now(),
    currentSeq: () => currentUtteranceSeq(),
    stop: () => stopAutoSpeech(),
  };
}

/** 一个实例的全部状态：模块级单例（整个页面只有一条语音链）。 */
interface SpeechState {
  port: FishSpeechPort;
  pending: FishSpeechLine[];
  pendingKeys: string[];
  playing: boolean;
  /** key → 上次入队时间。 */
  keys: Map<string, number>;
  /** 文本 → 上次入队时间。 */
  texts: Map<string, number>;
  unsubscribe: (() => void) | null;
  /** 等收尾的兜底定时器。 */
  timer: ReturnType<typeof setTimeout> | null;
  /** 正在念的这句所属的语音序号；undefined = 还没收到 start。 */
  waitingSeq: number | undefined;
  /** 正在念的文本：用来认出「这一句」的 start/end。 */
  waitingText: string | null;
  /** 念之前取到的播报序号基线；undefined = 端口不提供序号，只能按文本认句。 */
  baseline: number | undefined;
}

const state: SpeechState = {
  port: defaultPort(),
  pending: [],
  pendingKeys: [],
  playing: false,
  keys: new Map(),
  texts: new Map(),
  unsubscribe: null,
  timer: null,
  waitingSeq: undefined,
  waitingText: null,
  baseline: undefined,
};

/** 清一条时间记录之外的全部过期项，避免 Map 无限增长。 */
function pruneMaps(now: number): void {
  for (const [key, at] of state.keys) {
    if (now - at > DEDUPE_MS) state.keys.delete(key);
  }
  for (const [text, at] of state.texts) {
    if (now - at > DUPLICATE_TEXT_MS) state.texts.delete(text);
  }
}

/** 收尾：停定时器、清等待、继续下一句。 */
function settle(): void {
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.waitingSeq = undefined;
  state.waitingText = null;
  state.baseline = undefined;
  state.playing = false;
  pump();
}

/**
 * 语音链的 start / end：只认「我们这一句」。
 *
 * 认句优先用序号：`pump()` 在念之前记下播报序号基线，start 必须落在基线之后。
 * 端口给不出序号时才退化为按文本认（老链路/假端口），此时的取舍是「能继续往下念」优先。
 */
function onUtterance(event: VoiceUtteranceEvent): void {
  if (event.kind === 'start') {
    if (state.waitingText === null || state.waitingSeq !== undefined) return;
    if (event.text !== state.waitingText) return;
    // 别处念到同一句（文案池每档只有两句，很容易撞）不算自己的 start
    if (state.baseline !== undefined && event.seq <= state.baseline) return;
    state.waitingSeq = event.seq;
    return;
  }
  if (state.waitingText === null) return;
  if (state.waitingSeq !== undefined) {
    if (event.seq !== state.waitingSeq) return;
  } else if (state.baseline !== undefined) {
    // 有基线却没拿到自己的 start：这条 end 一定是别人的，等兜底超时，绝不提前推进
    return;
  } else if (event.text !== state.waitingText) {
    return;
  }
  settle();
}

/** 念下一句（若空闲且有排队）。 */
function pump(): void {
  if (state.playing) return;
  const now = state.port.now();
  let line = state.pending.shift();
  let key = state.pendingKeys.shift();
  // 过期句直接跳过：它们描述的是几十秒前的状态。
  while (line !== undefined && now - line.lineAt > MAX_STALE_MS) {
    line = state.pending.shift();
    key = state.pendingKeys.shift();
  }
  if (line === undefined || key === undefined) return;
  state.playing = true;
  state.waitingText = line.text;
  state.waitingSeq = undefined;
  // 必须先取基线再念：start 是 speak 内部同步发出的，晚取就落在基线之前了
  state.baseline = state.port.currentSeq?.();
  if (state.unsubscribe === null) state.unsubscribe = state.port.subscribe(onUtterance);
  // 语音链在任何结局（播完 / 合成失败 / 超时）都会发 end；这里只兜底一个「end 永远不来」。
  state.timer = setTimeout(() => {
    state.timer = null;
    settle();
  }, END_TIMEOUT_MS);
  state.timer.unref?.();
  state.port.speak(line.text);
}

/**
 * 入队一条播报。
 *
 * @param line - 要念的整句与它的来源；空文本忽略。
 */
export function enqueueFishLine(line: FishSpeechLine): void {
  const text = line.text.trim();
  if (text === '') return;
  const now = state.port.now();
  pruneMaps(now);
  const key = line.sessionId + '|' + line.kind + '|' + text;
  const seenKey = state.keys.get(key);
  if (seenKey !== undefined && now - seenKey < DEDUPE_MS) return;
  const seenText = state.texts.get(text);
  if (seenText !== undefined && now - seenText < DUPLICATE_TEXT_MS) {
    // 同一句刚念过（多半是另一个会话收工）：仍然记下 key，免得它 8s 后又被补念一次。
    state.keys.set(key, now);
    return;
  }
  state.keys.set(key, now);
  state.texts.set(text, now);
  const item: FishSpeechLine = { sessionId: line.sessionId, text, kind: line.kind, lineAt: line.lineAt };
  const priority = priorityOf(item.kind);
  // 插到最后一条「同优先级或更高优先级」之后：同级先进先出，要事可以插到进度句前面。
  let at = state.pending.length;
  while (at > 0 && priorityOf(state.pending[at - 1].kind) < priority) at -= 1;
  state.pending.splice(at, 0, item);
  state.pendingKeys.splice(at, 0, key);
  // 超限先丢最旧的进度句；没有进度句就丢队首（最旧的那条）。
  while (state.pending.length > MAX_PENDING) {
    const stale = state.pending.findIndex((entry) => entry.kind === 'progress');
    const drop = stale >= 0 ? stale : 0;
    state.pending.splice(drop, 1);
    state.pendingKeys.splice(drop, 1);
  }
  pump();
}

/**
 * 停掉队列并清空去重记录（浮层卸载 / 重置时调用）。
 */
export function stopFishSpeech(): void {
  const wasPlaying = state.playing;
  state.pending = [];
  state.pendingKeys = [];
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.playing = false;
  state.waitingSeq = undefined;
  state.waitingText = null;
  state.baseline = undefined;
  state.keys.clear();
  state.texts.clear();
  // 队列真在念时把正在响的那句也掐掉：浮层都卸载了，声音不该还在（没在念时不动，
  // 免得误停别的组件正在响的自动播报）。
  if (wasPlaying) state.port.stop?.();
}

/**
 * 换掉语音端口（只给测试用；传 null 恢复真实语音链）。
 *
 * @param port - 假端口或 null。
 */
export function configureFishSpeech(port: FishSpeechPort | null): void {
  stopFishSpeech();
  state.port = port ?? defaultPort();
}

/** 队列里还有几条（测试与观测用）。 */
export function pendingFishSpeech(): number {
  return state.pending.length;
}
