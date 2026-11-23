/**
 * 设置页样式注入（src/client/settings/css.ts）的契约测试。
 *
 * 两条契约：
 *   1. 幂等：同一页面反复渲染设置页只留一个 `<style>`，去重标记打在 `data-plugin-css` 上；
 *   2. 无 DOM 安全：没有 document（SSR 或纯单测环境）时静默返回，不让设置页整页崩掉。
 *
 * 假 DOM 只实现本模块用到的成员（不引 jsdom）：选择器只支持 `tag` / `[attr]` / `[attr="v"]` 三种形态。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { injectSettingsCss } from './css.ts';

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
    // 读写都走属性表：真实 DOM 里 dataset 就是 data-* 的视图，模块写完标记后查重读的是同一份。
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

/**
 * 取出样式表里所有**顶层**规则的选择器。
 *
 * 顶层 = 不在 `@media` / `@container` 里的规则块；嵌套块里的同名类是媒体查询的
 * 刻意覆盖（窄屏折行、高对比度档），不算重复定义。
 *
 * @param css - 样式表全文。
 * @returns 顶层选择器列表（已按逗号拆开）。
 */
function topLevelSelectors(css: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (char === '{') {
      if (depth === 0) {
        const selector = css.slice(start, index).trim();
        // `@media` / `@container` 自身不算选择器：它里面的规则在深度 > 0 处，已被跳过。
        if (!selector.startsWith('@')) {
          for (const part of selector.split(',')) selectors.push(part.trim());
        }
      }
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) start = index + 1;
    }
  }
  return selectors;
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

describe('injectSettingsCss —— 设置页样式注入', () => {
  /** 按去重标记取那一个 style：令牌层也在 head 里，不能按下标认。 */
  function styleOf(doc: FakeDocument, pluginCss: string): El {
    const found = doc.head.children.find((el) => el.attrs.get('data-plugin-css') === pluginCss);
    assert.ok(found !== undefined, '没有找到 ' + pluginCss);
    return found;
  }

  test('首次注入：head 里出现令牌层与设置页两份 style，两族类名都在', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectSettingsCss();
      assert.equal(doc.head.children.length, 2, '令牌层 + 设置页各一份');
      const tag = styleOf(doc, 'dsh-pet/settings.css');
      assert.equal(tag.tag, 'style');
      assert.equal(tag.dataset.plugin, 'dsh-pet');
      assert.ok(tag.textContent.includes('.dsh-pet-mp__trigger'), '模型选择器的样式必须在');
      assert.ok(tag.textContent.includes('.dsh-pet-cfg__inp'), '配置卡片表单的样式必须在');
      assert.ok(tag.textContent.includes('.dsh-pet-cfg__bar{'), '底部操作栏必须贴底常显');
      assert.ok(tag.textContent.includes('.dsh-pet-cfg__seg{'), '分区标签条的样式必须在');
      assert.ok(tag.textContent.includes('.dsh-pet-cfg__switch input[type=checkbox]'), '开关视觉的样式必须在');
      assert.ok(tag.textContent.includes('.dsh-pet-cfg__dot{'), '未保存改动的圆点样式必须在');
      // 降级块只能压时长：位移在开关里承载的是状态，一刀切 transform 会把「开」和「关」画成同一个样子。
      assert.equal(
        /prefers-reduced-motion[\s\S]*?transform:none/.test(tag.textContent),
        false,
        'prefers-reduced-motion 不许写 transform:none',
      );
    } finally {
      restore();
    }
  });

  test('动效不再由本页定义：pcg-dur / pcg-ease 已删，改用跨表面令牌', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectSettingsCss();
      const tag = styleOf(doc, 'dsh-pet/settings.css');
      assert.equal(tag.textContent.includes('--pcg-dur'), false, '时长档应只剩 --pet-dur-*');
      assert.equal(tag.textContent.includes('--pcg-ease'), false, '缓动应只剩 --pet-ease');
      assert.ok(tag.textContent.includes('var(--pet-dur-fast)'), '过渡要真的用上令牌');
      assert.ok(tag.textContent.includes('var(--pet-ease)'), '缓动要真的用上令牌');
    } finally {
      restore();
    }
  });

  test('焦点环只有一个出口：六处都写 var(--pet-focus-ring)，没有内联拼串', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectSettingsCss();
      const tag = styleOf(doc, 'dsh-pet/settings.css');
      assert.ok(tag.textContent.includes('box-shadow:var(--pet-focus-ring)'), '焦点环走令牌');
      assert.equal(tag.textContent.includes('0 0 0 2px var(--dsw-focus-ring-color'), false, '内联副本应全部收敛到令牌');
    } finally {
      restore();
    }
  });

  test('高对比度档：卡片边界升到 L3', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectSettingsCss();
      const tag = styleOf(doc, 'dsh-pet/settings.css');
      assert.match(
        tag.textContent,
        /@media \(prefers-contrast: more\)\{\.dsh-pet-cfg__card\{border-color:var\(--dsw-alias-border-l3\)\}\}/,
      );
    } finally {
      restore();
    }
  });

  test('重复注入：第二、三次调用都不再插入 style', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectSettingsCss();
      injectSettingsCss();
      injectSettingsCss();
      assert.equal(doc.head.children.length, 2, '去重标记失效会重复插入，样式规则成倍堆积');
    } finally {
      restore();
    }
  });

  test('没有 document：静默返回，不抛', () => {
    assert.doesNotThrow(() => injectSettingsCss(), '无 DOM 环境下注入必须是空操作');
  });
});

describe('注入后的样式表 —— 顶层类名不重复', () => {
  /** 注入一份样式表并取回全文。 */
  function injectedCss(): string {
    const { doc, restore } = withFakeDom();
    try {
      injectSettingsCss();
      const tag = doc.head.children.find((el) => el.attrs.get('data-plugin-css') === 'dsh-pet/settings.css');
      assert.ok(tag !== undefined, '设置页样式表没有注入');
      return tag!.ownText;
    } finally {
      restore();
    }
  }

  test('同一个顶层类只定义一次：重复会让后一条悄悄改掉前一条的布局', () => {
    const css = injectedCss();
    const seen = new Map<string, number>();
    for (const selector of topLevelSelectors(css)) {
      const match = /^\.dsh-pet-cfg__([A-Za-z0-9_-]+)$/.exec(selector);
      if (match === null) continue;
      seen.set(match[1], (seen.get(match[1]) ?? 0) + 1);
    }
    const duplicated = [...seen].filter(([, count]) => count > 1).map(([name, count]) => name + ' x' + count);
    assert.deepEqual(duplicated, [], '顶层重复定义的类：' + duplicated.join(', '));
  });

  test('音效槽那一行是竖排（主体在上、元信息在下）', () => {
    const css = injectedCss();
    assert.match(css, /\.dsh-pet-cfg__row\{[^}]*flex-direction:column/, '列表行必须是竖排');
  });

  test('字段级的一行走自己的类名：横排，不与列表行共用', () => {
    const css = injectedCss();
    assert.match(css, /\.dsh-pet-cfg__fieldRow\{[^}]*display:flex/, '字段行要有自己的样式');
    assert.doesNotMatch(css, /\.dsh-pet-cfg__fieldRow\{[^}]*flex-direction:column/, '字段行是横排');
  });
  test('导入清单里的 id 是等宽单行文本，不再借用列表行的类名', () => {
    const css = injectedCss();
    assert.match(
      css,
      /\.dsh-pet-cfg__impMeta>\.dsh-pet-cfg__rowMain\{[^}]*text-overflow:ellipsis/,
      '导入清单的 id 仍要能省略号截断',
    );
  });
});
