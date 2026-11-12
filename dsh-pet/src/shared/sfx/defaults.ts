/**
 * 事件槽的内置默认音与文件名别名。
 *
 * 默认文件都在包内 assets/sound/，所以「配置里没有任何音效文件」时事件槽依然有声音。
 * 动作音、hook 与睡眠两段**没有**默认：动画太杂、hook 是调用方语义，乱响比不响更糟。
 * @module dsh-pet/src/shared/sfx/defaults
 */
import type { SfxEventSlot } from '../types.ts';

/** 槽位 → 包内默认文件名。 */
export const DEFAULT_EVENT_FILES: Readonly<Partial<Record<SfxEventSlot, string>>> = {
  click: 'click-duck.wav',
  throw: 'throw.wav',
  floor: 'bump-soft.wav',
  wall: 'bump-soft.wav',
  ceiling: 'bump-soft.wav',
  pet: 'pet-bump.wav',
};

/** `bump` 是三个碰撞槽的通用兜底：没有具体 floor/wall/ceiling 文件时才用它。 */
export const BUMP_SLOT = 'bump';

/** 碰撞三槽：`bump` 兜底时按这个顺序一起填。 */
export const COLLISION_SLOTS = ['floor', 'wall', 'ceiling'] as const;

/** 文件名 → 槽位的别名表（键为小写、连字符形式，与 {@link canonicalSlotOf} 同一口径）。 */
const SLOT_ALIASES: Readonly<Record<string, SfxEventSlot>> = {
  click: 'click',
  throw: 'throw',
  'sleep-start': 'sleepStart',
  'sleep-end': 'sleepEnd',
  floor: 'floor',
  wall: 'wall',
  ceiling: 'ceiling',
  pet: 'pet',
};

/**
 * 文件名基名 → 规范槽名。
 *
 * @param base - 不含扩展名的文件名（大小写不敏感）。
 * @returns 槽位；不是槽名（含 `bump` 兜底名）时返回 undefined。
 */
export function canonicalSlotOf(base: string): SfxEventSlot | undefined {
  const key = base
    .trim()
    // 驼峰写法（sleepStart / sleepEnd）与连字符写法等价：文件名里两种都常见。
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  return SLOT_ALIASES[key];
}
