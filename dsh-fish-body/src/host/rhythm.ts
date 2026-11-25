/**
 * 节律状态：外部（soul 项目 / 用户脚本 / 定时任务）告诉「身体」现在该睡还是该醒。
 *
 * 为什么由外部驱动而不是本插件自己排时刻表：真实项目的作息形态互不相同——Coopanion 是角色自设的
 * 每日闹钟（`daily HH:MM`，跨夏令时保持本地钟点），surfcore 是「驱动力 + 下次触发时刻」
 * （`nextFireAt` + 九种 drive 权重），还有项目就是一句「23:00 必须睡」的自然语言。
 * 谁也算不出统一时刻表，所以本插件只提供**两态 + 到期时间**这一个最小契约，
 * 让算得出的那一侧来调。
 *
 * 与 `SleepStore` 的分工：那个是「睡觉动画播哪一套」的执行态，这个是「谁要求它现在是什么状态」
 * 的请求态。组装层把请求态翻成执行态（见 plugin 装配里的 `applyRhythm`）。
 * @module dsh-fish-body/src/host/rhythm
 */

/** 两态：醒着 / 睡着。不做 `hidden`、`quiet`——那些各自已有出口，多一个枚举只会多一处真源。 */
export type RhythmState = 'awake' | 'sleeping';

/** 谁要求的：外部调用缺省 `external`；用户手动覆盖标 `user`（将来用于优先级判断）。 */
export type RhythmSource = 'external' | 'user';

/** 一次节律请求。 */
export interface RhythmRequest {
  readonly state: RhythmState;
  /** 这条请求被设下的时刻（毫秒）。 */
  readonly since: number;
  /** 到期时刻（毫秒）；null = 一直有效直到被覆盖或清除。 */
  readonly until: number | null;
  /** 自由文本原因（写进日志与查询结果，排障用）。 */
  readonly reason: string;
  readonly source: RhythmSource;
}

/** 查询结果：请求 + 是否已到期。 */
export interface RhythmView extends RhythmRequest {
  /** true = 这条请求已过 `until`（查询时已按到期处理，不会留在表里）。 */
  readonly expired: boolean;
}

/** 一条待到期的请求（供定时器安排下一次检查）。 */
export interface RhythmPending {
  readonly petId: string;
  readonly until: number;
}

/** `set` 的输入。 */
export interface RhythmSetInput {
  readonly state: RhythmState;
  /** 到期时刻（毫秒时间戳或 Date）；缺省 = 不定时。 */
  readonly until?: number | Date | null;
  readonly reason?: string;
  readonly source?: RhythmSource;
}

/** `set` 的结论。 */
export interface RhythmSetResult {
  /** 状态真的变了才 true（同态同 until 的重复调用是幂等的）。 */
  readonly changed: boolean;
  readonly view: RhythmView;
}

/**
 * 到期判定的方向：`now >= until` 才算到期。
 *
 * 不对「定时器早跳」做特殊宽限：早跳时 `now < until` 天然不会命中，晚跳（线程被占、机器休眠）
 * 按时到期本来就是期望行为。`until` 是给调用方的承诺，不能提前撤销。
 */

/** 到期时刻归一：非法值一律当「不定时」（不抛、不写坏数据）。 */
function normalizeUntil(value: number | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const at = value instanceof Date ? value.getTime() : value;
  return Number.isFinite(at) ? at : null;
}

/**
 * 节律请求表（一个插件实例一个；进程内内存态，宿主重启即回到「醒着」）。
 *
 * 必须始终成立：**表里只留未到期的请求**——注释里的「到期」不是靠调用方记得清理，
 * 每次读都会顺手清；否则会出现「设了 2 小时的睡眠，第二天还在睡」。
 */
export class RhythmStore {
  // 用 declare + 构造器赋值：类字段初始化器会降级出 @oxc-project/runtime 外部 helper，
  // 而它是未声明的依赖，会被 prepack 门禁拦下（同 ./sleep、./lock 的约定）。
  declare private readonly map: Map<string, RhythmRequest>;
  declare private readonly onChange: (petId: string, request: RhythmRequest) => void;
  declare private readonly now: () => number;

  /**
   * @param opts.onChange - 请求生效时回调（组装层据此驱动睡觉动画）。到期恢复 awake 时同样回调。
   * @param opts.now - 取当前时刻（测试注入固定时钟）。
   */
  constructor(opts?: { onChange?: (petId: string, request: RhythmRequest) => void; now?: () => number }) {
    this.map = new Map();
    this.onChange = opts?.onChange ?? ((): void => {});
    this.now = opts?.now ?? Date.now;
  }

  /**
   * 查一只宠物的当前请求。
   *
   * @param petId - 宠物 id。
   * @returns 视图；没有请求（或已到期并被清掉）时 null。
   */
  get(petId: string): RhythmView | null {
    this.expire();
    const request = this.map.get(petId);
    return request === undefined ? null : { ...request, expired: false };
  }

  /**
   * 设一条请求。
   *
   * 同状态且同到期时刻时视为重复调用（返回 `changed:false`，不重复驱动动画）——
   * 与 `SleepStore.enter` 的幂等口径一致：接口被连点不该把动画从头放一遍。
   *
   * @param petId - 宠物 id。
   * @param input - 状态 / 到期 / 原因 / 来源。
   * @returns 结论与生效后的视图。
   * @throws {TypeError} 状态不是 `awake` / `sleeping` 时（调用方应先在路由层收敛成 400）。
   */
  set(petId: string, input: RhythmSetInput): RhythmSetResult {
    if (input.state !== 'awake' && input.state !== 'sleeping') {
      throw new TypeError('rhythm state 只能是 awake / sleeping');
    }
    this.expire();
    const until = normalizeUntil(input.until ?? null);
    const previous = this.map.get(petId);
    if (previous !== undefined && previous.state === input.state && previous.until === until) {
      return { changed: false, view: { ...previous, expired: false } };
    }
    const request: RhythmRequest = {
      state: input.state,
      since: this.now(),
      until,
      reason: input.reason ?? '',
      source: input.source ?? 'external',
    };
    this.map.set(petId, request);
    this.onChange(petId, request);
    return { changed: true, view: { ...request, expired: false } };
  }

  /**
   * 撤掉请求（回到默认：醒着）。
   *
   * @param petId - 宠物 id。
   * @returns 这次是否真的撤掉了（没有请求时幂等返回 false）。
   */
  clear(petId: string): boolean {
    this.expire();
    const previous = this.map.get(petId);
    if (previous === undefined) return false;
    this.map.delete(petId);
    this.onChange(petId, { ...previous, state: 'awake', until: null, reason: 'cleared' });
    return true;
  }

  /**
   * 把所有到期的请求清掉，并按「醒着」回调一次。
   *
   * @returns 被清掉的 petId（定时器用它打日志）。
   */
  expire(): string[] {
    const now = this.now();
    const expired: string[] = [];
    for (const [petId, request] of this.map) {
      // 未到期一律保留：`until` 是承诺，不能提前撤销。
      if (request.until === null || request.until > now) continue;
      this.map.delete(petId);
      expired.push(petId);
      this.onChange(petId, { ...request, state: 'awake', until: null, reason: 'expired' });
    }
    return expired;
  }

  /**
   * 还没到期的请求清单（含宠物 id），供调度方排下一次检查。
   *
   * @returns 按到期时刻升序；没有定时请求时为空数组。
   */
  pending(): RhythmPending[] {
    this.expire();
    const out: RhythmPending[] = [];
    for (const [petId, request] of this.map) {
      if (request.until !== null) out.push({ petId, until: request.until });
    }
    return out.sort((a, b) => a.until - b.until);
  }
}
