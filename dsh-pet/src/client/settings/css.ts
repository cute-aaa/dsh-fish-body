/**
 * 设置页样式表与注入入口：三段拼成一份（尺度 `./style/tokens`、控件 `./style/controls`、容器 `./style/cards`）。
 *
 * 为什么拆三段而不是一个大字符串：三者变化原因不同——调间距字号只动 tokens，换控件外观只动 controls，
 * 重排卡片与栅格只动 cards；本文件只负责「按顺序拼好并注入一次」。
 * 注入按 `data-plugin-css` 去重，同一页面重复渲染设置页不会长第二份样式；没有 document 时静默返回。
 * @module dsh-pet/src/client/settings/css
 */
import { CARDS_CSS } from './style/cards.ts';
import { CONTROLS_CSS } from './style/controls.ts';
import { TOKENS_CSS } from './style/tokens.ts';

/** 设置页样式表：顺序即层叠顺序（尺度 → 控件 → 容器）。 */
const SETTINGS_CSS = [TOKENS_CSS, CONTROLS_CSS, CARDS_CSS].join('\n');

/** 注入去重用的标记值，写在 `<style>` 的 `data-plugin-css` 上。 */
const settingsCssTag = 'dsh-pet/settings.css';

/** 把设置页样式注入 `document.head`：幂等，且没有 document（SSR 或单测）时直接返回。 */
export function injectSettingsCss(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector('style[data-plugin-css="' + settingsCssTag + '"]') !== null) return;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-pet';
  tag.dataset.pluginCss = settingsCssTag;
  tag.textContent = SETTINGS_CSS;
  document.head.appendChild(tag);
}
