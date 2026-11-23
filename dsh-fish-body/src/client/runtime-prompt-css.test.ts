/**
 * 运行时缺失弹窗样式（src/client/runtime-prompt-css.ts）的文本契约测试。
 *
 * 弹窗要在任意页面上出现（用户可能正在会话里，桌面窗口却起不来），所以它自带一份极小样式表；
 * 这里钉住两个无障碍档位真的落地，且既有的减少动效档没有被顺手删掉。
 * 假 DOM 只实现本模块用到的成员（与 src/client/settings/css.test.ts 同一范式）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { injectRuntimePromptCss } from './runtime-prompt-css.ts';

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

/** 注入一次并取回样式文本。 */
function injectedCss(doc: FakeDocument): string {
  const tag = doc.head.children.find((el) => el.attrs.get('data-plugin-css') === 'dsh-pet/runtime-prompt.css');
  assert.ok(tag !== undefined, '弹窗样式没有注入');
  return tag.textContent;
}

describe('injectRuntimePromptCss —— 跨表面无障碍档', () => {
  test('减少透明：去毛玻璃并把遮罩底色提到 72%', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectRuntimePromptCss();
      const css = injectedCss(doc);
      assert.match(css, /@media \(prefers-reduced-transparency: reduce\)\{\.dsh-pet-rp__mask\{backdrop-filter:none;/);
      assert.match(css, /var\(--dsw-alias-bg-base,#000\) 72%, transparent/);
      // 系统没开这一档时仍保留 blur：它是「窗口起不来」这张卡的层次来源。
      assert.match(css, /backdrop-filter:blur\(2px\)/);
    } finally {
      restore();
    }
  });

  test('高对比度：卡片描边升到 L3', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectRuntimePromptCss();
      assert.match(
        injectedCss(doc),
        /@media \(prefers-contrast: more\)\{\.dsh-pet-rp\{border-color:var\(--dsw-alias-border-l3\)\}\}/,
      );
    } finally {
      restore();
    }
  });

  test('既有的减少动效档没被顺手删掉', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectRuntimePromptCss();
      assert.match(
        injectedCss(doc),
        /@media \(prefers-reduced-motion: reduce\)\{\.dsh-pet-rp__fill\{transition:none\}\.dsh-pet-rp__btn\{transition:none\}\.dsh-pet-rp__btn:active\{transform:none\}\}/,
      );
    } finally {
      restore();
    }
  });

  test('重复注入只留一个 style；没有 document 不抛', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectRuntimePromptCss();
      injectRuntimePromptCss();
      assert.equal(doc.head.children.length, 1);
    } finally {
      restore();
    }
    assert.doesNotThrow(() => injectRuntimePromptCss());
  });
});
