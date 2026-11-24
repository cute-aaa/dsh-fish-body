/**
 * 「素材与字体」卡的契约测试。
 *
 * 三条契约：
 *   1. 许可徽标必须在行内可见（用户点之前就要知道能不能商用）；
 *   2. 未安装只给「下载」、已装只给「删除」——不给两个同时存在的按钮；
 *   3. 有包在动时，所有按钮都禁用且文案变成「处理中…」。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makePacksCard } from './packs-card.ts';
import type { PackView } from './packs-api.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
const PacksCard = makePacksCard({ h, t: (key: string) => key } as never);

/** 把树摊平（字符串算叶子，不进结果）。 */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

/** 收集所有文本（用于断言文案出现与否）。 */
function texts(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap(texts);
  return texts((node as Node).props?.children);
}

const buttons = (tree: unknown): Node[] => flatten(tree).filter((node) => node.tag === 'button');

/** 一只未安装的包。 */
const pack = (over: Partial<PackView> = {}): PackView => ({
  id: 'fonts-rouhei',
  kind: 'fonts',
  label: '思源柔黑',
  license: 'OFL-1.1',
  bytes: 1_572_864,
  sha256: 'a'.repeat(64),
  files: 2,
  installed: null,
  upToDate: false,
  ...over,
});

/** 一组不做事的状态桩。 */
const state = (items: readonly PackView[], busyId = '') =>
  ({
    items,
    busyId,
    message: '',
    failed: false,
    reload: () => {},
    install: () => {},
    remove: () => {},
  }) as const;

describe('PacksCard —— 素材与字体', () => {
  test('未安装：只给「下载」按钮，许可与体积在行内可见', () => {
    const tree = PacksCard({ busy: false, packs: state([pack()]) } as never);
    const found = buttons(tree);
    assert.equal(found.length, 1);
    assert.equal(found[0].props.children as string, 'packsInstall');
    const all = texts(tree);
    assert.ok(all.includes('OFL-1.1'), '许可必须直接可见');
    assert.ok(
      all.some((text) => text.includes('1.5 MB')),
      '体积要给人读的大小',
    );
    // 状态与体积挤在同一条次要行里（`1.5 MB · 未安装`），所以按子串判断。
    assert.ok(all.some((text) => text.includes('packsNotInstalled')));
  });

  test('已安装：给「删除」而不是「下载」；有新版本时状态可读', () => {
    const tree = PacksCard({
      busy: false,
      packs: state([pack({ installed: { files: 2, at: '2026-11-24T00:00:00.000Z' }, upToDate: false })]),
    } as never);
    const found = buttons(tree);
    assert.equal(found.length, 1);
    assert.equal(found[0].props.children as string, 'packsRemove');
    assert.ok(texts(tree).some((text) => text.includes('packsOutdated')));
  });

  test('空清单：显示空态文案，且没有任何按钮', () => {
    const tree = PacksCard({ busy: false, packs: state([]) } as never);
    assert.equal(buttons(tree).length, 0);
    assert.ok(texts(tree).includes('packsEmpty'));
  });

  test('有包在动：所有按钮禁用、文案变为「处理中…」', () => {
    const tree = PacksCard({
      busy: false,
      packs: state([pack(), pack({ id: 'memes', label: '表情包', kind: 'memes' })], 'fonts-rouhei'),
    } as never);
    const found = buttons(tree);
    assert.equal(found.length, 2);
    for (const button of found) assert.equal(button.props.disabled, true);
    assert.ok(found.some((button) => button.props.children === 'packsWorking'));
  });

  test('配置忙时按钮同样禁用（与设置页其它卡同一口径）', () => {
    const tree = PacksCard({ busy: true, packs: state([pack()]) } as never);
    assert.equal(buttons(tree)[0].props.disabled, true);
  });
});
