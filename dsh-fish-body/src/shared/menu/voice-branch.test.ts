/**
 * 「音色」菜单与 provider 视图解析的测试（shared/voice-providers.ts + shared/menu/tree.ts 的 voiceMenuBranch）。
 *
 * 钉四件事：坏数据不炸（网络来的字段一律按可能不存在处理）、内置实现不进音色菜单、
 * 当前音色打勾、实现不可用时整层置灰但条目仍在（让人看得见「有这些嗓子，只是服务没起」）。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readVoiceProviders, switchableProviders, type VoiceProviderView } from '../voice-providers.ts';
import { voiceMenuBranch } from './tree.ts';
import type { MenuNode } from './types.ts';

/** 造一个实现视图。 */
function provider(over: Partial<VoiceProviderView> = {}): VoiceProviderView {
  return {
    id: 'gsv',
    name: 'GSV（本地 GPT-SoVITS）',
    builtin: false,
    available: true,
    voices: [
      { id: 'vodyanitsa', name: 'vodyanitsa', available: true },
      { id: 'klee', name: 'klee', tag: '原神角色语音', available: true },
    ],
    voice: 'vodyanitsa',
    fields: [],
    ...over,
  };
}

/** 取一层里的叶子（单实现时「音色」下面直接是叶子）。 */
function leavesOf(nodes: readonly MenuNode[] | undefined): MenuNode[] {
  if (!nodes) return [];
  return nodes.flatMap((node) => ('children' in node ? node.children : [node]));
}

describe('readVoiceProviders —— 网络数据的容错解析', () => {
  test('不是数组：空列表', () => {
    assert.deepEqual(readVoiceProviders(undefined), []);
    assert.deepEqual(readVoiceProviders('nope'), []);
    assert.deepEqual(readVoiceProviders({ providers: [] }), []);
  });

  test('坏条目被丢弃，缺省字段补默认值', () => {
    const list = readVoiceProviders([
      { id: 'gsv', voices: [{ id: 'klee' }, { name: 'no-id' }, 'bad'] },
      { name: 'no-id-provider' },
      null,
    ]);
    assert.equal(list.length, 1);
    const gsv = list[0];
    assert.ok(gsv);
    assert.equal(gsv.available, true, '老宿主没有 available 字段 → 按可用处理');
    assert.deepEqual(gsv.voices, [{ id: 'klee', name: 'klee', available: true }]);
    assert.equal(gsv.voice, '');
  });

  test('逐音色状态与扫描诊断：缺省按可用，空白诊断不留空数组', () => {
    const [view] = readVoiceProviders([
      {
        id: 'gsv',
        voices: [
          { id: 'klee', available: true },
          { id: 'norma', available: false, reason: ' 缺少参考音频 ' },
          { id: 'old' },
        ],
        notes: ['音色来源：权重 2 个', '  ', 42],
      },
      { id: 'plain', voices: [], notes: [] },
    ]);
    assert.ok(view);
    assert.deepEqual(
      view.voices.map((voice) => [voice.id, voice.available, voice.reason]),
      [
        ['klee', true, undefined],
        ['norma', false, '缺少参考音频'],
        ['old', true, undefined],
      ],
      '没有 available 字段的按可用处理（老宿主）',
    );
    assert.deepEqual(view.notes, ['音色来源：权重 2 个'], '空白与非字符串丢掉');
    const plain = readVoiceProviders([{ id: 'plain', voices: [], notes: [] }])[0];
    assert.equal(plain?.notes, undefined, '空诊断不留下空数组');
  });

  test('switchableProviders：内置实现与没音色的实现都不进菜单', () => {
    const list = readVoiceProviders([
      { id: 'gsv', voices: [{ id: 'klee' }] },
      { id: 'edge', builtin: true, voices: [] },
      { id: 'empty', voices: [] },
    ]);
    assert.deepEqual(
      switchableProviders(list).map((item) => item.id),
      ['gsv'],
    );
  });
});

describe('voiceMenuBranch —— 右键「音色」子菜单', () => {
  test('没有可切音色：整项不出现', () => {
    assert.equal(voiceMenuBranch([]), null);
    assert.equal(voiceMenuBranch(readVoiceProviders([{ id: 'edge', builtin: true }])), null);
  });

  test('单实现：一层「音色」直挂叶子，当前项打勾', () => {
    const branch = voiceMenuBranch([provider()]);
    assert.ok(branch);
    assert.equal(branch.label, '音色');
    const leaves = leavesOf(branch.children);
    assert.deepEqual(leaves[0], {
      label: 'vodyanitsa ✓',
      action: 'set-provider-voice',
      voiceProvider: 'gsv',
      providerVoice: 'vodyanitsa',
    });
    assert.equal(leaves[1]?.label, 'klee');
  });

  test('服务没起：条目仍列出，但置灰并带上原因', () => {
    const branch = voiceMenuBranch([provider({ available: false, reason: '连不上 http://127.0.0.1:9880' })]);
    const leaves = leavesOf(branch?.children);
    assert.equal(leaves.length, 2);
    for (const leaf of leaves) {
      assert.equal('disabled' in leaf ? leaf.disabled : undefined, true);
      assert.match('hint' in leaf ? (leaf.hint ?? '') : '', /9880/);
    }
  });

  test('单个音色缺文件：整层可用，只有它置灰并显示缺什么', () => {
    const branch = voiceMenuBranch([
      provider({
        voices: [
          { id: 'klee', name: 'klee', available: true },
          { id: 'norma', name: 'norma', available: false, reason: '缺少参考音频：refs/norma.wav' },
        ],
        voice: 'klee',
      }),
    ]);
    const leaves = leavesOf(branch?.children);
    const norma = leaves.find((leaf) => 'providerVoice' in leaf && leaf.providerVoice === 'norma');
    assert.ok(norma);
    assert.equal('disabled' in norma ? norma.disabled : undefined, true);
    assert.match('hint' in norma ? (norma.hint ?? '') : '', /缺少参考音频/);
    const klee = leaves.find((leaf) => 'providerVoice' in leaf && leaf.providerVoice === 'klee');
    assert.ok(klee);
    assert.equal('disabled' in klee ? klee.disabled : undefined, undefined, '可用的音色不受影响');
  });

  test('多实现：每个实现一层子菜单', () => {
    const branch = voiceMenuBranch([provider(), provider({ id: 'other', name: '别的实现' })]);
    assert.ok(branch);
    const layers = branch.children;
    assert.equal(layers.length, 2);
    assert.equal('children' in layers[0] ? layers[0].label : '', 'GSV（本地 GPT-SoVITS）');
  });
});
