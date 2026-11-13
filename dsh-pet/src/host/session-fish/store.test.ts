/**
 * 会话鱼状态机：档位迁移、plan 等待、goal 中间轮、完成确认、关闭/复活与上限淘汰。
 * @module dsh-pet/src/host/session-fish/store.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionFishStore } from './store.ts';
import { DEFAULT_SESSION_FISH_SETTINGS, type SessionFishSettings } from '../../shared/session-fish.ts';

/** 测试夹具：时钟与随机源都固定，设置可覆盖。 */
function makeStore(over: Partial<SessionFishSettings> = {}) {
  let settings: SessionFishSettings = { ...DEFAULT_SESSION_FISH_SETTINGS, ...over };
  let now = 1_000_000;
  const store = new SessionFishStore({ settings: () => settings, now: () => now, pick: () => 0 });
  return {
    store,
    get now() {
      return now;
    },
    tick(ms = 1) {
      now += ms;
    },
    setSettings(next: Partial<SessionFishSettings>) {
      settings = { ...settings, ...next };
    },
  };
}

/** 常用事件。 */
const turnStart = { type: 'turn/start' } as const;
const turnEndCompleted = { type: 'turn/end', data: { reason: { kind: 'completed' } } } as const;
const toolRead = { type: 'tool/call', data: { name: 'read', arguments: '{"path":"src/index.ts"}' } } as const;
const toolResult = { type: 'tool/result' } as const;

describe('SessionFishStore 基本生命周期', () => {
  test('turn/start：建鱼并进入 thinking，带一条进度播报', () => {
    const { store } = makeStore();
    const outcome = store.applyEvent('s1', turnStart);
    assert.equal(outcome.changed, true);
    const entry = store.list()[0];
    assert.ok(entry);
    assert.equal(entry.state, 'thinking');
    assert.equal(entry.done, false);
    assert.ok(entry.line && entry.line.length > 0);
    assert.equal(entry.lineSeq, 2); // 1 = idle 待命句，2 = 思考播报
  });

  test('tool/call → working，tool/result → result；同一会话只保留一条鱼', () => {
    const { store } = makeStore();
    store.applyEvent('s1', turnStart);
    store.applyEvent('s1', toolRead);
    assert.equal(store.list()[0]?.state, 'working');
    store.applyEvent('s1', toolResult);
    assert.equal(store.list()[0]?.state, 'result');
    assert.equal(store.list().length, 1);
  });

  test('进度播报按 progressGapMs 节流，但状态仍然实时更新', () => {
    const { store, tick } = makeStore({ progressGapMs: 15_000 });
    store.applyEvent('s1', turnStart);
    const first = store.list()[0]?.lineSeq ?? 0;
    tick(100);
    store.applyEvent('s1', toolRead);
    assert.equal(store.list()[0]?.state, 'working');
    assert.equal(store.list()[0]?.lineSeq, first, '间隔不够时不产生新播报');
    tick(15_000);
    store.applyEvent('s1', {
      type: 'tool/call',
      data: { name: 'edit', arguments: '{"path":"src/a.ts"}' },
    });
    assert.ok((store.list()[0]?.lineSeq ?? 0) > first, '间隔够了要产生新播报');
  });

  test('完成：先返回活动门确认，markDone 后才置 done；期间新一轮作废旧确认', () => {
    const { store } = makeStore();
    store.applyEvent('s1', turnStart);
    const outcome = store.applyEvent('s1', turnEndCompleted);
    assert.ok(outcome.awaitDone);
    assert.equal(store.list()[0]?.done, false);
    const epoch = outcome.awaitDone?.epoch ?? -1;
    assert.equal(store.markDone('s1', epoch), true);
    assert.equal(store.list()[0]?.done, true);
    // 同世代重复确认无效
    assert.equal(store.markDone('s1', epoch), false);
  });

  test('活动门判定还有活：压回 working，不算完成', () => {
    const { store } = makeStore();
    store.applyEvent('s1', turnStart);
    const outcome = store.applyEvent('s1', turnEndCompleted);
    assert.ok(outcome.awaitDone);
    assert.equal(store.markStillBusy('s1', outcome.awaitDone?.epoch ?? -1, true), true);
    assert.equal(store.list()[0]?.state, 'working');
    assert.equal(store.list()[0]?.done, false);
  });

  test('出错直接完成；aborted 直接移除', () => {
    const errored = makeStore();
    errored.store.applyEvent('s1', turnStart);
    errored.store.applyEvent('s1', { type: 'turn/end', data: { reason: { kind: 'error' } } });
    assert.equal(errored.store.list()[0]?.done, true);

    const aborted = makeStore();
    aborted.store.applyEvent('s2', turnStart);
    aborted.store.applyEvent('s2', { type: 'turn/end', data: { reason: { kind: 'aborted' } } });
    assert.equal(aborted.store.list().length, 0);
  });
});

describe('SessionFishStore 的 plan 与 goal 语义', () => {
  test('plan 模式：exit_plan_mode 等待期间 turn/end 不算结束', () => {
    const { store } = makeStore();
    store.applyEvent('s1', turnStart);
    store.applyEvent('s1', { type: 'plan/mode', data: { active: true } });
    store.applyEvent('s1', { type: 'tool/call', data: { name: 'exit_plan_mode', arguments: '{"plan":"# P"}' } });
    const entry = store.list()[0];
    assert.ok(entry);
    assert.equal(entry.state, 'waiting');
    assert.equal(entry.planPending, true);
    const outcome = store.applyEvent('s1', turnEndCompleted);
    assert.equal(outcome.awaitDone, undefined);
    assert.equal(store.list()[0]?.done, false);
    assert.equal(store.list()[0]?.state, 'waiting');
  });

  test('goal 中间轮：completed 只算「本轮完成」，不置 done；收尾轮 complete 才算', () => {
    const { store } = makeStore();
    store.applyEvent('s1', turnStart);
    store.applyEvent('s1', { type: 'user/message', data: { source: { kind: 'goal' } } });
    const middle = store.applyEvent('s1', turnEndCompleted);
    assert.equal(middle.awaitDone, undefined);
    assert.equal(store.list()[0]?.state, 'result');
    assert.equal(store.list()[0]?.done, false);

    store.applyEvent('s1', turnStart);
    store.applyEvent('s1', { type: 'update_goal', data: {} }); // 非 tool/call：不参与
    store.applyEvent('s1', { type: 'tool/call', data: { name: 'update_goal', arguments: '{"action":"complete"}' } });
    const final = store.applyEvent('s1', turnEndCompleted);
    assert.ok(final.awaitDone);
    store.markDone('s1', final.awaitDone?.epoch ?? -1);
    assert.equal(store.list()[0]?.done, true);
  });
});

describe('SessionFishStore 的展示生命周期', () => {
  test('focus 已完成的会话 → 鱼消失；focus 空白/运行中 → 补一条待命鱼', () => {
    const { store } = makeStore();
    store.applyEvent('s1', turnStart);
    const outcome = store.applyEvent('s1', turnEndCompleted);
    store.markDone('s1', outcome.awaitDone?.epoch ?? -1);
    assert.equal(store.focus('s1'), true);
    assert.equal(store.list().length, 0);

    assert.equal(store.focus('blank', { blank: true }), true);
    assert.equal(store.list()[0]?.sessionId, 'blank');
    assert.equal(store.list()[0]?.state, 'idle');
    assert.equal(store.focus('old'), false, '普通旧会话不建鱼');
  });

  test('close 后隐藏到下一轮：focus 不复活，turn/start 复活', () => {
    const { store } = makeStore();
    store.applyEvent('s1', turnStart);
    assert.equal(store.close('s1'), true);
    assert.equal(store.focus('s1', { running: true }), false);
    store.applyEvent('s1', turnStart);
    assert.equal(store.list().length, 1);
  });

  test('上限淘汰：先逐出最早完成的，再逐出最早活动的', () => {
    const { store, tick } = makeStore({ maxCount: 2 });
    store.applyEvent('s1', turnStart);
    const outcome = store.applyEvent('s1', turnEndCompleted);
    store.markDone('s1', outcome.awaitDone?.epoch ?? -1);
    tick();
    store.applyEvent('s2', turnStart);
    tick();
    store.applyEvent('s3', turnStart);
    const ids = store.list().map((fish) => fish.sessionId);
    assert.equal(ids.length, 2);
    assert.equal(ids.includes('s1'), false, '最早完成的那条先走');
    assert.deepEqual(ids.sort(), ['s2', 's3']);
  });

  test('总开关关掉：不建鱼、不处理事件；重新打开后下一轮再建', () => {
    const { store, setSettings } = makeStore({ enabled: false });
    assert.equal(store.applyEvent('s1', turnStart).changed, false);
    assert.equal(store.list().length, 0);
    setSettings({ enabled: true });
    store.applyEvent('s1', turnStart);
    assert.equal(store.list().length, 1);
  });

  test('快照带齐显示参数与排序（最近活动在前）', () => {
    const { store, tick } = makeStore();
    store.applyEvent('a', turnStart);
    tick(10);
    store.applyEvent('b', turnStart);
    const snap = store.snapshot();
    assert.equal(snap.enabled, true);
    assert.equal(snap.sizePx, DEFAULT_SESSION_FISH_SETTINGS.sizePx);
    assert.deepEqual(
      snap.fishes.map((fish) => fish.sessionId),
      ['b', 'a'],
    );
    assert.ok(snap.ts > 0);
  });
});
