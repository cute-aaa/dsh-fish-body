/**
 * 音效卡（src/client/settings/sfx-card.ts）的「打开文件夹」契约：
 * 每个事件槽与每个 hook 行都必须有一个按钮，且类别由该行的来源/建议落点决定——
 * 按钮开错目录比没有按钮更糟（用户会往一个不会被读到的目录里放文件）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { NO_DIRTY } from './dirty.ts';
import { makeSfxCard } from './sfx-card.ts';
import { SFX_EVENT_SLOTS } from '../../shared/sfx/types.ts';
import type { SfxSettings, SfxSlotView } from './use-sfx-settings.ts';

interface Node {
  tag: unknown;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;

/** 假 hooks：不重渲染、不执行副作用（气泡逻辑在交互时才跑）。 */
const runtime = {
  h,
  t: (key: string) => key,
  useState: (<T>(init: T) => [init, () => undefined]) as never,
  useEffect: (() => undefined) as never,
  useRef: (<T>(init: T) => ({ current: init })) as never,
  useCallback: ((fn: unknown) => fn) as never,
};

/** 造一行槽位视图。 */
const slot = (patch: Partial<SfxSlotView> & Pick<SfxSlotView, 'slot'>): SfxSlotView => ({
  enabled: true,
  file: 'x.wav',
  origin: 'package-default',
  which: 'package',
  ...patch,
});

/** 造一份只含给定槽位与 hook 的状态。 */
const settingsOf = (slots: SfxSlotView[], hooks: SfxSettings['hooks'] = []): SfxSettings => ({
  apply: () => undefined,
  config: {},
  hooks,
  load: () => undefined,
  setSlotEnabled: () => undefined,
  slots,
  addHook: () => false,
  removeHook: () => undefined,
  tryHook: () => undefined,
  trySlot: () => undefined,
});

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

/** 渲染一次卡片。 */
const render = (settings: SfxSettings): Node[] =>
  flatten(
    makeSfxCard(runtime as never)({
      busy: false,
      sfx: settings,
      dirty: NO_DIRTY,
    }),
  );

describe('sfx-card —— 每行都有「打开文件夹」', () => {
  test('八个事件槽各一个按钮，类别取自 which', () => {
    const slots = SFX_EVENT_SLOTS.map((name) =>
      slot({ slot: name, which: name === 'click' ? 'pool-layered' : 'package' }),
    );
    const nodes = render(settingsOf(slots));
    const buttons = nodes.filter((node) => typeof node.props?.which === 'string');
    assert.equal(buttons.length, SFX_EVENT_SLOTS.length);
    assert.equal(buttons[0].props.which, 'pool-layered');
  });

  test('命中池：显示绝对路径，按钮仍指向池目录', () => {
    const nodes = render(
      settingsOf([
        slot({
          origin: 'pool-global',
          path: 'D:/u/skin/sound/click.wav',
          slot: 'click',
          which: 'pool-global-sound',
        }),
      ]),
    );
    const button = nodes.find((node) => typeof node.props?.which === 'string');
    assert.equal(button?.props.which, 'pool-global-sound');
    const code = nodes.find((node) => node.props?.className === 'dsh-pet-cfg__sfxPattern' && node.props.title);
    assert.equal(code?.props.title, 'D:/u/skin/sound/click.wav');
  });

  test('未命中池：第二行是「建议放这里」，按钮指向建议类别', () => {
    const nodes = render(
      settingsOf([
        slot({
          slot: 'click',
          suggestion: {
            absolute: 'D:/u/skin/layered/c1/c1-click.wav',
            relative: 'skin/layered/c1/c1-click.wav',
            which: 'pool-layered',
          },
          which: 'pool-layered',
        }),
      ]),
    );
    const suggestTexts = nodes
      .filter((node) => node.props?.className === 'dsh-pet-cfg__sfxFile')
      .map((node) => JSON.stringify(node.props.children));
    assert.ok(
      suggestTexts.some((text) => text.includes('sfxWhereToPut')),
      '第二行应提示建议落点',
    );
    assert.equal(nodes.filter((node) => node.props?.which === 'pool-layered').length, 1);
  });

  test('hook 行也有按钮（按来源给类别）', () => {
    const nodes = render(
      settingsOf(
        [],
        [{ builtin: false, declared: true, file: 'hook-ding.wav', name: 'ding', origin: 'sound', which: 'sound' }],
      ),
    );
    const hookButton = nodes.find((node) => node.props?.which === 'sound' && node.props?.className === undefined);
    assert.ok(hookButton, 'hook 行的按钮应带上 which=sound');
  });
});
