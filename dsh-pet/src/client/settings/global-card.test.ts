/**
 * 全局开关卡（src/client/settings/global-card.ts）的契约测试。
 *
 * 两条契约：
 *   1. 五个开关的勾选态来自 `values`，切换回传的是配置字段名（键名错位会静默写坏别的开关）；
 *   2. 忙时全部禁用，一次切换只回调一次。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeGlobalCard, type GlobalFlags } from './global-card.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
const GlobalCard = makeGlobalCard({ h, t: (key: string) => key } as never);

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const allOff: GlobalFlags = {
  notificationsEnabled: false,
  sfxEnabled: false,
  sfxKeepAlive: false,
  confineToScreen: false,
  trayEnabled: false,
};

/** 五个开关的框，顺序即展示顺序（音量滑块也是 input，按 type=checkbox 挑出来）。 */
const boxes = (tree: unknown): Node[] =>
  flatten(tree).filter((node) => node.tag === 'input' && node.props.type === 'checkbox');

/** 音量滑块。 */
const slider = (tree: unknown): Node | undefined =>
  flatten(tree).find((node) => node.tag === 'input' && node.props.type === 'range');

/** 卡的固定输入：音量与回调按默认值给。 */
const baseProps = (extra: Record<string, unknown>): never =>
  ({ busy: false, sfxVolume: 0.5, onSfxVolumeChange: () => {}, ...extra }) as never;

describe('GlobalCard —— 全局开关卡', () => {
  test('五个开关都在，勾选态来自 values', () => {
    const tree = GlobalCard(
      baseProps({ values: { ...allOff, notificationsEnabled: true, trayEnabled: true }, onChange: () => {} }),
    );
    const found = boxes(tree);
    assert.equal(found.length, 5);
    assert.deepEqual(
      found.map((box) => box.props.checked),
      [true, false, false, false, true],
    );
  });

  test('每个开关回传自己的配置字段名', () => {
    const seen: Array<[string, boolean]> = [];
    const tree = GlobalCard(
      baseProps({ values: allOff, onChange: (key: string, value: boolean) => seen.push([key, value]) }),
    );
    for (const box of boxes(tree)) {
      (box.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    }
    assert.deepEqual(
      seen.map(([key]) => key),
      ['notificationsEnabled', 'sfxEnabled', 'sfxKeepAlive', 'confineToScreen', 'trayEnabled'],
    );
    assert.ok(
      seen.every(([, value]) => value === true),
      '回传的必须是布尔值，不是事件对象',
    );
  });

  test('音量滑块：读成品值，拖动回传 0–1 的数字', () => {
    const seen: number[] = [];
    const tree = GlobalCard(
      baseProps({
        values: allOff,
        onChange: () => {},
        sfxVolume: 0.35,
        onSfxVolumeChange: (v: number) => seen.push(v),
      }),
    );
    const range = slider(tree);
    assert.ok(range, '全局卡里应有音量滑块');
    assert.equal(range.props.min, '0');
    assert.equal(range.props.max, '1');
    assert.equal(range.props.value, '0.35', '滑块显示成品音量');
    (range.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '0.8' } });
    assert.deepEqual(seen, [0.8], '回传的是数字，不是字符串');
  });

  test('忙时全部禁用', () => {
    const tree = GlobalCard(baseProps({ busy: true, values: allOff, onChange: () => {} }));
    for (const box of boxes(tree)) assert.equal(box.props.disabled, true);
  });
});
