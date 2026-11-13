/**
 * 动作频率卡（src/client/settings/motion-card.ts）的契约测试。
 *
 * 三条契约：
 *   1. 三个输入框顺序固定为 待机 / 转向 / 移动；随机动作是**纯读数**，不是一个假输入框；
 *   2. 改一项时另两项不动，超上限的值在提交前被夹住；
 *   3. 忙时三个输入全部禁用。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeMotionCard } from './motion-card.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
const MotionCard = makeMotionCard({ h, t: (key: string) => key } as never);

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const inputs = (tree: unknown): Node[] => flatten(tree).filter((node) => node.tag === 'input');

/** 触发 numberInputProps 的失焦提交。 */
function commit(input: Node, text: string): void {
  const target = { value: text };
  (input.props.onBlur as (event: { target: { value: string } }) => void)({ target });
}

describe('MotionCard —— 动作频率卡', () => {
  test('三个输入框顺序固定；随机动作只显示余量，不给输入入口', () => {
    const tree = MotionCard({
      busy: false,
      weights: { idle: 10, turn: 5, move: 5 },
      onChange: () => {},
    } as never);
    const found = inputs(tree);
    assert.equal(found.length, 3, '只有三个可编辑权重');
    assert.deepEqual(
      found.map((input) => input.props.defaultValue),
      ['10', '5', '5'],
    );
    const [readout] = flatten(tree).filter((node) => String(node.props.className ?? '').includes('__readout'));
    assert.equal(readout.props.children, '80%', '随机动作 = 100 − 三项之和');
  });

  test('改待机：另两项不动，超过上限被夹到 90', () => {
    const seen: unknown[] = [];
    const tree = MotionCard({
      busy: false,
      weights: { idle: 10, turn: 5, move: 5 },
      onChange: (weights: unknown) => seen.push(weights),
    } as never);
    commit(inputs(tree)[0], '95');
    assert.deepEqual(seen, [{ idle: 90, turn: 5, move: 5 }]);
  });

  test('值没变不回调', () => {
    const seen: unknown[] = [];
    const tree = MotionCard({
      busy: false,
      weights: { idle: 10, turn: 5, move: 5 },
      onChange: (weights: unknown) => seen.push(weights),
    } as never);
    commit(inputs(tree)[0], '10');
    assert.deepEqual(seen, []);
  });

  test('忙时三个输入禁用', () => {
    const tree = MotionCard({
      busy: true,
      weights: { idle: 10, turn: 5, move: 5 },
      onChange: () => {},
    } as never);
    for (const input of inputs(tree)) assert.equal(input.props.disabled, true);
  });
});
