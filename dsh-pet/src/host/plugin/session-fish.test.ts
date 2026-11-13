/**
 * 会话鱼快照桥：内容不变不写叶子，显示参数变化要立刻写。
 * @module dsh-pet/src/host/plugin/session-fish.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionFishBridge } from './session-fish.ts';
import { SessionFishStore } from '../session-fish/store.ts';
import { DEFAULT_SESSION_FISH_SETTINGS, type SessionFishSettings } from '../../shared/session-fish.ts';
import type { PollStateStore } from '../state.ts';

describe('createSessionFishBridge', () => {
  test('首写一次；内容不变不重复写；设置变化/新鱼才写', () => {
    let settings: SessionFishSettings = { ...DEFAULT_SESSION_FISH_SETTINGS };
    let now = 1_000;
    const store = new SessionFishStore({ settings: () => settings, now: () => now, pick: () => 0 });
    const writes: Array<{ name: string; data: unknown }> = [];
    const state = { writeSection: (name: string, data: unknown) => writes.push({ name, data }) };
    const bridge = createSessionFishBridge({ state: state as unknown as PollStateStore, store });

    bridge.publishSessionFish();
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.name, 'sessionFish');

    // 只有 ts 变（时钟前进）：签名把它抹平，不应再写。
    now += 5_000;
    bridge.publishSessionFish();
    assert.equal(writes.length, 1);

    // 设置变化：立即再写一次。
    settings = { ...settings, sizePx: 72 };
    bridge.publishSessionFish();
    assert.equal(writes.length, 2);
    assert.equal((writes[1]?.data as { sizePx: number }).sizePx, 72);

    // 新鱼出现：再写。
    store.applyEvent('s1', { type: 'turn/start' });
    bridge.publishSessionFish();
    assert.equal(writes.length, 3);
    assert.equal((writes[2]?.data as { fishes: unknown[] }).fishes.length, 1);
  });
});
