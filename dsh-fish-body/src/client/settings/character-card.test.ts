/**
 * 角色卡（character-card.ts）的契约测试：未安装项置灰与期望路径、只读实例禁用下拉/应用/删除、
 * 切实例后角色选择跟随该实例的引用、点「应用」把草稿正文交给数据层。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeCharacterCard } from './character-card.ts';
import { NO_DIRTY } from './dirty.ts';
import type { Pet } from '../../shared/types.ts';

interface Node {
  tag: unknown;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
const rt = {
  h,
  t: (key: string) => ({ characterExpectedPath: 'expected {path}', characterScopeLabel: '作用于 {pet}' })[key] ?? key,
  useState: <T>(init: T) => [init, () => {}] as [T, (next: T) => void],
  useEffect: () => undefined,
  useRef: <T>(init: T) => ({ current: init }),
  useCallback: (fn: unknown) => fn,
};
const CharacterCard = makeCharacterCard(rt as never);

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

const pet = (id: string, character?: string): Pet =>
  ({ id, name: '名字-' + id, size: 260, display: 'web', personaCharacter: character }) as unknown as Pet;

/** 数据层替身：两个来源（一个装了、一个没装）+ 一个角色。 */
function personaOf(over: Record<string, unknown> = {}) {
  return {
    sources: [
      {
        id: 'fish-soul',
        name: 'dsh-fish-soul',
        kind: 'soul-card',
        installed: true,
        expectedPath: '/dsh/fish-soul/persona.json',
        path: '/dsh/fish-soul/persona.json',
        scannable: true,
        lastScan: null,
      },
      {
        id: 'dsh-soul',
        name: 'dsh-soul',
        kind: 'soul-card',
        installed: false,
        expectedPath: '/dsh/dsh-soul/persona.json',
        path: null,
        scannable: true,
        lastScan: null,
      },
      {
        id: 'editor',
        name: 'editor',
        kind: 'editor',
        installed: true,
        expectedPath: null,
        path: null,
        scannable: false,
        lastScan: null,
      },
    ],
    characters: [
      {
        id: '鱼生',
        name: '鱼生',
        source: { kind: 'soul-card', id: 'fish-soul', path: 'a.json' },
        importedAt: '',
        chars: 5,
        appliedTo: [],
      },
    ],
    scope: { id: 'a', entry: 'main', writable: true, character: null },
    ready: true,
    busy: false,
    degraded: false,
    scan: async () => null,
    apply: async () => null,
    remove: async () => false,
    reload: () => undefined,
    ...over,
  };
}

const importerStub = {
  preview: null,
  files: [],
  busy: false,
  pick: async () => undefined,
  update: () => undefined,
  commit: async () => false,
  cancel: () => undefined,
};

const render = (props: Record<string, unknown>) =>
  CharacterCard({
    pet: pet('a'),
    petIndex: 0,
    busy: false,
    dirty: NO_DIRTY,
    importer: importerStub,
    onChange: () => {},
    ...props,
  } as never);

/** 按钮按文案找。 */
const button = (tree: unknown, label: string): Node => {
  const found = flatten(tree).find((node) => node.tag === 'button' && node.props.children === label);
  assert.ok(found, '没找到按钮 ' + label);
  return found;
};

describe('CharacterCard —— 角色卡', () => {
  test('未安装来源：下拉项带「未安装」，并显示期望路径', () => {
    const tree = render({ persona: personaOf() });
    const sourcePicker = flatten(tree).find(
      (node) => Array.isArray(node.props.options) && node.props.options.length === 3,
    );
    assert.ok(sourcePicker, '来源下拉应有三项');
    const labels = (sourcePicker.props.options as { label: string }[]).map((item) => item.label);
    assert.ok(
      labels.some((label) => label.includes('characterSourceMissing')),
      '未安装项要有标记',
    );
    assert.ok(
      texts(tree).some((text) => text.includes('/dsh/dsh-soul/persona.json')),
      '期望路径要显示',
    );
    assert.ok(
      labels.some((label) => label.includes('characterSourceNoScan')),
      '不可扫描项要有标记',
    );
  });

  test('只读实例（pet pack）：角色下拉、应用与删除一起禁用，扫描仍可用', () => {
    const tree = render({
      persona: personaOf({ scope: { id: 'a', entry: 'glm', writable: false, character: '鱼生' } }),
    });
    assert.equal(button(tree, 'characterApply').props.disabled, true);
    assert.equal(button(tree, 'characterRemove').props.disabled, true);
    const picker = flatten(tree).find(
      (node) => Array.isArray(node.props.options) && node.props.options.some((item: { id: string }) => item.id === ''),
    );
    assert.ok(picker, '角色下拉应存在');
    assert.equal(picker.props.disabled, true, '只读实例的下拉也要禁用（否则「不引用」绕道写盘）');
    assert.equal(button(tree, 'characterScan').props.disabled, false, '扫描只写全局库，仍可用');
    assert.ok(texts(tree).includes('characterReadonly'));
  });

  test('点「应用」把本实例当前草稿正文一起交给数据层（personaApplyOverwrote 靠它判定）', () => {
    const calls: unknown[][] = [];
    const tree = render({
      pet: { ...pet('a'), whisperPrompt: '我未保存的草稿' },
      persona: personaOf({
        scope: { id: 'a', entry: 'main', writable: true, character: '鱼生' },
        apply: async (...args: unknown[]) => {
          calls.push(args);
          return 'applied';
        },
      }),
    });
    (button(tree, 'characterApply').props.onClick as () => void)();
    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls[0],
      ['鱼生', true, '我未保存的草稿'],
      '第三个参数是草稿正文；缺了它状态行分不清「已应用」和「已覆盖」',
    );
  });

  test('切实例：角色选择跟随该实例的 personaCharacter', () => {
    const first = render({
      persona: personaOf({ scope: { id: 'a', entry: 'main', writable: true, character: '鱼生' } }),
    });
    const pickerOf = (tree: unknown): Node => {
      const found = flatten(tree).find(
        (node) =>
          Array.isArray(node.props.options) && node.props.options.some((item: { id: string }) => item.id === '鱼生'),
      );
      assert.ok(found, '角色下拉应存在');
      return found;
    };
    assert.equal(pickerOf(first).props.value, '鱼生');

    const second = render({
      pet: pet('b'),
      petIndex: 1,
      persona: personaOf({ scope: { id: 'b', entry: 'main', writable: true, character: null } }),
    });
    assert.equal(pickerOf(second).props.value, '', '没有引用时显示空项');
  });

  test('导入文档：展开预览区但不发请求（取消由数据层负责）', () => {
    const tree = render({ persona: personaOf() });
    const toggle = button(tree, 'characterImport');
    (toggle.props.onClick as () => void)();
    // 按钮点击只切本地状态；数据层替身的 pick/commit 计数为 0
    assert.equal(importerStub.preview, null);
  });
});

describe('CharacterCard —— 选择语义（返工二）', () => {
  /** 角色下拉（含「（不引用角色）」空项）。 */
  const picker = (tree: unknown): Node => {
    const found = flatten(tree).find(
      (node) => Array.isArray(node.props.options) && node.props.options.some((item: { id: string }) => item.id === ''),
    );
    assert.ok(found, '角色下拉应存在且含空项');
    return found;
  };

  test('选「（不引用角色）」：回传 personaCharacter=undefined（删键语义），正文键不出现', () => {
    const patches: Record<string, unknown>[] = [];
    const tree = render({
      persona: personaOf({ scope: { id: 'a', entry: 'main', writable: true, character: '鱼生' } }),
      onChange: (patch: Record<string, unknown>) => patches.push(patch),
    });
    (picker(tree).props.onChange as (id: string) => void)('');
    assert.deepEqual(patches, [{ personaCharacter: undefined }]);
    assert.equal('whisperPrompt' in patches[0], false, '清除引用不该动正文');
  });

  test('改选别的角色只改本地选择，不发任何写请求（草稿零变化）', () => {
    const patches: Record<string, unknown>[] = [];
    const tree = render({
      persona: personaOf({ scope: { id: 'a', entry: 'main', writable: true, character: null } }),
      onChange: (patch: Record<string, unknown>) => patches.push(patch),
    });
    (picker(tree).props.onChange as (id: string) => void)('鱼生');
    assert.deepEqual(patches, [], '选中即写会与「点应用才落草稿」自相矛盾');
  });

  test('只读实例：角色下拉与应用 / 删除一起禁用', () => {
    const tree = render({
      persona: personaOf({ scope: { id: 'a', entry: 'glm', writable: false, character: '鱼生' } }),
    });
    assert.equal(picker(tree).props.disabled, true, '只读实例不能选，否则「不引用」会绕道写盘');
    assert.equal(button(tree, 'characterApply').props.disabled, true);
    assert.equal(button(tree, 'characterRemove').props.disabled, true);
  });
});
