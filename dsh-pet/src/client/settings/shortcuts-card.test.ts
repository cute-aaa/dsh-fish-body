/**
 * 快捷键卡的契约：
 *   1. 九个悬停键都从 `hotkeys` 取值（改绑后跟着变），没有被写死在卡片里；
 *   2. 键帽是按钮，点一下进捕获态；捕获到一个裸键就回传 `onAssign(动作, 键)`；
 *   3. 全局那组跟着 DSH 目录走，改绑后显示改绑后的组合；
 *   4. 仍是折叠卡，卡头说明挂在问号气泡上。
 *
 * 跑法：node --experimental-strip-types --test src/client/settings/shortcuts-card.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { DEFAULT_HOTKEYS, type HotkeyAction, type HotkeyMap } from '../../shared/hotkeys.ts';
import { keycapOf, type ShortcutHost } from '../app-shortcut.ts';
import { makeShortcutsCard } from './shortcuts-card.ts';

/** 节点桩：`h` 只把 tag 与 props 收集起来，不渲染。 */
interface Node {
  tag: string;
  props: Record<string, unknown>;
}

/** 目录行：服务按平台展开好的键帽片段。 */
type Row = { id: string; keys: string[] };

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
/**
 * 假 useState：初始值原样收下；setter 记进 `seen`（捕获态与开合态都靠它观察）。
 * 第三个及之后的 hook 各拿自己的初值——卡片里 open / editing / keycaps 三个状态互不能串。
 */
function makeUseState(seen: unknown[][]): never {
  return ((init: unknown) => {
    const box: unknown[] = [init];
    seen.push(box);
    return [init, (next: unknown) => box.push(next)];
  }) as never;
}
/** 假 useEffect：不在测试里挂订阅，只要求它存在。 */
const useEffect = (() => {}) as never;

/** 假上下文：目录内容由用例给。 */
function makeCtx(rows: Row[]): ShortcutHost {
  return {
    get: () => ({
      catalog: {
        getSnapshot: () => rows,
        subscribe: () => () => {},
      },
    }),
  };
}

/** 四条命令被改绑后的样子：键帽里出现的字母都不是默认值。 */
const REBOUND: Row[] = [
  { id: 'pet-chat.open', keys: ['Ctrl', '+', 'Alt', '+', 'J'] },
  { id: 'pet-chat.float', keys: ['Ctrl', '+', 'Alt', '+', 'K'] },
  { id: 'pet-chat.hear', keys: ['Ctrl', '+', 'Alt', '+', 'H'] },
  { id: 'pet-chat.capture', keys: ['Ctrl', '+', 'Alt', '+', 'Y'] },
];

/** 默认组合：目录里没有这一行时的兜底文案。 */
const CHAT_DEFAULT = keycapOf({ code: 'KeyP', modifiers: ['primary', 'shift'] });
const FLOAT_DEFAULT = keycapOf({ code: 'KeyL', modifiers: ['primary', 'shift'] });
const HEAR_DEFAULT = keycapOf({ code: 'KeyM', modifiers: ['primary', 'shift'] });
const CAPTURE_DEFAULT = keycapOf({ code: 'KeyS', modifiers: ['primary', 'shift'] });

/** 摊平节点树，把所有文本片段收成数组。 */
function texts(node: unknown): string[] {
  if (node === null || node === undefined) return [];
  if (typeof node === 'string') return [node];
  if (typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  return texts((node as Node).props?.children);
}

/** 摊平节点树，收集所有 `data-tip`（问号气泡的内容不在文本里）。 */
function tips(node: unknown): string[] {
  if (node === null || node === undefined || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(tips);
  const element = node as Node;
  const tip = element.props?.['data-tip'];
  return [...(typeof tip === 'string' ? [tip] : []), ...tips(element.props?.children)];
}

/** 摊平节点树，收集所有元素节点。 */
function nodes(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  const element = node as Node;
  return [element, ...nodes(element.props?.children)];
}

/** 渲染一次整张卡；`onAssign` 收集改绑回传，`stateSeen` 用来观察本地状态变化。 */
function render(
  rows: Row[] = [],
  hotkeys: HotkeyMap = DEFAULT_HOTKEYS,
  options: { onAssign?: (action: HotkeyAction, key: string) => void; onReset?: () => void } = {},
): { tree: unknown; seen: unknown[][]; assigned: Array<[HotkeyAction, string]> } {
  const assigned: Array<[HotkeyAction, string]> = [];
  const seen: unknown[][] = [];
  const Card = makeShortcutsCard(
    { h, t: (key: string) => key, useState: makeUseState(seen), useEffect } as never,
    makeCtx(rows),
  );
  const tree = Card({
    hotkeys,
    onAssign: (action, key) => {
      assigned.push([action, key]);
      options.onAssign?.(action, key);
    },
    onReset: () => options.onReset?.(),
    disabled: false,
  });
  return { tree, seen, assigned };
}

/**
 * 一架会真的重渲染的假 hook 环境：`useState` 记住每次渲染的值，setter 触发重新渲染，
 * `useEffect` 立即执行并把清理函数收起来。捕获态要靠它才测得动（点键帽 → 按键 → 回传）。
 */
function makeHarness(rows: Row[] = [], hotkeys: HotkeyMap = DEFAULT_HOTKEYS) {
  const state: unknown[] = [];
  let cursor = 0;
  const assigned: Array<[HotkeyAction, string]> = [];
  let reset = 0;
  const listeners: Array<{ type: string; fn: (e: KeyboardEvent) => void }> = [];
  const savedWindow = (globalThis as { window?: unknown }).window;
  const fakeWindow = {
    addEventListener: (type: string, fn: unknown): void => {
      if (typeof fn === 'function') listeners.push({ type, fn: fn as (e: KeyboardEvent) => void });
    },
    removeEventListener: (): void => undefined,
  };
  (globalThis as { window?: unknown }).window = fakeWindow;

  const Card = makeShortcutsCard(
    {
      h,
      t: (key: string) => key,
      useState: ((init: unknown) => {
        const index = cursor;
        cursor += 1;
        if (state.length <= index) state[index] = init;
        return [
          state[index],
          (next: unknown) => {
            state[index] = typeof next === 'function' ? (next as (prev: unknown) => unknown)(state[index]) : next;
            render();
          },
        ];
      }) as never,
      useEffect: ((fn: () => void | (() => void)) => {
        fn();
      }) as never,
    } as never,
    makeCtx(rows),
  );

  let current: unknown;
  function render(): unknown {
    cursor = 0;
    listeners.length = 0;
    current = Card({
      hotkeys,
      onAssign: (action, key) => assigned.push([action, key]),
      onReset: () => (reset += 1),
      disabled: false,
    });
    return current;
  }

  render();
  return {
    /** 最近一次渲染的节点树（点击会触发重渲染，所以必须是 getter）。 */
    get tree(): unknown {
      return current;
    },
    assigned,
    /** 按下一个键：所有已注册的 keydown 监听都会收到，事件对象带最小的两个方法。 */
    press: (key: string, extra: Partial<KeyboardEvent> = {}): void => {
      const event = { key, preventDefault: () => undefined, stopPropagation: () => undefined, ...extra };
      for (const item of listeners) if (item.type === 'keydown') item.fn(event as unknown as KeyboardEvent);
    },
    get resetCount(): number {
      return reset;
    },
    restore: (): void => {
      (globalThis as { window?: unknown }).window = savedWindow;
    },
  };
}

/** 按下某个键帽（找 aria-label 里带动作标签的那个按钮）。 */
function keycapOfLabel(tree: unknown, label: string): Node | undefined {
  return nodes(tree).find(
    (node) =>
      node.tag === 'button' &&
      String(node.props?.className ?? '').includes('dsh-pet-cfg__keycap') &&
      String(node.props?.['aria-label'] ?? '').startsWith(label),
  );
}

describe('ShortcutsCard —— 快捷键卡', () => {
  test('九个悬停键都来自配置：改绑后键帽跟着变', () => {
    const custom: HotkeyMap = { ...DEFAULT_HOTKEYS, chat: 'k', sleep: 'q', 'display.none': '0' };
    const text = texts(render([], custom).tree).join('\n');
    assert.ok(text.includes('K 键'), '对话键取配置里的 K');
    assert.ok(text.includes('Q 键'), '睡觉键取配置里的 Q');
    assert.ok(text.includes('0 键'), '「都不」取配置里的 0');
    assert.ok(!text.includes('Z 键'), '默认的 Z 不该再出现');
  });

  test('出厂配置下九个键帽都在', () => {
    const text = texts(render().tree).join('\n');
    for (const cap of ['L 键', 'M 键', 'S 键', 'D 键', 'Z 键', '1 键', '2 键', '3 键', '4 键']) {
      assert.ok(text.includes(cap), cap + ' 应该出现在键帽里');
    }
  });

  test('点键帽进捕获态，按一个裸键就回传 (动作, 键)', () => {
    const box = makeHarness();
    try {
      const button = keycapOfLabel(box.tree, 'shortcutRowChat');
      assert.ok(button, '对话那一行应该有键帽按钮');
      (button?.props?.onClick as () => void)();
      // 捕获态：键帽文字换成「按一个键…」。
      assert.ok(texts(keycapOfLabel(box.tree, 'shortcutRowChat')).join('').includes('shortcutCapture'));
      box.press('k');
      assert.deepEqual(box.assigned, [['chat', 'k']]);
      // 捕获结束：键帽回到配置里的值（上层拿到 onAssign 后会写回配置，这里仍是 L）。
      assert.equal(texts(keycapOfLabel(box.tree, 'shortcutRowChat')).join(''), 'L 键');
    } finally {
      box.restore();
    }
  });

  test('捕获态：Escape 取消、带修饰键与非法键都不认、也不回传', () => {
    const box = makeHarness();
    try {
      (keycapOfLabel(box.tree, 'shortcutRowSleep')?.props?.onClick as () => void)();
      box.press('Escape');
      assert.deepEqual(box.assigned, []);
      // 退出捕获态之后，再按空格（不是裸键）也不该被算成一次改绑。
      (keycapOfLabel(box.tree, 'shortcutRowSleep')?.props?.onClick as () => void)();
      box.press(' ', { ctrlKey: true });
      box.press('Shift');
      assert.deepEqual(box.assigned, []);
    } finally {
      box.restore();
    }
  });

  test('全局那组跟着目录走：改绑后显示改绑后的键', () => {
    const text = texts(render(REBOUND).tree).join('\n');
    assert.ok(text.includes('Ctrl+Alt+K'), '打开对话用改绑后的键');
    assert.ok(text.includes('Ctrl+Alt+H'), '语音输入用改绑后的键');
    assert.ok(text.includes('Ctrl+Alt+Y'), '截图用改绑后的键');
    assert.ok(text.includes('Ctrl+Alt+J'), '侧栏对话用改绑后的键');
  });

  test('没改绑 → 全局那组显示默认组合', () => {
    const text = texts(render().tree).join('\n');
    assert.ok(text.includes(FLOAT_DEFAULT), '打开对话');
    assert.ok(text.includes(HEAR_DEFAULT), '语音输入');
    assert.ok(text.includes(CAPTURE_DEFAULT), '截图');
    assert.ok(text.includes(CHAT_DEFAULT), '侧栏对话');
  });

  test('三组标题、说明与全部行标签都在', () => {
    const text = texts(render().tree).join('\n');
    for (const key of [
      'shortcutGroupPet',
      'shortcutGroupPetHint',
      'shortcutGroupDisplay',
      'shortcutGroupDisplayHint',
      'shortcutGroupGlobal',
      'shortcutGroupGlobalHint',
      'shortcutRowChat',
      'shortcutRowHold',
      'shortcutRowHear',
      'shortcutRowCapture',
      'shortcutRowPaste',
      'shortcutRowTodo',
      'shortcutRowSleep',
      'shortcutRowDisplayWeb',
      'shortcutRowDisplayDesktop',
      'shortcutRowDisplayBoth',
      'shortcutRowDisplayNone',
      'shortcutRowSidebar',
      'shortcutReset',
    ]) {
      assert.ok(text.includes(key), key + ' 应该出现');
    }
  });

  test('是折叠卡，默认收起（与页尾两张参考卡同一套骨架）', () => {
    const all = nodes(render().tree);
    const card = all.find((node) => String(node.props?.className ?? '').includes('dsh-pet-cfg__card'));
    assert.ok(String(card?.props?.className).includes('is-fold'), '应该是折叠卡');
    assert.ok(!String(card?.props?.className).includes('is-open'), '默认不该展开');
    const toggle = all.find((node) => String(node.props?.className ?? '').includes('dsh-pet-cfg__foldToggle'));
    assert.equal(toggle?.props?.['aria-expanded'], false);
    assert.equal(toggle?.props?.['aria-controls'], 'pet-cfg-shortcuts');
  });

  test('标题是卡片头文本，说明挂在问号气泡上', () => {
    const tree = render().tree;
    assert.ok(texts(tree).join('\n').includes('shortcutCardTitle'), '标题应该在文本里');
    assert.ok(tips(tree).includes('shortcutCardHint'), '说明应该挂在 data-tip 上');
  });

  test('恢复默认按钮回传 onReset', () => {
    const box = makeHarness();
    try {
      const button = nodes(box.tree).find((node) => node.tag === 'button' && node.props?.children === 'shortcutReset');
      assert.ok(button, '应该有「恢复默认键位」按钮');
      (button?.props?.onClick as () => void)();
      assert.equal(box.resetCount, 1);
    } finally {
      box.restore();
    }
  });
});
