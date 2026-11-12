/**
 * 保存请求体摊平（src/client/settings/save-fields.ts）的契约测试。
 *
 * 三条契约（对应曾经的源码守卫 ⑦ 与请求体契约）：
 *   1. 五个全局开关（含系统通知与点击音效常驻预热）必须原样进请求体——漏一个键等于「切了开关点保存也不生效」；
 *   2. 语音的六个字段与 UI 的字段名一一对应（whisper/todo/notify 要翻成 voiceXxxEnabled）；
 *   3. 远端音色与接入配置不进请求体：它们即时落盘，混进来会被宿主当成配置字段。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSaveFields, type SaveFieldParts } from './save-fields.ts';
import { DEFAULT_FONT } from '../../shared/fonts.ts';
import { DEFAULT_PHYSICS } from '../../shared/physics.ts';
import { DEFAULT_WEIGHTS } from '../../shared/weights.ts';
import type { Pet } from '../../shared/types.ts';

/** 一只最小实例。 */
const pet = (id: string): Pet => ({
  id,
  name: id,
  size: 320,
  balanceEnabled: false,
  whisperEnabled: false,
  workStatusEnabled: false,
  fixedEnabled: false,
  display: 'web',
  position: { corner: 'top-right', marginX: 0, marginY: 0 },
});

/** 一份改了值的输入：每个分区都与内置默认不同，漏映射会被立刻看出来。 */
const parts = (): SaveFieldParts => ({
  pets: [pet('m1')],
  global: {
    notificationsEnabled: false,
    sfxEnabled: false,
    sfxKeepAlive: true,
    confineToScreen: true,
    trayEnabled: false,
  },
  sfxVolume: 0.25,
  sfx: { events: { click: { volume: 0.8 } } },
  chat: { whisperImageEnabled: true, chatImageEnabled: false, chatAnimationEnabled: false },
  voice: { enabled: true, name: 'zh-CN-YunxiNeural', volume: 0.4, whisper: true, todo: false, notify: true },
  model: {
    whisperModel: { provider: 'deepseek', model: 'deepseek-chat' },
    chatModel: { provider: '', model: '' },
    chatMemory: 7,
    chatImageLimit: 3,
  },
  look: {
    physics: { ...DEFAULT_PHYSICS, gravity: 1234 },
    font: { ...DEFAULT_FONT, size: 22 },
    weights: { ...DEFAULT_WEIGHTS, idle: 40 },
  },
});

describe('buildSaveFields —— 保存请求体的摊平', () => {
  test('五个全局开关原样进请求体（含系统通知）', () => {
    const fields = buildSaveFields(parts());
    assert.equal(fields.notificationsEnabled, false, '通知开关必须在请求体里，否则切了也不生效');
    assert.equal(fields.sfxEnabled, false);
    assert.equal(fields.sfxKeepAlive, true, '常驻预热也要进请求体，漏了就永远勾不上');
    assert.equal(fields.sfxVolume, 0.25, '音效音量要与语音音量分开带走');
    assert.deepEqual(
      fields.sfx,
      { events: { click: { volume: 0.8 } } },
      'sfx 段要原样带走，否则设置页的音量改动存不进去',
    );
    assert.equal(fields.confineToScreen, true);
    assert.equal(fields.trayEnabled, false);
  });

  test('语音字段名一一对应：whisper/todo/notify 翻成 voiceXxxEnabled', () => {
    const fields = buildSaveFields(parts());
    assert.equal(fields.voiceEnabled, true);
    assert.equal(fields.voiceName, 'zh-CN-YunxiNeural');
    assert.equal(fields.voiceVolume, 0.4);
    assert.equal(fields.voiceWhisperEnabled, true);
    assert.equal(fields.voiceTodoEnabled, false);
    assert.equal(fields.voiceNotifyEnabled, true);
  });

  test('对话、外观与实例字段照原值带走', () => {
    const fields = buildSaveFields(parts());
    assert.deepEqual(
      fields.pets.map((item) => item.id),
      ['m1'],
    );
    assert.equal(fields.chatImageEnabled, false);
    assert.equal(fields.whisperImageEnabled, true);
    assert.equal(fields.chatAnimationEnabled, false);
    assert.deepEqual(fields.chatModel, { provider: '', model: '' });
    assert.equal(fields.chatMemoryRounds, 7);
    assert.equal(fields.chatImageLimit, 3);
    assert.equal(fields.physics.gravity, 1234);
    assert.equal(fields.font.size, 22);
    assert.equal(fields.animationWeights.idle, 40);
  });

  test('远端音色与接入配置不进请求体', () => {
    const fields = buildSaveFields(parts());
    const keys = Object.keys(fields);
    // 接入配置（baseUrl / startScript 等）与音色清单都是即时落盘的旁路，混进来会被宿主按未知字段拒绝。
    for (const key of ['providers', 'voices', 'baseUrl', 'startScript', 'provider']) {
      assert.ok(!keys.includes(key), `请求体不得出现 ${key}`);
    }
  });
});
