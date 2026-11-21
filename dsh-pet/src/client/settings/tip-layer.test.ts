/**
 * 设置页说明气泡（src/client/settings/tip-layer.ts）的契约测试。
 *
 * 钉住四件事：命中 `data-tip` 才出气泡；贴边时坐标被夹回视口（这正是伪元素方案丢字的原因）；
 * 离开、滚动、按下都收起；拆掉之后监听与节点一个不剩，重新装上能再工作。
 *
 * 假 DOM 只实现本模块用到的成员（不引 jsdom）：class 用 Set 表示，`style` 是普通对象，
 * 元素没有排版，宽高直接给定值。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { attachTipLayer } from './tip-layer.ts';

/** 极简元素替身：`parent` 与 `remove()` 连通，用来验证「挂到 body / 从 body 摘掉」。 */
class FakeEl {
  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly style: Record<string, string> = {};
  readonly children: FakeEl[] = [];
  parent: FakeEl | null = null;
  textContent = '';
  /** 假 DOM 没有排版：给固定宽高，摆位计算才有真实尺寸可用（对齐那条 150 字说明的量级）。 */
  offsetWidth = 300;
  offsetHeight = 120;

  get parentNode(): FakeEl | null {
    return this.parent;
  }

  get classList(): {
    add: (name: string) => void;
    remove: (name: string) => void;
    contains: (name: string) => boolean;
  } {
    const classes = this.classes;
    return {
      add: (name) => void classes.add(name),
      remove: (name) => void classes.delete(name),
      contains: (name) => classes.has(name),
    };
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  appendChild(el: FakeEl): void {
    el.parent = this;
    this.children.push(el);
  }

  removeChild(el: FakeEl): void {
    const index = this.children.indexOf(el);
    if (index >= 0) this.children.splice(index, 1);
    el.parent = null;
  }

  remove(): void {
    this.parent?.removeChild(this);
  }
}

/** 极简事件目标：记录监听，`fire()` 模拟一次派发。 */
class FakeTarget {
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const bucket = this.listeners.get(type) ?? new Set<(event: unknown) => void>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** 该类型当前挂着的监听数（用来验证卸载时确实摘干净、重复装没叠加）。 */
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  fire(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

/** 极简 window 替身 + 视口尺寸。 */
class FakeWindow extends FakeTarget {
  innerWidth = 1280;
  innerHeight = 800;
}

/** 极简 document 替身。 */
class FakeDocument extends FakeTarget {
  readonly body = new FakeEl();

  createElement(): FakeEl {
    return new FakeEl();
  }
}

/** 假触发元素：`closest` 返回自身，因此「同一元素」判定靠对象身份成立。 */
interface FakeTrigger {
  getAttribute: (name: string) => string | null;
  closest: (selector: string) => FakeTrigger | null;
}

function fakeTrigger(text: string | null): FakeTrigger {
  const node: FakeTrigger = {
    getAttribute: (name) => (name === 'data-tip' ? text : null),
    closest: () => node,
  };
  return node;
}

/** 装一套假全局，返回 document 与还原函数。 */
function withFakeDom(): { doc: FakeDocument; restore: () => void } {
  const doc = new FakeDocument();
  const win = new FakeWindow();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  (globalThis as { document?: unknown }).document = doc;
  (globalThis as { window?: unknown }).window = win;
  return {
    doc,
    restore: () => {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    },
  };
}

/** 一次悬停事件：光标位置 + 事件目标。 */
function hover(target: unknown, x = 100, y = 100): { target: unknown; clientX: number; clientY: number } {
  return { target, clientX: x, clientY: y };
}

/** 当前挂在 body 上的气泡（class 里带 pet-cfg-tip 那一个；基类 pet-tip-base 也在同一串里）。 */
function bubbles(doc: FakeDocument): FakeEl[] {
  return doc.body.children.filter((el) => (el.attrs.get('class') ?? '').split(' ').includes('pet-cfg-tip'));
}

describe('attachTipLayer —— 说明气泡', () => {
  test('悬停到带 data-tip 的元素：气泡挂在 body 上，正文与显隐就位', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      doc.fire('pointerover', hover(fakeTrigger('对话配图张数上限的说明')));
      const bubble = bubbles(doc);
      assert.equal(bubble.length, 1, '气泡应该挂在 body 上（设置页内容区是滚动容器，挂在里面会被裁掉）');
      assert.equal(bubble[0].attrs.get('class'), 'pet-tip-base pet-cfg-tip', '基类提供定位与显隐，本类提供外观');
      assert.equal(bubble[0].attrs.get('role'), 'tooltip');
      assert.equal(bubble[0].textContent, '对话配图张数上限的说明');
      assert.equal(bubble[0].classList.contains('is-on'), true);
    } finally {
      detach();
      restore();
    }
  });

  test('悬停到没有 data-tip 的元素：不出气泡', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      doc.fire('pointerover', hover({ closest: () => null }));
      assert.equal(bubbles(doc).length, 0);
    } finally {
      detach();
      restore();
    }
  });

  test('右缘：光标贴右边时气泡翻到光标左侧，整块仍在视口内', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      // 1270 + 10 + 300 越过 1280，翻到左侧：1270 - 10 - 300 = 960
      doc.fire('pointerover', hover(fakeTrigger('说明'), 1270, 400));
      const bubble = bubbles(doc)[0];
      assert.equal(bubble.style.left, '960px');
      assert.ok(Number.parseInt(bubble.style.left, 10) + 300 <= 1280, '右边缘不能伸出视口');
    } finally {
      detach();
      restore();
    }
  });

  test('底缘：光标贴底时气泡翻到光标上方，整块仍在视口内', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      // 790 + 10 + 120 越过 800，翻到上方：790 - 10 - 120 = 660
      doc.fire('pointerover', hover(fakeTrigger('说明'), 400, 790));
      const bubble = bubbles(doc)[0];
      assert.equal(bubble.style.top, '660px');
      assert.ok(Number.parseInt(bubble.style.top, 10) + 120 <= 800, '下边缘不能伸出视口');
    } finally {
      detach();
      restore();
    }
  });

  test('光标离开：只摘显隐，元素留着复用（悬停频繁，反复建删会闪）', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      const trigger = fakeTrigger('说明');
      doc.fire('pointerover', hover(trigger));
      doc.fire('pointerout', { target: trigger, relatedTarget: null });
      assert.equal(bubbles(doc).length, 1);
      assert.equal(bubbles(doc)[0].classList.contains('is-on'), false);
    } finally {
      detach();
      restore();
    }
  });

  test('光标移进触发元素自己的子节点：不算离开，气泡不闪', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      const trigger = fakeTrigger('说明');
      doc.fire('pointerover', hover(trigger));
      // 子节点的 closest 仍指向同一个触发元素
      doc.fire('pointerout', { target: { closest: () => trigger }, relatedTarget: trigger });
      assert.equal(bubbles(doc)[0].classList.contains('is-on'), true);
    } finally {
      detach();
      restore();
    }
  });

  test('滚动或被按下：气泡立刻收起（fixed 定位不会跟着内容走，留着就错位）', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      doc.fire('pointerover', hover(fakeTrigger('说明')));
      doc.fire('scroll', {});
      assert.equal(bubbles(doc)[0].classList.contains('is-on'), false);

      doc.fire('pointerover', hover(fakeTrigger('说明')));
      doc.fire('pointerdown', {});
      assert.equal(bubbles(doc)[0].classList.contains('is-on'), false);
    } finally {
      detach();
      restore();
    }
  });

  test('滚动/按下收起后，同一元素再进入仍会重新出气泡（收起通知回流到记账）', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      const trigger = fakeTrigger('说明');
      doc.fire('pointerover', hover(trigger));
      doc.fire('scroll', {});
      assert.equal(bubbles(doc)[0].classList.contains('is-on'), false);
      // 在同一元素内再派发（没有 pointerout）：记账没被作废的话，这里会被「同一元素」判据挡掉、气泡不再出现
      doc.fire('pointerover', hover(trigger));
      assert.equal(bubbles(doc)[0].classList.contains('is-on'), true);
    } finally {
      detach();
      restore();
    }
  });

  test('同一触发元素内重复派发：只摆一次，不重复换位', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      const trigger = fakeTrigger('说明');
      doc.fire('pointerover', hover(trigger, 100, 100));
      doc.fire('pointerover', hover(trigger, 600, 600));
      assert.equal(bubbles(doc)[0].style.left, '110px');
    } finally {
      detach();
      restore();
    }
  });
});

describe('attachTipLayer —— 安装与拆除', () => {
  test('装上只挂「谁触发」两条监听；收起监听由共享控制器单出口登记，拆掉后一条不剩', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      assert.equal(doc.count('pointerover'), 1);
      assert.equal(doc.count('pointerout'), 1);
      // 页面侧不再挂 scroll/pointerdown：收起由 shared/tooltip 的控制器负责，同一事件只有一次 hide
      assert.equal(doc.count('pointerdown'), 0);
      assert.equal(doc.count('scroll'), 0);

      doc.fire('pointerover', hover(fakeTrigger('说明')));
      assert.equal(doc.count('scroll'), 1, '气泡建出来后收起监听由控制器挂且只挂一份');
      assert.equal(doc.count('pointerdown'), 1);

      detach();
      assert.equal(bubbles(doc).length, 0, '气泡应该从 body 上摘掉');
      for (const type of ['pointerover', 'pointerout', 'pointerdown', 'scroll']) {
        assert.equal(doc.count(type), 0, type + ' 监听应该摘干净');
      }
    } finally {
      restore();
    }
  });

  test('重复安装：返回同一个拆除函数，监听不叠加', () => {
    const { doc, restore } = withFakeDom();
    const first = attachTipLayer();
    try {
      const second = attachTipLayer();
      assert.equal(second, first);
      assert.equal(doc.count('pointerover'), 1);
    } finally {
      first();
      restore();
    }
  });

  test('拆掉之后再装：仍能工作，不是一次性', () => {
    const { doc, restore } = withFakeDom();
    const first = attachTipLayer();
    first();
    const second = attachTipLayer();
    try {
      doc.fire('pointerover', hover(fakeTrigger('说明')));
      assert.equal(bubbles(doc).length, 1);
    } finally {
      second();
      restore();
    }
  });

  test('aria-description 契约不变：气泡不碰触发元素的 ARIA 属性', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      // data-tip 是视觉说明，aria-description 是可读名；气泡只读 data-tip，绝不回写触发元素。
      const attrs = new Map<string, string>([
        ['data-tip', '说明'],
        ['aria-description', '同一句话的可读名'],
      ]);
      interface Node {
        getAttribute: (name: string) => string | null;
        closest: (selector: string) => Node | null;
        setAttribute: (name: string, value: string) => void;
        removeAttribute: (name: string) => void;
      }
      const node: Node = {
        getAttribute: (name) => attrs.get(name) ?? null,
        closest: () => node,
        setAttribute: (name, value) => void attrs.set(name, value),
        removeAttribute: (name) => void attrs.delete(name),
      };
      doc.fire('pointerover', hover(node));
      assert.equal(attrs.get('aria-description'), '同一句话的可读名');
      assert.equal(attrs.get('data-tip'), '说明');
    } finally {
      detach();
      restore();
    }
  });
});
