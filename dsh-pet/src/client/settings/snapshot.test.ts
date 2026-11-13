/**
 * 表单快照（src/client/settings/snapshot.ts）的契约测试。
 *
 * 两条契约：
 *   1. `makeSnapshot` 摊出来的形状必须与基线同形——漏一个键，那一路的改动就不会亮圆点；
 *   2. `withoutFish` 只去掉会话鱼那一截，其余原样带过（推进主配置基线时用它）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { makeSnapshot, withoutFish } from './snapshot.ts';

/** 一份最小可用的状态集合：只填快照会读到的字段。 */
function sources() {
  return {
    list: { pets: [{ id: 'a' }] },
    global: {
      values: {
        notificationsEnabled: true,
        trayEnabled: false,
        confineToScreen: true,
        sfxEnabled: true,
        sfxKeepAlive: false,
      },
      sfxVolume: 0.5,
    },
    sfx: { config: { slots: { click: true } } },
    voice: {
      enabled: true,
      name: 'xiao',
      volume: 0.8,
      whisper: false,
      todo: true,
      notify: false,
      stripEmoji: true,
    },
    model: {
      whisperModel: { provider: '', model: '' },
      chatModel: { provider: 'p', model: 'm' },
      chatMemory: 3,
      chatImageLimit: 5,
      chatFlags: { whisperImageEnabled: false, chatImageEnabled: true, chatAnimationEnabled: false },
    },
    look: { physics: { gravity: 1 }, weights: { idle: 1 }, font: { family: 'candy' } },
    fish: { draft: { enabled: true } },
  };
}

describe('makeSnapshot —— 表单快照', () => {
  test('各分区字段各就各位，形状与基线一致', () => {
    const snapshot = makeSnapshot(sources() as never);
    assert.deepEqual(snapshot.pets, [{ id: 'a' }]);
    assert.equal(snapshot.global?.sfxVolume, 0.5);
    assert.equal(snapshot.global?.trayEnabled, false);
    assert.deepEqual(snapshot.voice, {
      enabled: true,
      name: 'xiao',
      volume: 0.8,
      whisper: false,
      todo: true,
      notify: false,
      stripEmoji: true,
    });
    // 三个对话开关摊在 model 段顶层（与成品配置字段同名）。
    assert.equal(snapshot.model?.chatImageEnabled, true);
    assert.equal(snapshot.model?.chatImageLimit, 5);
    assert.deepEqual(snapshot.look, {
      physics: { gravity: 1 },
      weights: { idle: 1 },
      font: { family: 'candy' },
    });
    assert.deepEqual(snapshot.fish, { enabled: true });
  });

  test('会话鱼草稿没读到时为 null（整块不参与比较）', () => {
    const input = sources();
    input.fish = { draft: null } as never;
    assert.equal(makeSnapshot(input as never).fish, null);
  });
});

describe('withoutFish —— 只推进主配置基线', () => {
  test('去掉 fish，其余字段原样带过', () => {
    const snapshot = makeSnapshot(sources() as never);
    const trimmed = withoutFish(snapshot);
    assert.equal('fish' in trimmed, false);
    assert.deepEqual(trimmed.pets, snapshot.pets);
    assert.deepEqual(trimmed.model, snapshot.model);
  });
});
