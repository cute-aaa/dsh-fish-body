/**
 * live2d 的「叠加层」：动作与外观各自成层，可同时挂多个，且不打断内置待机。
 *
 * 为什么要自己管队列：pixi-live2d-display 0.4.0 的 cubism4 后端把所有 motion 塞进**同一个**
 * `MotionQueueManager`，`_startMotion` 一进来就 `stopAllMotions()`——用 `model.motion()` 点第二个动作，
 * 第一个立刻被掐掉，待机也跟着没了。VTube 的用法恰恰相反：热键动作叠在待机之上，
 * 「举手」「竖手指」「狗尾巴草」三种姿态还能同时保持。
 *
 * 做法：每条叠加物一个独立队列，在 `internalModel` 的 `beforeModelUpdate` 里依次推进。
 * 那个钩子在 `model.update()` 之前、`loadParameters()` 之前，所以写入只影响本帧，
 * 不会把姿态污染成下一帧的基准。
 * @module dsh-pet/src/client/pet/render/live2d/overlay
 */
import { parseMotion3, type MotionFinalValue } from '../../../../shared/live2d-motion3.ts';

/** 叠加层要写的模型能力（CubismModel 的子集）。 */
export interface OverlayCoreModel {
  setParameterValueById(id: string, value: number, weight?: number): void;
  setPartOpacityById?(id: string, value: number): void;
}

/** 叠加层创建出的动作对象（ACubismMotion 的子集）。 */
export interface OverlayMotion {
  setFadeInTime?(seconds: number): void;
  setFadeOutTime?(seconds: number): void;
  setIsLoop?(loop: boolean): void;
}

/** 一条独立队列（CubismMotionQueueManager 的子集）。 */
export interface OverlayQueue {
  setEventCallback?(callback: () => void): void;
  startMotion(motion: OverlayMotion, autoDelete: boolean, nowSeconds: number): unknown;
  doUpdateMotion(model: OverlayCoreModel, nowSeconds: number): boolean;
  stopAllMotions(): void;
  isFinished(): boolean;
}

/** cubism4 UMD 里叠加层用到的构造入口（都挂在 `PIXI.live2d` 上）。 */
export interface OverlayApi {
  readonly CubismMotion: { create(json: unknown): OverlayMotion };
  readonly CubismExpressionMotion: { create(json: unknown): OverlayMotion };
  readonly CubismMotionQueueManager: new () => OverlayQueue;
}

/** 叠加物类别：动作（播完可定格）与外观（挂着不动的状态）。 */
export type OverlayKind = 'motion' | 'expression';

/** 起一条叠加物的参数。 */
export interface OverlayPlayOptions {
  /** 播完停在末帧（VTube 热键的 `StopsOnLastFrame`）：举手/竖手指这类姿态全靠它保持。 */
  readonly hold?: boolean;
  /** 淡入秒数（VTube 热键的 `FadeSecondsAmount`）；缺省沿用文件自己的值。 */
  readonly fadeSeconds?: number;
  /** 动作文件原始 JSON：`hold` 要靠它算末帧姿态。 */
  readonly raw?: unknown;
}

/** 叠加层对外接口。 */
export interface Overlay {
  /** 起一条（同 key 已存在则先停旧的再起）。 */
  play(key: string, kind: OverlayKind, json: unknown, options?: OverlayPlayOptions): void;
  /** 切换：挂着就摘，没挂就起；返回切换后的状态。 */
  toggle(key: string, kind: OverlayKind, json: unknown, options?: OverlayPlayOptions): 'on' | 'off';
  /** 摘掉一条（不存在时什么都不做）。 */
  stop(key: string): void;
  /** 摘掉某一类的全部。 */
  stopKind(kind: OverlayKind): void;
  /** 当前挂着的 key 列表（按挂载顺序，菜单打勾用）。 */
  active(kind: OverlayKind): readonly string[];
  /** 每帧推进；挂在 `beforeModelUpdate` 上。 */
  tick(): void;
  /** 全部摘掉。 */
  destroy(): void;
}

/** 同时挂着的上限：再多也看不出区别，纯粹是内存与逐帧开销。 */
const MAX_LAYERS = 8;

/** 一条叠加物。 */
interface Entry {
  readonly kind: OverlayKind;
  readonly queue: OverlayQueue;
  /** 定格姿态（只有 `hold` 的动作有）。 */
  readonly finals: readonly MotionFinalValue[] | null;
  /** 本条已播完：之后每帧只写定格姿态。 */
  done: boolean;
}

/**
 * 造叠加层。
 *
 * @param api - cubism4 的三个构造入口。
 * @param core - 取当前 coreModel 的取值函数；模型还没就绪时返回 null。
 * @param nowMs - 单调时钟（`performance.now`）；测试可注入。
 * @returns 叠加层接口。
 */
export function createOverlay(
  api: OverlayApi,
  core: () => OverlayCoreModel | null,
  nowMs: () => number = () => performance.now(),
): Overlay {
  const entries = new Map<string, Entry>();

  /** 把定格姿态写回模型（参数与部件不透明度分开走）。 */
  const applyFinals = (model: OverlayCoreModel, finals: readonly MotionFinalValue[]): void => {
    for (const item of finals) {
      if (item.target === 'PartOpacity') model.setPartOpacityById?.(item.id, item.value);
      else model.setParameterValueById(item.id, item.value, 1);
    }
  };

  /** 超上限时淘汰同类里最早的那条（Map 保插入顺序）。 */
  const evict = (kind: OverlayKind): void => {
    for (const [key, entry] of entries) {
      if (entry.kind !== kind) continue;
      entry.queue.stopAllMotions();
      entries.delete(key);
      return;
    }
  };

  const stop = (key: string): void => {
    const entry = entries.get(key);
    if (entry === undefined) return;
    entry.queue.stopAllMotions();
    entries.delete(key);
  };

  const play = (key: string, kind: OverlayKind, json: unknown, options: OverlayPlayOptions = {}): void => {
    stop(key);
    if (entries.size >= MAX_LAYERS) evict(kind);
    const queue = new api.CubismMotionQueueManager();
    // 事件回调空实现：动作文件带 UserData 时运行库会无条件调用它，缺了直接抛异常。
    queue.setEventCallback?.(() => {});
    const motion = kind === 'expression' ? api.CubismExpressionMotion.create(json) : api.CubismMotion.create(json);
    if (kind === 'motion') {
      // 文件里的 Loop 是给「待机循环」用的；热键动作一律播一遍，否则手臂会反复来回抖。
      motion.setIsLoop?.(false);
    }
    if (options.fadeSeconds !== undefined && Number.isFinite(options.fadeSeconds)) {
      motion.setFadeInTime?.(options.fadeSeconds);
      motion.setFadeOutTime?.(options.fadeSeconds);
    }
    queue.startMotion(motion, false, nowMs() / 1000);
    const finals =
      kind === 'motion' && options.hold === true && options.raw !== undefined ? parseMotion3(options.raw).finals : null;
    entries.set(key, { kind, queue, finals, done: false });
  };

  const tick = (): void => {
    const model = core();
    if (model === null) return;
    const nowSeconds = nowMs() / 1000;
    // 先写定格姿态、再推进活动层：新动作要能盖住旧的定格（否则抬手永远压不过已定格的姿势）。
    for (const entry of entries.values()) {
      if (entry.done && entry.finals !== null) applyFinals(model, entry.finals);
    }
    for (const [key, entry] of entries) {
      if (entry.done) continue;
      entry.queue.doUpdateMotion(model, nowSeconds);
      if (!entry.queue.isFinished()) continue;
      if (entry.finals !== null) entry.done = true;
      else entries.delete(key);
    }
  };

  return {
    play,
    toggle: (key, kind, json, options) => {
      if (entries.has(key)) {
        stop(key);
        return 'off';
      }
      play(key, kind, json, options);
      return 'on';
    },
    stop,
    stopKind: (kind) => {
      for (const key of [...entries.keys()]) {
        if (entries.get(key)?.kind === kind) stop(key);
      }
    },
    active: (kind) => [...entries.entries()].filter(([, entry]) => entry.kind === kind).map(([key]) => key),
    tick,
    destroy: () => {
      for (const key of [...entries.keys()]) stop(key);
    },
  };
}
