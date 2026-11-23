/**
 * 动效与尺度令牌（src/shared/motion-tokens.ts）的契约测试。
 *
 * 钉住三件事：15 个变量名与值齐全（少一个就是某个表面悄悄回落到字面值）；阴影值等于会话鱼现状的字面量
 * （改值会直接改观感）；令牌层对宿主只依赖焦点环回落链上的两个 `--dsw-*`（多一个就把桌面 Helper 页拽下水）。
 * 假 DOM 只实现本模块用到的成员（与 src/client/settings/css.test.ts 同一范式）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { injectUiTokens, UI_TOKENS_CSS, UI_TOKENS_TAG } from './motion-tokens.ts';

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

/** 极简 document 替身：只提供 head、createElement 与顶层 querySelector。 */
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

/** 从令牌块里解出 `--pet-*` 变量 → 值（值里可能还带括号与逗号）。 */
function petVars(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.matchAll(/(--pet-[a-z-]+):([^;}]+)/g)) found.set(match[1]!, match[2]!.trim());
  return found;
}

/** 令牌块里出现过的全部宿主变量名。 */
function hostVars(css: string): string[] {
  return [...new Set([...css.matchAll(/--dsw-[a-z-]+/g)].map((match) => match[0]))].sort();
}

describe('UI_TOKENS_CSS —— 令牌集合', () => {
  test('15 个变量齐全，且只有这一个 :root 声明块', () => {
    const vars = petVars(UI_TOKENS_CSS);
    assert.deepEqual(
      [...vars.keys()].sort(),
      [
        '--pet-dur',
        '--pet-dur-fast',
        '--pet-dur-slow',
        '--pet-ease',
        '--pet-focus-ring',
        '--pet-fs-body',
        '--pet-fs-label',
        '--pet-fs-meta',
        '--pet-fs-title',
        '--pet-press',
        '--pet-press-dur',
        '--pet-shadow-bubble',
        '--pet-shadow-sprite',
        '--pet-tracking-meta',
        '--pet-tracking-title',
      ],
      '变量集变了就要同步改消费点，不能只加不减',
    );
    assert.equal(UI_TOKENS_CSS.match(/:root\{/g)?.length, 1, '令牌层只能有一个 :root 块');
  });

  test('时长、缓动、按下反馈与字号档取设计值', () => {
    const vars = petVars(UI_TOKENS_CSS);
    assert.equal(vars.get('--pet-dur-fast'), '120ms');
    assert.equal(vars.get('--pet-dur'), '160ms');
    assert.equal(vars.get('--pet-dur-slow'), '240ms');
    assert.equal(vars.get('--pet-ease'), 'cubic-bezier(.2,.7,.3,1)');
    assert.equal(vars.get('--pet-press'), 'scale(.98)');
    assert.equal(vars.get('--pet-press-dur'), '80ms');
    assert.equal(vars.get('--pet-fs-title'), '14px');
    assert.equal(vars.get('--pet-fs-body'), '13px');
    assert.equal(vars.get('--pet-fs-label'), '12px');
    assert.equal(vars.get('--pet-fs-meta'), '11px');
    assert.equal(vars.get('--pet-tracking-title'), '-0.01em');
    assert.equal(vars.get('--pet-tracking-meta'), '0.01em');
  });

  test('两道阴影等于会话鱼现状的字面量（改值就是改观感）', () => {
    const vars = petVars(UI_TOKENS_CSS);
    assert.equal(vars.get('--pet-shadow-sprite'), 'drop-shadow(0 3px 4px rgba(0,0,0,.22))');
    assert.equal(vars.get('--pet-shadow-bubble'), '0 6px 20px rgba(0,0,0,.14)');
  });

  test('焦点环带存活值：优先宿主的 --dsw-focus-ring-color，缺了就回落主色', () => {
    const vars = petVars(UI_TOKENS_CSS);
    assert.equal(
      vars.get('--pet-focus-ring'),
      '0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))',
    );
  });

  test('对宿主的依赖只有焦点环回落链上的那两个变量', () => {
    assert.deepEqual(hostVars(UI_TOKENS_CSS), ['--dsw-alias-state-business-primary', '--dsw-focus-ring-color']);
  });
});

describe('injectUiTokens —— 注入', () => {
  test('首次注入：head 里出现一个带 dsh-pet 标记的 style', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectUiTokens();
      assert.equal(doc.head.children.length, 1, '应只注入一个 style');
      const [tag] = doc.head.children;
      assert.equal(tag.tag, 'style');
      assert.equal(tag.dataset.plugin, 'dsh-pet');
      assert.equal(tag.dataset.pluginCss, UI_TOKENS_TAG);
      assert.equal(tag.textContent, UI_TOKENS_CSS);
    } finally {
      restore();
    }
  });

  test('重复注入：第二、三次调用都不再插入 style', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectUiTokens();
      injectUiTokens();
      injectUiTokens();
      assert.equal(doc.head.children.length, 1, '三个表面各调一次也只能留一份');
    } finally {
      restore();
    }
  });

  test('没有 document：静默返回，不抛', () => {
    assert.doesNotThrow(() => injectUiTokens(), '无 DOM 环境下注入必须是空操作');
  });
});
