/**
 * 未保存改动判定（src/client/settings/dirty.ts）的契约测试。
 *
 * 四条契约：
 *   1. 改动路径是「快照里的位置」，对象逐键下钻、数组整体算一条（宠物只关心「哪只被改过」）；
 *   2. 基线缺省的字段不参与比较——服务端没给可信值不等于用户改了；
 *   3. `has` 同时命中子路径，卡片可以拿卡片级前缀一次问整块；
 *   4. 路径按最长前缀归到分区，标签条据此点亮小圆点。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { baselineFromConfig, diffSnapshot, dirtyTabs, makeDirtyQuery, type FormSnapshot } from './dirty.ts';
import { DEFAULT_PHYSICS } from '../../shared/physics.ts';
import type { Pet } from '../../shared/types.ts';

const pet = (id: string, size: number): Pet =>
  ({
    id,
    size,
    display: 'web',
    position: { corner: 'top-left', marginX: 0, marginY: 0 },
  }) as unknown as Pet;

/** 一份完整的「当前」快照：只填本文件关心的字段。 */
const current: FormSnapshot = {
  pets: [pet('a', 240)],
  global: {
    notificationsEnabled: true,
    trayEnabled: true,
    confineToScreen: false,
    sfxEnabled: true,
    sfxKeepAlive: true,
    sfxVolume: 0.5,
  },
  sfx: {},
  voice: { enabled: false, name: 'xiao', volume: 1, whisper: false, todo: false, notify: false, stripEmoji: true },
  model: {
    whisperModel: { provider: '', model: '' },
    chatModel: { provider: '', model: '' },
    chatMemory: 10,
    chatImageLimit: 20,
    whisperImageEnabled: false,
    chatImageEnabled: false,
    chatAnimationEnabled: true,
  },
  look: {
    physics: { ...DEFAULT_PHYSICS },
    weights: { idle: 30, turn: 20, move: 20 },
    font: { family: 'candy', size: 14, followPet: true },
  },
  fish: null,
};

describe('diffSnapshot —— 路径级改动', () => {
  test('没有改动时是空集', () => {
    assert.equal(diffSnapshot(current, current).size, 0);
  });

  test('对象逐键下钻到单字段', () => {
    const next: FormSnapshot = {
      ...current,
      look: { ...current.look, physics: { ...DEFAULT_PHYSICS, gravity: DEFAULT_PHYSICS.gravity + 100 } },
    };
    const paths = diffSnapshot(current, next);
    assert.deepEqual([...paths], ['look.physics.gravity']);
  });

  test('数组整体算一条：改任意一只宠物只报 `pets`', () => {
    const paths = diffSnapshot(current, { ...current, pets: [pet('a', 300)] });
    assert.deepEqual([...paths], ['pets']);
  });

  test('基线缺省的字段跳过：服务端没给可信值不算改动', () => {
    const bare: FormSnapshot = { pets: current.pets };
    assert.equal(diffSnapshot(bare, current).size, 0);
  });

  test('会话鱼未加载（null）不参与比较，加载后按字段报', () => {
    assert.equal(diffSnapshot({ ...current, fish: null }, current).size, 0);
    const fishA = { enabled: true, sizePx: 96 } as never;
    const fishB = { enabled: false, sizePx: 96 } as never;
    assert.deepEqual([...diffSnapshot({ ...current, fish: fishA }, { ...current, fish: fishB })], ['fish.enabled']);
  });
});

describe('makeDirtyQuery —— 圆点查询口', () => {
  test('has 命中自身与子路径，count 是路径条数', () => {
    const dirty = makeDirtyQuery(new Set(['look.physics.gravity', 'model.chatMemory']));
    assert.equal(dirty.count, 2);
    assert.equal(dirty.has('look.physics.gravity'), true);
    assert.equal(dirty.has('look.physics'), true, '卡片级前缀要能一次问整块');
    assert.equal(dirty.has('model'), true);
    assert.equal(dirty.has('look.font'), false);
  });
});

describe('dirtyTabs —— 路径归到分区', () => {
  test('最长前缀优先：音效三项进「声音」，通知进「系统」', () => {
    const tabs = dirtyTabs(new Set(['global.sfxVolume', 'global.notificationsEnabled', 'look.physics.gravity']));
    assert.equal(tabs.audio, true);
    assert.equal(tabs.system, true);
    assert.equal(tabs.feel, true, '物理归到「外观与手感」');
    assert.equal(tabs.pet, false);
    assert.equal(tabs.fish, false);
  });

  test('宠物与字体各自归位', () => {
    const tabs = dirtyTabs(new Set(['pets', 'look.font.size']));
    assert.equal(tabs.pet, true);
    assert.equal(tabs.feel, true, '字体也归到「外观与手感」');
  });
});

describe('baselineFromConfig —— 权威值 → 基线', () => {
  test('缺省字段保持 undefined，会话鱼留给外壳', () => {
    const baseline = baselineFromConfig([{ key: 'main', kind: 'main', pets: [pet('a', 240)] }], {
      pets: [pet('a', 240)],
      chatMemoryRounds: 3,
    });
    assert.equal(baseline.pets?.length, 1);
    assert.equal(baseline.model?.chatMemory, 3);
    assert.equal(baseline.model?.chatImageLimit, undefined, '没给的字段不该编出默认值');
    assert.equal(baseline.fish, undefined);
  });
});
