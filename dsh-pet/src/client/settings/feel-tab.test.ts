/**
 * 「外观与手感」分区的顺序契约：渲染卡 → 皮肤三行 → 窗口行为 → 手感三卡。
 *
 * 顺序是这一页的可读性来源（先看「它长什么样」，再看「它能干什么」，最后才是手感细节）；
 * 截图只能证明「画出来了」，证明不了「谁在前」——所以这里钉住装配顺序。
 * @module dsh-fish-body/src/client/settings/feel-tab.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeFeelTab } from './feel-tab.ts';
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
  useEffect: () => undefined,
  useRef: <T>(init: T) => ({ current: init }),
  useCallback: (fn: unknown) => fn,
};
const FeelTab = makeFeelTab(rt as never);

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

/** 一只字段齐全的实例。 */
const pet = {
  id: 'a',
  name: 'Alpha',
  size: 300,
  display: 'web',
  renderer: 'layered',
  position: { corner: 'top-left', marginX: 10, marginY: 20 },
} as unknown as Pet;

/** 空的资源清单：卡片仍渲染，只是桶都缺失。 */
const resources = { resources: null, busy: false, reload: () => undefined };

const look = {
  physics: {
    gravity: 2400,
    restitution: 0.6,
    groundFriction: 4,
    throwPower: 1,
    ceilingBounce: false,
    petCollision: false,
  },
  weights: {},
  font: {},
  patchPhysics: () => undefined,
  setWeights: () => undefined,
  patchFont: () => undefined,
  apply: () => undefined,
};

const global = {
  values: {
    notificationsEnabled: true,
    sfxEnabled: true,
    sfxKeepAlive: false,
    confineToScreen: false,
    trayEnabled: true,
  },
  sfxVolume: 0.5,
  setFlag: () => undefined,
  setSfxVolume: () => undefined,
  apply: () => undefined,
};

const render = (over: Record<string, unknown> = {}) =>
  FeelTab({
    busy: false,
    look,
    dirty: NO_DIRTY,
    pet,
    petIndex: 0,
    resources,
    global,
    onChange: () => undefined,
    ...over,
  } as never);

describe('FeelTab —— 外观与手感的装配顺序', () => {
  test('渲染卡 → 皮肤三行 → 窗口行为 → 手感小节', () => {
    const order = texts(render());
    const at = (key: string): number => order.indexOf(key);
    const render_ = at('renderCardTitle');
    const skins = at('skinDirsTitle');
    const win = at('windowBehaviorTitle');
    const feel = at('secFeel');
    assert.ok(render_ >= 0, '渲染卡要在');
    assert.ok(skins > render_, '皮肤三行紧跟渲染卡');
    assert.ok(win > skins, '窗口行为在皮肤三行之后');
    assert.ok(feel > win, '手感小节最后');
  });

  test('没有选中实例时渲染卡整卡不渲染，皮肤与窗口行为仍在', () => {
    const tree = render({ pet: null, petIndex: -1 });
    const order = texts(tree);
    assert.ok(!order.includes('renderCardTitle'), '无实例时渲染卡不出现');
    assert.ok(order.includes('skinDirsTitle'));
    assert.ok(order.includes('windowBehaviorTitle'));
  });
});
