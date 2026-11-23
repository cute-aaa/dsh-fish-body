/**
 * 窗口行为卡（window-behavior.ts）的契约测试：两行同时存在、各带作用域标注、
 * 改第一行只走实例补丁、改第二行只走全局通道、忙时两行都禁用。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeWindowBehavior } from './window-behavior.ts';
import { NO_DIRTY } from './dirty.ts';
import type { Pet } from '../../shared/types.ts';

interface Node {
  tag: unknown;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
const rt = {
  h,
  t: (key: string) => key,
  useState: <T>(init: T) => [init, () => {}] as [T, (next: T) => void],
};
const WindowBehavior = makeWindowBehavior(rt as never);

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  if (typeof element.tag === 'function') {
    return [element, ...flatten((element.tag as (props: Record<string, unknown>) => unknown)(element.props))];
  }
  return [element, ...flatten(element.props?.children)];
}

const texts = (tree: unknown): string[] =>
  flatten(tree)
    .filter((node) => typeof node.props.children === 'string')
    .map((node) => node.props.children as string);

const pet = (over: Record<string, unknown> = {}): Pet =>
  ({ id: 'a', name: 'A', size: 300, display: 'web', clickThrough: false, ...over }) as unknown as Pet;

/** 全局替身：记录 setFlag 调用。 */
function globalOf(value = false) {
  const calls: [string, boolean][] = [];
  return {
    calls,
    global: {
      values: {
        notificationsEnabled: true,
        sfxEnabled: true,
        sfxKeepAlive: false,
        confineToScreen: value,
        trayEnabled: true,
      },
      sfxVolume: 0.5,
      setFlag: (key: string, next: boolean) => calls.push([key, next]),
      setSfxVolume: () => undefined,
      apply: () => undefined,
    },
  };
}

const render = (over: Record<string, unknown> = {}) =>
  WindowBehavior({
    pet: pet(),
    petIndex: 0,
    busy: false,
    dirty: NO_DIRTY,
    global: globalOf().global,
    onChange: () => undefined,
    ...over,
  } as never);

/** 开关（checkbox）与它所在的开关格。 */
const switches = (tree: unknown): Node[] =>
  flatten(tree).filter((node) => node.tag === 'input' && node.props.type === 'checkbox');

describe('WindowBehavior —— 窗口行为卡', () => {
  test('两行同时存在，各带「这只 / 全部」标注', () => {
    const tree = render();
    assert.equal(switches(tree).length, 2, '两个开关：鼠标穿透 + 锁定在当前屏幕');
    const all = texts(tree);
    assert.ok(all.includes('scopeThis'), '第一行标「这只」');
    assert.ok(all.includes('scopeAll'), '第二行标「全部」');
    assert.ok(all.includes('clickThrough') && all.includes('confineToggle'), '两行的标签都在');
    assert.ok(all.includes('windowBehaviorTitle'), '卡头标题在');
  });

  test('改第一行只回传实例补丁；改第二行只走全局通道', () => {
    const patches: Record<string, unknown>[] = [];
    const stub = globalOf();
    const tree = render({ onChange: (patch: Record<string, unknown>) => patches.push(patch), global: stub.global });
    const [through, confine] = switches(tree);
    (through.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    assert.deepEqual(patches, [{ clickThrough: true }]);
    assert.deepEqual(stub.calls, [], '第一行不该碰全局开关');

    (confine.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    assert.deepEqual(stub.calls, [['confineToScreen', true]]);
    assert.deepEqual(patches, [{ clickThrough: true }], '第二行不该写实例字段');
  });

  test('busy 时两行都禁用；没有选中宠物时只有第一行禁用', () => {
    const busyTree = render({ busy: true });
    for (const box of switches(busyTree)) assert.equal(box.props.disabled, true);
    const noPet = render({ pet: null });
    const boxes = switches(noPet);
    assert.equal(boxes[0].props.disabled, true, '没有实例可写时穿透置灰');
    assert.equal(boxes[1].props.disabled, false, '全局开关仍可改');
  });
});
