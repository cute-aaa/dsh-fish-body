/**
 * 「你的声音」能力声明的测试。
 *
 * 关注点不是措辞好不好看，而是三件会直接影响它答题的事：
 * 1. 只用运行时真值——没连上的实现不能被写成能用；
 * 2. 说清自己改不了（不然用户会看到「我换个嗓子」这种做不到的承诺）；
 * 3. 缺状态时也不崩、不说错（宁少一句，不编一句）。
 * @module dsh-fish-body/src/host/voice/capability.test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { voiceCapabilityNote } from './capability.ts';
import type { VoiceProviderStatus } from './registry.ts';

/** 造一个第三方语音实现的状态。 */
function provider(over: Partial<VoiceProviderStatus> & Pick<VoiceProviderStatus, 'id' | 'name'>): VoiceProviderStatus {
  return {
    builtin: false,
    available: true,
    fields: [],
    voices: [],
    voice: '',
    ...over,
  };
}

test('只有内置 edge 时：报出当前音色名，并说明换不了', () => {
  const note = voiceCapabilityNote({ edgeVoice: 'zh-CN-YunxiNeural' });
  assert.match(note, /当前基础实现是 edge 在线语音 · 云希（zh-CN-YunxiNeural）/);
  assert.match(note, /你换不了嗓子/);
  assert.doesNotMatch(note, /GSV/);
});

test('edgeVoice 缺省/非法：回落到默认音色，不把 undefined 拼进提示词', () => {
  const a = voiceCapabilityNote({});
  assert.match(a, /晓伊（zh-CN-XiaoyiNeural）/);
  const b = voiceCapabilityNote({ edgeVoice: 'not-a-voice' });
  assert.match(b, /not-a-voice/);
  assert.doesNotMatch(b, /undefined/);
});

test('接了 GSV 且连上：列出可念音色与当前音色', () => {
  const note = voiceCapabilityNote({
    providers: [
      provider({
        id: 'gsv',
        name: '本地 GSV',
        available: true,
        voice: 'nuomu',
        voices: [
          { id: 'nuomu', name: '诺姆' },
          { id: 'nahida', name: '纳西妲' },
          { id: 'klee', name: '可莉', available: false, reason: '缺少参考音频：klee/ref.wav' },
        ],
      }),
    ],
  });
  assert.match(note, /本地 GSV：诺姆、纳西妲，当前「诺姆」/);
  // 缺文件的音色不算「能念」
  assert.doesNotMatch(note, /诺姆、纳西妲、可莉/);
});

test('装了但没连上：只报用不了并给原因，不写成可用', () => {
  const note = voiceCapabilityNote({
    providers: [
      provider({ id: 'gsv', name: '本地 GSV', available: false, reason: '服务没启动（127.0.0.1:9880 连不上）' }),
    ],
  });
  assert.match(note, /本地 GSV装了但此刻用不了（服务没启动/);
  assert.doesNotMatch(note, /也接了/);
});

test('音色很多时截断，但报出总数', () => {
  const voices = Array.from({ length: 9 }, (_, i) => ({ id: `v${i}`, name: `音色${i}` }));
  const note = voiceCapabilityNote({ providers: [provider({ id: 'gsv', name: '本地 GSV', voices })] });
  assert.match(note, /音色0、音色1、音色2、音色3、音色4、音色5 等 9 个/);
  assert.doesNotMatch(note, /音色6/);
});

test('两个开关全关：明确说「不会自动出声」', () => {
  const note = voiceCapabilityNote({ replyVoiceOn: false, whisperVoiceOn: false });
  assert.match(note, /语音总开关是关的/);
  assert.match(note, /只有用户点喇叭时才会响/);
});

test('只关碎碎念：说明只有那一类不念，别处照常', () => {
  const note = voiceCapabilityNote({ replyVoiceOn: true, whisperVoiceOn: false });
  assert.match(note, /碎碎念现在不念/);
  assert.doesNotMatch(note, /语音总开关是关的/);
});

test('开关都开着（或没传）：不出现任何「关」的断言', () => {
  for (const input of [{}, { replyVoiceOn: true, whisperVoiceOn: true }]) {
    const note = voiceCapabilityNote(input);
    assert.doesNotMatch(note, /语音总开关是关的/);
    assert.doesNotMatch(note, /现在不念/);
  }
});

test('实现自己抛错拿不到音色（voices 空）：仍列为可用，只是列不出音色', () => {
  const note = voiceCapabilityNote({ providers: [provider({ id: 'gsv', name: '本地 GSV', voices: [] })] });
  assert.match(note, /本地 GSV（音色暂时列不出来）/);
});

test('明确 TTS 只负责说话，不承诺真正唱歌', () => {
  const note = voiceCapabilityNote({});
  assert.match(note, /不会生成歌曲旋律/);
  assert.match(note, /不要声称自己能真正唱歌/);
});
