/**
 * 作息驱动：把「人设里的作息文字」变成 `/rhythm` 的请求，让桌子上的宠物真的按点睡。
 *
 * 这是「`extractSchedule` 接 `/rhythm`」的装配层，三件事按顺序做：
 * 1. `extractSchedule` 从文本抽时段（只认明确时刻，中文数字不认）；
 * 2. `activeEntryAt` 判断此刻落在哪一段；
 * 3. 落在段里 → `rhythm.set({state:'sleeping', until: 段结束})`；出段 → `rhythm.clear()`。
 *
 * **只动自己设的那条**：`RhythmStore` 的请求带 `reason`，只有 `reason === 'schedule'` 的才归这里管。
 * 用户手动设的（`reason:'user'`）与外部脚本设的（其它 reason）一律不碰——作息引擎不该覆盖人的决定。
 * @module dsh-fish-body/src/host/schedule/driver
 */
import type { RhythmStore } from '../rhythm.ts';
import { extractSchedule } from './extract.ts';
import { activeEntryAt, endOfWindow, minuteOf } from './next.ts';

/** driver 认领的 reason 标记：只有它设的条目才允许被它清掉。 */
export const SCHEDULE_REASON = 'schedule';

/** 一只宠物的作息文本来源。 */
export interface ScheduleSource {
  readonly petId: string;
  /** 人设正文（`whisperPrompt`）；空串 = 没有作息可读。 */
  readonly text: string;
}

/** 装配输入。 */
export interface ScheduleDriverOptions {
  readonly rhythm: RhythmStore;
  /** 读当前所有宠物的作息文本。由装配层提供，driver 自己不读配置。 */
  readonly readSources: () => readonly ScheduleSource[];
  /** 取当前时刻（测试注入固定时钟）。 */
  readonly now?: () => Date;
  readonly log?: { info(message: string): void };
}

/** 一次 tick 的结论（日志与测试都读它）。 */
export interface ScheduleTickResult {
  /** 这一拍新进入睡眠的 petId。 */
  readonly entered: readonly string[];
  /** 这一拍退出睡眠（回到醒着）的 petId。 */
  readonly left: readonly string[];
}

/**
 * 作息驱动：无状态类，状态都在 `RhythmStore` 里，所以多实例不会打架。
 *
 * 由宿主的定时器每分钟调一次 `tick()`；`tick` 是**幂等**的，
 * 同一分钟调两次只会产生一次 `changed: true`（`RhythmStore` 那边同态同 until 就是幂等）。
 */
export class ScheduleDriver {
  declare private readonly rhythm: RhythmStore;
  declare private readonly readSources: () => readonly ScheduleSource[];
  declare private readonly now: () => Date;
  declare private readonly log: (message: string) => void;

  constructor(options: ScheduleDriverOptions) {
    this.rhythm = options.rhythm;
    this.readSources = options.readSources;
    this.now = options.now ?? ((): Date => new Date());
    this.log = (message: string): void => options.log?.info(message);
  }

  /**
   * 走一拍：按每只宠物的作息文本决定现在该睡还是该醒。
   *
   * @returns 这次进入 / 退出睡眠的 petId。
   */
  tick(): ScheduleTickResult {
    const now = this.now();
    const minutes = minuteOf(now);
    const entered: string[] = [];
    const left: string[] = [];

    for (const source of this.readSources()) {
      const current = this.rhythm.get(source.petId);
      const mine = current !== null && current.reason === SCHEDULE_REASON;
      const entries = extractSchedule(source.text);
      const active = activeEntryAt(entries, minutes);

      if (active !== null) {
        const until = endOfWindow(active, now);
        if (until === undefined) continue;
        // 已经有别人设的请求时让位：只在"没人设"或"就是我自己设的"时才动手
        if (current !== null && !mine) continue;
        const result = this.rhythm.set(source.petId, {
          state: 'sleeping',
          until: until.getTime(),
          reason: SCHEDULE_REASON,
        });
        if (result.changed) {
          entered.push(source.petId);
          this.log('[fish-body] 作息生效：' + source.petId + ' 进入睡眠（' + active.from + '→' + active.to + '）');
        }
        continue;
      }

      // 不在任何睡眠段：只清自己设的那条
      if (mine && this.rhythm.clear(source.petId)) {
        left.push(source.petId);
        this.log('[fish-body] 作息结束：' + source.petId + ' 回到醒着');
      }
    }

    return { entered, left };
  }
}
