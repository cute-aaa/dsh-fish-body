/**
 * 渲染卡（render-card.ts）的契约测试：三渲染方式可切换、模型/皮肤选项来自 resources、
 * 缺文件提示带具体文件名与目录、尺寸覆盖「等于基准即删键」仍成立。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeRenderCard } from './render-card.ts';
import { NO_DIRTY } from './dirty.ts';
import type { Pet } from '../../shared/types.ts';

interface Node {
  tag: unknown;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
const rt = {
  h,
  t: (key: string) => ({ renderMissingFiles: 'missing {files} in {path}', renderRescan: 'rescan' })[key] ?? key,
  useState: <T>(init: T) => [init, () => {}] as [T, (next: T) => void],
  useEffect: () => undefined,
  useRef: <T>(init: T) => ({ current: init }),
  useCallback: (fn: unknown) => fn,
};
const RenderCard = makeRenderCard(rt as never);

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

const bucket = (over: Record<string, unknown> = {}) => ({
  status: 'ok',
  dir: '/p/layered',
  count: 1,
  items: [{ id: 'pa15', label: 'pa15', source: 'pool' as const }],
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
      webm: bucket({ dir: '/p/webm', items: [] }),
    },
  },
  busy: false,
  reload: () => undefined,
};

const pet = (over: Record<string, unknown> = {}): Pet =>
  ({
    id: 'a',
    name: 'A',
    size: 300,
    display: 'web',
    renderer: 'layered',
    position: { corner: 'top-left', marginX: 10, marginY: 20 },
    ...over,
  }) as unknown as Pet;

const render = (onChange: (patch: unknown) => void, over: Record<string, unknown> = {}) =>
  RenderCard({ pet: pet(), petIndex: 0, busy: false, dirty: NO_DIRTY, resources, onChange, ...over } as never);

/** 自绘下拉：节点上带 options 数组。 */
const pickers = (tree: unknown): Node[] => flatten(tree).filter((node) => Array.isArray(node.props.options));

describe('RenderCard —— 渲染卡', () => {
  test('渲染方式与模型/皮肤同一行（pair 容器），两种下拉都在', () => {
    const tree = render(() => {});
    const pair = flatten(tree).find((node) => String(node.props.className ?? '').includes('__pair'));
    assert.ok(pair, '首行要用 pair 容器（≥520 并排、<520 堆叠）');
    // 自绘下拉的组件节点与内部节点都带 options：按字段标签判「两个字段都在」更稳。
    const labels = new Set(pickers(tree).map((node) => String(node.props.label ?? '')));
    assert.ok(labels.has('rendererLabel'), '渲染方式下拉在');
    assert.ok(labels.has('renderModelLabel'), '模型/皮肤下拉在');
  });

  test('三渲染方式可切换：改渲染方式只回传 renderer', () => {
    const patches: Record<string, unknown>[] = [];
    const tree = render((patch) => patches.push(patch as Record<string, unknown>));
    const renderer = pickers(tree).find((node) => node.props.value === 'layered');
    assert.ok(renderer, '渲染方式下拉当前应为 layered');
    assert.deepEqual(
      (renderer.props.options as { id: string }[]).map((item) => item.id),
      ['webm', 'layered', 'live2d'],
    );
    (renderer.props.onChange as (id: string) => void)('live2d');
    assert.deepEqual(patches, [{ renderer: 'live2d' }]);
  });

  test('模型下拉项来自当前渲染方式的 resources 桶', () => {
    const tree = render(() => {});
    const model = pickers(tree).find((node) => node.props.value === '');
    assert.ok(model, '没有选模型时应是空值项');
    assert.deepEqual(
      (model.props.options as { id: string }[]).map((item) => item.id),
      ['pa15'],
    );
    const webm = render(() => {}, { pet: pet({ renderer: 'webm' }) });
    const disabledModel = pickers(webm).find(
      (node) => node.props.disabled === true && Array.isArray(node.props.options),
    );
    assert.ok(disabledModel, 'webm 下模型下拉置灰');
  });

  test('当前 model 不在清单里时插入「已失效」而不是让下拉空白', () => {
    const tree = render(() => {}, { pet: pet({ model: 'gone' }) });
    const model = pickers(tree).find((node) => node.props.value === 'gone');
    assert.ok(model, '应以当前值作为选中项');
    assert.ok(
      (model.props.options as { label: string }[]).some((item) => item.label.includes('renderModelStale')),
      '失效项要带标记',
    );
  });

  test('缺文件提示：带具体文件名与目录，并给重新扫描', () => {
    const tree = render(() => {}, { pet: pet({ renderer: 'live2d' }) });
    const banner = flatten(tree).find((node) => String(node.props.className ?? '').includes('is-warn'));
    assert.ok(banner, '缺文件时要显示提示条');
    const all = texts(banner);
    assert.ok(
      all.some((text) => text.includes('*.model3.json')),
      '要写出缺哪个文件',
    );
    assert.ok(
      all.some((text) => text.includes('/p/live2d')),
      '要写出期望目录',
    );
    assert.ok(all.includes('rescan'), '要能重新扫描');
  });

  test('尺寸覆盖：等于基准即删键（跟随默认按钮）', () => {
    const patches: Record<string, unknown>[] = [];
    const tree = render((patch) => patches.push(patch as Record<string, unknown>), {
      pet: pet({ sizes: { layered: 360 } }),
    });
    const follow = flatten(tree).find((node) => node.tag === 'button' && node.props.children === 'sizeFollowDefault');
    assert.ok(follow, '有覆盖时要给「跟随默认」');
    (follow.props.onClick as () => void)();
    assert.deepEqual(patches, [{ sizes: {} }], '点跟随默认 = 删掉该渲染方式的覆盖');
  });
});
