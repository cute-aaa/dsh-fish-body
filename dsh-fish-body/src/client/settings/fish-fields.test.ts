/**
 * 会话鱼显示字段（src/client/settings/fish-fields.ts）的契约测试。
 *
 * 只钉一件事：皮肤那一行的「打开皮肤目录」走**共用的 FolderButton**，不再自己发 `/open-folder`。
 * 这条值得单独立个用例：它曾经直接 `openFolderOf(..., create = true)`——目录不存在时静默建目录、
 * 失败也没有任何提示，而设置页另有三处「先问再建」的打开目录入口。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { fishSkinView } from './fish-skins.ts';
import { makeFishFields } from './fish-fields.ts';
import type { FishFieldsProps } from './fish-fields.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

/** 组件就地展开（等价于一次浅渲染），原生标签原样记录。 */
const h = ((tag: unknown, props: Record<string, unknown>) =>
  typeof tag === 'function' ? (tag as (p: unknown) => unknown)(props) : { tag, props }) as unknown as typeof jsx;
const Fields = makeFishFields({
  h,
  t: (key: string) => key,
  useState: ((init: unknown) => [init, () => {}]) as never,
} as never);

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

/** 一份最小输入：皮肤清单为空也能渲染（宿主还没扫完时就是这个状态）。 */
const props = (patch: Partial<FishFieldsProps> = {}): FishFieldsProps => ({
  busy: false,
  draft: { enabled: true, sizePx: 96, maxCount: 6, bubbleMs: 12_000, skin: '' } as FishFieldsProps['draft'],
  skins: fishSkinView([], '', ''),
  update: () => {},
  onRescan: () => {},
  skinBusy: false,
  ...patch,
});

describe('fish-fields —— 打开皮肤目录', () => {
  test('走共用 FolderButton（先问再建 + 失败有提示），不再是裸 openFolderOf', () => {
    const tree = Fields(props()) as unknown as Node;
    const [wrapper] = flatten(tree).filter((node) =>
      String(node.props.className ?? '').includes('dsh-pet-cfg__folderBtn'),
    );
    assert.ok(wrapper, '皮肤那一行要有 FolderButton 的外框');
    const buttons = flatten(wrapper).filter((node) => node.tag === 'button');
    // 第一个按钮是 FolderButton 自己那个「打开目录」，第二个是「重新扫描」之后的产物——
    // 这里只要确认它带的是共用实现的类名与文案。
    const open = buttons[0];
    assert.equal(open.props.className, 'dsh-pet-cfg__btn is-text');
    assert.equal(open.props.children, 'fish.openSkinFolder');
  });

  test('「重新扫描」仍是普通按钮，两者互不影响', () => {
    const seen: string[] = [];
    const tree = Fields(props({ onRescan: () => seen.push('rescan') })) as unknown as Node;
    const rescan = flatten(tree).find((node) => node.props.children === 'fish.skinRescan');
    assert.ok(rescan);
    (rescan?.props.onClick as () => void)();
    assert.deepEqual(seen, ['rescan']);
  });
});
