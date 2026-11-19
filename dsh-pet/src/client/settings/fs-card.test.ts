/**
 * 「文件与目录」卡（src/client/settings/fs-card.ts）的契约测试。
 *
 * 五条契约：
 *   1. 默认收起，正文仍挂在树上（收起只是裁高度），`aria-controls` 与正文 id 成对；
 *   2. 树每行只出现一次、带前缀与名字；可打开的行带 `which`，不可打开的行（文件 / 包内只读）没有；
 *   3. 树里**没有**「可删 / 需下载」这类徽标，改由每一行后面的一句说明表达（漏登记说明的行只显示名字）；
 *   4. 数据根与皮肤目录各有一行位置，且都带「更改位置…」（位置可改是这张卡的硬要求）；
 *   5. 卸载命令用 meta 里的 profile；反推不出来时用 `<profile>` 占位符。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import type { ConfigMeta, MetaNode } from './config/index.ts';
import { makeFsCard, type FsCardProps } from './fs-card.ts';

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
  fsLocationChange: '更改位置…',
  'fsDesc.cache': '缓存：语音合成结果、Electron 安装包、桌面窗口 profile。',
  'fsDesc.config': '设置：主配置、会话鱼、语音接入。',
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
  node('cache', 'cache', 1, { open: 'cache' }),
  node('cache.voice', 'voice', 2),
  node('runtime', 'runtime', 1, { open: 'runtime' }),
  node('runtime.electron', 'electron', 2, { open: 'runtime' }),
  node('skin', 'skin', 1, { open: 'skin-root' }),
  node('assets', 'assets', 1, { open: 'assets' }),
  { ...node('logs', 'logs.txt', 1, { kind: 'file' }), path: 'D:/u/fish-body/logs.txt', rel: 'logs.txt' },
];

const meta: ConfigMeta = {
  root: 'D:/u/fish-body',
  rootSource: 'default',
  skin: 'D:/u/fish-body/skin',
  layout,
  readonly: [{ ...node('pkg.config', 'config.jsonc', 0, { kind: 'pkg' }), path: 'D:/pkg/assets/config.jsonc' }],
  runtime: {
    dir: 'D:/u/fish-body/runtime/electron',
    exe: 'D:/u/fish-body/runtime/electron/electron.exe',
    installed: true,
    version: '43.3.0',
    source: 'default',
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

/**
 * 卡片输入：绝大多数用例只关心 `paths`。
 *
 * 重启入口由「搬迁完成后点立即重启」那一例单独断言——它现在由系统分区传进来（与维护卡同一实现），
 * 卡片自己不再持有它。
 */
const props = (paths: ConfigMeta = meta, onRestart: () => void = () => {}): FsCardProps => ({
  paths,
  onRestart,
});

describe('fs-card —— 一张卡讲完文件在哪', () => {
  test('默认收起：aria-expanded 为 false，正文在树上但 aria-hidden', () => {
    const tree = make(false)(props());
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
    const tree = make(false, seen)(props());
    (byClass(tree, 'dsh-pet-cfg__foldToggle')?.props.onClick as () => void)();
    assert.deepEqual(seen, [true]);
  });

  test('树：每个节点只出现一次，前缀与名字都在', () => {
    const tree = make(true)(props());
    const rows = allByClass(tree, 'dsh-pet-cfg__treeRow');
    // 布局 10 行 + 1 个包内只读行。
    assert.equal(rows.length, meta.layout.length + meta.readonly.length);
    const keys = rows.map((row) => String(row.props.key));
    assert.equal(new Set(keys).size, keys.length, '同一条路径不许画两遍');
    // 根行顶格：没有前缀那一格，网格少一列（靠 is-root 换网格，名字才真的贴住左边缘）。
    assert.match(String(rows[0]?.props.className), /is-root/);
    assert.equal(byClass(rows[0], 'dsh-pet-cfg__treePrefix'), undefined);
    // 第一个子项直接落在第 0 列。
    assert.equal(byClass(rows[1], 'dsh-pet-cfg__treePrefix')?.props.children, '├─ ');
    const dirNames = allByClass(tree, 'dsh-pet-cfg__treeName').map((item) => String(item.props.children));
    assert.ok(dirNames.includes('config/'), '目录名带尾斜杠');
    assert.ok(dirNames.includes('logs.txt'), '文件名不带');
  });

  test('可打开的行带 which，文件与包内只读没有', () => {
    const tree = make(true)(props());
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

  test('树里没有「可删 / 需下载」徽标，改成每行后面的一句说明', () => {
    const tree = make(true)(props());
    const rows = allByClass(tree, 'dsh-pet-cfg__treeRow');
    // 徽标只剩只读参考那一组（那一组本来是「不能改」的信息，不是「能不能删」）。
    const badges = allByClass(tree, 'dsh-pet-cfg__treeBadge').map((item) => String(item.props.children));
    assert.deepEqual(badges, ['fsBadgeReadonly']);

    const descOf = (key: string): unknown => {
      const row = rows.find((item) => item.props.key === key);
      const desc = flatten(row?.props.children).find((item) =>
        String(item.props?.className ?? '').includes('dsh-pet-cfg__treeDesc'),
      );
      return desc?.props.children;
    };
    assert.equal(descOf('cache'), dict['fsDesc.cache']);
    assert.equal(descOf('config'), dict['fsDesc.config']);
    // 没登记说明的节点只显示名字（不会把半截字典键印到界面上）。
    assert.equal(descOf('pkg.config'), undefined);
  });

  test('数据根与皮肤目录各有一行位置，且都能改', () => {
    const tree = make(true)(props());
    const texts = flatten(tree)
      .map((item) => item.props?.children)
      .filter((value): value is string => typeof value === 'string');
    assert.ok(texts.includes('D:/u/fish-body'), '数据根绝对路径要显示');
    assert.ok(texts.includes('D:/u/fish-body/skin'), '皮肤目录绝对路径要显示');
    const changes = allByClass(tree, 'dsh-pet-cfg__btn').filter((item) => item.props.children === '更改位置…');
    assert.equal(changes.length, 2, '两处位置各一个「更改位置」');
  });

  test('运行时行显示版本、来源与状态', () => {
    const tree = make(true)(props());
    const texts = flatten(tree)
      .map((item) => item.props?.children)
      .filter((value): value is string => typeof value === 'string');
    assert.ok(texts.some((text) => text.startsWith('fsRuntimeReady') && text.includes('43.3.0')));
    assert.ok(texts.includes('fsRuntimeDefault'), '来源要说清楚（默认位置）');
    // 已装时按钮是「重新下载」且可用：运行时可能被换版本、被搬到别的盘，按钮该一直能点。
    const buttons = allByClass(tree, 'dsh-pet-cfg__btn');
    const download = buttons.find((button) => button.props.children === 'fsRuntimeRedownload');
    assert.ok(download, '已装时下载按钮文案变成「重新下载」');
    assert.equal(download?.props.disabled, false);
    assert.equal(buttons.filter((button) => button.props.disabled === true).length, 0);
    // 默认位置没有「回到默认位置」按钮。
    assert.equal(
      buttons.some((button) => button.props.children === 'fsRuntimeReset'),
      false,
    );
  });

  test('运行时指到自定义目录时给出「回到默认位置」', () => {
    const custom: ConfigMeta = {
      ...meta,
      runtime: { ...meta.runtime!, source: 'custom', dir: 'E:/electron' },
    };
    const tree = make(true)(props(custom));
    const buttons = allByClass(tree, 'dsh-pet-cfg__btn');
    assert.ok(buttons.some((button) => button.props.children === 'fsRuntimeReset'));
  });

  test('卸载命令用 meta 的 profile；没有 profile 时用占位符', () => {
    const withProfile = make(true)(props());
    const cmd = byClass(withProfile, 'dsh-pet-cfg__cmd');
    assert.match(String(cmd?.props.children), /--profile fish remove dsh-fish-body/);

    const noProfile = make(true)(props({ ...meta, profile: undefined }));
    const fallback = byClass(noProfile, 'dsh-pet-cfg__cmd');
    assert.match(String(fallback?.props.children), /--profile <profile>/);
  });

  test('卸载步骤里带出数据根绝对路径', () => {
    const tree = make(true)(props());
    const notes = allByClass(tree, 'dsh-pet-cfg__note').map((item) => String(item.props.children));
    assert.ok(notes.some((text) => text.includes('D:/u/fish-body')));
  });

  test('老宿主给的 meta 缺字段时按空树渲染，不把设置页带崩', () => {
    const legacy = { root: 'D:/u', layout: undefined, readonly: undefined } as unknown as ConfigMeta;
    const tree = make(true)(props(legacy));
    assert.equal(allByClass(tree, 'dsh-pet-cfg__treeRow').length, 0);
    assert.ok(byClass(tree, 'dsh-pet-cfg__foldToggle'), '标题行仍在');
  });
});
