/**
 * live2d 的「叠加层」：动作与外观各自成层，可同时挂多个，且不打断内置待机。
 *
 * 为什么要自己管队列：pixi-live2d-display 0.4.0 的 cubism4 后端把所有 motion 塞进**同一个**
 * `MotionQueueManager`，`_startMotion` 一进来就 `stopAllMotions()`——用 `model.motion()` 点第二个动作，
 * 第一个立刻被掐掉，待机也跟着没了。VTube 的用法恰恰相反：热键动作叠在待机之上，
 * 「举手」「竖手指」「狗尾巴草」三种姿态还能同时保持。
 *
 * 做法：动作每条一个独立队列，在 `internalModel` 的 `beforeModelUpdate` 里依次推进。
 * 那个钩子紧贴 `coreModel.update()`、之后才是 `loadParameters()`，所以写入只影响本帧，
 * 不会把姿态污染成下一帧的基准。
 *
 * **外观不是动作**：`CubismExpressionMotion` 是一次性的（淡入 → 淡出 → 结束），外观却是
 * VTube 语义的开关状态，所以这里自己解析 exp3 并把参数**每帧重写**，直到被摘掉为止。
 * 直接用运行库的结果是「牙齿闪一下就没了」——用户报的「兔牙没生效」就是这个。
 * @module dsh-fish-body/src/client/pet/render/live2d/overlay
 */
import { parseExp3, type Exp3Parameter } from '../../../../shared/live2d-exp3.ts';
import { parseMotion3, type MotionFinalValue } from '../../../../shared/live2d-motion3.ts';

/** 叠加层要写的模型能力（CubismModel 的子集）。 */
export interface OverlayCoreModel {
  setParameterValueById(id: string, value: number, weight?: number): void;
  /** 读当前值：`Add` / `Multiply` 要按「当前值」算目标，缺了它就从 0 / 1 起算。 */
  getParameterValueById?(id: string): number;
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
  /** 动作队列；外观没有队列（它每帧重写参数，不靠时间轴推进）。 */
  readonly queue: OverlayQueue | null;
  /** 定格姿态（只有 `hold` 的动作有）。 */
  readonly finals: readonly MotionFinalValue[] | null;
  /** 外观要每帧写的参数（只有 `expression` 有）。 */
  readonly params: readonly Exp3Parameter[] | null;
  /** 外观淡入的起点与时长（秒）：挂着期间只淡入一次，之后恒为满权重。 */
  readonly startedAt: number;
  readonly fadeIn: number;
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

  /**
   * 把一组外观参数按当前权重写进模型。
   *
   * 混合方式自己算而不是交给 `setParameterValueById` 的 weight：那个 weight 是「向目标值插值」，
   * 对 `Add` / `Multiply` 来说等价于把目标值按比例缩放，只有当基准是 0 / 1 时才对——
   * VTube 的 `key*` 参数正好是这种，但别的模型未必，所以按当前值算目标更稳。
   *
   * @param model - 当前 coreModel。
   * @param params - exp3 解析出来的参数表。
   * @param weight - 0~1（淡入进度）；1 = 完全生效。
   */
  const applyParams = (model: OverlayCoreModel, params: readonly Exp3Parameter[], weight: number): void => {
    const w = Math.max(0, Math.min(1, weight));
    for (const item of params) {
      const current = model.getParameterValueById?.(item.id);
      const base = typeof current === 'number' && Number.isFinite(current) ? current : undefined;
      if (item.blend === 'Multiply')
        model.setParameterValueById(item.id, base === undefined ? item.value : base * item.value, w);
      else if (item.blend === 'Overwrite') model.setParameterValueById(item.id, item.value, w);
      else model.setParameterValueById(item.id, base === undefined ? item.value : base + item.value, w);
    }
  };

  /** 超上限时淘汰同类里最早的那条（Map 保插入顺序）。 */
  const evict = (kind: OverlayKind): void => {
    for (const [key, entry] of entries) {
      if (entry.kind !== kind) continue;
      entry.queue?.stopAllMotions();
      entries.delete(key);
      return;
    }
  };

  const stop = (key: string): void => {
    const entry = entries.get(key);
    if (entry === undefined) return;
    entry.queue?.stopAllMotions();
    entries.delete(key);
  };

  const play = (key: string, kind: OverlayKind, json: unknown, options: OverlayPlayOptions = {}): void => {
    stop(key);
    if (entries.size >= MAX_LAYERS) evict(kind);
    const now = nowMs() / 1000;
    // 外观：解析 exp3 后每帧重写，不建队列——运行库的表达式是一次性的，挂不住。
    if (kind === 'expression') {
      const parsed = parseExp3(json);
      // 一行诊断：外观「看起来没生效」时，第一件要确认的就是 exp3 到底写了哪些参数
      // （空 Parameters = 这份外观本身是空的，不是我们没挂上）。每次挂载打一行，不是每帧。
      console.log(
        '[fish-body] 外观挂载 ' +
          key +
          ' params=' +
          String(parsed.parameters.length) +
          (parsed.parameters.length === 0
            ? '（这份 exp3 没有 Parameters，挂上也不会变）'
            : '(' + parsed.parameters.map((p) => p.id + '+' + String(p.value)).join(',') + ')'),
      );
      entries.set(key, {
        kind,
        queue: null,
        finals: null,
        params: parsed.parameters,
        startedAt: now,
        fadeIn: options.fadeSeconds === undefined ? parsed.fadeIn : options.fadeSeconds,
        done: false,
      });
      return;
    }
    const queue = new api.CubismMotionQueueManager();
    // 事件回调空实现：动作文件带 UserData 时运行库会无条件调用它，缺了直接抛异常。
    queue.setEventCallback?.(() => {});
    const motion = api.CubismMotion.create(json);
    // 文件里的 Loop 是给「待机循环」用的；热键动作一律播一遍，否则手臂会反复来回抖。
    motion.setIsLoop?.(false);
    if (options.fadeSeconds !== undefined && Number.isFinite(options.fadeSeconds)) {
      motion.setFadeInTime?.(options.fadeSeconds);
      motion.setFadeOutTime?.(options.fadeSeconds);
    }
    queue.startMotion(motion, false, now);
    const finals = options.hold === true && options.raw !== undefined ? parseMotion3(options.raw).finals : null;
    entries.set(key, { kind, queue, finals, params: null, startedAt: now, fadeIn: 0, done: false });
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
      // 外观：挂着就一直写（这就是「开关状态」的全部实现），淡入只跑一次。
      if (entry.kind === 'expression') {
        if (entry.params !== null && entry.params.length > 0) {
          const weight = entry.fadeIn <= 0 ? 1 : (nowSeconds - entry.startedAt) / entry.fadeIn;
          applyParams(model, entry.params, weight);
        }
        continue;
      }
      if (entry.queue === null || entry.done) continue;
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
