/**
 * 右键菜单挂载（src/shared/menu/mount.ts）的契约测试。
 *
 * 为什么自带一个假 DOM：菜单挂载是纯客户端行为，但它是**两端共用**的（网页 overlay 与桌面 Helper
 * 都从 shared-core 拿同一份），而「大小」滑块这条路径既没有 canvas 也没有 IPC，唯一能钉住的就是
 * 「拖只改读数、松手才派发、派发后关闭」这三条。这里用最小假 DOM 跑真实实现，不引 jsdom。
 *
 * 覆盖：叶子点击派发、分支子面板、滑块行的属性/读数/派发时机（拖回原值不算改动）。
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { mountContextMenu } from './mount.ts';
import { sizeMenuBranch } from './tree.ts';
import type { MenuLeaf, MenuNode, MenuSlider } from './types.ts';

/** 假元素：只实现挂载器真正用到的那一小撮接口。 */
class FakeEl {
  tagName: string;
  className = '';
  textContent = '';
  readonly style: Record<string, string> = {};
  readonly attrs: Record<string, string> = {};
  readonly children: FakeEl[] = [];
  parent: FakeEl | null = null;
  offsetWidth = 160;
  offsetHeight = 40;
  /** 任意附加属性（input 的 type/value/min/max/step 直接当属性写）。 */
  [key: string]: unknown;
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  get classList(): { add: (name: string) => void } {
    return {
      add: (name: string) => {
        this.className = (this.className + ' ' + name).trim();
      },
    };
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  getAttribute(name: string): string | undefined {
    return this.attrs[name];
  }

  addEventListener(type: string, fn: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((item) => item !== fn),
    );
  }

  /** 触发监听（只支持本测试需要的「无参事件」形状）。 */
  emit(type: string, event: unknown = { target: this, preventDefault() {}, stopPropagation() {} }): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  appendChild(child: FakeEl): FakeEl {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    const parent = this.parent;
    if (parent === null) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parent = null;
  }

  contains(node: unknown): boolean {
    let current = node instanceof FakeEl ? node : null;
    while (current !== null) {
      if (current === this) return true;
      current = current.parent;
    }
    return false;
  }

  /** 按类名找后代（挂载器只用 `.dsh-pet-menu-column` 这一种）。 */
  querySelectorAll(selector: string): FakeEl[] {
    const name = selector.replace(/^\./, '');
    const out: FakeEl[] = [];
    const walk = (el: FakeEl): void => {
      for (const child of el.children) {
        if (child.className.split(' ').includes(name)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  /** 深度优先找第一个满足条件的后代（测试用，不进实现）。 */
  find(predicate: (el: FakeEl) => boolean): FakeEl | undefined {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const hit = child.find(predicate);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }

  getBoundingClientRect(): { left: number; right: number; top: number; bottom: number; width: number; height: number } {
    return {
      left: 0,
      top: 0,
      right: this.offsetWidth,
      bottom: this.offsetHeight,
      width: this.offsetWidth,
      height: this.offsetHeight,
    };
  }
}

/** 假 document：只给挂载器与测试用到的那几个入口。 */
class FakeDocument {
  readonly body = new FakeEl('body');
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  createElement(tagName: string): FakeEl {
    return new FakeEl(tagName);
  }

  addEventListener(type: string, fn: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((item) => item !== fn),
    );
  }
}

let doc: FakeDocument;
let savedDocument: unknown;
let savedWindow: unknown;

before(() => {
  doc = new FakeDocument();
  savedDocument = (globalThis as Record<string, unknown>).document;
  savedWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).window = {
    innerWidth: 1200,
    innerHeight: 800,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
});

after(() => {
  (globalThis as Record<string, unknown>).document = savedDocument;
  (globalThis as Record<string, unknown>).window = savedWindow;
});

/** 挂一个菜单并把派发记录收集起来。 */
function mount(tree: MenuNode[]): { root: FakeEl; actions: MenuLeaf[]; closed: () => boolean } {
  const actions: MenuLeaf[] = [];
  const mountHandle = mountContextMenu({ tree, x: 10, y: 10, onAction: (leaf) => actions.push(leaf) });
  const root = doc.body.children[doc.body.children.length - 1] as FakeEl;
  void mountHandle;
  return { root, actions, closed: () => !doc.body.contains(root) };
}

describe('mountContextMenu —— 叶子与分支', () => {
  test('点叶子：派发一次并关闭菜单', () => {
    const items: MenuNode[] = [{ label: '待机呼吸', anim: 'idle' }];
    const { root, actions, closed } = mount(items);
    const leaf = root.find((el) => el.className.includes('dsh-pet-menu-item') && el.textContent === '');
    // label 在子 span 里：按文本找那一项
    const target = root.find(
      (el) => el.className.includes('dsh-pet-menu-item') && el.children.some((c) => c.textContent === '待机呼吸'),
    );
    assert.ok(target ?? leaf, '应渲染出叶子项');
    (target as FakeEl).emit('click');
    assert.deepEqual(actions, [{ label: '待机呼吸', anim: 'idle' }]);
    assert.equal(closed(), true, '点完要关闭');
  });

  test('分支项：渲染箭头与子面板（子面板默认隐藏）', () => {
    const branch: MenuNode = { label: '动作', children: [{ label: '待机呼吸', anim: 'idle' }] };
    const { root } = mount([branch]);
    const arrow = root.find((el) => el.className === 'dsh-pet-menu-arrow');
    assert.ok(arrow, '分支要有箭头');
    const panels = root.querySelectorAll('.dsh-pet-menu-column');
    assert.equal(panels.length, 2, '根面板 + 子面板');
    assert.equal(panels[1]?.style.display, 'none', '子面板默认收起');
  });
});

describe('mountContextMenu —— 「大小」滑块行', () => {
  /** 「大小」子菜单：滑块 + 恢复默认。 */
  const sizeTree = (): MenuNode[] => [sizeMenuBranch(555, 462)];

  /** 取根面板里的滑块行。 */
  function sliderOf(root: FakeEl): { row: FakeEl; range: FakeEl; value: FakeEl } {
    const range = root.find((el) => el.className === 'dsh-pet-menu-range');
    assert.ok(range, '菜单里应有滑块');
    const row = range.parent as FakeEl;
    const value = row.children.find((el) => el.className === 'dsh-pet-menu-value');
    assert.ok(value, '滑块右侧应有读数');
    return { row, range, value };
  }

  test('属性来自节点：min/max/step/初值 + aria 名称；读数写成 px', () => {
    const { root } = mount(sizeTree());
    const { range, value } = sliderOf(root);
    const slider = sizeMenuBranch(555, 462).children[0] as MenuSlider;
    assert.equal(range.type, 'range');
    assert.equal(range.min, String(slider.min));
    assert.equal(range.max, String(slider.max));
    assert.equal(range.step, String(slider.step));
    assert.equal(range.value, '555');
    assert.equal(range.getAttribute('aria-label'), slider.label);
    assert.equal(value.textContent, '555px');
  });

  test('拖动（input）只改读数：不派发、菜单不关', () => {
    const { root, actions, closed } = mount(sizeTree());
    const { range, value } = sliderOf(root);
    range.value = '700';
    range.emit('input');
    assert.equal(value.textContent, '700px', '读数跟着滑块走');
    assert.deepEqual(actions, [], '拖动过程中不得写配置');
    assert.equal(closed(), false, '拖动过程中菜单必须还在');
  });

  test('松手（change）派发 set-size 并关闭菜单', () => {
    const { root, actions, closed } = mount(sizeTree());
    const { range } = sliderOf(root);
    range.value = '777';
    range.emit('change');
    assert.deepEqual(
      actions,
      [{ label: '大小（px）', action: 'set-size', size: 777 }],
      '派发形状与「恢复默认」同一条路：action=set-size + size',
    );
    assert.equal(closed(), true);
  });

  test('拖回原值不算一次改动：不派发、但菜单也照常关（松手即结束）', () => {
    const { root, actions } = mount(sizeTree());
    const { range } = sliderOf(root);
    range.value = '555';
    range.emit('change');
    assert.deepEqual(actions, [], '值没变就不该写盘');
  });

  test('越界值夹回区间后再派发', () => {
    const { root, actions } = mount(sizeTree());
    const { range } = sliderOf(root);
    range.value = '99999';
    range.emit('change');
    const slider = sizeMenuBranch(555, 462).children[0] as MenuSlider;
    assert.equal((actions[0] as MenuLeaf).size, slider.max, '超过上限按上限发');
  });

  test('滑块行内按下/抬起不冒泡（避免被外层「点空白收起」误判）', () => {
    const { root } = mount(sizeTree());
    const { row } = sliderOf(root);
    let stopped = 0;
    const event = { target: row, preventDefault() {}, stopPropagation: () => (stopped += 1) };
    row.emit('mousedown', event);
    row.emit('click', event);
    assert.equal(stopped, 2, 'mousedown 与 click 都应阻止冒泡');
  });
});
