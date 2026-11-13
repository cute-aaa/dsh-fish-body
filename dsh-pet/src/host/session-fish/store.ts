/**
 * 会话鱼的宿主状态机：按会话聚合工作状态、播报与「结束待确认」。
 *
 * 纯内存、可单测：时钟与随机源都从构造参数注入，事件 → 结果不读全局、不写盘、不订阅。
 * 事件语义与 `session-watch` 同源，但**独立维护**自己的 turn 上下文（goal 续跑轮 / plan 审查），
 * 因为会话鱼要能回答「这一轮是不是整个任务结束了」，而不是只看档位。
 * 必须始终成立：`done` 只在「没有 plan 待确认、不是 goal 中间轮、活动门确认没活」之后才置位；
 * 点进会话（focus）是清掉 done 鱼的唯一入口，关闭（close）只隐藏到下一次 `turn/start`。
 * @module dsh-pet/src/host/session-fish/store
 */
import {
  effectiveSessionFishSkin,
  sessionFishSkinKindOf,
  type SessionFishEntry,
  type SessionFishLineKind,
  type SessionFishSettings,
  type SessionFishSnapshot,
  type SessionFishState,
} from '../../shared/session-fish.ts';
import {
  GOAL_UPDATE_TOOL,
  completedState,
  currentTaskFromTodo,
  goalUpdateAction,
  type WorkStatusTurnContext,
} from '../work-status.ts';
import { toolDetailFromEvent } from '../tool-detail.ts';
import { composeSessionFishLine, composeStillBusyLine } from './lines.ts';

/** 等待用户确认的工具名：计划审查 / 选择题。 */
const EXIT_PLAN_TOOL = 'exit_plan_mode';
const USER_QUESTION_TOOL = 'ask_user_question';

/** 会话级 turn 上下文：不随鱼被关闭/移除而消失（下一轮还要用）。 */
interface SessionFlags extends WorkStatusTurnContext {
  /** plan 模式是否处于激活状态（由 `plan/mode` 事件更新）。 */
  planActive: boolean;
  /** 是否有一次 plan 审查在等用户（由 `exit_plan_mode` 调用 / 结果更新）。 */
  planPending: boolean;
  /** 轮次世代号：新的 `turn/start` 递增，用于作废过期的活动门确认。 */
  turnEpoch: number;
}

/** 内部条目：wire 字段 + 只在本模块使用的状态。 */
interface InternalEntry {
  sessionId: string;
  state: SessionFishState;
  task: string | null;
  line: string | null;
  lineKind: SessionFishLineKind;
  lineSeq: number;
  lineAt: number;
  done: boolean;
  planPending: boolean;
  createdAt: number;
  updatedAt: number;
  lastProgressAt: number;
}

/** 一次会话事件的处理结果；装配层据此决定是否发布、是否排活动门定时器。 */
export interface SessionFishEventOutcome {
  /** 快照内容是否变化（含只改了任务/状态、没有新播报的情况）。 */
  readonly changed: boolean;
  /** 需要在延迟后确认活动门；`epoch` 用于期间来了新一轮时作废这次确认。 */
  readonly awaitDone?: { readonly sessionId: string; readonly epoch: number };
}

/** 构造参数：时钟、随机源与设置 getter（都注入，便于单测）。 */
export interface SessionFishStoreOptions {
  /** 当前设置；enabled / maxCount / progressGapMs 在调用时现取。 */
  readonly settings: () => SessionFishSettings;
  /** 当前时间（ms）。 */
  readonly now?: () => number;
  /** 随机源（[0,1)）；只用于从播报候选里挑一条。 */
  readonly pick?: () => number;
}

/** 会话事件的最小形状（宽松读取，缺字段按「不关心」处理）。 */
interface SessionEventLike {
  type?: string;
  data?: {
    reason?: { kind?: string };
    source?: { kind?: string };
    name?: unknown;
    arguments?: unknown;
    todos?: Array<{ status?: string; content?: string }>;
    active?: unknown;
  };
}

/** 会话鱼聚合（一个插件实例一个；进程内内存态）。 */
export class SessionFishStore {
  declare private readonly entries: Map<string, InternalEntry>;
  declare private readonly flags: Map<string, SessionFlags>;
  declare private readonly closed: Set<string>;
  declare private readonly lineSeq: Map<string, number>;
  declare private readonly settings: () => SessionFishSettings;
  declare private readonly now: () => number;
  declare private readonly pick: () => number;

  constructor(options: SessionFishStoreOptions) {
    this.entries = new Map();
    this.flags = new Map();
    this.closed = new Set();
    this.lineSeq = new Map();
    this.settings = options.settings;
    this.now = options.now ?? (() => Date.now());
    this.pick = options.pick ?? Math.random;
  }

  /** 该会话是否已有鱼（供装配层判断 focus 是否需要新建）。 */
  has(sessionId: string): boolean {
    return this.entries.has(sessionId);
  }

  /** 所有鱼按最近活动排序后的只读视图（测试 / 装配层观察用）。 */
  list(): readonly SessionFishEntry[] {
    return this.wireEntries();
  }

  /** turn 世代号；没有条目/上下文时返回 0。 */
  epochOf(sessionId: string): number {
    return this.flags.get(sessionId)?.turnEpoch ?? 0;
  }

  /**
   * 新建一条待命鱼（已关闭或总开关关掉时不建）。
   *
   * @returns 是否真的新建。
   */
  ensureIdle(sessionId: string): boolean {
    const settings = this.settings();
    if (!settings.enabled || this.closed.has(sessionId) || this.entries.has(sessionId)) return false;
    const at = this.now();
    const entry: InternalEntry = {
      sessionId,
      state: 'idle',
      task: null,
      line: null,
      lineKind: 'idle',
      lineSeq: 0,
      lineAt: at,
      done: false,
      planPending: false,
      createdAt: at,
      updatedAt: at,
      lastProgressAt: 0,
    };
    this.entries.set(sessionId, entry);
    this.emitLine(entry, 'idle', 'idle', null, true);
    this.prune();
    return true;
  }

  /**
   * 用户点进某个会话（浏览器报告）。
   *
   * 已完成的鱼在这里消失；正在跑的鱼保持。没有鱼时，只有「新建空白会话」或「正在跑」才补一条。
   *
   * @param sessionId - 会话 id。
   * @param options - blank/running 来自客户端会话列表；判据缺失按 false。
   * @returns 快照是否变化。
   */
  focus(sessionId: string, options: { blank?: boolean; running?: boolean } = {}): boolean {
    const settings = this.settings();
    if (!settings.enabled || sessionId === '' || this.closed.has(sessionId)) return false;
    const entry = this.entries.get(sessionId);
    if (entry) {
      if (!entry.done) return false;
      this.entries.delete(sessionId);
      return true;
    }
    if (options.blank === true || options.running === true) return this.ensureIdle(sessionId);
    return false;
  }

  /** 用户点某条鱼的 ×：移除并隐藏到下一次 `turn/start`。 */
  close(sessionId: string): boolean {
    this.closed.add(sessionId);
    return this.entries.delete(sessionId);
  }

  /** 设置关闭时清空全部鱼（保留 turn 上下文与关闭标记，重新打开时下一轮照常出现）。 */
  clearAll(): boolean {
    if (this.entries.size === 0) return false;
    this.entries.clear();
    return true;
  }

  /**
   * 处理一条会话事件。
   *
   * @param sessionId - 事件所属会话（调用方已过滤 unknown / 子代理）。
   * @param event - `session/event` 的子事件。
   * @returns 是否变化，以及是否需要延迟确认活动门。
   */
  applyEvent(sessionId: string, event: SessionEventLike): SessionFishEventOutcome {
    const type = event.type;
    if (!type || sessionId === '' || !this.settings().enabled) return { changed: false };
    const flags = this.flagsOf(sessionId);
    switch (type) {
      case 'plan/mode':
        // plan 激活与否只影响「这一轮结束后算不算真结束」；没有鱼也照记，下一轮要用。
        if (typeof event.data?.active === 'boolean') flags.planActive = event.data.active;
        return { changed: false };
      case 'user/message':
        if (event.data?.source?.kind === 'goal') flags.goalRound = true;
        // 用户再次对话：清掉「被关掉」标记，鱼随后由 turn/start 建出来（这里不建，
        // 否则中间会多出一条「新会话待命」的播报，插在正常对话里很突兀）。
        this.closed.delete(sessionId);
        return { changed: false };
      case 'turn/start': {
        flags.goalRound = false;
        flags.closing = null;
        flags.planPending = false;
        flags.turnEpoch += 1;
        this.closed.delete(sessionId);
        this.ensureIdle(sessionId);
        const entry = this.entries.get(sessionId);
        if (entry) {
          // 新一轮是新的任务上下文：上一轮的详情与完成态都清掉。
          entry.task = null;
          entry.done = false;
          entry.planPending = false;
          entry.updatedAt = this.now();
        }
        return this.applyProgress(sessionId, flags, 'thinking', null, true);
      }
      case 'todo/write': {
        const entry = this.entries.get(sessionId);
        if (!entry) return { changed: false }; // 已关闭/已确认的会话不再写幽灵任务
        const task = currentTaskFromTodo(event as { data?: { todos?: Array<{ status?: string; content?: string }> } });
        // 清单可能被连续改写：任务文案实时更新即可，播报仍走进度节流。
        return this.applyProgress(sessionId, flags, entry.state, task, false);
      }
      case 'tool/call': {
        const name = String(event.data?.name ?? '');
        if (name === EXIT_PLAN_TOOL) flags.planPending = true;
        // update_goal 的收尾动作决定 completed 是「整个目标结束」还是「中间轮完成」。
        if (name === GOAL_UPDATE_TOOL) {
          const action = goalUpdateAction(String(event.data?.arguments ?? ''));
          if (action) flags.closing = action;
        }
        const next: SessionFishState = name === EXIT_PLAN_TOOL || name === USER_QUESTION_TOOL ? 'waiting' : 'working';
        const detail = toolDetailFromEvent(event as { data?: { name?: unknown; arguments?: unknown } });
        const task = detail ?? this.entries.get(sessionId)?.task ?? null;
        return this.applyProgress(sessionId, flags, next, task, next === 'waiting');
      }
      case 'tool/result':
        flags.planPending = false;
        return this.applyProgress(sessionId, flags, 'result', this.entries.get(sessionId)?.task ?? null, false);
      case 'approval/asked':
        return this.applyProgress(sessionId, flags, 'waiting', this.entries.get(sessionId)?.task ?? null, true);
      case 'turn/end':
        return this.applyTurnEnd(sessionId, flags, event);
      default:
        return { changed: false };
    }
  }

  /**
   * 活动门通过后标记任务完成（不新增播报，轮次结束那句已经念过）。
   *
   * @param sessionId - 会话 id。
   * @param epoch - 排这次确认时的世代号；期间来了新一轮则忽略。
   */
  markDone(sessionId: string, epoch: number): boolean {
    if (this.epochOf(sessionId) !== epoch) return false;
    const entry = this.entries.get(sessionId);
    if (!entry || entry.done) return false;
    entry.done = true;
    entry.updatedAt = this.now();
    return true;
  }

  /**
   * 活动门判定还有活：把刚显示的终态压回工作态，但仍不算完成。
   *
   * @param sessionId - 会话 id。
   * @param epoch - 排确认时的世代号。
   */
  markStillBusy(sessionId: string, epoch: number, speak = false): boolean {
    if (this.epochOf(sessionId) !== epoch) return false;
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    const at = this.now();
    entry.state = 'working';
    entry.done = false;
    entry.updatedAt = at;
    if (speak) {
      entry.line = composeStillBusyLine(this.pick);
      entry.lineKind = 'turnEnd';
      entry.lineAt = at;
      entry.lineSeq = this.nextLineSeq(sessionId);
    }
    return true;
  }

  /** 生成 `/state` 叶子载荷；`ts` 供消费端判重，不参与发布签名。 */
  snapshot(): SessionFishSnapshot {
    const settings = this.settings();
    // 皮肤名在快照里就已经是「生效值」：空设置换成默认皮肤，渲染方式一并算好，
    // 客户端不必再判扩展名（两端各判一次迟早会分叉）。
    const skin = effectiveSessionFishSkin(settings.skin);
    return {
      enabled: settings.enabled,
      sizePx: settings.sizePx,
      maxCount: settings.maxCount,
      bubbleMs: settings.bubbleMs,
      skin,
      skinKind: sessionFishSkinKindOf(skin) ?? 'video',
      followPet: settings.followPet,
      speakEnabled: settings.speakEnabled,
      speakProgress: settings.speakProgress,
      speakTurnEnd: settings.speakTurnEnd,
      speakWaiting: settings.speakWaiting,
      fishes: this.wireEntries(),
      ts: this.now(),
    };
  }

  /** 取/建 turn 上下文。 */
  private flagsOf(sessionId: string): SessionFlags {
    let flags = this.flags.get(sessionId);
    if (!flags) {
      flags = { goalRound: false, closing: null, planActive: false, planPending: false, turnEpoch: 0 };
      this.flags.set(sessionId, flags);
    }
    return flags;
  }

  /** 下一次播报序号：跨「关闭 → 复活」保持单调，消费端才不会把新播报当成旧的。 */
  private nextLineSeq(sessionId: string): number {
    const next = (this.lineSeq.get(sessionId) ?? 0) + 1;
    this.lineSeq.set(sessionId, next);
    return next;
  }

  /** 更新条目并写一条播报（进度类按 progressGapMs 节流；`force` 跳过节流）。 */
  private applyProgress(
    sessionId: string,
    flags: SessionFlags,
    state: SessionFishState,
    task: string | null,
    force: boolean,
  ): SessionFishEventOutcome {
    const entry = this.entries.get(sessionId);
    if (!entry) {
      // 事件先于 turn/start（老会话恢复、外部写入）：补一条鱼，状态按本次事件走。
      if (!this.ensureIdle(sessionId)) return { changed: false };
      return this.applyProgress(sessionId, flags, state, task, true);
    }
    const at = this.now();
    let changed = false;
    if (entry.state !== state) {
      entry.state = state;
      changed = true;
    }
    if (task !== null && entry.task !== task) {
      entry.task = task;
      changed = true;
    }
    if (entry.planPending !== flags.planPending) {
      entry.planPending = flags.planPending;
      changed = true;
    }
    if (this.emitLine(entry, 'progress', state, entry.task, force)) changed = true;
    if (changed) entry.updatedAt = at;
    this.prune();
    return { changed };
  }

  /** `turn/end` 的分支：plan 等待、goal 中间轮、真完成、出错、取消。 */
  private applyTurnEnd(sessionId: string, flags: SessionFlags, event: SessionEventLike): SessionFishEventOutcome {
    const kind = String(event.data?.reason?.kind ?? '');
    const entry = this.entries.get(sessionId);
    if (!entry) return { changed: false };
    if (kind === 'completed') {
      // plan 模式：计划还没被批准，等待确认不算结束，也不进入「完成待点开」。
      if (flags.planActive || flags.planPending) {
        flags.planPending = true;
        return this.applyProgress(sessionId, flags, 'waiting', entry.task, true);
      }
      const terminal = completedState(flags);
      const at = this.now();
      entry.state = terminal;
      entry.done = false;
      entry.planPending = false;
      entry.updatedAt = at;
      // 轮次结束播报：中间轮（goal 续跑）也是「轮次结束」，但不是任务结束。
      this.emitLine(entry, 'turnEnd', terminal, entry.task, true);
      if (terminal === 'result') return { changed: true };
      return { changed: true, awaitDone: { sessionId, epoch: flags.turnEpoch } };
    }
    if (kind === 'error' || kind === 'max-tokens' || kind === 'timeout') {
      entry.state = 'error';
      entry.done = true;
      entry.planPending = false;
      entry.updatedAt = this.now();
      this.emitLine(entry, 'turnEnd', 'error', entry.task, true);
      return { changed: true };
    }
    if (kind === 'blocked') {
      flags.planPending = true;
      return this.applyProgress(sessionId, flags, 'waiting', entry.task, true);
    }
    // aborted / interrupted / 未知：用户取消了这一轮，不留完成态。
    this.entries.delete(sessionId);
    flags.goalRound = false;
    flags.closing = null;
    flags.planPending = false;
    flags.turnEpoch += 1;
    return { changed: true };
  }

  /** 写一条播报；进度类若距上一条不足 progressGapMs 且未 force，则只更新状态不换文案。 */
  private emitLine(
    entry: InternalEntry,
    kind: SessionFishLineKind,
    state: SessionFishState,
    task: string | null,
    force: boolean,
  ): boolean {
    const at = this.now();
    const gap = this.settings().progressGapMs;
    if (kind === 'progress' && !force && at - entry.lastProgressAt < gap) return false;
    const line = composeSessionFishLine(kind, state, task, this.pick);
    entry.line = line;
    entry.lineKind = kind;
    entry.lineAt = at;
    entry.lineSeq = this.nextLineSeq(entry.sessionId);
    if (kind === 'progress') entry.lastProgressAt = at;
    return true;
  }

  /** 超上限时淘汰：先逐出最早完成的，再逐出最早活动的。 */
  private prune(): void {
    const max = Math.max(1, Math.floor(this.settings().maxCount));
    while (this.entries.size > max) {
      const candidates = [...this.entries.values()].sort((a, b) => {
        if (a.done !== b.done) return a.done ? -1 : 1;
        return a.updatedAt - b.updatedAt;
      });
      const victim = candidates[0];
      if (!victim) return;
      this.entries.delete(victim.sessionId);
    }
  }

  /** 条目 → wire 列表（最近活动在前；宿主已按上限裁过）。 */
  private wireEntries(): SessionFishEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.sessionId.localeCompare(b.sessionId))
      .map((e) => ({
        sessionId: e.sessionId,
        state: e.state,
        task: e.task,
        line: e.line,
        lineKind: e.lineKind,
        lineSeq: e.lineSeq,
        lineAt: e.lineAt,
        done: e.done,
        planPending: e.planPending,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      }));
  }
}
