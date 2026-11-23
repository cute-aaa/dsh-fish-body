/**
 * 看屏幕 / 避让配置的归一化（src/shared/screen-config.ts）。
 *
 * 钉住三件容易错的事：
 *   1. 时段解析不能把 `24:00` / `12:60` 当成「差一点」，也不能把跨越午夜当成空区间；
 *   2. 运行期读到越界值要**夹取**（能跑），而不是抛错（跑不起来）；
 *   3. 布尔只认真布尔——配置里写 `"true"` 是写错了，按默认处理。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  AVOID_DELAY_MAX,
  AVOID_DELAY_MIN,
  SCREEN_DEFAULTS,
  SCREEN_INTERVAL_MAX,
  SCREEN_INTERVAL_MIN,
  formatClock,
  inQuietWindow,
  normalizeAvoidApps,
  parseClockMinutes,
  screenConfigOf,
} from './screen-config.ts';

describe('parseClockMinutes / formatClock', () => {
  test('接受宽松写法并规范化', () => {
    assert.equal(parseClockMinutes('9:05'), 545);
    assert.equal(parseClockMinutes('09:5'), 545);
    assert.equal(parseClockMinutes(' 23:59 '), 23 * 60 + 59);
    assert.equal(formatClock(parseClockMinutes('9:05') as number), '09:05');
  });

  test('不存在的时刻一律 null（不是「差不多」）', () => {
    for (const bad of ['', '24:00', '12:60', 'ab:cd', '930', '12', null, undefined, 930]) {
      assert.equal(parseClockMinutes(bad), null, String(bad));
    }
  });
});

describe('inQuietWindow', () => {
  test('同日窗口：左闭右开', () => {
    assert.equal(inQuietWindow('09:00', '18:00', 9 * 60), true);
    assert.equal(inQuietWindow('09:00', '18:00', 18 * 60), false);
    assert.equal(inQuietWindow('09:00', '18:00', 8 * 60 + 59), false);
  });

  test('跨午夜窗口：22:00 → 06:00', () => {
    assert.equal(inQuietWindow('22:00', '06:00', 23 * 60), true);
    assert.equal(inQuietWindow('22:00', '06:00', 2 * 60), true);
    assert.equal(inQuietWindow('22:00', '06:00', 12 * 60), false);
  });

  test('空串 / 起止相同 / 解析失败 → 不静默（宁可不静默也别整天不出声）', () => {
    assert.equal(inQuietWindow('', '', 12 * 60), false);
    assert.equal(inQuietWindow('09:00', '', 9 * 60), false);
    assert.equal(inQuietWindow('09:00', '09:00', 9 * 60), false);
    assert.equal(inQuietWindow('99:00', '06:00', 3 * 60), false);
  });
});

describe('screenConfigOf', () => {
  test('缺配置 = 出厂默认（两项都关）', () => {
    assert.deepEqual(screenConfigOf(undefined), SCREEN_DEFAULTS);
    assert.deepEqual(screenConfigOf({}), SCREEN_DEFAULTS);
    assert.equal(SCREEN_DEFAULTS.readEnabled, false);
    assert.equal(SCREEN_DEFAULTS.avoidFullscreen, false);
    assert.equal(SCREEN_DEFAULTS.avoidAppsEnabled, false);
  });

  test('数值越界夹到边界，非法数回落默认', () => {
    const cfg = screenConfigOf({ screenReadIntervalSec: 5, avoidDelayMs: 99999, avoidPollMs: 'abc' });
    assert.equal(cfg.intervalSec, SCREEN_INTERVAL_MIN);
    assert.equal(cfg.avoidDelayMs, AVOID_DELAY_MAX);
    assert.equal(cfg.avoidPollMs, SCREEN_DEFAULTS.avoidPollMs);
    assert.equal(screenConfigOf({ avoidDelayMs: -5 }).avoidDelayMs, AVOID_DELAY_MIN);
    assert.equal(screenConfigOf({ screenReadIntervalSec: 99999 }).intervalSec, SCREEN_INTERVAL_MAX);
  });

  test('布尔只认真布尔：字符串 "true" 不算开', () => {
    assert.equal(screenConfigOf({ screenReadEnabled: 'true' }).readEnabled, false);
    assert.equal(screenConfigOf({ screenReadEnabled: true }).readEnabled, true);
    assert.equal(screenConfigOf({ avoidFullscreenEnabled: 1 }).avoidFullscreen, false);
  });

  test('时段归一化：宽松写法与非法值', () => {
    const cfg = screenConfigOf({ screenReadQuietFrom: '9:5', screenReadQuietTo: '08:00' });
    assert.equal(cfg.quietFrom, '09:05');
    assert.equal(cfg.quietTo, '08:00');
    assert.equal(screenConfigOf({ screenReadQuietFrom: '25:00' }).quietFrom, '');
  });

  test('白名单：trim、去空、大小写去重、保留第一份写法', () => {
    assert.deepEqual(screenConfigOf({ avoidApps: [' Chrome.exe ', 'chrome.exe', '', '哔哩哔哩'] }).avoidApps, [
      'Chrome.exe',
      '哔哩哔哩',
    ]);
    assert.deepEqual(normalizeAvoidApps('not-an-array'), []);
  });
});
