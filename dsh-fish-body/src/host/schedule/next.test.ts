/**
 * 时段算术的契约：跨午夜、重叠取最长、边界换算。
 *
 * 这些是「按作息真的睡着」的唯一判据，所以每条都钉住；纯函数，不碰磁盘与时钟。
 * @module dsh-fish-body/src/host/schedule/next.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { ScheduleEntry } from './extract.ts';
import {
  activeEntryAt,
  endOfWindow,
  isInWindow,
  minuteOf,
  minuteOfDay,
  minutesToNextBoundary,
  windowOf,
} from './next.ts';

/** 造一条时段。 */
function entry(from: string, to: string): ScheduleEntry {
  return { from, to, state: 'sleeping', source: from + '-' + to };
}

describe('minuteOfDay / minuteOf', () => {
  test('HH:MM → 分钟数', () => {
    assert.equal(minuteOfDay('00:00'), 0);
    assert.equal(minuteOfDay('23:59'), 23 * 60 + 59);
    assert.equal(minuteOfDay('08:30'), 8 * 60 + 30);
  });

  test('非法格式 / 越界 → undefined（不猜）', () => {
    assert.equal(minuteOfDay('8:30'), undefined, '没补零不认');
    assert.equal(minuteOfDay('25:00'), undefined);
    assert.equal(minuteOfDay('12:70'), undefined);
    assert.equal(minuteOfDay(''), undefined);
  });

  test('minuteOf 取本地钟点', () => {
    assert.equal(minuteOf(new Date(2026, 10, 25, 13, 47)), 13 * 60 + 47);
  });
});

describe('windowOf / isInWindow', () => {
  test('普通区间', () => {
    const w = windowOf(entry('09:00', '17:00'));
    assert.deepEqual(w, { start: 540, end: 1020 });
    assert.equal(isInWindow(600, w!), true);
    assert.equal(isInWindow(540, w!), true, '起点含');
    assert.equal(isInWindow(1020, w!), false, '终点不含');
  });

  test('跨午夜区间：23:00→08:00 含 23:30 与 03:00，不含 12:00', () => {
    const w = windowOf(entry('23:00', '08:00'));
    assert.deepEqual(w, { start: 1380, end: 480 });
    assert.equal(isInWindow(23 * 60 + 30, w!), true);
    assert.equal(isInWindow(3 * 60, w!), true);
    assert.equal(isInWindow(12 * 60, w!), false);
    assert.equal(isInWindow(8 * 60, w!), false, '终点不含');
  });

  test('from === to → undefined（无法判断零长度还是整天）', () => {
    assert.equal(windowOf(entry('08:00', '08:00')), undefined);
  });
});

describe('activeEntryAt', () => {
  test('落在唯一一段里 → 那一段', () => {
    const entries = [entry('23:00', '08:00')];
    assert.equal(activeEntryAt(entries, 23 * 60 + 30)?.from, '23:00');
    assert.equal(activeEntryAt(entries, 12 * 60), null);
  });

  test('两段重叠：取已经持续最久的那条（跨午夜段优先）', () => {
    // 23:00→08:00 与 00:00→02:00 在 01:00 重叠；前者已经持续 2 小时、后者 1 小时
    const entries = [entry('23:00', '08:00'), entry('00:00', '02:00')];
    assert.equal(activeEntryAt(entries, 60)?.from, '23:00');
  });

  test('一段都没有 → null', () => {
    assert.equal(activeEntryAt([], 600), null);
  });

  test('非法时间被跳过，不影响其它段', () => {
    const entries = [entry('25:00', '08:00'), entry('23:00', '08:00')];
    assert.equal(activeEntryAt(entries, 23 * 60 + 30)?.from, '23:00');
  });
});

describe('endOfWindow', () => {
  test('普通区间：结束在今天', () => {
    const now = new Date(2026, 10, 25, 10, 0);
    const end = endOfWindow(entry('09:00', '17:00'), now);
    assert.equal(end?.getDate(), 25);
    assert.equal(end?.getHours(), 17);
    assert.equal(end?.getMinutes(), 0);
  });

  test('跨午夜且当前已过午夜：结束在今天早上', () => {
    const now = new Date(2026, 10, 25, 3, 0);
    const end = endOfWindow(entry('23:00', '08:00'), now);
    assert.equal(end?.getDate(), 25);
    assert.equal(end?.getHours(), 8);
  });

  test('跨午夜且当前在午夜前：结束在次日早上', () => {
    const now = new Date(2026, 10, 25, 23, 30);
    const end = endOfWindow(entry('23:00', '08:00'), now);
    assert.equal(end?.getDate(), 26);
    assert.equal(end?.getHours(), 8);
  });

  test('秒与毫秒被归零（边界要对齐整分）', () => {
    const now = new Date(2026, 10, 25, 23, 30, 45, 123);
    const end = endOfWindow(entry('23:00', '08:00'), now);
    assert.equal(end?.getSeconds(), 0);
    assert.equal(end?.getMilliseconds(), 0);
  });
});

describe('minutesToNextBoundary', () => {
  test('到最近的进段或出段', () => {
    // 09:00-17:00，现在 16:50 → 10 分钟到出段
    assert.equal(minutesToNextBoundary([entry('09:00', '17:00')], 16 * 60 + 50), 10);
  });

  test('跨午夜：现在 22:00、段 23:00 开始 → 60 分钟', () => {
    assert.equal(minutesToNextBoundary([entry('23:00', '08:00')], 22 * 60), 60);
  });

  test('刚好处在边界上不返回 0（下一次是下一个边界）', () => {
    const delta = minutesToNextBoundary([entry('23:00', '08:00')], 23 * 60);
    assert.ok(delta !== undefined && delta > 0 && delta <= 9 * 60, String(delta));
  });

  test('空表 → undefined', () => {
    assert.equal(minutesToNextBoundary([], 600), undefined);
  });
});
