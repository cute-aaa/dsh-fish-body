/**
 * 会话鱼（Session Fish）：两端共用的 wire 形状、范围常量与只读解析。
 *
 * 状态由宿主写进 `/state` 的 `sections.sessionFish`，浏览器只读；本模块不产生状态、不读时钟。
 * 解析一律「形状非法 → null / 丢条目」，让消费端跳过这一拍，而不是拿半份数据去渲染。
 * @module dsh-pet/src/shared/session-fish
 */

/** 会话鱼显示宽度下限（px；16:9 的小动画）。 */
export const SESSION_FISH_SIZE_MIN = 48;
/** 会话鱼显示宽度上限（px）。 */
export const SESSION_FISH_SIZE_MAX = 160;
/** 会话鱼显示宽度默认值（px）：小尺寸，不抢桌宠的视线。 */
export const SESSION_FISH_SIZE_DEFAULT = 96;
/** 同时存在的会话鱼数量下限。 */
export const SESSION_FISH_MAX_COUNT_MIN = 1;
/** 同时存在的会话鱼数量上限。 */
export const SESSION_FISH_MAX_COUNT_MAX = 12;
/** 同时存在的会话鱼数量默认值。 */
export const SESSION_FISH_MAX_COUNT_DEFAULT = 6;
/** 气泡停留时长的下限（ms）。 */
export const SESSION_FISH_BUBBLE_MS_MIN = 4_000;
/** 气泡停留时长的上限（ms）。 */
export const SESSION_FISH_BUBBLE_MS_MAX = 60_000;
/** 气泡停留时长的默认值（ms）。 */
export const SESSION_FISH_BUBBLE_MS_DEFAULT = 12_000;
/** 进度播报的最小间隔下限（ms）。 */
export const SESSION_FISH_PROGRESS_GAP_MS_MIN = 5_000;
/** 进度播报的最小间隔上限（ms）。 */
export const SESSION_FISH_PROGRESS_GAP_MS_MAX = 600_000;
/** 进度播报的最小间隔默认值（ms）：工具连跑时不要每步都念。 */
export const SESSION_FISH_PROGRESS_GAP_MS_DEFAULT = 15_000;

/** 默认皮肤：包内 `assets/webm/` 里那段写代码的小动作。 */
export const SESSION_FISH_SKIN_DEFAULT = '写代码.webm';
/** 皮肤允许的扩展名：视频（webm/mp4）与图片/动图（png/jpg/jpeg/gif/webp）。 */
export const SESSION_FISH_SKIN_EXTS = ['.webm', '.mp4', '.png', '.jpg', '.jpeg', '.gif', '.webp'] as const;
/** 皮肤 id（文件名）长度上限：够放中文名 + 扩展名，又不至于变成一段路径。 */
export const SESSION_FISH_SKIN_MAX_LEN = 120;

/** 皮肤的渲染方式：视频用 `<video>`，图片与动图用 `<img>`。 */
export type SessionFishSkinKind = 'video' | 'image';

/** 工作状态档位；与 `shared/work-status.ts` 的档位同名，另多一个 `idle`（空白会话待命）。 */
export const SESSION_FISH_STATES = ['idle', 'thinking', 'working', 'result', 'waiting', 'success', 'error'] as const;
export type SessionFishState = (typeof SESSION_FISH_STATES)[number];

/** 一条播报的类型：决定这次要不要念、气泡算不算「完成」。 */
export const SESSION_FISH_LINE_KINDS = ['idle', 'progress', 'turnEnd', 'done'] as const;
export type SessionFishLineKind = (typeof SESSION_FISH_LINE_KINDS)[number];

/** 会话鱼的设置（独立文件 `session-fish.json`；默认值见 {@link DEFAULT_SESSION_FISH_SETTINGS}）。 */
export interface SessionFishSettings {
  /** 总开关：关掉后不建鱼、不写播报，浮层也不渲染。 */
  readonly enabled: boolean;
  /** 小动画的显示宽度（px；高度按 16:9 换算）。 */
  readonly sizePx: number;
  /** 同时最多几条鱼；超出时宿主先淘汰最早完成的。 */
  readonly maxCount: number;
  /** 气泡在一条播报后停留多久（ms）。 */
  readonly bubbleMs: number;
  /** 皮肤 id：素材名（`写代码.webm`、`我的鱼.gif`）；空串 = 默认皮肤。 */
  readonly skin: string;
  /** 是否围着桌宠转：关掉后回到右下角竖排（拖拽与持久化语义不变）。 */
  readonly followPet: boolean;
  /** 语音播报总开关；关掉后三类播报都不出声，气泡照常。 */
  readonly speakEnabled: boolean;
  /** 进度类播报是否念出来。 */
  readonly speakProgress: boolean;
  /** 轮次结束播报是否念出来。 */
  readonly speakTurnEnd: boolean;
  /** 等待确认（审批 / 计划审查）播报是否念出来。 */
  readonly speakWaiting: boolean;
  /** 同一会话两条进度播报之间的最小间隔（ms）。 */
  readonly progressGapMs: number;
}

/** 设置默认值：唯一真源；宿主解析与设置页兜底都从这里取。 */
export const DEFAULT_SESSION_FISH_SETTINGS: SessionFishSettings = {
  enabled: true,
  sizePx: SESSION_FISH_SIZE_DEFAULT,
  maxCount: SESSION_FISH_MAX_COUNT_DEFAULT,
  bubbleMs: SESSION_FISH_BUBBLE_MS_DEFAULT,
  skin: '',
  followPet: true,
  speakEnabled: true,
  speakProgress: true,
  speakTurnEnd: true,
  speakWaiting: true,
  progressGapMs: SESSION_FISH_PROGRESS_GAP_MS_DEFAULT,
};

/** 一条会话鱼（= `/state` 里 `sections.sessionFish.data.fishes[i]`）。 */
export interface SessionFishEntry {
  /** 该鱼对应的 DSH 会话。 */
  readonly sessionId: string;
  /** 当前档位。 */
  readonly state: SessionFishState;
  /** 当前任务详情（todo/write 或工具描述）；没有则 null。 */
  readonly task: string | null;
  /** 最近一条播报文案；没有则 null。 */
  readonly line: string | null;
  /** 最近一条播报的类型。 */
  readonly lineKind: SessionFishLineKind;
  /** 播报序号：每产生一条新播报 +1，消费端据此只念一次。 */
  readonly lineSeq: number;
  /** 最近一条播报的时间戳（ms）。 */
  readonly lineAt: number;
  /** 任务结束、等用户点进该会话。 */
  readonly done: boolean;
  /** 正在等用户审查计划（plan 模式），不算结束。 */
  readonly planPending: boolean;
  /** 建鱼时间。 */
  readonly createdAt: number;
  /** 最近活动时间。 */
  readonly updatedAt: number;
}

/** `/state` 的会话鱼叶子载荷。 */
export interface SessionFishSnapshot {
  readonly enabled: boolean;
  readonly sizePx: number;
  readonly maxCount: number;
  readonly bubbleMs: number;
  /** 生效的皮肤 id（空设置已换成默认皮肤名）。 */
  readonly skin: string;
  /** 皮肤的渲染方式，客户端据此选 `<video>` 还是 `<img>`。 */
  readonly skinKind: SessionFishSkinKind;
  /** 是否围着桌宠转。 */
  readonly followPet: boolean;
  readonly speakEnabled: boolean;
  readonly speakProgress: boolean;
  readonly speakTurnEnd: boolean;
  readonly speakWaiting: boolean;
  readonly fishes: readonly SessionFishEntry[];
  readonly ts: number;
}

/** 取小写扩展名（含点）；没有扩展名时返回空串。 */
function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * 皮肤文件名 → 渲染方式；扩展名不认识时 `null`。
 *
 * 只按扩展名判：素材真伪由宿主在 `GET /session-fish/skin` 落盘时保证，客户端不探测内容。
 *
 * @param name - 皮肤 id（文件名）。
 * @returns `video` / `image`；无法判定时 null。
 */
export function sessionFishSkinKindOf(name: unknown): SessionFishSkinKind | null {
  if (typeof name !== 'string' || name === '') return null;
  const ext = extOf(name);
  if (ext === '.webm' || ext === '.mp4') return 'video';
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.webp') return 'image';
  return null;
}

/**
 * 皮肤 id 是否可接受（设置写侧的唯一口径）。
 *
 * 只允许「一个文件名」：不含路径分隔符与 `..`、不以点开头、长度受限、扩展名在白名单里。
 * 宿主取文件时仍会再过一遍 `resolveExisting`，这里是第一道、也是给用户看的那道。
 *
 * @param name - 待校验的皮肤 id；空串合法（= 用默认皮肤）。
 * @returns 可写入设置时 true。
 */
export function isSessionFishSkinName(name: string): boolean {
  if (name === '') return true;
  if (name.length > SESSION_FISH_SKIN_MAX_LEN) return false;
  if (name.startsWith('.')) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  // 控制字符一律拒（文件名里本来就不该有，URL 里也表达不出来）
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return sessionFishSkinKindOf(name) !== null;
}

/**
 * 生效的皮肤 id：设置里的空串换成默认皮肤。
 *
 * @param skin - 设置值（可能为空/脏值）。
 * @returns 一定非空且可直接拼地址的皮肤 id。
 */
export function effectiveSessionFishSkin(skin: unknown): string {
  if (typeof skin !== 'string' || skin === '' || !isSessionFishSkinName(skin)) return SESSION_FISH_SKIN_DEFAULT;
  return skin;
}

/**
 * 这一份快照是否由会话鱼接管「自动播报」。
 *
 * 桌宠自己的「工作状态播报」与会话鱼播的是同一件事：有人接管时旧播报必须让路，
 * 否则一次 turn/end 会被念两遍。总开关（`enabled`）或语音总开关（`speakEnabled`）关掉时
 * 会话鱼不出声，旧播报就该恢复工作——这是共享给两端的一口径，不各写一份。
 *
 * @param snapshot - `/state` 里的会话鱼快照；缺失/非法按「没接管」处理。
 * @returns 会话鱼是否有鱼要念。
 */
export function ownsSessionFishSpeech(
  snapshot: Pick<SessionFishSnapshot, 'enabled' | 'speakEnabled' | 'fishes'> | null | undefined,
): boolean {
  if (!snapshot) return false;
  return snapshot.enabled === true && snapshot.speakEnabled === true && snapshot.fishes.length > 0;
}

/** 是否合法档位。 */
export function isSessionFishState(value: unknown): value is SessionFishState {
  return typeof value === 'string' && (SESSION_FISH_STATES as readonly string[]).includes(value);
}

/** 是否合法播报类型。 */
export function isSessionFishLineKind(value: unknown): value is SessionFishLineKind {
  return typeof value === 'string' && (SESSION_FISH_LINE_KINDS as readonly string[]).includes(value);
}

/** 取有限数字；否则用兜底值。 */
function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 布尔；否则用兜底值。 */
function boolOf(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * 解析一条鱼；形状非法（缺 sessionId / 档位不认识 / 计数不是数字）→ null。
 *
 * 播报字段缺省时按「没有播报」处理（老宿主 / 数据被裁），不因此丢掉整条鱼：
 * 鱼本身还在工作，气泡可以退回状态文案。
 */
function readSessionFishEntry(raw: unknown): SessionFishEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const sessionId = typeof r.sessionId === 'string' ? r.sessionId : '';
  if (sessionId === '') return null;
  if (!isSessionFishState(r.state)) return null;
  const lineSeq = finiteNumber(r.lineSeq, 0);
  const lineKind = isSessionFishLineKind(r.lineKind) ? r.lineKind : 'progress';
  return {
    sessionId,
    state: r.state,
    task: typeof r.task === 'string' && r.task !== '' ? r.task : null,
    line: typeof r.line === 'string' && r.line !== '' ? r.line : null,
    lineKind,
    lineSeq: lineSeq >= 0 ? Math.floor(lineSeq) : 0,
    lineAt: finiteNumber(r.lineAt, 0),
    done: r.done === true,
    planPending: r.planPending === true,
    createdAt: finiteNumber(r.createdAt, 0),
    updatedAt: finiteNumber(r.updatedAt, 0),
  };
}

/**
 * 解析 `/state` 的会话鱼叶子。
 *
 * @param raw - 叶子 `data`；宿主可能给了 null / 脏数据。
 * @returns 规范化快照；顶层形状非法时 null（消费端整拍跳过），单条鱼非法时只丢那一条。
 */
export function readSessionFish(raw: unknown): SessionFishSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled !== 'boolean') return null;
  const rawFishes = Array.isArray(r.fishes) ? r.fishes : [];
  const fishes: SessionFishEntry[] = [];
  for (const item of rawFishes) {
    const entry = readSessionFishEntry(item);
    if (entry) fishes.push(entry);
  }
  // 皮肤：空串/脏名都退回默认皮肤；渲染方式跟着 id 走，客户端不自己判扩展名。
  const skin = effectiveSessionFishSkin(r.skin);
  return {
    enabled: r.enabled,
    sizePx: finiteNumber(r.sizePx, SESSION_FISH_SIZE_DEFAULT),
    maxCount: finiteNumber(r.maxCount, SESSION_FISH_MAX_COUNT_DEFAULT),
    bubbleMs: finiteNumber(r.bubbleMs, SESSION_FISH_BUBBLE_MS_DEFAULT),
    skin,
    skinKind: sessionFishSkinKindOf(skin) ?? 'video',
    followPet: boolOf(r.followPet, DEFAULT_SESSION_FISH_SETTINGS.followPet),
    speakEnabled: boolOf(r.speakEnabled, DEFAULT_SESSION_FISH_SETTINGS.speakEnabled),
    speakProgress: boolOf(r.speakProgress, DEFAULT_SESSION_FISH_SETTINGS.speakProgress),
    speakTurnEnd: boolOf(r.speakTurnEnd, DEFAULT_SESSION_FISH_SETTINGS.speakTurnEnd),
    speakWaiting: boolOf(r.speakWaiting, DEFAULT_SESSION_FISH_SETTINGS.speakWaiting),
    fishes,
    ts: finiteNumber(r.ts, 0),
  };
}

/** 一条鱼当前该不该显示气泡：完成态常驻（用户还没点进来），否则只在停留窗口内显示。 */
export function isSessionFishBubbleVisible(entry: SessionFishEntry, now: number, bubbleMs: number): boolean {
  if (entry.done) return true;
  if (entry.line === null) return false;
  return now - entry.lineAt < bubbleMs;
}

/**
 * 这一拍要不要念某条鱼的播报。
 *
 * 只认「新序号」：`lastSeq` 已见过同一个序号就不重复念（轮询每拍都会拿到同一份快照）。
 * 首拍由调用方传入 undefined 并只记基线（页面刚打开时不补念历史）。
 *
 * @param entry - 当前鱼。
 * @param lastSeq - 上次念过的序号；首见传 `undefined`。
 * @param settings - 播报开关。
 * @returns 要念的文案；不该念时 undefined。
 */
export function sessionFishSpeechOf(
  entry: SessionFishEntry,
  lastSeq: number | undefined,
  settings: Pick<SessionFishSnapshot, 'speakEnabled' | 'speakProgress' | 'speakTurnEnd' | 'speakWaiting'>,
): string | undefined {
  if (lastSeq === undefined || entry.lineSeq <= lastSeq || entry.line === null) return undefined;
  if (!settings.speakEnabled) return undefined;
  if (entry.lineKind === 'progress') {
    // 计划审查 / 选择题也发 progress，但文案由「等待确认」开关管，不受进度开关影响。
    if (entry.state === 'waiting') return settings.speakWaiting ? entry.line : undefined;
    return settings.speakProgress ? entry.line : undefined;
  }
  if (entry.lineKind === 'turnEnd' || entry.lineKind === 'done') return settings.speakTurnEnd ? entry.line : undefined;
  return undefined;
}

/** 按最近活动截到上限，再按创建先后排稳定位置（活动变化不该让鱼在默认堆叠里跳来跳去）。 */
export function selectSessionFishes(fishes: readonly SessionFishEntry[], maxCount: number): SessionFishEntry[] {
  const limit = Math.max(1, Math.floor(maxCount));
  const active = [...fishes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  return active.sort((a, b) => a.createdAt - b.createdAt || a.sessionId.localeCompare(b.sessionId));
}
