/**
 * 宠物配置卡（src/client/settings/pet-card.ts）的契约测试。
 *
 * 口径（T7 收窄后）：
 *   1. 选中宠物为空时只显示「暂无宠物」提示；
 *   2. 名字 / 大小走顶层字段；四个能力开关各回传自己的键；
 *   3. 渲染方式 / 显示位置 / 角落三个下拉与人设尺寸折叠**不再出现**在这张卡；鼠标穿透也不再在这里；
 *   4. 有角色数据时角色卡常显，人设正文默认折叠（`aria-expanded=false`）；
 *   5. 忙时全部控件禁用，卡片上没有第二个保存入口。
 *
 * 用假的 `h` 记录节点树（不引 jsdom）；函数组件在摊平时被调用一次，等价于 React 渲染那一层。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makePetCard } from './pet-card.ts';
import type { PetPatch } from './pet-card-parts.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';
import { NO_DIRTY } from './dirty.ts';
import type { Pet } from '../../shared/types.ts';

interface Node {
  tag: unknown;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
/** 假 runtime：hook 只在组件体内被调用，这里只需能返回初值、能装 ref。 */
const rt = {
  h,
  t: (key: string) => key,
  useState: <T>(init: T) => [init, () => {}] as [T, (next: T) => void],
  useEffect: () => {},
  useRef: <T>(init: T) => ({ current: init }),
};
const PetCard = makePetCard(rt as never);

/** 摊平整棵树；函数组件（头像格 / 字段组 / 角色卡）在这里被调用一次。 */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  if (typeof element.tag === 'function') {
    return [element, ...flatten((element.tag as (props: Record<string, unknown>) => unknown)(element.props))];
  }
  return [element, ...flatten(element.props?.children)];
}

const pet = {
  id: 'pet-1',
  name: '小桌宠',
  size: 260,
  display: 'both',
  balanceEnabled: true,
  whisperEnabled: false,
  workStatusEnabled: true,
  fixedEnabled: false,
  position: { corner: 'bottom-left', marginX: 40, marginY: 60 },
  whisperPrompt: '你是一只猫',
} as unknown as Pet;

/** 按标签 + 值找控件。 */
function control(tree: unknown, tag: string, match: (props: Record<string, unknown>) => boolean): Node {
  const found = flatten(tree).find((node) => node.tag === tag && match(node.props));
  assert.ok(found, `没找到满足条件的 ${tag}`);
  return found;
}

/** 空的角色数据：卡片仍渲染，但来源/角色列表为空。 */
const characterStub = {
  persona: {
    sources: [],
    characters: [],
    scope: { id: 'pet-1', entry: 'main', writable: true, character: null },
    ready: true,
    busy: false,
    degraded: false,
    scan: async () => null,
    apply: async () => null,
    remove: async () => false,
    reload: () => undefined,
  },
  importer: {
    preview: null,
    files: [],
    busy: false,
    pick: async () => undefined,
    update: () => undefined,
    commit: async () => false,
    cancel: () => undefined,
  },
  polish: {
    preview: null,
    busy: false,
    polish: async () => undefined,
    apply: () => undefined,
    cancel: () => undefined,
  },
  onChange: () => undefined,
};

const render = (onChange: (patch: PetPatch) => void, extra: Record<string, unknown> = {}) =>
  PetCard({ pet, petIndex: 0, busy: false, entryPrompt: '条目人设', onChange, dirty: NO_DIRTY, ...extra } as never);

/** 全部下拉（自绘组件：节点上带 options 数组）。 */
const pickers = (tree: unknown): Node[] => flatten(tree).filter((node) => Array.isArray(node.props.options));

describe('PetCard —— 宠物配置卡（T7 收窄后）', () => {
  test('没有选中宠物：只给「暂无宠物」提示', () => {
    const tree = PetCard({
      pet: null,
      petIndex: 0,
      busy: false,
      entryPrompt: '',
      onChange: () => {},
      onRemove: () => {},
      dirty: NO_DIRTY,
    } as never);
    assert.equal(flatten(tree).length, 1);
    assert.equal(flatten(tree)[0].props.children, 'emptyPets');
  });

  test('名字与大小走顶层字段', () => {
    const patches: PetPatch[] = [];
    const tree = render((patch) => patches.push(patch));
    const name = control(tree, 'input', (props) => props.value === '小桌宠');
    (name.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '新名字' } });
    const size = control(tree, 'input', (props) => props.defaultValue === '260');
    (size.props.onBlur as (e: { target: { value: string } }) => void)({ target: { value: '300' } });
    assert.deepEqual(patches, [{ name: '新名字' }, { size: 300 }]);
  });

  test('四个能力开关各自回传自己的键（鼠标穿透已搬到窗口行为卡）', () => {
    const patches: PetPatch[] = [];
    const tree = render((patch) => patches.push(patch));
    const checkboxes = flatten(tree).filter((node) => node.tag === 'input' && node.props.type === 'checkbox');
    assert.equal(checkboxes.length, 4, '只剩四个能力开关');
    for (const box of checkboxes) {
      (box.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    }
    assert.deepEqual(patches, [
      { balanceEnabled: true },
      { whisperEnabled: true },
      { workStatusEnabled: true },
      { fixedEnabled: true },
    ]);
  });

  test('不再出现显示位置 / 渲染方式 / 角落三个下拉，也没有尺寸折叠', () => {
    const tree = render(() => {});
    assert.equal(pickers(tree).length, 0, '卡片里不该再有下拉（渲染/位置/尺寸都搬走了）');
    const titles = flatten(tree)
      .filter((node) => typeof node.props.children === 'string')
      .map((node) => node.props.children);
    assert.equal(titles.includes('sizesTitle'), false, '每渲染尺寸不在宠物卡');
  });

  test('有角色数据时角色卡常显；人设正文默认折叠', () => {
    const tree = render(() => {}, { character: characterStub });
    const texts = flatten(tree)
      .filter((node) => typeof node.props.children === 'string')
      .map((node) => node.props.children as string);
    assert.ok(
      texts.some((text) => text.startsWith('characterTitle')),
      '角色卡标题要出现',
    );
    const fold = flatten(tree).find(
      (node) => node.tag === 'button' && node.props['aria-controls'] === 'pet-cfg-persona',
    );
    assert.ok(fold, '人设折叠卡必须存在');
    assert.equal(fold.props['aria-expanded'], false, '人设正文默认折叠');
    const scopeTitle = texts.find((text) => text.startsWith('characterTitle')) ?? '';
    assert.match(scopeTitle, /作用于|characterScopeLabel/, '标题行要写明作用域');
  });

  test('人设：回显当前值、占位符用条目人设、右下角显示字数', () => {
    const tree = render(() => {});
    const area = control(tree, 'textarea', () => true);
    assert.equal(area.props.value, '你是一只猫');
    assert.equal(area.props.placeholder, '条目人设');
    assert.ok(flatten(tree).some((node) => node.props.children === 'personaCount'));
  });

  test('忙时全部控件禁用；卡片上不再有第二个保存入口', () => {
    const tree = PetCard({
      pet,
      petIndex: 0,
      busy: true,
      entryPrompt: '',
      onChange: () => {},
      onRemove: () => {},
      dirty: NO_DIRTY,
    } as never);
    const controls = flatten(tree).filter((node) => node.tag === 'input' || node.tag === 'textarea');
    assert.ok(controls.length > 0);
    for (const node of controls) assert.equal(node.props.disabled, true, `${node.tag} 应被禁用`);
    assert.equal(
      flatten(tree).filter((node) => node.tag === 'button' && node.props.children === 'save').length,
      0,
      '保存已收进底部操作栏，卡片里不该再有保存按钮',
    );
  });
});

describe('PetCard —— 头像上传', () => {
  /** 头像文件选择框。 */
  const fileInput = (tree: unknown): Node => {
    const found = flatten(tree).find((node) => node.tag === 'input' && node.props.type === 'file');
    assert.ok(found, '应当渲染头像选择框');
    return found;
  };

  test('预览用传入的地址，选择框只收四种图片', () => {
    const tree = render(() => {}, { avatarSrc: ROUTE_PATH + '/logo?root=cat&v=1', onAvatar: () => {} });
    const img = flatten(tree).find((node) => node.tag === 'img' && String(node.props.className).includes('avatarImg'));
    assert.ok(img, '应当渲染头像预览图');
    assert.equal(img.props.src, ROUTE_PATH + '/logo?root=cat&v=1');
    const file = fileInput(tree);
    assert.equal(file.props.accept, 'image/png,image/jpeg,image/webp,image/gif');
    assert.equal(file.props.disabled, false);
  });

  test('不传 onAvatar（内置条目）→ 只有预览，没有上传入口', () => {
    const tree = render(() => {}, { avatarSrc: ROUTE_PATH + '/logo?root=main&v=1' });
    assert.ok(
      flatten(tree).some((node) => node.tag === 'img' && String(node.props.className).includes('avatarImg')),
      '预览仍然要显示',
    );
    assert.equal(
      flatten(tree).some((node) => node.tag === 'input' && node.props.type === 'file'),
      false,
      '内置条目不该出现文件选择框',
    );
  });

  test('选中文件后回传 onAvatar，并清空 input 以便重选同一张', () => {
    const picked: File[] = [];
    const tree = render(() => {}, { onAvatar: (file: File) => picked.push(file) });
    const file = fileInput(tree);
    const chosen = { name: 'a.png' } as File;
    const target = { files: [chosen], value: 'C:\\fakepath\\a.png' };
    (file.props.onChange as (e: { target: typeof target }) => void)({ target });
    assert.deepEqual(picked, [chosen]);
    assert.equal(target.value, '', '清空后同一个文件才能再次触发 change');
  });

  test('可换时：悬浮遮罩文案是「更换」，说明走 data-tip', () => {
    const tree = render(() => {}, { onAvatar: () => {} });
    const mask = flatten(tree).find((node) => String(node.props.className).includes('avatarMask'));
    assert.ok(mask, '应当渲染悬浮遮罩');
    assert.equal(mask.props.children, 'avatarChange');
    const pick = flatten(tree).find((node) => String(node.props.className).includes('avatarPick'));
    assert.ok(pick, '头像本身应当是可点区域');
    assert.equal(pick.props['data-tip'], 'avatarHint');
    assert.equal(pick.props.title, undefined);
  });
});
