/**
 * 作息驱动的契约：到点进入、出段退出、不覆盖人设外的决定、幂等。
 *
 * 这一层一旦出错就是「宠物半夜自己醒着/白天一直睡」，所以每条都要有测试盯着；
 * 用注入时钟与真 `RhythmStore`，不碰定时器。
 * @module dsh-fish-body/src/host/schedule/driver.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { RhythmStore } from '../rhythm.ts';
import { SCHEDULE_REASON, ScheduleDriver, type ScheduleSource } from './driver.ts';

/** 固定时刻的时钟。 */
function clock(at: Date): { now: () => Date; set: (next: Date) => void } {
  let value = at;
  return { now: () => value, set: (next: Date) => (value = next) };
}

/** 造一个 driver。 */
function driverWith(
  sources: ScheduleSource[],
  at: Date,
): { driver: ScheduleDriver; rhythm: RhythmStore; clock: ReturnType<typeof clock> } {
  const c = clock(at);
  // RhythmStore 也要吃同一个固定时钟，否则夹具日期会被真实 Date.now() 判成已过期。
  const rhythm = new RhythmStore({ now: () => c.now().getTime() });
  const driver = new ScheduleDriver({ rhythm, readSources: () => sources, now: c.now });
  return { driver, rhythm, clock: c };
}

// 方向配对写法：入睡点 + 起床点。只给入睡点时 extractSchedule 会按 +7h 推一段（见下条测试）
const NIGHT = '- 23:00 睡觉，早上 08:00 起床\n';

describe('ScheduleDriver —— 到点进入', () => {
  test('23:30 落在 23:00→08:00 里 → 设 sleeping，until 是次日 08:00', () => {
    const { driver, rhythm } = driverWith([{ petId: 'main', text: NIGHT }], new Date(2026, 10, 25, 23, 30));
    const result = driver.tick();
    assert.deepEqual(result.entered, ['main']);
    const view = rhythm.get('main');
    assert.equal(view?.state, 'sleeping');
    assert.equal(view?.reason, SCHEDULE_REASON);
    const until = new Date(view!.until!);
    assert.equal(until.getDate(), 26);
    assert.equal(until.getHours(), 8);
  });

  test('03:00 也在同一段里（跨午夜）', () => {
    const { driver, rhythm } = driverWith([{ petId: 'main', text: NIGHT }], new Date(2026, 10, 26, 3, 0));
    driver.tick();
    assert.equal(rhythm.get('main')?.state, 'sleeping');
  });

  test('白天（13:00）不进入', () => {
    const { driver, rhythm } = driverWith([{ petId: 'main', text: NIGHT }], new Date(2026, 10, 25, 13, 0));
    const result = driver.tick();
    assert.deepEqual(result.entered, []);
    assert.equal(rhythm.get('main'), null);
  });

  test('文本里没有作息 → 什么都不做', () => {
    const { driver, rhythm } = driverWith(
      [{ petId: 'main', text: '你是鱼生，爱撒娇。' }],
      new Date(2026, 10, 25, 23, 30),
    );
    assert.deepEqual(driver.tick().entered, []);
    assert.equal(rhythm.get('main'), null);
  });

  test('同一分钟连调两次只进一次（幂等）', () => {
    const { driver, rhythm } = driverWith([{ petId: 'main', text: NIGHT }], new Date(2026, 10, 25, 23, 30));
    assert.deepEqual(driver.tick().entered, ['main']);
    assert.deepEqual(driver.tick().entered, [], '第二拍 changed:false');
    assert.equal(rhythm.get('main')?.state, 'sleeping');
  });
});

describe('ScheduleDriver —— 出段回到醒着', () => {
  test('23:30 进、09:00 已到期 → RhythmStore 自动清掉，不把到期误记成 driver.left', () => {
    const { driver, rhythm, clock } = driverWith([{ petId: 'main', text: NIGHT }], new Date(2026, 10, 25, 23, 30));
    driver.tick();
    assert.equal(rhythm.get('main')?.state, 'sleeping');
    clock.set(new Date(2026, 10, 26, 9, 0));
    const result = driver.tick();
    assert.deepEqual(result.left, []);
    assert.equal(rhythm.get('main'), null);
  });

  test('文本改成没有作息 → 也清掉自己那条', () => {
    const sources: ScheduleSource[] = [{ petId: 'main', text: NIGHT }];
    const { driver, rhythm } = driverWith(sources, new Date(2026, 10, 25, 23, 30));
    driver.tick();
    sources[0] = { petId: 'main', text: '只剩人设了。' };
    assert.deepEqual(driver.tick().left, ['main']);
    assert.equal(rhythm.get('main'), null);
  });
});

describe('ScheduleDriver —— 不覆盖别人的决定', () => {
  test('用户手动设的（reason user）不在段里也不被清', () => {
    const { driver, rhythm, clock } = driverWith([{ petId: 'main', text: NIGHT }], new Date(2026, 10, 25, 13, 0));
    rhythm.set('main', { state: 'sleeping', reason: 'user', source: 'user' });
    clock.set(new Date(2026, 10, 25, 14, 0));
    const result = driver.tick();
    assert.deepEqual(result.left, [], '手动的不能被作息引擎清掉');
    assert.equal(rhythm.get('main')?.reason, 'user');
  });

  test('用户手动设着的时候，到点也不抢', () => {
    const { driver, rhythm } = driverWith([{ petId: 'main', text: NIGHT }], new Date(2026, 10, 25, 23, 30));
    rhythm.set('main', { state: 'awake', reason: 'user', source: 'user' });
    const result = driver.tick();
    assert.deepEqual(result.entered, [], '已有的非作息请求优先');
    assert.equal(rhythm.get('main')?.reason, 'user');
  });

  test('外部脚本设的（reason 不是 schedule）同样不被覆盖', () => {
    const { driver, rhythm } = driverWith([{ petId: 'main', text: NIGHT }], new Date(2026, 10, 25, 23, 30));
    rhythm.set('main', { state: 'awake', reason: 'cron', source: 'external' });
    driver.tick();
    assert.equal(rhythm.get('main')?.reason, 'cron');
  });
});

describe('ScheduleDriver —— 多宠物', () => {
  test('各自按自己的作息走，互不影响', () => {
    const { driver, rhythm } = driverWith(
      [
        { petId: 'a', text: NIGHT },
        { petId: 'b', text: '没有作息的人设。' },
      ],
      new Date(2026, 10, 25, 23, 30),
    );
    const result = driver.tick();
    assert.deepEqual(result.entered, ['a']);
    assert.equal(rhythm.get('a')?.state, 'sleeping');
    assert.equal(rhythm.get('b'), null);
  });
});
