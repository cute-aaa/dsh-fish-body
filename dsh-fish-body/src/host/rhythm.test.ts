/**
 * 节律状态机的契约：两态、幂等、到期自动回醒、不把过期请求留在表里。
 *
 * 这些行为会被外部脚本直接依赖（「设两小时睡眠」是明确承诺），所以逐条钉住；
 * 纯内存 + 注入时钟，不碰磁盘与网络。
 * @module dsh-fish-body/src/host/rhythm.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { RhythmStore, type RhythmRequest } from './rhythm.ts';

/** 可控时钟：`tick(ms)` 推进。 */
function clock(start = 1_800_000_000_000): { now: () => number; tick: (ms: number) => void } {
  let value = start;
  return { now: () => value, tick: (ms: number) => (value += ms) };
}

describe('RhythmStore —— 两态与幂等', () => {
  test('没设过 → null（默认醒着，不占表）', () => {
    const store = new RhythmStore();
    assert.equal(store.get('main'), null);
  });

  test('设 sleeping 后查得到，字段齐全', () => {
    const c = clock();
    const store = new RhythmStore({ now: c.now });
    const result = store.set('main', { state: 'sleeping', until: c.now() + 3600_000, reason: '作息' });
    assert.equal(result.changed, true);
    assert.equal(result.view.state, 'sleeping');
    assert.equal(result.view.reason, '作息');
    assert.equal(result.view.source, 'external');
    assert.equal(store.get('main')?.state, 'sleeping');
  });

  test('同态同 until 重复调用 → changed:false（不重复驱动动画）', () => {
    const c = clock();
    const store = new RhythmStore({ now: c.now });
    const until = c.now() + 3600_000;
    store.set('main', { state: 'sleeping', until });
    const again = store.set('main', { state: 'sleeping', until });
    assert.equal(again.changed, false);
  });

  test('同态但换了 until → 视为变化（延长/缩短都算）', () => {
    const c = clock();
    const store = new RhythmStore({ now: c.now });
    store.set('main', { state: 'sleeping', until: c.now() + 1000 });
    const longer = store.set('main', { state: 'sleeping', until: c.now() + 7200_000 });
    assert.equal(longer.changed, true);
    assert.equal(longer.view.until, c.now() + 7200_000);
  });

  test('换态 → changed:true', () => {
    const store = new RhythmStore();
    store.set('main', { state: 'sleeping' });
    assert.equal(store.set('main', { state: 'awake' }).changed, true);
  });

  test('非法状态抛 TypeError（路由层先收敛成 400）', () => {
    const store = new RhythmStore();
    assert.throws(() => store.set('main', { state: 'hidden' as never }), TypeError);
  });

  test('非法 until 当「不定时」，不写坏数据', () => {
    const store = new RhythmStore();
    const result = store.set('main', { state: 'sleeping', until: Number.NaN });
    assert.equal(result.view.until, null);
  });
});

describe('RhythmStore —— 到期', () => {
  test('到点后查不到，并按 awake 回调一次', () => {
    const c = clock();
    const events: RhythmRequest[] = [];
    const store = new RhythmStore({ now: c.now, onChange: (_id, req) => events.push(req) });
    store.set('main', { state: 'sleeping', until: c.now() + 1000 });
    c.tick(1001);
    assert.equal(store.get('main'), null, '过期请求不该留在表里');
    assert.equal(events.length, 2, 'set 一次 + 到期一次');
    assert.equal(events[1]?.state, 'awake');
    assert.equal(events[1]?.reason, 'expired');
  });

  test('到期前一刻仍有效，到点才失效（不提前撤销承诺）', () => {
    const c = clock();
    const store = new RhythmStore({ now: c.now });
    store.set('main', { state: 'sleeping', until: c.now() + 1000 });
    c.tick(996);
    assert.equal(store.get('main')?.state, 'sleeping');
    c.tick(5);
    assert.equal(store.get('main'), null);
  });

  test('不定时的请求不会自己消失', () => {
    const c = clock();
    const store = new RhythmStore({ now: c.now });
    store.set('main', { state: 'sleeping' });
    c.tick(86_400_000 * 365);
    assert.equal(store.get('main')?.state, 'sleeping');
  });

  test('pending 只列定时请求，按到期升序', () => {
    const c = clock();
    const store = new RhythmStore({ now: c.now });
    store.set('a', { state: 'sleeping', until: c.now() + 5000 });
    store.set('b', { state: 'sleeping', until: c.now() + 1000 });
    store.set('c', { state: 'sleeping' });
    assert.deepEqual(
      store.pending().map((item) => item.petId),
      ['b', 'a'],
    );
  });

  test('expire() 回报被清掉的 petId', () => {
    const c = clock();
    const store = new RhythmStore({ now: c.now });
    store.set('a', { state: 'sleeping', until: c.now() + 10 });
    store.set('b', { state: 'sleeping', until: c.now() + 20 });
    c.tick(100);
    assert.deepEqual(store.expire().sort(), ['a', 'b']);
    assert.deepEqual(store.expire(), [], '第二次没有可清的');
  });
});

describe('RhythmStore —— 清除', () => {
  test('clear 撤掉请求并按 awake 回调', () => {
    const events: RhythmRequest[] = [];
    const store = new RhythmStore({ onChange: (_id, req) => events.push(req) });
    store.set('main', { state: 'sleeping' });
    assert.equal(store.clear('main'), true);
    assert.equal(store.get('main'), null);
    const last = events[events.length - 1];
    assert.equal(last?.state, 'awake');
    assert.equal(last?.reason, 'cleared');
  });

  test('clear 幂等：没有请求时返回 false 且不回调', () => {
    const events: RhythmRequest[] = [];
    const store = new RhythmStore({ onChange: (_id, req) => events.push(req) });
    assert.equal(store.clear('main'), false);
    assert.deepEqual(events, []);
  });
});

describe('RhythmStore —— 多宠物互不干扰', () => {
  test('一只睡不影响另一只', () => {
    const store = new RhythmStore();
    store.set('a', { state: 'sleeping' });
    store.set('b', { state: 'awake' });
    assert.equal(store.get('a')?.state, 'sleeping');
    assert.equal(store.get('b')?.state, 'awake');
  });
});
