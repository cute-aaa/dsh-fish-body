/**
 * 对话面板样式（src/client/chat/panel-css.ts）的文本契约测试。
 *
 * 面板没有浏览器 E2E 夹具（见执行计划「验证与验收」），键盘可达与按下反馈只能靠文本断言 + 3099 真机走查。
 * 这里钉住三件容易在后续改动里悄悄丢掉的事：
 *   1. 四类控件（tab / tool / send / attach）都有焦点环与按下反馈，且过渡里带 transform；
 *   2. 过渡一律走跨表面令牌，不再引用宿主的 `--ds-transition-*`（值不受本插件控制）；
 *   3. 减少动效只压过渡、不压 animation（转圈是状态反馈，压掉就成了「看上去卡住」）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PANEL_CSS } from './panel-css.ts';
import { TIP_BASE_CSS } from '../../shared/tooltip.ts';

/** 取一条规则的声明体；找不到就返回空串（断言会因此失败并指出是哪条）。 */
function bodyOf(selector: string): string {
  for (const variant of [selector, selector + ':not(:disabled)']) {
    const pattern = new RegExp(variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
    const body = pattern.exec(PANEL_CSS)?.[1];
    if (body !== undefined) return body;
  }
  return '';
}

/** 四类可点控件。 */
const CONTROLS = ['.pet-chat-tab', '.pet-chat-tool', '.pet-chat-send', '.pet-chat-attach'];

describe('PANEL_CSS —— 过渡令牌化', () => {
  test('不再引用宿主的过渡变量', () => {
    assert.equal(PANEL_CSS.includes('--ds-transition-duration-fast'), false, '时长应改走 --pet-dur-*');
    assert.equal(PANEL_CSS.includes('--ds-ease-in-out'), false, '缓动应改走 --pet-ease');
  });

  test('每条过渡都走插件令牌：无字面时长、无宿主变量', () => {
    // 断言意图是「过渡全部令牌化」而不是「至少多少处」：新增过渡也不能回头写字面值。
    // 令牌的回落值（var(--pet-dur-fast,120ms)）不算字面时长——它只在令牌层缺席时才生效，先剥掉再判。
    const declarations = [...PANEL_CSS.matchAll(/transition:\s*([^;}]*)/g)].map((m) => m[1] ?? '');
    assert.ok(declarations.length >= 10, '没扫到过渡声明，正则或样式结构变了');
    for (const value of declarations) {
      const bare = value.replace(/var\(--[\w-]+,[^)]*\)/g, 'var(--tok)').trim();
      assert.equal(/\d+(\.\d+)?m?s/.test(bare), false, '过渡里还有字面时长：' + bare);
      assert.equal(/var\(--dsw?-/.test(bare), false, '过渡不该引用宿主变量：' + bare);
      assert.match(value, /var\(--pet-/, '过渡应该走插件令牌：' + value.trim());
    }
    assert.ok(PANEL_CSS.includes('opacity var(--pet-dur)'), '播报/动作按钮的 0.15s 应换成 160ms 档');
  });
});

describe('PANEL_CSS —— 焦点环与按下反馈', () => {
  for (const selector of CONTROLS) {
    test(`${selector}：焦点环走令牌，按下有内缩`, () => {
      const focus = bodyOf(selector + ':focus-visible');
      assert.match(focus, /outline:\s*none/, `${selector} 的焦点环不该用方形 outline`);
      assert.match(focus, /box-shadow:\s*var\(--pet-focus-ring\)/, `${selector} 缺焦点环`);
      const active = bodyOf(selector + ':active');
      assert.match(active, /transform:\s*var\(--pet-press\)/, `${selector} 缺按下反馈`);
    });
  }

  test('四类控件的 transition 都带 transform（否则按下是硬切）', () => {
    for (const selector of CONTROLS) {
      assert.match(
        bodyOf(selector),
        /transition:[\s\S]*transform var\(--pet-press-dur\) var\(--pet-ease\)/,
        selector + ' 的过渡里缺 transform 档',
      );
    }
  });
});

describe('PANEL_CSS —— 降级档与提示基类', () => {
  test('减少动效：只压 transition，不压 animation（转圈必须还在转）', () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(PANEL_CSS)?.[1] ?? '';
    assert.match(block, /transition-duration:\s*1ms !important/);
    assert.match(block, /transition-delay:\s*0ms !important/);
    assert.equal(block.includes('animation-duration'), false, '压掉 animation 会让生成中的转圈停住');
  });

  test('高对比度：宠物气泡补一圈 L3 描边', () => {
    assert.match(
      PANEL_CSS,
      /@media \(prefers-contrast: more\) \{\s*\.pet-chat-msg\.is-pet \.pet-chat-bubble \{\s*border: 1px solid var\(--dsw-alias-border-l3\);/,
    );
  });

  test('自带提示基类：只拼 PANEL_CSS 的页面也有气泡定位与显隐', () => {
    // 独立模式设置页（src/standalone/settings-page/style.ts）只把 PANEL_CSS 拼进 /standalone-ai/settings.css，
    // 不经过宠物页与桌面 Helper 的任何注入路径。基类必须跟着 PANEL_CSS 走，否则气泡会掉进正常文档流、
    // 首次悬停后常驻页面并截获点击（定位/显隐已从 .pet-chat-tip 移进基类）。
    assert.ok(PANEL_CSS.startsWith(TIP_BASE_CSS), '基类必须拼在面板样式之前（后者覆盖外观，前者提供布局）');
    const base = bodyOf('.pet-tip-base');
    assert.match(base, /position:\s*fixed/, '基类提供定位');
    assert.match(base, /opacity:\s*0/, '基类提供初始透明');
    assert.match(base, /pointer-events:\s*none/, '气泡不该吃指针事件');
    assert.ok(PANEL_CSS.includes('.pet-tip-base.is-on{opacity:1}'), '显隐用的 is-on 规则也要跟着走');
  });

  test('.pet-chat-tip 只留差异项：定位与显隐交给 pet-tip-base', () => {
    const tip = bodyOf('.pet-chat-tip');
    assert.equal(tip.includes('position: fixed'), false, '定位由基类提供');
    assert.equal(tip.includes('opacity'), false, '显隐由基类提供');
    assert.match(tip, /max-width/, '最大宽是面板侧的差异项');
    assert.match(tip, /--dsw-font-xxs-12/, '字号是面板侧的差异项');
  });

  test('转圈动画仍然存在（降级块不许删它）', () => {
    assert.ok(PANEL_CSS.includes('animation: pet-chat-spin 0.8s linear infinite'));
    assert.ok(PANEL_CSS.includes('@keyframes pet-chat-spin'));
  });
});
