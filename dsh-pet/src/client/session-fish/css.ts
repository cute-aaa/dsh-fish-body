/**
 * 会话鱼浮层与设置页预览的样式：只放行内样式表达不了的东西（动画、伪类、指针事件、裁剪）。
 *
 * 颜色一律用 `--dsw-*` token；层容器整片 click-through，只有鱼本体、气泡与 × 重新打开指针事件，
 * 所以它不会挡住下面的侧栏与输入框。注入按 `data-plugin-css` 去重。
 * @module dsh-pet/src/client/session-fish/css
 */

/** 注入去重标记。 */
const CSS_TAG = 'dsh-pet/session-fish';

/** 样式全文：浮层布局、气泡、鱼身配色与按档位的微动画。 */
const SESSION_FISH_CSS = [
  // ===== 浮层：整屏坐标层，鱼由运动引擎逐帧写 transform（left/top 必须归零，否则绝对定位会按静态位置堆叠） =====
  '.dsh-session-fish-layer{position:fixed;inset:0;z-index:30;pointer-events:none;overflow:hidden}',
  '.dsh-session-fish{position:absolute;left:0;top:0;pointer-events:none;user-select:none;touch-action:none;',
  'will-change:transform}',
  '.dsh-session-fish__open{position:relative;display:block;width:100%;height:100%;pointer-events:auto;',
  'border:0;background:transparent;padding:0;margin:0;cursor:grab;line-height:0;border-radius:8px;',
  'touch-action:none;transition:transform .12s ease}',
  '.dsh-session-fish__open:hover{transform:scale(1.03)}',
  '.dsh-session-fish.is-dragging .dsh-session-fish__open{cursor:grabbing;transform:scale(1.05)}',
  // 撞到别的鱼 / 桌宠时压一下：挤压比位移更容易被看见，也不会打乱引擎算出的位置。
  '.dsh-session-fish.is-bumping .dsh-session-fish__open{animation:dsh-session-fish-bump .26s ease-out}',
  '.dsh-session-fish__open:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}',
  '.dsh-session-fish__close{pointer-events:auto;position:absolute;top:-8px;right:-8px;width:16px;height:16px;',
  'border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);z-index:3;',
  'color:var(--dsw-alias-label-secondary);border-radius:50%;font-size:11px;line-height:14px;padding:0;',
  'display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity .12s ease}',
  '.dsh-session-fish:hover .dsh-session-fish__close,.dsh-session-fish__close:focus-visible{opacity:1}',
  '.dsh-session-fish__close:hover{color:var(--dsw-alias-state-error-primary);',
  'border-color:var(--dsw-alias-state-error-primary)}',
  // ===== 小动画 =====
  '.dsh-session-fish__video{display:block;width:100%;height:100%;object-fit:contain;background:transparent;',
  'pointer-events:none;filter:drop-shadow(0 3px 4px rgba(0,0,0,.22))}',
  '.dsh-session-fish__mediaFallback{display:flex;align-items:center;justify-content:center;pointer-events:none}',
  // ===== 气泡：默认在鱼左侧；鱼靠屏幕左边时翻到右侧 =====
  '.dsh-session-fish__bubble{position:absolute;right:calc(100% + 10px);bottom:0;pointer-events:auto;',
  'max-width:230px;min-width:88px;padding:7px 10px 8px;z-index:1;',
  'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
  'border:1px solid var(--dsw-alias-border-l1);border-radius:12px;',
  'box-shadow:0 6px 20px rgba(0,0,0,.14);font-size:12px;line-height:1.45;',
  'animation:dsh-session-fish-pop .16s ease-out}',
  '.dsh-session-fish.is-flipped .dsh-session-fish__bubble{right:auto;left:calc(100% + 10px)}',
  '.dsh-session-fish__title{display:flex;align-items:center;gap:4px;font-weight:600;font-size:11px;',
  'color:var(--dsw-alias-label-secondary);margin-bottom:2px}',
  '.dsh-session-fish__titleText{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-session-fish__done{color:var(--dsw-alias-state-success-primary);font-weight:700}',
  '.dsh-session-fish__line{word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;',
  '-webkit-box-orient:vertical;overflow:hidden}',
  '.dsh-session-fish__state{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}',
  // ===== SVG 回落与设置页预览 =====
  '.dsh-session-fish__sprite{display:block;filter:drop-shadow(0 3px 4px rgba(0,0,0,.22))}',
  '.dsh-session-fish__body,.dsh-session-fish__fin{fill:var(--dsw-alias-brand-primary)}',
  '.dsh-session-fish__tail{fill:var(--dsw-alias-brand-primary);opacity:.78}',
  '.dsh-session-fish__belly{fill:var(--dsw-alias-bg-layer-1);opacity:.85}',
  '.dsh-session-fish__eye{fill:var(--dsw-alias-bg-layer-1)}',
  '.dsh-session-fish__pupil{fill:var(--dsw-alias-bg-base)}',
  '.dsh-session-fish__gill{fill:none;stroke:var(--dsw-alias-bg-layer-1);stroke-width:1.4;',
  'stroke-linecap:round;opacity:.7}',
  // ===== 档位微动画 =====
  '.dsh-session-fish__sprite.is-idle,.dsh-session-fish__sprite.is-thinking{animation:dsh-session-fish-bob 3.4s ease-in-out infinite}',
  '.dsh-session-fish__sprite.is-thinking{animation-duration:2.6s}',
  '.dsh-session-fish__sprite.is-working{animation:dsh-session-fish-bob .9s ease-in-out infinite}',
  '.dsh-session-fish__sprite.is-working .dsh-session-fish__tail,',
  '.dsh-session-fish__sprite.is-thinking .dsh-session-fish__tail{',
  'transform-box:fill-box;transform-origin:left center;animation:dsh-session-fish-wag .5s ease-in-out infinite}',
  '.dsh-session-fish__sprite.is-result{animation:dsh-session-fish-bob 1.6s ease-in-out infinite}',
  '.dsh-session-fish__sprite.is-waiting{animation:dsh-session-fish-pulse 1.8s ease-in-out infinite}',
  '.dsh-session-fish__sprite.is-success{animation:dsh-session-fish-hop 1.1s ease-out 2}',
  '.dsh-session-fish__sprite.is-error{animation:dsh-session-fish-shake .42s ease-in-out 3}',
  '.dsh-session-fish__sprite.is-still{animation:none}',
  // ===== 设置页预览 =====
  '.dsh-session-fish-preview{display:flex;align-items:center;gap:10px;padding:10px 12px;',
  'border:1px dashed var(--dsw-alias-border-l1);border-radius:10px}',
  '.dsh-session-fish__icon{display:inline-flex;align-items:center;justify-content:center;line-height:0}',
  '.dsh-session-fish__icon.is-active{filter:drop-shadow(0 0 4px var(--dsw-alias-brand-primary))}',
  // ===== keyframes =====
  '@keyframes dsh-session-fish-bob{0%,100%{transform:translateY(1px)}50%{transform:translateY(-3px)}}',
  '@keyframes dsh-session-fish-wag{0%,100%{transform:rotate(6deg)}50%{transform:rotate(-9deg)}}',
  '@keyframes dsh-session-fish-pulse{0%,100%{opacity:1}50%{opacity:.55}}',
  '@keyframes dsh-session-fish-hop{0%{transform:translateY(0)}35%{transform:translateY(-9px)}',
  '70%{transform:translateY(0)}85%{transform:translateY(-3px)}100%{transform:translateY(0)}}',
  '@keyframes dsh-session-fish-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}',
  '75%{transform:translateX(3px)}}',
  '@keyframes dsh-session-fish-pop{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
  '@keyframes dsh-session-fish-bump{0%{transform:scale(1)}35%{transform:scale(.86)}70%{transform:scale(1.06)}',
  '100%{transform:scale(1)}}',
  // 触屏没有 hover：× 必须常驻，否则看得见鱼、摸不到关闭按钮。
  '@media (hover: none){.dsh-session-fish__close{opacity:1}}',
  '@media (prefers-reduced-motion: reduce){.dsh-session-fish__sprite,.dsh-session-fish__tail,',
  '.dsh-session-fish__bubble,.dsh-session-fish__open{animation:none!important}}',
].join('');

/** 注入一次；重复挂载不会重复插入。 */
export function injectSessionFishCss(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') !== null) return;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-pet';
  tag.dataset.pluginCss = CSS_TAG;
  tag.textContent = SESSION_FISH_CSS;
  document.head.appendChild(tag);
}
