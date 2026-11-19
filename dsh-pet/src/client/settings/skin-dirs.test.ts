/**
 * 皮肤目录三行（skin-dirs.ts）的契约测试：三行都在、缺失行带 is-missing 与 ⚠️ 文案（含具体文件名）、
 * 资源数与 items 一致、打开按钮发三个 `pool-bucket-*`、卡片头打开皮肤根。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeSkinDirs } from './skin-dirs.ts';

interface Node {
  tag: unknown;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
const rt = {
  h,
  t: (key: string) =>
    ({
      'renderDir.layered': 'layered',
      'renderDir.live2d': 'live2d',
      'renderDir.webm': 'webm',
      skinDirsCount: '{n} items',
      skinDirsMissing: 'missing {file}',
      skinDirsEmpty: 'folder but no assets',
      skinDirsExpect: 'expects {list}',
    })[key] ?? key,
  useState: <T>(init: T) => [init, () => {}] as [T, (next: T) => void],
};
const SkinDirs = makeSkinDirs(rt as never);

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  if (typeof element.tag === 'function') {
    return [element, ...flatten((element.tag as (props: Record<string, unknown>) => unknown)(element.props))];
  }
  return [element, ...flatten(element.props?.children)];
}

const bucket = (over: Record<string, unknown> = {}) => ({
  status: 'ok',
  dir: '/p/layered',
  count: 2,
  items: [
    { id: 'a', label: 'a', source: 'pool' as const },
    { id: 'b', label: 'b', source: 'pool' as const },
  ],
  expect: ['manifest.json'],
  missingFiles: [],
  ...over,
});

const resources = {
  resources: {
    root: 'main',
    renderers: {
      layered: bucket(),
      live2d: bucket({
        status: 'missing',
        dir: '/p/live2d',
        count: 0,
        items: [],
        expect: ['*.model3.json'],
        missingFiles: ['*.model3.json'],
      }),
      webm: bucket({ dir: '/p/webm', count: 3 }),
    },
  },
  busy: false,
  reload: () => undefined,
};

const render = () => SkinDirs({ resources, busy: false } as never);

describe('SkinDirs —— 渲染卡下方三行', () => {
  test('三行都在，顺序 layered / live2d / webm', () => {
    const tree = render();
    const rows = flatten(tree).filter((node) => String(node.props.className ?? '').includes('__treeRow'));
    assert.equal(rows.length, 3);
    const names = rows.map(
      (row) =>
        flatten(row.props.children).find((node) => node.props.className === 'dsh-pet-cfg__treeName')?.props.children,
    );
    assert.deepEqual(
      names.map((name) => String(name).replace('/', '')),
      ['layered', 'live2d', 'webm'],
    );
  });

  test('缺失行带 is-missing 与 ⚠️ 文案（含具体文件名）', () => {
    const tree = render();
    const rows = flatten(tree).filter((node) => String(node.props.className ?? '').includes('__treeRow'));
    const missing = rows.filter((row) => String(row.props.className).includes('is-missing'));
    assert.equal(missing.length, 1, '只有 live2d 缺失');
    const desc = flatten(missing[0].props.children).find((node) => node.props.className === 'dsh-pet-cfg__treeDesc');
    assert.ok(desc, '缺失行要有说明');
    assert.match(String(desc.props.children), /⚠️/);
    assert.match(String(desc.props.children), /\*\.model3\.json/);
  });

  test('资源数与 items 一致；打开按钮发 pool-bucket-*，卡片头发 skin-root', () => {
    const tree = render();
    const descs = flatten(tree)
      .filter((node) => node.props.className === 'dsh-pet-cfg__treeDesc')
      .map((node) => String(node.props.children));
    assert.ok(descs.some((text) => text.includes('2') && text.includes('items')));
    assert.ok(descs.some((text) => text.includes('3') && text.includes('items')));

    const which = flatten(tree)
      .map((node) => (node.props.which === undefined ? '' : String(node.props.which)))
      .filter((value) => value !== '');
    assert.ok(which.includes('pool-bucket-layered'));
    assert.ok(which.includes('pool-bucket-live2d'));
    assert.ok(which.includes('pool-bucket-webm'));
    assert.ok(which.includes('skin-root'), '卡片头要能打开皮肤根');
  });
});

describe('SkinDirs —— empty 与 missing 分开', () => {
  test('empty：目录在、没资源 → 不画 is-missing，徽标与文案都说是空，并附 expect 清单', () => {
    const emptyResources = {
      ...resources,
      resources: {
        ...resources.resources,
        renderers: {
          ...resources.resources.renderers,
          live2d: bucket({
            status: 'empty',
            dir: '/p/live2d',
            count: 0,
            items: [],
            expect: ['*.model3.json'],
            missingFiles: [],
          }),
        },
      },
    };
    const tree = SkinDirs({ resources: emptyResources, busy: false } as never);
    const rows = flatten(tree).filter((node) => String(node.props.className ?? '').includes('__treeRow'));
    const live2d = rows.find((row) => flatten(row.props.children).some((node) => node.props.children === 'live2d/'));
    assert.ok(live2d, 'live2d 行要在');
    assert.equal(String(live2d.props.className).includes('is-missing'), false, 'empty 不该画成缺失');
    const texts = flatten(live2d.props.children).map((node) => String(node.props.children ?? ''));
    assert.ok(
      texts.some((text) => text.includes('folder but no assets')),
      '文案要说是空',
    );
    assert.ok(texts.includes('skinDirsBadgeEmpty'), '徽标是「空」');
    assert.ok(
      texts.some((text) => text.includes('*.model3.json')),
      '行内要附 expect 清单',
    );
  });

  test('missing：行内写「缺 …」与 expect，徽标是缺失，且仍能打开该目录', () => {
    const tree = render();
    const rows = flatten(tree).filter((node) => String(node.props.className ?? '').includes('__treeRow'));
    const live2d = rows.find((row) => flatten(row.props.children).some((node) => node.props.children === 'live2d/'));
    assert.ok(live2d);
    assert.equal(String(live2d.props.className).includes('is-missing'), true);
    const texts = flatten(live2d.props.children).map((node) => String(node.props.children ?? ''));
    assert.ok(texts.includes('skinDirsBadgeMissing'));
    assert.ok(texts.some((text) => text.includes('missing') && text.includes('*.model3.json')));
    const which = flatten(live2d.props.children)
      .map((node) => String(node.props.which ?? ''))
      .filter((value) => value !== '');
    assert.ok(which.includes('pool-bucket-live2d'), '缺目录也要能一键打开去放文件');
  });
});
