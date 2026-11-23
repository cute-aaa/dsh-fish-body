/**
 * 「声音」分区装配的契约测试：页内两节（音效 / 语音）、会话鱼开关不在本页、跳转回调只回传目标分区。
 *
 * 用最小 `h` 替身摊平元素树——卡片本身不在这里渲染，只钉装配关系与那一行只读引用。
 * @module dsh-fish-body/src/client/settings/audio-tab.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { makeAudioTab } from './audio-tab.ts';
import { NO_DIRTY } from './dirty.ts';
import type { H, SettingsRuntime } from './runtime.ts';

interface Node {
  tag: unknown;
  props: Record<string, unknown>;
}

/** 最小 `h`：只记录标签与 props，不渲染子组件。 */
const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as H;

/** 摊平整棵树。 */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

/** 树里全部文本片段（字符串子节点）。 */
function texts(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap(texts);
  return texts((node as Node).props?.children);
}

/** 造一份最小运行时：只有 `h` 与 `t` 被真正用到，其余给直通实现。 */
function runtime(): SettingsRuntime {
  return {
    h,
    t: (key: string) => key,
    useState: ((init: unknown) => [init, () => undefined]) as never,
    useEffect: (() => undefined) as never,
    useRef: ((value: unknown) => ({ current: value })) as never,
    useCallback: ((callback: unknown) => callback) as never,
  };
}

/** 只填装配所需的空壳（卡片不渲染，字段不会被读）。 */
const props = (onSelectTab?: (tab: 'fish') => void) =>
  ({
    busy: false,
    global: {},
    sfx: {},
    voice: {},
    dirty: NO_DIRTY,
    ...(onSelectTab === undefined ? {} : { onSelectTab }),
  }) as never;

describe('AudioTab —— 页内两节 + 会话鱼只读引用', () => {
  test('两个小节标题都在（音效 / 语音），且顺序是音效在前', () => {
    const AudioTab = makeAudioTab(runtime());
    const tree = AudioTab(props());
    const titles = flatten(tree)
      .filter((node) => String(node.props.className ?? '').includes('__sectionTitle'))
      .map((node) => node.props.children);
    assert.deepEqual(titles, ['secSfx', 'secVoice']);
  });

  test('会话鱼播报开关不在声音页出现（只给一行引用 + 跳转）', () => {
    const AudioTab = makeAudioTab(runtime());
    const tree = AudioTab(props(() => undefined));
    const all = texts(tree);
    assert.ok(all.includes('fishSpeakElsewhere'), '应有一行只读引用');
    assert.ok(all.includes('fishSpeakJump'), '应有跳转按钮文案');
    // 会话鱼四个开关的文案键一个都不该在声音页出现
    for (const key of ['fish.speakEnabled', 'fish.speakProgress', 'fish.speakTurnEnd', 'fish.speakWaiting']) {
      assert.equal(all.includes(key), false, key + ' 不应出现在声音页');
    }
  });

  test('跳转按钮只回传 fish；没有回调时按钮不渲染', () => {
    const calls: string[] = [];
    const AudioTab = makeAudioTab(runtime());
    const buttons = flatten(AudioTab(props((tab) => calls.push(tab)))).filter((node) => node.tag === 'button');
    assert.equal(buttons.length, 1);
    (buttons[0].props.onClick as () => void)();
    assert.deepEqual(calls, ['fish']);

    const without = flatten(AudioTab(props())).filter((node) => node.tag === 'button');
    assert.equal(without.length, 0, '没有 onSelectTab 时不渲染死按钮');
  });
});
