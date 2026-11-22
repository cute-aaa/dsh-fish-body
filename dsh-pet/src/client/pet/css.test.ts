/**
 * 宠物页面样式注入（src/client/pet/css.ts）的契约测试。
 *
 * 为什么单独立一份：本轮把提示基类 `TIP_BASE_CSS` 拼进了 `PET_CSS`（计划偏差 1），而这条注入链
 * 此前**没有任何测试**——P1-1「独立页气泡丢定位」正是同一类根因（某个注入点漏带基类）在另一个表面
 * 上的表现。这里把三个约束钉住：
 *
 *   1. 基类必须随宠物页样式走，且只带一份：气泡节点在宠物页也挂 `pet-tip-base`，缺了它
 *      `position:fixed` 与初始 `opacity:0` 一起消失（气泡会变成文档流里的一行字）；
 *   2. 幂等：同一页面重复挂载只留一个 `<style>` 与一个 alpha 修正 `<svg>`；
 *   3. 无 DOM 安全：没有 document 时静默返回。
 *
 * 假 DOM 只实现本模块用到的成员（不引 jsdom）：选择器只支持 `tag` / `tag[attr]` / `tag[attr="v"]`。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { injectPetCss } from './css.ts';

/** 极简元素替身：`dataset` 写回 `data-*` 属性，`setAttribute` 与真实 DOM 一致。 */
class El {
  readonly tag: string;
  readonly attrs = new Map<string, string>();
  readonly children: El[] = [];
  readonly dataset: Record<string, string>;
  readonly style: Record<string, string> = {};
  ownText = '';
  id = '';

  constructor(tag: string) {
    this.tag = tag;
    const name = (key: string): string => 'data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    this.dataset = new Proxy({} as Record<string, string>, {
      set: (_target, key, value: string) => {
        this.attrs.set(name(String(key)), value);
        return true;
      },
      get: (_target, key) => this.attrs.get(name(String(key))),
    });
  }

  get textContent(): string {
    return this.ownText;
  }

  set textContent(value: string) {
    this.ownText = value;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  appendChild(node: El): El {
    this.children.push(node);
    return node;
  }

  querySelector(selector: string): El | null {
    return this.descendants().find((el) => matches(el, selector)) ?? null;
  }

  /** 子孙（不含自己），与真实 DOM 的 querySelector 作用域一致。 */
  descendants(): El[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

/** 支持 `tag` / `[attr]` / `tag[attr]` / `tag[attr="v"]` 四种形态。 */
function matches(el: El, selector: string): boolean {
  const parsed = /^([a-z]*)(?:\[([a-zA-Z-]+)(?:="([^"]*)")?\])?$/.exec(selector);
  if (parsed === null) throw new Error('假 DOM 不支持的 selector：' + selector);
  const [, tag, attr, value] = parsed;
  if (tag !== '' && el.tag !== tag) return false;
  if (attr === undefined) return true;
  const actual = el.attrs.get(attr);
  if (actual === undefined) return false;
  return value === undefined ? true : actual === value;
}

/** 极简 document 替身：head / body / createElement / createElementNS / 顶层 querySelector。 */
class FakeDocument {
  readonly head = new El('head');
  readonly body = new El('body');

  createElement(tag: string): El {
    return new El(tag);
  }

  createElementNS(_ns: string, tag: string): El {
    return new El(tag);
  }

  querySelector(selector: string): El | null {
    return this.head.querySelector(selector) ?? this.body.querySelector(selector);
  }
}

/** 装一套假 DOM，返回 document 与还原函数。 */
function withFakeDom(): { doc: FakeDocument; restore: () => void } {
  const doc = new FakeDocument();
  const previous = globalThis.document;
  (globalThis as { document?: unknown }).document = doc;
  return {
    doc,
    restore: () => {
      (globalThis as { document?: unknown }).document = previous;
    },
  };
}

describe('injectPetCss —— 宠物页样式注入', () => {
  /** 按去重标记取那一个 style（宠物页只有一份，但仍按标记认，避免将来加第二份时错位）。 */
  function styleOf(doc: FakeDocument): El {
    const found = doc.head.children.find((el) => el.attrs.get('data-plugin-css') === 'dsh-pet/style.css');
    assert.ok(found !== undefined, '没有找到 dsh-pet/style.css');
    return found;
  }

  test('首次注入：宠物页样式确实落到 head，关键类名与降级档都在', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectPetCss();
      const tag = styleOf(doc);
      assert.equal(tag.tag, 'style');
      assert.equal(tag.dataset.plugin, 'dsh-pet');
      assert.ok(tag.textContent.includes('.dsh-pet-root{'), '宠物根容器样式必须在');
      assert.ok(tag.textContent.includes('.dsh-pet-hit{'), '命中区样式必须在（拖拽与光标都靠它）');
      assert.ok(tag.textContent.includes('touch-action:none'), '触屏拖拽必需，缺了会被判成滚动');
      assert.ok(tag.textContent.includes('.pet-tooltip{'), '提示外观与桌面端共用同一份');
      assert.doesNotMatch(
        tag.textContent,
        /\.dsh-pet-video\{[^}]*transition/,
        '视频不许再挂 opacity 过渡：两段同时半透明会让合成 alpha 掉到 0.75，换动画时闪一下',
      );
    } finally {
      restore();
    }
  });

  test('提示基类随宠物页样式走：定位/初始透明/显隐过渡齐全，且只带一份', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectPetCss();
      const css = styleOf(doc).textContent;
      assert.ok(
        css.includes('.pet-tip-base{position:fixed;left:0;top:0;pointer-events:none;opacity:0;'),
        '气泡节点挂 pet-tip-base，注入体里必须有它的定位与初始透明（P1-1 同类根因）',
      );
      assert.ok(css.includes('.pet-tip-base.is-on{opacity:1}'), '显隐规则也必须跟着走');
      assert.ok(css.includes('transition:opacity var(--pet-dur-fast,120ms)'), '过渡走令牌并带回落值');
      // 宠物页没有令牌层（计划偏差 10）：基类只能靠回退值，引用宿主变量在这里就是死值
      assert.equal(/--dsw-/.test(css), false, '宠物页不许引用 DSH 宿主变量');
      // 一份注入体里只带一份基类：重复会让排查时误以为有两条来源
      assert.equal(css.split('.pet-tip-base{').length - 1, 1, '.pet-tip-base 在宠物页注入体里只该出现一次');
    } finally {
      restore();
    }
  });

  test('幂等：重复注入只留一份 style 与一个 alpha 修正 svg', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectPetCss();
      injectPetCss();
      injectPetCss();
      assert.equal(doc.head.children.length, 1, '去重标记失效会让样式规则成倍堆积');
      assert.equal(doc.body.children.length, 1, 'alpha 修正 svg 只该有一个');
      const svg = doc.body.querySelector('svg[data-dsh-pet-alpha-fix]');
      assert.ok(svg !== null, 'alpha 修正滤镜必须留在文档里（filter:url(#…) 按同文档 id 解析）');
      assert.ok(
        svg.descendants().some((el) => el.id === 'dsh-pet-alpha-fix'),
        '滤镜 id 与 CSS 引用一致',
      );
      assert.equal(svg.attrs.get('aria-hidden'), 'true', '装饰性 svg 不该进无障碍树');
    } finally {
      restore();
    }
  });

  test('没有 document：静默返回，不抛', () => {
    assert.doesNotThrow(() => injectPetCss(), '无 DOM 环境下注入必须是空操作');
  });
});
