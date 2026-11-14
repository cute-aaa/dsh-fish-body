/**
 * 「文件与目录」卡（src/client/settings/fs-card.ts）的契约测试。
 *
 * 四条契约：
 *   1. 默认收起，正文仍挂在树上（收起只是裁高度），`aria-controls` 与正文 id 成对；
 *   2. 树每行只出现一次、带前缀与名字；可打开的行带 `which`，不可打开的行（文件 / 包内只读）没有；
 *   3. `cache` 与 `runtime/electron` 带徽标（可删 / 需下载），其余没有；
 *   4. 卸载命令用 meta 里的 profile；反推不出来时用 `<profile>` 占位符。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import type { ConfigMeta, MetaNode } from './config/index.ts';
import { makeFsCard } from './fs-card.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;

/**
 * 假 useState：**第一次调用**的初值由用例给（折叠状态），其余 hook 用自己的初值。
 *
 * 不能对所有 hook 都返回同一个值：卡片里 runtime / busy / polling 都是状态，
 * 一律返回 true 会把「运行时已安装」误判成「未安装」。setter 只记录、不触发重渲染。
 */
function fakeState(initial: boolean, seen: boolean[]) {
  let first = true;
  return ((init: unknown) => {
    const value = first ? initial : init;
    first = false;
    return [value, (next: boolean) => seen.push(next)];
  }) as never;
}

/** 假 useEffect：本用例不跑副作用（轮询只在点下载之后才开始）。 */
const noEffect = (() => undefined) as never;

/** 翻译：只给需要观察插值的键真文案，其余原样回声。 */
const dict: Record<string, string> = {
  uninstallCmd: 'dsh plugin --profile {profile} remove dsh-fish-body',
  uninstallStep3: '删除 {root}',
};

function make(initial: boolean, seen: boolean[] = []) {
  return makeFsCard({
    h,
    t: (key: string) => dict[key] ?? key,
    useState: fakeState(initial, seen),
    useEffect: noEffect,
  } as never);
}

const node = (key: string, name: string, depth: number, extra: Partial<MetaNode> = {}): MetaNode => ({
  key,
  rel: name,
  name,
  path: 'D:/u/fish-body/' + name,
  kind: 'dir',
  depth,
  exists: true,
  ...extra,
});

const layout: MetaNode[] = [
  { ...node('root', 'fish-body', 0, { open: 'root' }), rel: 'fish-body/' },
  node('config', 'config', 1, { open: 'config' }),
  node('data', 'data', 1, { open: 'data' }),
  node('cache', 'cache', 1, { open: 'cache', badge: 'disposable' }),
  node('cache.voice', 'voice', 2, { badge: 'disposable' }),
  node('runtime', 'runtime', 1, { open: 'runtime' }),
  node('runtime.electron', 'electron', 2, { open: 'runtime', badge: 'download' }),
  node('pets', 'pets', 1, { open: 'pets' }),
  node('assets', 'assets', 1, { open: 'assets' }),
  { ...node('logs', 'logs.txt', 1, { kind: 'file' }), path: 'D:/u/fish-body/logs.txt', rel: 'logs.txt' },
];

const meta: ConfigMeta = {
  root: 'D:/u/fish-body',
  layout,
  readonly: [{ ...node('pkg.config', 'config.jsonc', 0, { kind: 'pkg' }), path: 'D:/pkg/assets/config.jsonc' }],
  runtime: {
    dir: 'D:/u/fish-body/runtime/electron',
    exe: 'D:/u/fish-body/runtime/electron/electron.exe',
    installed: true,
    version: '43.3.0',
  },
  user: 'D:/u/fish-body/config/main-config.jsonc',
  default: 'D:/pkg/assets/config.jsonc',
  animations: 'D:/u/fish-body/assets/animation',
  logs: 'D:/u/fish-body/logs.txt',
  profile: 'fish',
  package: 'D:/pkg',
};

function flatten(input: unknown): Node[] {
  if (input === null || input === undefined || typeof input === 'string') return [];
  if (Array.isArray(input)) return input.flatMap(flatten);
  const element = input as Node;
  return [element, ...flatten(element.props?.children)];
}

const byClass = (tree: unknown, cls: string): Node | undefined =>
  flatten(tree).find((item) => String(item.props?.className ?? '').includes(cls));
const allByClass = (tree: unknown, cls: string): Node[] =>
  flatten(tree).filter((item) => String(item.props?.className ?? '').includes(cls));

describe('fs-card —— 一张卡讲完文件在哪', () => {
  test('默认收起：aria-expanded 为 false，正文在树上但 aria-hidden', () => {
    const tree = make(false)({ paths: meta });
    const toggle = byClass(tree, 'dsh-pet-cfg__foldToggle');
    assert.ok(toggle);
    assert.equal(toggle.props['aria-expanded'], false);
    assert.equal(toggle.props['aria-controls'], 'pet-cfg-paths-fs');
    const body = flatten(tree).find((item) => item.props?.id === 'pet-cfg-paths-fs');
    assert.ok(body, '收起不该丢内容');
    assert.equal(body?.props['aria-hidden'], 'true');
  });

  test('点标题行是取反开合', () => {
    const seen: boolean[] = [];
    const tree = make(false, seen)({ paths: meta });
    (byClass(tree, 'dsh-pet-cfg__foldToggle')?.props.onClick as () => void)();
    assert.deepEqual(seen, [true]);
  });

  test('树：每个节点只出现一次，前缀与名字都在', () => {
    const tree = make(true)({ paths: meta });
    const rows = allByClass(tree, 'dsh-pet-cfg__treeRow');
    // 布局 10 行 + 1 个包内只读行。
    assert.equal(rows.length, meta.layout.length + meta.readonly.length);
    const keys = rows.map((row) => String(row.props.key));
    assert.equal(new Set(keys).size, keys.length, '同一条路径不许画两遍');
    const firstPrefix = byClass(rows[0], 'dsh-pet-cfg__treePrefix');
    // 根节点是唯一的 0 层，所以它是「最后一个」；子项靠缩进表达层级。
    assert.equal(firstPrefix?.props.children, '└─ ');
    const dirNames = allByClass(tree, 'dsh-pet-cfg__treeName').map((item) => String(item.props.children));
    assert.ok(dirNames.includes('config/'), '目录名带尾斜杠');
    assert.ok(dirNames.includes('logs.txt'), '文件名不带');
  });

  test('可打开的行带 which，文件与包内只读没有', () => {
    const tree = make(true)({ paths: meta });
    const rows = allByClass(tree, 'dsh-pet-cfg__treeRow');
    const openOf = (key: string): unknown => {
      const row = rows.find((item) => item.props.key === key);
      const button = flatten(row?.props.children).find((item) => typeof item.tag === 'function');
      return (button?.props as Record<string, unknown> | undefined)?.which;
    };
    assert.equal(openOf('config'), 'config');
    assert.equal(openOf('cache'), 'cache');
    assert.equal(openOf('logs'), undefined);
    assert.equal(openOf('pkg.config'), undefined);
  });

  test('徽标只给 cache 与 runtime/electron', () => {
    const tree = make(true)({ paths: meta });
    const rows = allByClass(tree, 'dsh-pet-cfg__treeRow');
    const badgeOf = (key: string): unknown => {
      const row = rows.find((item) => item.props.key === key);
      const badge = flatten(row?.props.children).find((item) =>
        String(item.props?.className ?? '').includes('dsh-pet-cfg__treeBadge'),
      );
      return badge?.props.children;
    };
    assert.equal(badgeOf('cache'), 'fsBadgeDisposable');
    assert.equal(badgeOf('runtime.electron'), 'fsBadgeDownload');
    assert.equal(badgeOf('config'), undefined);
    assert.equal(badgeOf('data'), undefined);
  });

  test('运行时行显示版本与状态', () => {
    const tree = make(true)({ paths: meta });
    const texts = flatten(tree)
      .map((item) => item.props?.children)
      .filter((value): value is string => typeof value === 'string');
    assert.ok(texts.some((text) => text.startsWith('fsRuntimeReady') && text.includes('43.3.0')));
    // 已装时按钮存在但禁用（删了也能从这里重下，所以按钮始终在）。
    const buttons = allByClass(tree, 'dsh-pet-cfg__btn');
    const disabled = buttons.filter((button) => button.props.disabled === true);
    assert.equal(disabled.length, 1, '只有「下载运行时」在已装时禁用');
  });

  test('卸载命令用 meta 的 profile；没有 profile 时用占位符', () => {
    const withProfile = make(true)({ paths: meta });
    const cmd = byClass(withProfile, 'dsh-pet-cfg__cmd');
    assert.match(String(cmd?.props.children), /--profile fish remove dsh-fish-body/);

    const noProfile = make(true)({ paths: { ...meta, profile: undefined } });
    const fallback = byClass(noProfile, 'dsh-pet-cfg__cmd');
    assert.match(String(fallback?.props.children), /--profile <profile>/);
  });

  test('卸载步骤里带出数据根绝对路径', () => {
    const tree = make(true)({ paths: meta });
    const notes = allByClass(tree, 'dsh-pet-cfg__note').map((item) => String(item.props.children));
    assert.ok(notes.some((text) => text.includes('D:/u/fish-body')));
  });
});
