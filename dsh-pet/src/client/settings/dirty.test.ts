/**
 * 未保存改动判定（src/client/settings/dirty.ts）的契约测试。
 *
 * 四条契约：
 *   1. 改动路径是「快照里的位置」，对象逐键下钻、数组按位置下钻（`pets.0.size`）；长度一变退回聚合路径；
 *   2. 基线缺省的字段不参与比较——服务端没给可信值不等于用户改了；
 *   3. `has` 同时命中子路径，卡片可以拿卡片级前缀一次问整块；
 *   4. 路径按最长前缀归到分区，标签条据此点亮小圆点。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  advancePetBaseline,
  baselineFromConfig,
  diffSnapshot,
  dirtyTabs,
  makeDirtyQuery,
  type FormSnapshot,
} from './dirty.ts';
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

  test('数组按位置下钻：改一只宠物的大小编成 `pets.0.size`', () => {
    const paths = diffSnapshot(current, { ...current, pets: [pet('a', 300)] });
    assert.deepEqual([...paths], ['pets.0.size']);
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

describe('dirtyTabs —— 实例字段级归属（控件搬了家，圆点跟着走）', () => {
  /** 只有目标分区被点亮。 */
  const only = (path: string, tab: 'pet' | 'feel'): void => {
    const tabs = dirtyTabs(new Set([path]));
    const lit = Object.entries(tabs)
      .filter(([, on]) => on)
      .map(([id]) => id);
    assert.deepEqual(lit, [tab], `${path} 应只点亮 ${tab}`);
  };

  test('渲染 / 位置 / 尺寸 / 鼠标穿透 → 外观与手感', () => {
    only('pets.0.renderer', 'feel');
    only('pets.0.model', 'feel');
    only('pets.0.sizes.live2d', 'feel');
    only('pets.0.position.marginX', 'feel');
    only('pets.0.clickThrough', 'feel');
  });

  test('名字 / 人设正文 / 角色引用 → 桌宠', () => {
    only('pets.0.name', 'pet');
    only('pets.0.whisperPrompt', 'pet');
    only('pets.1.personaCharacter', 'pet');
  });

  test('global.confineToScreen → 外观与手感（它已搬进窗口行为卡）', () => {
    only('global.confineToScreen', 'feel');
  });
});

describe('advancePetBaseline —— 只推一只的指定字段', () => {
  test('推进 A 的 whisperPrompt 后，A 该字段无改动、B 的改动仍在', () => {
    const baseline: FormSnapshot = {
      pets: [
        { ...pet('a', 240), whisperPrompt: '旧正文' },
        { ...pet('b', 240), whisperPrompt: 'B 旧' },
      ] as Pet[],
    };
    const current: FormSnapshot = {
      pets: [
        { ...pet('a', 240), whisperPrompt: '角色正文' },
        { ...pet('b', 240), whisperPrompt: 'B 新' },
      ] as Pet[],
    };
    const advanced = advancePetBaseline(baseline, 'a', { whisperPrompt: '角色正文' });
    assert.deepEqual([...diffSnapshot(advanced, current)], ['pets.1.whisperPrompt']);
  });

  test('基线没有宠物列表时原样返回（不凭空造一个）', () => {
    const bare: FormSnapshot = { global: { trayEnabled: true } };
    assert.equal(advancePetBaseline(bare, 'a', { whisperPrompt: 'x' }), bare);
  });
});
