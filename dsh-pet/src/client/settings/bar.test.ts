/**
 * 底部操作栏（src/client/settings/bar.ts）的契约测试。
 *
 * 三条契约：
 *   1. 四个按钮按「越靠右越终局」排：重启 / 取消 / 应用 / 确定，确定是实心主按钮；
 *   2. 写盘时禁掉会改东西的三个（重启 / 应用 / 确定），取消永远可点——它是读失败时唯一的退路；
 *   3. 反馈贴左显示，错误带 is-err。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { H } from './runtime.ts';

import { makeBar } from './bar.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: string, props: Record<string, unknown>) => ({ tag, props })) as unknown as H;
const Bar = makeBar({ h, t: (key: string) => key } as never);

/** 摊平整棵树，便于按标签找节点。 */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const buttons = (tree: unknown): Node[] => flatten(tree).filter((node) => node.tag === 'button');

/** 造一份栏输入；未覆盖的字段给固定值。 */
function props(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    busy: false,
    msg: { kind: '', text: '' },
    onConfirm: () => {},
    onCancel: () => {},
    onApply: () => {},
    onRestart: () => {},
    ...over,
  };
}

describe('Bar —— 底部操作栏', () => {
  test('四个按钮按终局顺序排，确定是主按钮', () => {
    const tree = Bar(props() as never);
    const all = buttons(tree);
    assert.deepEqual(
      all.map((node) => node.props.children),
      ['barRestart', 'barCancel', 'barApply', 'barConfirm'],
    );
    assert.equal(all[3].props.className, 'dsh-pet-cfg__btn is-primary');
  });

  test('点击各自回调，互不串台', () => {
    const calls: string[] = [];
    const tree = Bar(
      props({
        onConfirm: () => calls.push('confirm'),
        onCancel: () => calls.push('cancel'),
        onApply: () => calls.push('apply'),
        onRestart: () => calls.push('restart'),
      }) as never,
    );
    for (const node of buttons(tree)) (node.props.onClick as () => void)();
    assert.deepEqual(calls, ['restart', 'cancel', 'apply', 'confirm']);
  });

  test('写盘时只禁会改东西的三个，取消仍可点', () => {
    const all = buttons(Bar(props({ busy: true }) as never));
    assert.deepEqual(
      all.map((node) => node.props.disabled === true),
      [true, false, true, true],
    );
  });

  test('反馈贴左显示；错误带 is-err；没有反馈时不留空位', () => {
    const ok = Bar(props({ msg: { kind: 'ok', text: 'saved' } }) as never);
    const [msg] = flatten(ok).filter((node) => node.props.children === 'saved');
    assert.match(String(msg.props.className), /dsh-pet-cfg__msg/);
    assert.doesNotMatch(String(msg.props.className), /is-err/);

    const err = Bar(props({ msg: { kind: 'err', text: 'saveError' } }) as never);
    const [bad] = flatten(err).filter((node) => node.props.children === 'saveError');
    assert.match(String(bad.props.className), /is-err/);

    assert.equal(
      flatten(Bar(props() as never)).filter((node) => String(node.props.className ?? '').includes('__msg')).length,
      0,
    );
  });
});
