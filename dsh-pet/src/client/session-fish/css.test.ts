/**
 * 会话鱼样式（src/client/session-fish/css.ts）的文本契约测试。
 *
 * 会话鱼没有浏览器 E2E 夹具，观感回归只能靠文本断言 + 真机截图；这里钉住「已经令牌化」这件事：
 * 字面时长与 rgba 阴影不许留在样式里（改令牌即全表面生效），而档位微动画的时长与曲线必须原样保留
 * （bob 3.4s / wag .5s / pulse 1.8s / hop 1.1s / shake .42s 是动画语义本身，token 化就是改手感）。
 * 假 DOM 只实现本模块用到的成员（与 src/client/settings/css.test.ts 同一范式）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { injectSessionFishCss } from './css.ts';

/** 极简元素替身：`dataset` 写回 `data-*` 属性，与真实 DOM 一致。 */
class El {
  readonly tag: string;
  readonly attrs = new Map<string, string>();
  readonly children: El[] = [];
  readonly dataset: Record<string, string>;
  ownText = '';

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

  appendChild(node: El): void {
    this.children.push(node);
  }

  querySelector(selector: string): El | null {
    return this.children.flatMap((child) => [child, ...child.children]).find((el) => matches(el, selector)) ?? null;
  }
}

/** 支持 `tag` / `[attr]` / `[attr="v"]` 三种形态。 */
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

/** 极简 document 替身。 */
class FakeDocument {
  readonly head = new El('head');

  createElement(tag: string): El {
    return new El(tag);
  }

  querySelector(selector: string): El | null {
    return this.head.querySelector(selector);
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

/** 注入一次并取回会话鱼那份样式文本。 */
function injectedCss(doc: FakeDocument): string {
  const tag = doc.head.children.find((el) => el.attrs.get('data-plugin-css') === 'dsh-pet/session-fish');
  assert.ok(tag !== undefined, '会话鱼样式没有注入');
  return tag.textContent;
}

describe('injectSessionFishCss —— 令牌化', () => {
  test('会话鱼样式与令牌层各注入一份，重复调用不再增加', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectSessionFishCss();
      injectSessionFishCss();
      injectSessionFishCss();
      assert.equal(doc.head.children.length, 2, '令牌层 + 会话鱼各一份');
      assert.ok(
        doc.head.children.some((el) => el.attrs.get('data-plugin-css') === 'dsh-pet/ui-tokens'),
        '令牌层必须一起落地，否则 var(--pet-*) 全是空值',
      );
    } finally {
      restore();
    }
  });

  test('字面时长全部换掉：不再出现 .12s / .16s / .26s', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectSessionFishCss();
      const css = injectedCss(doc);
      for (const literal of ['.12s', '.16s', '.26s']) {
        assert.equal(css.includes(literal), false, '过渡与 pop/bump 应改用令牌：' + literal);
      }
      assert.ok(css.includes('transition:transform var(--pet-dur-fast) var(--pet-ease)'), '悬停缩放走令牌');
      assert.ok(css.includes('animation:dsh-session-fish-pop var(--pet-dur) var(--pet-ease)'), 'pop 走令牌');
      assert.ok(css.includes('animation:dsh-session-fish-bump var(--pet-dur-slow) var(--pet-ease)'), 'bump 走令牌');
    } finally {
      restore();
    }
  });

  test('字号与两道阴影换令牌，样式里不再有 rgba（阴影唯一来源在令牌层）', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectSessionFishCss();
      const css = injectedCss(doc);
      assert.equal(css.includes('rgba('), false, '阴影不该再写字面色值');
      assert.ok(css.includes('filter:var(--pet-shadow-sprite)'), '鱼身与 SVG 回落共用一道阴影');
      assert.ok(css.includes('box-shadow:var(--pet-shadow-bubble)'), '气泡阴影走令牌');
      assert.ok(css.includes('font-size:var(--pet-fs-meta)'), '11px 档走令牌');
      assert.ok(css.includes('font-size:var(--pet-fs-label)'), '12px 档走令牌');
    } finally {
      restore();
    }
  });

  test('档位微动画原样保留：时长与曲线是动画语义，不 token 化', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectSessionFishCss();
      const css = injectedCss(doc);
      for (const literal of [
        'dsh-session-fish-bob 3.4s ease-in-out infinite',
        'animation-duration:2.6s',
        'dsh-session-fish-bob .9s ease-in-out infinite',
        'dsh-session-fish-wag .5s ease-in-out infinite',
        'dsh-session-fish-pulse 1.8s ease-in-out infinite',
        'dsh-session-fish-hop 1.1s ease-out 2',
        'dsh-session-fish-shake .42s ease-in-out 3',
      ]) {
        assert.ok(css.includes(literal), '动画语义被改动：' + literal);
      }
      assert.equal((css.match(/@keyframes /g) ?? []).length, 7, '七组关键帧一个不少');
    } finally {
      restore();
    }
  });

  test('降级与触屏块原样保留', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectSessionFishCss();
      const css = injectedCss(doc);
      assert.ok(css.includes('@media (hover: none)'), '触屏没有 hover，× 必须常驻');
      assert.match(css, /@media \(prefers-reduced-motion: reduce\)\{[\s\S]*animation:none!important/);
    } finally {
      restore();
    }
  });

  test('没有 document：静默返回，不抛', () => {
    assert.doesNotThrow(() => injectSessionFishCss());
  });
});
