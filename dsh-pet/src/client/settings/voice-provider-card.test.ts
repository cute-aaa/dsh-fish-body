/**
 * 语音接入卡（src/client/settings/voice-provider-card.ts）的契约测试。
 *
 * 主要钉一件事：**下拉字段必须真的渲染成 `select`，并且能改到草稿**。
 * 这类控件由宿主声明驱动（`fields[].kind` + `options`），属性名或分支漂了不会报类型错，
 * 只会得到一个「填了也没用」的输入框——用户看到的是「选项呢？」。
 * 顺带钉住文本 / 密钥两种分支没被这次改动弄坏。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeVoiceProviderCard, type VoiceProviderCardProps } from './voice-provider-card.ts';
import type { VoiceFieldView } from '../../shared/voice-providers.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
const Card = makeVoiceProviderCard({ h, t: (key: string) => key } as never);

/** 把虚拟树摊平：`field()` 会把控件包在 label 里，所以要递归 children。 */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

/** 一份最小输入；各用例只覆盖自己关心的几项。 */
const props = (patch: Partial<VoiceProviderCardProps> = {}): VoiceProviderCardProps =>
  ({
    busy: false,
    name: 'DeepSeek 云端语音（按量计费）',
    available: true,
    reason: '',
    lastError: '',
    fields: [],
    values: {},
    secrets: {},
    message: '',
    onChange: () => {},
    onSave: () => {},
    onClearSecret: () => {},
    showProcess: false,
    canStart: false,
    canStop: false,
    running: false,
    starting: false,
    processBusy: false,
    processMessage: '',
    onStart: () => {},
    onStop: () => {},
    ...patch,
  }) as VoiceProviderCardProps;

/** 一份 select 字段（云端卡里的「音色」）。 */
const voiceField: VoiceFieldView = {
  key: 'voice',
  label: '音色',
  kind: 'select',
  required: false,
  options: ['stella', 'tide'],
};

/** 卡里唯一的 `select`。 */
const selectOf = (tree: unknown): Node | undefined => flatten(tree).find((node) => node.tag === 'select');

describe('VoiceProviderCard —— 下拉字段', () => {
  test('select 字段渲染成下拉，候选值一个不少', () => {
    const select = selectOf(Card(props({ fields: [voiceField] })));
    assert.ok(select, 'kind: select 必须渲染成 select，不能退化成输入框');
    const options = flatten(select.props.children).filter((node) => node.tag === 'option');
    assert.deepEqual(
      options.map((node) => node.props.value),
      ['stella', 'tide'],
    );
  });

  test('草稿为空时显示第一项（「没配」与「默认音色」在这里是同一件事）', () => {
    assert.equal(selectOf(Card(props({ fields: [voiceField], values: {} })))?.props.value, 'stella');
  });

  test('草稿里有合法值时按它选中；脏值回落第一项，不让界面空着', () => {
    assert.equal(selectOf(Card(props({ fields: [voiceField], values: { voice: 'tide' } })))?.props.value, 'tide');
    assert.equal(selectOf(Card(props({ fields: [voiceField], values: { voice: 'alloy' } })))?.props.value, 'stella');
  });

  test('改下拉真的写到草稿（键与值都要对）', () => {
    const seen: [string, string][] = [];
    const select = selectOf(Card(props({ fields: [voiceField], onChange: (key, value) => seen.push([key, value]) })));
    assert.ok(select);
    (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'tide' } });
    assert.deepEqual(seen, [['voice', 'tide']]);
  });

  test('保存忙时下拉也禁用（避免半截提交）', () => {
    assert.equal(selectOf(Card(props({ fields: [voiceField], busy: true })))?.props.disabled, true);
  });

  test('没声明候选值的 select 退回输入框（不渲染空下拉）', () => {
    const bare: VoiceFieldView = { key: 'voice', label: '音色', kind: 'select', required: false };
    const tree = Card(props({ fields: [bare] }));
    assert.equal(selectOf(tree), undefined);
    const input = flatten(tree).find((node) => node.tag === 'input');
    assert.equal(input?.props.type, 'text');
  });
});

describe('VoiceProviderCard —— 动作结论只占一行', () => {
  /** 卡片里的 `__msg` 行（顶部可用性 + 底部动作结论）。 */
  const messagesOf = (tree: unknown): Node[] =>
    flatten(tree).filter((node) => String(node.props.className ?? '').includes('dsh-pet-cfg__msg'));

  test('保存与启停的结论不并排：启停优先，只渲染一条', () => {
    const tree = Card(
      props({
        fields: [voiceField],
        showProcess: true,
        canStart: true,
        message: 'voiceProviderSaved',
        processMessage: 'voiceProviderStarted',
      }),
    );
    const texts = messagesOf(tree).map((node) =>
      flatten(node)
        .map((inner) => inner.props.children)
        .join(''),
    );
    // 第一行是「服务通不通」，第二行才是「上一次点了什么」——两条各有各的意思，不合并。
    assert.deepEqual(texts, ['voiceProviderReady', 'voiceProviderStarted']);
  });

  test('没有启停结论时显示保存结论；失败带 is-err', () => {
    const tree = Card(props({ fields: [voiceField], message: '!保存被拒' }));
    const [action] = messagesOf(tree).slice(-1);
    assert.equal(
      flatten(action)
        .map((inner) => inner.props.children)
        .join(''),
      '保存被拒',
    );
    assert.match(String(action.props.className), /is-err/);
  });

  test('两个结论都没有：不渲染多余的空行', () => {
    const tree = Card(props({ fields: [voiceField] }));
    // 只剩顶部那一行「就绪」。
    assert.equal(messagesOf(tree).length, 1);
  });
});

describe('VoiceProviderCard —— 其它分支没被弄坏', () => {
  test('text 字段仍是输入框', () => {
    const base: VoiceFieldView = { key: 'baseURL', label: '服务地址', kind: 'text', required: false };
    const input = flatten(Card(props({ fields: [base] }))).find((node) => node.tag === 'input');
    assert.equal(input?.props.type, 'text');
  });

  test('密钥字段：已保存时给出「清除」按钮，占位文案不假装是空值', () => {
    const secret: VoiceFieldView = {
      key: 'apiKey',
      label: 'API Key',
      kind: 'password',
      required: true,
      credentialRef: 'DSH_FISH_BODY_CLOUD_TTS_KEY',
    } as VoiceFieldView;
    const tree = Card(props({ fields: [secret], secrets: { apiKey: true } }));
    const input = flatten(tree).find((node) => node.tag === 'input');
    assert.equal(input?.props.type, 'password');
    assert.equal(input?.props.placeholder, 'voiceProviderSecretSaved');
    const clear = flatten(tree).find((node) => node.tag === 'button');
    assert.deepEqual(clear?.props.children, ['voiceProviderSecretClear']);
  });
});
