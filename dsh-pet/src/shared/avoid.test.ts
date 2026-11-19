/**
 * 避让判定与滞回状态机（src/shared/avoid.ts）。
 *
 * 这组测试覆盖「什么时候该躲」与「躲多久才对」两件事：
 *   1. 覆盖判定（全屏 / 最大化）的容差与工作区口径；
 *   2. 白名单两种写法（进程名精确 / 标题子串）；
 *   3. 自己的窗口不触发；
 *   4. 延迟与恢复延迟真的生效，且来回抖动不会被放过去。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  avoidHidden,
  avoidWantHide,
  advanceAvoid,
  coversRect,
  matchesAppList,
  type AvoidInput,
  type AvoidPhase,
} from './avoid.ts';
import type { ForegroundSnapshot } from './foreground.ts';

/** 主屏：3840×2160，任务栏 72px（工作区高度 2088）。 */
const MONITOR = {
  bounds: { x: 0, y: 0, width: 3840, height: 2160 },
  workArea: { x: 0, y: 0, width: 3840, height: 2088 },
};

/** 造一帧前台快照。 */
function snap(over: Partial<ForegroundSnapshot> = {}): ForegroundSnapshot {
  return { pid: 4242, app: 'chrome', title: '深度求索', rect: { x: 0, y: 0, width: 3840, height: 2160 }, ...over };
}

/** 造判定输入。 */
function input(over: Partial<AvoidInput> = {}): AvoidInput {
  return {
    snapshot: snap(),
    ownPid: 100,
    monitor: MONITOR,
    fullscreenEnabled: true,
    maximizeEnabled: false,
    appsEnabled: false,
    apps: [],
    ...over,
  };
}

describe('coversRect', () => {
  test('完全覆盖 / 1px 缺口算覆盖 / 5px 缺口不算', () => {
    assert.equal(coversRect(MONITOR.bounds, MONITOR.bounds), true);
    assert.equal(coversRect({ x: 1, y: 1, width: 3839, height: 2159 }, MONITOR.bounds), true);
    assert.equal(coversRect({ x: 0, y: 0, width: 3830, height: 2160 }, MONITOR.bounds), false);
    assert.equal(coversRect({ x: -2, y: 0, width: 3844, height: 2160 }, MONITOR.bounds), true);
  });
});

describe('matchesAppList', () => {
  test('.exe 结尾按进程名精确比（不分大小写、忽略扩展名）', () => {
    assert.equal(matchesAppList('chrome', '', ['chrome.exe']), true);
    assert.equal(matchesAppList('Chrome.exe', '', ['chrome.exe']), true);
    assert.equal(matchesAppList('msedge', '', ['chrome.exe']), false);
  });

  test('其它写法按标题子串（不分大小写）', () => {
    assert.equal(matchesAppList('msedge', '哔哩哔哩 (゜-゜)つロ 干杯~', ['哔哩哔哩']), true);
    assert.equal(matchesAppList('msedge', 'GitHub', ['哔哩哔哩']), false);
  });

  test('空名单 / 空项不影响', () => {
    assert.equal(matchesAppList('chrome', 'x', []), false);
    assert.equal(matchesAppList('chrome', 'x', ['', '   ']), false);
  });
});

describe('avoidWantHide', () => {
  test('全屏前台：命中 fullscreen', () => {
    assert.deepEqual(avoidWantHide(input()), { wantHide: true, reason: 'fullscreen' });
  });

  test('自己的窗口不触发（pid 相同）', () => {
    assert.deepEqual(avoidWantHide(input({ ownPid: 4242 })), { wantHide: false, reason: '' });
  });

  test('开关关着就不躲（即使全屏）', () => {
    assert.deepEqual(avoidWantHide(input({ fullscreenEnabled: false })), { wantHide: false, reason: '' });
  });

  test('最大化：只有开了开关、且只覆盖工作区时才触发', () => {
    const maximized = snap({ rect: { x: 0, y: 0, width: 3840, height: 2088 } });
    assert.deepEqual(avoidWantHide(input({ snapshot: maximized })), { wantHide: false, reason: '' });
    assert.deepEqual(avoidWantHide(input({ snapshot: maximized, maximizeEnabled: true })), {
      wantHide: true,
      reason: 'maximize',
    });
    // 真全屏时走 fullscreen，不会被误记成 maximize
    assert.equal(avoidWantHide(input({ maximizeEnabled: true })).reason, 'fullscreen');
  });

  test('白名单先于全屏判定（原因更具体）', () => {
    assert.deepEqual(avoidWantHide(input({ appsEnabled: true, apps: ['chrome.exe'] })), {
      wantHide: true,
      reason: 'app',
    });
  });

  test('快照缺失（这一拍不知道）→ 不躲', () => {
    assert.deepEqual(avoidWantHide(input({ snapshot: null })), { wantHide: false, reason: '' });
  });
});

describe('advanceAvoid —— 延迟与恢复延迟', () => {
  test('delay 未到不躲，到了才躲', () => {
    const first = advanceAvoid({
      phase: 'idle',
      sinceMs: 0,
      nowMs: 1000,
      wantHide: true,
      delayMs: 1500,
      restoreMs: 800,
    });
    assert.deepEqual(first, { phase: 'pending-hide', sinceMs: 1000, hide: false });
    const early = advanceAvoid({ ...first, nowMs: 2000, wantHide: true, delayMs: 1500, restoreMs: 800 });
    assert.equal(early.hide, false);
    const due = advanceAvoid({ ...early, nowMs: 2500, wantHide: true, delayMs: 1500, restoreMs: 800 });
    assert.deepEqual(due, { phase: 'hidden', sinceMs: 2500, hide: true });
  });

  test('delay = 0 立刻躲（用户显式要「马上」）', () => {
    const r = advanceAvoid({ phase: 'idle', sinceMs: 0, nowMs: 10, wantHide: true, delayMs: 0, restoreMs: 800 });
    assert.equal(r.hide, true);
  });

  test('条件消失后要等 restore 才回来，期间仍是 hidden 一侧', () => {
    const hiding = advanceAvoid({
      phase: 'hidden',
      sinceMs: 0,
      nowMs: 10,
      wantHide: false,
      delayMs: 0,
      restoreMs: 800,
    });
    assert.deepEqual(hiding, { phase: 'pending-show', sinceMs: 10, hide: true });
    assert.equal(avoidHidden(hiding.phase), true);
    const stillWaiting = advanceAvoid({ ...hiding, nowMs: 500, wantHide: false, delayMs: 0, restoreMs: 800 });
    assert.equal(stillWaiting.hide, true);
    const back = advanceAvoid({ ...stillWaiting, nowMs: 900, wantHide: false, delayMs: 0, restoreMs: 800 });
    assert.deepEqual(back, { phase: 'idle', sinceMs: 900, hide: false });
  });

  test('恢复等待期里条件又成立 → 立刻回到 hidden，不重新计时', () => {
    const r = advanceAvoid({
      phase: 'pending-show',
      sinceMs: 100,
      nowMs: 300,
      wantHide: true,
      delayMs: 1500,
      restoreMs: 800,
    });
    assert.deepEqual(r, { phase: 'hidden', sinceMs: 300, hide: true });
  });

  test('等待躲下去的过程中条件消失 → 回 idle，不躲', () => {
    const r = advanceAvoid({
      phase: 'pending-hide',
      sinceMs: 100,
      nowMs: 200,
      wantHide: false,
      delayMs: 1500,
      restoreMs: 800,
    });
    assert.deepEqual(r, { phase: 'idle', sinceMs: 200, hide: false });
  });

  test('时钟回拨不会把宠物永久藏起来', () => {
    const r = advanceAvoid({
      phase: 'hidden',
      sinceMs: 5_000,
      nowMs: 1_000,
      wantHide: false,
      delayMs: 0,
      restoreMs: 800,
    });
    assert.equal(r.phase, 'pending-show');
    // 回拨后 waited 按 0 算：要等时间重新走够 restore 才恢复
    const again = advanceAvoid({ ...r, nowMs: 1_700, wantHide: false, delayMs: 0, restoreMs: 800 });
    assert.equal(again.phase, 'pending-show');
    const done = advanceAvoid({ ...again, nowMs: 1_900, wantHide: false, delayMs: 0, restoreMs: 800 });
    assert.equal(done.phase, 'idle');
  });

  test('相位 → 是否处于隐藏侧', () => {
    const cases: [AvoidPhase, boolean][] = [
      ['idle', false],
      ['pending-hide', false],
      ['hidden', true],
      ['pending-show', true],
    ];
    for (const [phase, hide] of cases) assert.equal(avoidHidden(phase), hide, phase);
  });
});
