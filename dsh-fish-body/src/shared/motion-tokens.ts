/**
 * 跨表面的动效与尺度令牌：六个 UI 表面共用一套时长、缓动、按下反馈、焦点环与字号档。
 *
 * 为什么放共享层：设置页过去有 `--pcg-dur-*`，会话鱼与对话面板各自写字面值
 * （`.12s` 与宿主的 `--ds-transition-duration-fast`），三处一旦分别演进就成了「同一插件里两种手感」。
 * 变量前缀 `--pet-` 是插件自有命名（与桌面 Helper 的 `--pet-size` 不同名，不撞车）。
 * 落在 `:root` 而不是各表面根类：仓库没有 Shadow DOM，三个表面同处一个 DSH 页面，
 * 各写一份会立刻分叉，`:root` 是唯一一处定义。
 *
 * 注入不随卸载移除：它是页面级常量，摘掉会让已渲染的过渡瞬间失去时长（值回落到浏览器默认 0s）。
 * 不含 `src/shared/index.ts` 的导出：那是桌面 shared-core 的打包入口，CSS 文本对 Helper 没有用处。
 * @module dsh-fish-body/src/shared/motion-tokens
 */

/** 注入去重标记，写在 `<style>` 的 `data-plugin-css` 上。 */
export const UI_TOKENS_TAG = 'dsh-pet/ui-tokens';

/**
 * 令牌块：一个 `:root` 声明块，15 个变量。
 *
 * 取值口径：
 * - 时长三档 120 / 160 / 240ms（反馈 / 位移 / 强调），缓动沿用设置页现值；
 * - 按下反馈拆成两个变量：一个自定义属性只能装一个值槽，`transform` 与 `transition-duration` 无法共用；
 * - 阴影两个值等于会话鱼现状的字面量，因此即使只删注入调用，外观也不会回退（只是失去可调性）；
 * - `--dsw-*` 只出现在焦点环的回落链里：它只存在于 DSH 页面，桌面 Helper 页没有，必须给存活值。
 */
export const UI_TOKENS_CSS = [
  ':root{',
  '--pet-dur-fast:120ms;--pet-dur:160ms;--pet-dur-slow:240ms;',
  '--pet-ease:cubic-bezier(.2,.7,.3,1);',
  '--pet-press:scale(.98);--pet-press-dur:80ms;',
  '--pet-focus-ring:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));',
  '--pet-fs-title:14px;--pet-fs-body:13px;--pet-fs-label:12px;--pet-fs-meta:11px;',
  '--pet-tracking-title:-0.01em;--pet-tracking-meta:0.01em;',
  '--pet-shadow-sprite:drop-shadow(0 3px 4px rgba(0,0,0,.22));',
  '--pet-shadow-bubble:0 6px 20px rgba(0,0,0,.14)',
  '}',
].join('');

/**
 * 注入令牌层：幂等，没有 document（SSR / 单测）时静默返回。
 *
 * 三个表面各自的注入器各调一次即可；重复调用只留一个 `<style>`。
 */
export function injectUiTokens(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector('style[data-plugin-css="' + UI_TOKENS_TAG + '"]') !== null) return;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-pet';
  tag.dataset.pluginCss = UI_TOKENS_TAG;
  tag.textContent = UI_TOKENS_CSS;
  document.head.appendChild(tag);
}
