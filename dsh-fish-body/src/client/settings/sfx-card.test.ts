/**
 * 音效卡（src/client/settings/sfx-card.ts）的装配契约：
 * 卡头只有一个「打开文件夹」、槽位明细整块收进折叠、hook 卡紧随其后。
 *
 * 这一条是这一轮改动的核心：过去八个槽位各挂一个同名按钮 + 一条命名规则，卡片被撑成两屏；
 * 现在常显的只有「开不开、响不响」，排障用的路径与命名规则都在同一个折叠里。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { NO_DIRTY } from './dirty.ts';
import { makeSfxCard } from './sfx-card.ts';
import type { SfxSettings } from './use-sfx-settings.ts';

interface Node {
  tag: unknown;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
const runtime = {
  h,
  t: (key: string) => key,
  useState: (<T>(init: T) => [init, () => undefined]) as never,
};

/** 空状态：这张卡不需要真实槽位就能验装配。 */
const empty: SfxSettings = {
  apply: () => undefined,
  config: {},
  hooks: [],
  load: () => undefined,
  setSlotEnabled: () => undefined,
  slots: [],
  addHook: () => false,
  removeHook: () => undefined,
  tryHook: () => undefined,
  trySlot: () => undefined,
};

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

describe('SfxCard —— 装配', () => {
  const assetImports = {
    busy: '',
    importSkin: async () => false,
    importSfxSlot: async () => false,
    importSharedSfx: async () => false,
    importHookSfx: async () => false,
    importSessionFish: async () => false,
  };
  const nodes = flatten(
    makeSfxCard(runtime as never)({ busy: false, dirty: NO_DIRTY, sfx: empty, assetImports: assetImports as never }),
  );

  test('卡头只有一个「打开文件夹」，指向声音目录', () => {
    const buttons = nodes.filter((node) => typeof node.props?.which === 'string');
    assert.equal(buttons.length, 1, '槽位级的八个按钮已经收进折叠');
    assert.equal(buttons[0].props.which, 'sound');
  });

  test('槽位列表常显、明细收进折叠、hook 卡在同一分区', () => {
    // 分区装配里挂了几件子组件（列表 / 明细 / hook 卡 / 卡头的文件夹按钮）。
    const components = nodes.filter((node) => typeof node.tag === 'function');
    assert.ok(components.length >= 3, '紧凑列表、明细与 hook 卡都要挂在树上');
    // 折叠卡的选项就是它的 props（h 不展开组件）：按正文 id 找它。
    const fold = nodes.find((node) => node.props.id === 'pet-cfg-sfx-sources');
    assert.ok(fold, '明细要有自己的折叠卡');
    assert.equal(fold.props.title, 'sfxSourcesTitle');
    assert.equal(
      flatten(fold.props.body).filter((node) => typeof node.tag === 'function').length,
      1,
      '折叠正文里是明细组件',
    );
  });

  test('命名规则的常显说明仍在（只是收短了）', () => {
    assert.ok(nodes.some((node) => node.props.children === 'sfxFileHint'));
  });
});
