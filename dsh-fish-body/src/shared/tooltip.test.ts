/**
 * 提示气泡（src/shared/tooltip.ts）的契约测试：基类只放两端共用的布局、控制器只建一个节点并可回收。
 *
 * 基类不能带 `--dsw-*`：桌面 Helper 页没有宿主变量，写进去就是死值（白底黑字那套外观仍留在 TOOLTIP_CSS）。
 * 控制器是设置页与对话面板的共同实现，这里钉住「连续 show 只建一个节点、滚动即收、回收摘干净」。
 * 假 DOM 只实现本模块用到的成员（与 src/client/settings/tip-layer.test.ts 同一范式）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createTipBubble, TIP_BASE_CLASS, TIP_BASE_CSS, TOOLTIP_CSS } from './tooltip.ts';

/** 极简元素替身：`parent` 与 `remove()` 连通，`classList` 用 Set 表示。 */
class FakeEl {
  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly style: Record<string, string> = {};
  readonly children: FakeEl[] = [];
  parent: FakeEl | null = null;
  textContent = '';
  /** 假 DOM 没有排版：给固定宽高，摆位计算才有真实尺寸可用。 */
  offsetWidth = 80;
  offsetHeight = 26;

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
  readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const bucket = this.listeners.get(type) ?? new Set<() => void>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
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

/** 装一套假全局，返回 document / window 与还原函数。 */
function withFakeDom(): { doc: FakeDocument; win: FakeWindow; restore: () => void } {
  const doc = new FakeDocument();
  const win = new FakeWindow();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  (globalThis as { document?: unknown }).document = doc;
  (globalThis as { window?: unknown }).window = win;
  return {
    doc,
    win,
    restore: () => {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    },
  };
}

describe('TIP_BASE_CSS —— 两端共用的布局', () => {
  test('只放相同语义的布局：固定定位、初始透明、显隐与过渡', () => {
    assert.ok(TIP_BASE_CSS.includes('.' + TIP_BASE_CLASS + '{'));
    assert.ok(TIP_BASE_CSS.includes('position:fixed;left:0;top:0;pointer-events:none;opacity:0'));
    assert.ok(TIP_BASE_CSS.includes('.pet-tip-base.is-on{opacity:1}'));
    assert.ok(TIP_BASE_CSS.includes('var(--pet-dur-fast,120ms)'), '时长走令牌并带回退值');
    assert.ok(TIP_BASE_CSS.includes('var(--pet-ease,ease)'), '缓动走令牌并带回退值');
  });

  test('不含任何宿主变量：桌面 Helper 页没有 --dsw-*', () => {
    assert.equal(TIP_BASE_CSS.includes('--dsw-'), false, '基类一旦引用宿主变量，桌面端就是死值');
  });

  test('不含层级、字号与最大宽：三处各不相同，留给各自的类', () => {
    for (const word of ['z-index', 'font-size', 'max-width']) {
      assert.equal(TIP_BASE_CSS.includes(word), false, '基类不许带 ' + word);
    }
  });

  test('宠物侧的 TOOLTIP_CSS 不再重复基类已有的定位与显隐', () => {
    assert.equal(TOOLTIP_CSS.includes('position:fixed'), false);
    assert.equal(TOOLTIP_CSS.includes('opacity:0'), false);
    assert.equal(TOOLTIP_CSS.includes('pointer-events:none'), false);
    assert.ok(TOOLTIP_CSS.includes('z-index:2'), '层级是宠物侧的差异项，留在自己的类里');
  });
});

describe('createTipBubble —— 控制器', () => {
  test('连续 show 三次只建一个节点，class 同时带基类与专属类', () => {
    const { doc, restore } = withFakeDom();
    const tip = createTipBubble({ className: 'pet-cfg-tip', gapPx: 10 });
    try {
      tip.show('第一句', { x: 100, y: 100 });
      tip.show('第二句', { x: 200, y: 100 });
      tip.show('第三句', { x: 300, y: 100 });
      assert.equal(doc.body.children.length, 1, '反复建删会让气泡闪，必须复用同一个节点');
      const [node] = doc.body.children;
      assert.equal(node.attrs.get('class'), TIP_BASE_CLASS + ' pet-cfg-tip');
      assert.equal(node.attrs.get('role'), 'tooltip');
      assert.equal(node.textContent, '第三句');
      assert.equal(node.style.left, '310px');
      assert.equal(node.style.top, '110px');
    } finally {
      tip.dispose();
      restore();
    }
  });

  test('贴右下角：翻到光标左上，整块仍在视口内', () => {
    const { doc, restore } = withFakeDom();
    const tip = createTipBubble({ className: 'pet-chat-tip', gapPx: 10 });
    try {
      tip.show('贴边的那一句', { x: 1270, y: 790 });
      const [node] = doc.body.children;
      assert.equal(node.style.left, '1180px');
      assert.equal(node.style.top, '754px');
    } finally {
      tip.dispose();
      restore();
    }
  });

  test('hide 只摘显隐，元素留着复用', () => {
    const { doc, restore } = withFakeDom();
    const tip = createTipBubble({ className: 'pet-chat-tip', gapPx: 10 });
    try {
      tip.show('第一句', { x: 100, y: 100 });
      tip.hide();
      assert.equal(doc.body.children.length, 1);
      assert.equal(doc.body.children[0].classList.contains('is-on'), false);
    } finally {
      tip.dispose();
      restore();
    }
  });

  test('滚动与按下都收起（fixed 定位不会跟着内容走，留着就错位）', () => {
    const { doc, restore } = withFakeDom();
    const tip = createTipBubble({ className: 'pet-chat-tip', gapPx: 10 });
    try {
      tip.show('第一句', { x: 100, y: 100 });
      doc.fire('scroll');
      assert.equal(doc.body.children[0].classList.contains('is-on'), false, '滚动应收起');

      tip.show('第二句', { x: 100, y: 100 });
      doc.fire('pointerdown');
      assert.equal(doc.body.children[0].classList.contains('is-on'), false, '按下应收起');
    } finally {
      tip.dispose();
      restore();
    }
  });

  test('dispose：节点与监听都摘掉，之后还能再用', () => {
    const { doc, restore } = withFakeDom();
    const tip = createTipBubble({ className: 'pet-chat-tip', gapPx: 10 });
    try {
      tip.show('第一句', { x: 100, y: 100 });
      assert.equal(doc.count('scroll'), 1);
      assert.equal(doc.count('pointerdown'), 1);
      tip.dispose();
      assert.equal(doc.body.children.length, 0, '节点应摘掉');
      assert.equal(doc.count('scroll'), 0);
      assert.equal(doc.count('pointerdown'), 0);

      tip.show('第二句', { x: 100, y: 100 });
      assert.equal(doc.body.children.length, 1, '回收只是摘，不是停用');
      assert.equal(doc.count('scroll'), 1, '监听不能重复叠加');
    } finally {
      tip.dispose();
      restore();
    }
  });

  test('两份控制器互不干扰：各建一个节点、各收各的', () => {
    const { doc, restore } = withFakeDom();
    const left = createTipBubble({ className: 'pet-cfg-tip', gapPx: 10 });
    const right = createTipBubble({ className: 'pet-chat-tip', gapPx: 10 });
    try {
      left.show('设置页', { x: 100, y: 100 });
      right.show('面板', { x: 100, y: 200 });
      assert.equal(doc.body.children.length, 2);
      left.hide();
      assert.equal(right === left, false);
      assert.equal(doc.body.children[1].classList.contains('is-on'), true, '收起一个不该动另一个');
    } finally {
      left.dispose();
      right.dispose();
      restore();
    }
  });
});
