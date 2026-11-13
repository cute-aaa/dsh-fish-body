/**
 * 自定义 hook 卡（src/client/settings/sfx-hooks.ts）的契约测试。
 *
 * 三条契约：
 *   1. 登记前先校验名字：非法与已登记各给一句话，合法才调 `addHook`；
 *   2. 名单里的「试听」在没匹配到文件时禁用——点了没声只会被当成坏按钮；
 *   3. 「取消登记」只出现在写进配置的那些上：索引里扫到的素材删了会自己回来。
 *
 * 这张卡自己有 draft / error 两个状态，所以这里带一个最小的「渲染一次 + 触发事件 + 再渲染一次」的循环，
 * 用可变格子代替 React 的 useState——不必引 jsdom 也能验到「输入 → 提交」这条链。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { SFX_HOOK_NAME_RE } from '../../shared/sfx/types.ts';
import { makeSfxHooks } from './sfx-hooks.ts';
import type { SfxHookView, SfxSettings } from './use-sfx-settings.ts';

interface Node {
  tag: unknown;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;

/** 造一份只含 hook 名单的状态。 */
const settingsOf = (hooks: SfxHookView[], addHook: (name: string) => boolean = () => true): SfxSettings => ({
  apply: () => undefined,
  config: {},
  hooks,
  load: () => undefined,
  setSlotEnabled: () => undefined,
  slots: [],
  addHook,
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

/**
 * 挂载一次：返回「重新渲染」与「输入后重新渲染」。
 *
 * @param settings - 分区状态。
 * @returns 渲染函数与输入入口。
 */
function mount(settings: SfxSettings) {
  // 卡片按固定顺序取两个 useState：draft、error。
  const cells: unknown[] = ['', ''];
  const render = (): Node[] => {
    let index = 0;
    const rt = {
      h,
      t: (key: string) => key,
      useState: (<T>(init: T) => {
        const slot = index++;
        const [value, set] = [cells[slot] as T, (next: T) => void (cells[slot] = next)];
        return [value ?? init, set];
      }) as never,
    };
    return flatten((makeSfxHooks(rt as never) as (p: unknown) => unknown)({ busy: false, sfx: settings }));
  };
  const nodes = render();
  /** 每次都取最新一次的渲染结果：事件的闭包必须来自「输入之后」那一版。 */
  const inputOf = (tree: Node[]): Node | undefined =>
    tree.find((node) => node.tag === 'input' && node.props.type === 'text');
  const submitOf = (tree: Node[]): Node | undefined =>
    tree.find((node) => node.tag === 'button' && String(node.props.className ?? '').includes('is-primary'));
  return {
    nodes,
    /** 输入一段文字并重新渲染。 */
    type: (text: string): Node[] => {
      (inputOf(render())?.props.onChange as (e: { target: { value: string } }) => void)({
        target: { value: text },
      });
      return render();
    },
    /** 点一下「登记」并重新渲染。 */
    submit: (): Node[] => {
      (submitOf(render())?.props.onClick as () => void)();
      return render();
    },
  };
}

describe('SfxHooks —— 自定义 hook', () => {
  test('名字非法：给出校验提示，不调 addHook', () => {
    const calls: string[] = [];
    const card = mount(settingsOf([], (name) => (calls.push(name), true)));
    card.type('has space');
    const after = card.submit();
    assert.deepEqual(calls, [], `空格不在允许集合里（${String(SFX_HOOK_NAME_RE)}）`);
    assert.ok(
      after.some((node) => node.props.children === 'sfxHookInvalid'),
      '非法名字要就地说明规则',
    );
  });

  test('已登记：提示重复，不调 addHook', () => {
    const calls: string[] = [];
    const card = mount(settingsOf([], (name) => (calls.push(name), false)));
    card.type('ding');
    const after = card.submit();
    assert.deepEqual(calls, ['ding']);
    assert.ok(after.some((node) => node.props.children === 'sfxHookExists'));
  });

  test('合法名字：调 addHook 且只调一次', () => {
    const calls: string[] = [];
    const card = mount(settingsOf([], (name) => (calls.push(name), true)));
    card.type('ding');
    const after = card.submit();
    assert.deepEqual(calls, ['ding']);
    assert.equal(
      after.some((node) => node.props.children === 'sfxHookExists'),
      false,
    );
  });

  test('名单：没文件的试听禁用，只有已登记项给「取消登记」', () => {
    const declared: SfxHookView = {
      builtin: false,
      declared: true,
      file: '',
      name: 'ding',
      origin: 'none',
      which: 'sound',
    };
    const scanned: SfxHookView = {
      builtin: true,
      declared: false,
      file: 'hook-drag.wav',
      name: 'drag',
      origin: 'sound',
      which: 'sound',
    };
    const nodes = mount(settingsOf([declared, scanned])).nodes;
    const tries = nodes.filter((node) => node.tag === 'button' && node.props.children === 'sfxTry');
    assert.equal(tries.length, 2);
    assert.equal(tries[0].props.disabled, true, '没有文件的 hook 不能试听');
    assert.equal(tries[1].props.disabled, false);

    const removes = nodes.filter((node) => node.tag === 'button' && node.props.children === 'sfxHookRemove');
    assert.equal(removes.length, 1, '只有写进配置的那个才能取消登记');
  });
});
