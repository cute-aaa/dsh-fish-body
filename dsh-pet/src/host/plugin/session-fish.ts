/**
 * 会话鱼的事件装配：把 DSH 会话事件喂给状态机，按「活动门」确认任务真的结束，并发布快照。
 *
 * 不定义状态语义（归 ../session-fish/store）也不渲染：这里只做事件过滤、延迟确认与叶子写入。
 * 必须始终成立：只有会话门放行、且不是 unknown/子代理的会话才进状态机；发布内容没变就不写叶子
 * （每次写都推进 counter，会吵醒所有长轮询）。
 * @module dsh-pet/src/host/plugin/session-fish
 */
import { hasBlockingActivity, sessionIdOf, shouldNotifySession } from '../notify-events.ts';
import type { PollStateStore } from '../state.ts';
import type { SessionFishStore } from '../session-fish/store.ts';
import type { HostContext } from './context.ts';

/** 完成后的活动门延迟：与系统通知同值同因——`turn/end` 写在回合体的 finally 里，同步查自己还是 running。 */
const DONE_CHECK_MS = 1500;

/** waterfall 的最小签名（DSH 未导出该事件的请求/响应类型）。 */
type Waterfall = (name: string, request: unknown, next: () => Promise<unknown[]>) => Promise<unknown>;

/** 会话鱼桥的输入。 */
export interface SessionFishBridgeInput {
  /** 轮询快照：唯一出口。 */
  readonly state: PollStateStore;
  /** 会话鱼状态机。 */
  readonly store: SessionFishStore;
}

/** 会话鱼桥：发布函数（事件装配与路由共用）。 */
export interface SessionFishBridge {
  /** 内容变化时把快照写进 `/state`；没变化是空操作。 */
  publishSessionFish(): void;
}

/** 快照发布签名：`ts` 每次都变，不参与比较。 */
function signatureOf(snapshot: unknown): string {
  return JSON.stringify(snapshot, (key, value) => (key === 'ts' ? 0 : value));
}

/**
 * 创建快照桥。
 *
 * @param deps - 快照与状态机。
 * @returns 发布函数；首次调用总会写一次，让页面启动时就能读到启停与尺寸。
 */
export function createSessionFishBridge(deps: SessionFishBridgeInput): SessionFishBridge {
  let published = '\u0000';
  const publishSessionFish = (): void => {
    const snapshot = deps.store.snapshot();
    const key = signatureOf(snapshot);
    if (key === published) return;
    published = key;
    deps.state.writeSection('sessionFish', snapshot);
  };
  return { publishSessionFish };
}

/** 会话鱼事件装配的输入。 */
export interface RegisterSessionFishInput {
  /** 宿主上下文（apply 收到的那一个）。 */
  readonly ctx: HostContext;
  /** 状态机。 */
  readonly store: SessionFishStore;
  /** 快照发布。 */
  readonly publishSessionFish: () => void;
}

/** 事件装配的产出：卸载时清掉活动门定时器。 */
export interface SessionFishRuntime {
  /** 停止全部待确认定时器（插件卸载 / 关闭）。 */
  stopSessionFishTimers(): void;
}

/**
 * 注册会话事件监听与完成确认。
 *
 * @param deps - 宿主上下文、状态机与发布函数。
 * @returns 定时器清理入口，由生命周期统一调用。
 */
export function registerSessionFish(deps: RegisterSessionFishInput): SessionFishRuntime {
  const { ctx, store, publishSessionFish } = deps;
  /** 每会话一个待确认定时器；新一轮到来自动作废（epoch 也会兜底）。 */
  const doneTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const cancelDoneCheck = (sessionId: string): void => {
    const timer = doneTimers.get(sessionId);
    if (timer === undefined) return;
    clearTimeout(timer);
    doneTimers.delete(sessionId);
  };

  const stopSessionFishTimers = (): void => {
    for (const timer of doneTimers.values()) clearTimeout(timer);
    doneTimers.clear();
  };

  /** 这条会话是否还有在跑的活；判据不可用一律 false＝视为已收工（与系统通知同一取向）。 */
  const sessionHasRunningWork = async (sessionId: string): Promise<boolean> => {
    const waterfall = (ctx as { waterfall?: Waterfall }).waterfall;
    if (typeof waterfall !== 'function') return false;
    try {
      const activity = await waterfall.call(ctx, 'workspace/session-activity', { sessionId }, () =>
        Promise.resolve([]),
      );
      return hasBlockingActivity(activity);
    } catch {
      return false;
    }
  };

  const scheduleDoneCheck = (sessionId: string, epoch: number): void => {
    cancelDoneCheck(sessionId);
    const timer = setTimeout(() => {
      doneTimers.delete(sessionId);
      void (async () => {
        if (await sessionHasRunningWork(sessionId)) {
          // 还有子代理 / 后台任务：把刚显示的终态压回工作态，不置 done。
          if (store.markStillBusy(sessionId, epoch, true)) publishSessionFish();
          return;
        }
        if (store.markDone(sessionId, epoch)) publishSessionFish();
      })();
    }, DONE_CHECK_MS);
    // 与宿主其余定时器同一策略：别把进程钉在事件循环里（node:test 下保留）
    if (process.env.NODE_TEST_CONTEXT === undefined) timer.unref?.();
    doneTimers.set(sessionId, timer);
  };

  ctx.effect(() => {
    const dispose = ctx.on('session/event', (session: unknown, event: unknown) => {
      // 会话门：子代理 / 委派会话不生成会话鱼——你等的是父对话，不是某一路子代理。
      if (!shouldNotifySession(session)) return;
      const sessionId = sessionIdOf(session);
      if (sessionId === 'unknown') return;
      const type = (event as { type?: string } | null)?.type;
      if (type === 'turn/start') cancelDoneCheck(sessionId);
      const outcome = store.applyEvent(sessionId, (event ?? {}) as Parameters<SessionFishStore['applyEvent']>[1]);
      if (outcome.changed) publishSessionFish();
      if (outcome.awaitDone) scheduleDoneCheck(outcome.awaitDone.sessionId, outcome.awaitDone.epoch);
    });
    return () => {
      dispose();
      stopSessionFishTimers();
    };
  }, 'dsh-pet: session fish events');

  // 刻意不在启动时发布：`/state` 的初始叶子必须保持 `{counter:0,data:null}`（前端首拉当基线），
  // 没鱼时也没什么可显示的；第一条鱼（或一次设置保存）第一次写叶子时页面自然就拿到了脚本参数。
  return { stopSessionFishTimers };
}
