/**
 * 运行时缺失弹窗的样式：一个自包含的极小样式表（遮罩 + 居中卡片 + 两个按钮组）。
 *
 * 为什么不复用设置页那份：那个样式表是跟着设置页挂载注入的，而这里的弹窗要能在任意页面上出现
 * （用户可能正在会话里，桌面窗口却起不来）。为了一张卡把整份设置页样式拉进每个页面不值得。
 * 用到的颜色变量都是宿主提供的主题令牌，深浅色自动跟随。
 * @module dsh-fish-body/src/client/runtime-prompt-css
 */

/** 注入去重用的标记值，写在 `<style>` 的 `data-plugin-css` 上。 */
const CSS_TAG = 'dsh-pet/runtime-prompt.css';

/** 弹窗样式表。 */
const RUNTIME_PROMPT_CSS = [
  '.dsh-pet-rp__mask{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb, var(--dsw-alias-bg-base,#000) 42%, transparent);backdrop-filter:blur(2px);padding:24px}',
  '.dsh-pet-rp{width:100%;max-width:420px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base,#fff));box-shadow:0 18px 48px color-mix(in srgb,#000 28%,transparent);padding:18px 18px 14px;display:flex;flex-direction:column;gap:10px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
  '.dsh-pet-rp__title{font-size:14px;font-weight:600;letter-spacing:-0.01em}',
  '.dsh-pet-rp__body{color:var(--dsw-alias-label-secondary)}',
  '.dsh-pet-rp__bar{height:4px;border-radius:2px;background:var(--dsw-alias-interactive-bg-active);overflow:hidden}',
  '.dsh-pet-rp__fill{height:100%;border-radius:2px;background:var(--dsw-alias-state-business-primary);transform-origin:left center;transition:transform 240ms ease-out}',
  '.dsh-pet-rp__meta{font-size:12px;color:var(--dsw-alias-label-tertiary);word-break:break-all}',
  '.dsh-pet-rp__acts{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:2px}',
  '.dsh-pet-rp__btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;height:28px;font-size:12px;cursor:pointer;transition:transform 100ms ease-out,background 120ms ease-out}',
  '.dsh-pet-rp__btn:hover{background:var(--dsw-alias-interactive-bg-active)}',
  '.dsh-pet-rp__btn:active{transform:scale(0.97)}',
  '.dsh-pet-rp__btn:disabled{opacity:.5;cursor:default}',
  '.dsh-pet-rp__btn.is-primary{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}',
  '@media (prefers-reduced-motion: reduce){.dsh-pet-rp__fill{transition:none}.dsh-pet-rp__btn{transition:none}.dsh-pet-rp__btn:active{transform:none}}',
].join('\n');

/** 把弹窗样式注入 `document.head`：幂等，且没有 document（SSR / 单测）时直接返回。 */
export function injectRuntimePromptCss(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') !== null) return;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-pet';
  tag.dataset.pluginCss = CSS_TAG;
  tag.textContent = RUNTIME_PROMPT_CSS;
  document.head.appendChild(tag);
}
