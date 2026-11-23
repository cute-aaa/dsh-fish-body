/**
 * 识屏时机判定（src/host/screen/policy.ts）。
 *
 * 这一段决定「什么时候看你的屏幕」，也是唯一的费用闸门，所以每条门都要钉住：
 * 关着不拍、手动优先、没到间隔不拍、DSH 忙不拍、静默时段不拍、都过了才拍。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SCREEN_DEFAULTS, type ScreenConfig } from '../../shared/screen-config.ts';
import { decideScreenTick, minuteOfDayOf, screenBusyNow, type ScreenTickInput } from './policy.ts';

/** 造一份「全部门都放行」的输入：开着、空闲、没有静默时段、从没拍过。 */
function base(over: Partial<ScreenTickInput> = {}, screenOver: Partial<ScreenConfig> = {}): ScreenTickInput {
  return {
    screen: { ...SCREEN_DEFAULTS, readEnabled: true, ...screenOver },
    manual: false,
    busy: false,
    idleForMs: 10 * 60 * 1000,
    lastMs: 0,
    nowMs: 1_000_000,
    minuteOfDay: 12 * 60,
    ...over,
  };
}

describe('decideScreenTick', () => {
  test('总开关关着：一条都不拍（手动也不行，按钮本来就该置灰）', () => {
    assert.deepEqual(decideScreenTick(base({}, { readEnabled: false })), { capture: false, reason: 'disabled' });
    assert.deepEqual(decideScreenTick(base({ manual: true }, { readEnabled: false })), {
      capture: false,
      reason: 'disabled',
    });
  });

  test('手动请求优先于间隔与忙闲', () => {
    const input = base({ manual: true, busy: true, lastMs: 1_000_000 - 100, idleForMs: 0 });
    assert.deepEqual(decideScreenTick(input), { capture: true, reason: 'manual' });
  });

  test('间隔没到不拍；到了就拍', () => {
    const interval = SCREEN_DEFAULTS.intervalSec * 1000;
    assert.deepEqual(decideScreenTick(base({ lastMs: 1_000_000 - interval + 1 })), {
      capture: false,
      reason: 'throttled',
    });
    assert.deepEqual(decideScreenTick(base({ lastMs: 1_000_000 - interval })), { capture: true, reason: 'ready' });
  });

  test('时钟回拨（elapsed < 0）按到点处理，不把识屏永久卡死', () => {
    assert.deepEqual(decideScreenTick(base({ lastMs: 2_000_000 })), { capture: true, reason: 'ready' });
  });

  test('忙（有回合 / 刚干完没到阈值）不拍；关了空闲门就照拍', () => {
    assert.deepEqual(decideScreenTick(base({ busy: true })), { capture: false, reason: 'busy' });
    assert.deepEqual(decideScreenTick(base({ idleForMs: 5_000 })), { capture: false, reason: 'busy' });
    assert.deepEqual(decideScreenTick(base({ idleForMs: 5_000 }, { idleOnly: false })), {
      capture: true,
      reason: 'ready',
    });
    assert.deepEqual(decideScreenTick(base({ idleForMs: 5_000 }, { idleSec: 0, idleOnly: true })), {
      capture: true,
      reason: 'ready',
    });
  });

  test('静默时段不拍（含跨午夜）', () => {
    const quiet = { quietFrom: '23:00', quietTo: '07:00' };
    assert.deepEqual(decideScreenTick(base({ minuteOfDay: 3 * 60 }, quiet)), { capture: false, reason: 'quiet' });
    assert.deepEqual(decideScreenTick(base({ minuteOfDay: 12 * 60 }, quiet)), { capture: true, reason: 'ready' });
  });
});

describe('screenBusyNow / minuteOfDayOf', () => {
  test('忙判定两层都要看', () => {
    const screen = { ...SCREEN_DEFAULTS, idleOnly: true, idleSec: 30 };
    assert.equal(screenBusyNow(screen, true, 10 * 60 * 1000), true);
    assert.equal(screenBusyNow(screen, false, 29_000), true);
    assert.equal(screenBusyNow(screen, false, 30_000), false);
    assert.equal(screenBusyNow({ ...screen, idleOnly: false }, true, 0), false);
  });

  test('分钟数取本地时间', () => {
    const date = new Date(2026, 10, 15, 3, 6, 0);
    assert.equal(minuteOfDayOf(date), 3 * 60 + 6);
  });
});
