/**
 * 「会话鱼」分区（src/client/settings/fish-tab.ts）的契约测试。
 *
 * 四条契约：
 *   1. 草稿未就绪时只给一句引导，不画半张空表单；
 *   2. 已加载时关键控件都在：预览、皮肤下拉、六个开关、四个数字框、两个位置动作；
 *   3. 每个控件回传的是 `SessionFishSettings` 的字段名与夹取后的值（谁写错谁静默不落盘）；
 *   4. 读取失败就地给「重试」，不阻塞页面其余部分。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { NO_DIRTY } from './dirty.ts';
import { makeFishTab } from './fish-tab.ts';
import type { SessionFishState } from './use-session-fish.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
const useState = (<T>(init: T): [T, (value: T) => void] => [init, () => {}]) as never;
const FishTab = makeFishTab({
  h,
  t: (key: string) => key,
  useState,
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: ((fn: unknown) => fn) as never,
} as never);

/** 摊平整棵树，便于按标签找节点。 */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const cards = (tree: unknown): Node[] =>
  flatten(tree).filter((node) => String(node.props.className ?? '').includes('dsh-pet-cfg__card'));

/** 一份填满的草稿。 */
const draft = {
  enabled: true,
  sizePx: 96,
  maxCount: 6,
  bubbleMs: 12_000,
  skin: '',
  followPet: true,
  speakEnabled: true,
  speakProgress: true,
  speakTurnEnd: true,
  speakWaiting: true,
  progressGapMs: 15_000,
};

/** 造一份分区输入；未覆盖的字段给固定值。 */
function fish(over: Partial<SessionFishState> = {}): SessionFishState {
  return {
    draft,
    loadFailed: false,
    skins: [],
    skinBusy: false,
    busy: false,
    update: () => {},
    apply: () => {},
    reload: () => {},
    rescan: () => {},
    resetPositions: () => {},
    save: async () => true,
    reset: async () => true,
    ...over,
  };
}

const render = (over: Partial<SessionFishState> = {}) =>
  FishTab({ busy: false, fish: fish(over), dirty: NO_DIRTY } as never);

describe('FishTab —— 会话鱼分区', () => {
  test('草稿未就绪：只给一句引导', () => {
    const tree = render({ draft: null });
    assert.equal(cards(tree).length, 0);
    assert.ok(flatten(tree).some((node) => node.props.children === 'fish.intro'));
  });

  test('已加载：预览、皮肤、六个开关、四个数字框与位置动作都在', () => {
    const tree = render();
    assert.ok(flatten(tree).some((node) => String(node.props.className ?? '').includes('dsh-session-fish-preview')));
    assert.ok(flatten(tree).some((node) => node.tag === 'select'));

    const boxes = flatten(tree).filter((node) => node.tag === 'input' && node.props.type === 'checkbox');
    assert.equal(boxes.length, 6, '总开关 + 围转 + 语音总开关 + 三个分类开关');

    const numbers = flatten(tree).filter((node) => node.tag === 'input' && node.props.type === 'number');
    assert.equal(numbers.length, 4, '尺寸 / 数量 / 气泡 / 进度间隔');

    const labels = flatten(tree)
      .filter((node) => node.tag === 'button')
      .map((node) => node.props.children);
    assert.ok(labels.includes('fish.skinRescan'));
    assert.ok(labels.includes('fish.openSkinFolder'));
    assert.ok(labels.includes('fish.resetPositions'));
  });

  test('改皮肤：回传字段名 skin 与选中的 id', () => {
    const calls: string[] = [];
    const tree = render({
      skins: [{ id: 'a.webm', label: 'A', kind: 'video', source: 'user' }],
      update: (key: string, value: unknown) => calls.push(key + '=' + String(value)),
    });
    const select = flatten(tree).find((node) => node.tag === 'select');
    (select?.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'a.webm' } });
    assert.deepEqual(calls, ['skin=a.webm']);
  });

  test('读取失败：就地给重试，按钮触发 reload', () => {
    let reloads = 0;
    const tree = render({ loadFailed: true, reload: () => (reloads += 1) });
    const retry = flatten(tree).find((node) => node.tag === 'button' && node.props.children === 'retry');
    assert.ok(retry, '失败时要给「重试」');
    (retry.props.onClick as () => void)();
    assert.equal(reloads, 1);
  });
});
