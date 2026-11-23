/**
 * 语音卡（src/client/settings/voice-card.ts）的契约测试。
 *
 * 两条契约：
 *   1. 试听按钮必须真的接上回调——`h(...)` 不做 props 类型检查，属性名漂了不会报错，
 *      只会得到一个「点了没反应」的按钮（真实事故：接口叫 `onTest`、状态对象给了 `test`）；
 *   2. 阶段与失败原因要显示在按钮旁边：合成中禁用、播放中给出提示、失败留一句可读的话。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeVoiceCard, type VoiceCardProps } from './voice-card.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
/** 音色选择器在这些用例里不参与断言：给一个只会占位的组件。 */
const Picker = (() => null) as unknown as Parameters<typeof makeVoiceCard>[1];
const VoiceCard = makeVoiceCard({ h, t: (key: string) => key } as never, Picker);

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

/** 一份最小输入；`preview` 由各用例覆盖。 */
const props = (patch: Partial<VoiceCardProps> = {}): VoiceCardProps =>
  ({
    busy: false,
    enabled: true,
    voiceName: 'zh-CN-XiaoyiNeural',
    volume: 1,
    voices: [],
    whisperEnabled: true,
    todoEnabled: false,
    notifyEnabled: false,
    onToggle: () => {},
    onVoiceChange: () => {},
    onVolumeChange: () => {},
    onWhisperToggle: () => {},
    onTodoToggle: () => {},
    onNotifyToggle: () => {},
    preview: { phase: 'idle', message: '', test: () => {} },
    ...patch,
  }) as VoiceCardProps;

/** 试听按钮：卡里唯一带 `voicePreview` 文案的按钮。 */
const previewButton = (tree: unknown): Node | undefined =>
  flatten(tree).find((node) => node.tag === 'button' && node.props?.children === 'voicePreview');

describe('VoiceCard —— 试听按钮', () => {
  test('点一下真的调到试听回调', () => {
    let called = 0;
    const button = previewButton(
      VoiceCard(props({ preview: { phase: 'idle', message: '', test: () => (called += 1) } })),
    );
    assert.ok(button, '试听按钮必须存在');
    (button.props.onClick as () => void)();
    assert.equal(called, 1, '按钮必须接上 test()：接不上的表现就是「点了没声音」');
    assert.equal(button.props.disabled, false);
  });

  test('合成中：按钮换成「合成中…」并禁用，避免连点顶掉正在合成的那一句', () => {
    const tree = VoiceCard(props({ preview: { phase: 'loading', message: '', test: () => {} } }));
    const button = flatten(tree).find(
      (node) => node.tag === 'button' && node.props?.children === 'voicePreviewLoading',
    );
    assert.ok(button, '合成期间要显示「合成中…」');
    assert.equal(button.props.disabled, true);
  });

  test('播放中与失败都给出就地反馈', () => {
    const playing = flatten(VoiceCard(props({ preview: { phase: 'playing', message: '', test: () => {} } })));
    assert.ok(
      playing.some((node) => node.props?.children === 'voicePreviewPlaying'),
      '播放中要显示一句提示',
    );
    const failed = flatten(
      VoiceCard(props({ preview: { phase: 'failed', message: '试听失败：语音服务不可用', test: () => {} } })),
    );
    assert.ok(
      failed.some((node) => node.props?.children === '试听失败：语音服务不可用'),
      '失败原因要落在卡片里，不能静默',
    );
  });

  test('保存忙时禁用试听', () => {
    const tree = VoiceCard(props({ busy: true }));
    assert.equal(previewButton(tree)?.props.disabled, true);
  });
});
