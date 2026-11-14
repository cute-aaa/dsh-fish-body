/**
 * 设置页的设计尺度与基础层：`--pcg-*` 是本页自己的间距 / 圆角 / 字号 / 时长变量。
 *
 * 为什么还要一层自有变量：`--dsw-*` 只给颜色与个别圆角，间距与字号没有 token，
 * 而本页有 6 个分区、几十个控件，散落的 px 会让「同一层的东西看起来不一样」。
 * 这里只定义尺度与关键帧，颜色一律取 `--dsw-*`（见 `./controls` 与 `./cards`）。
 * 基础层同时负责根容器的排版与降级动效：`prefers-reduced-motion` 下把过渡与动画压到最小，
 * 但保留透明度变化——它承载状态反馈，不该跟着动画一起消失；同理，承载状态的位移也必须留着。
 * @module dsh-fish-body/src/client/settings/style/tokens
 */

/**
 * 根容器变量 + 关键帧 + 动效降级。
 *
 * 尺度约定：4 / 8 / 12 / 16 的间距节奏；控件 28px 高、8px 圆角；卡片 12px 圆角。
 */
export const TOKENS_CSS = [
  '.dsh-pet-cfg{',
  // 间距与圆角
  '--pcg-gap:12px;--pcg-gap-sm:8px;--pcg-pad-y:14px;--pcg-pad-x:16px;',
  '--pcg-radius:12px;--pcg-radius-sm:8px;--pcg-radius-pill:999px;',
  // 控件与排版
  '--pcg-ctl-h:28px;--pcg-fs-title:14px;--pcg-fs-body:13px;--pcg-fs-label:12px;--pcg-fs-meta:11px;',
  '--pcg-leading:20px;',
  // 动效：反馈类 120ms，位移类 160ms，同一缓动曲线
  '--pcg-dur-fast:120ms;--pcg-dur:160ms;--pcg-ease:cubic-bezier(.2,.7,.3,1);',
  'container-type:inline-size;display:flex;flex-direction:column;gap:var(--pcg-gap);',
  'color:var(--dsw-alias-label-primary);font-size:var(--pcg-fs-body);line-height:var(--pcg-leading)',
  '}',
  // 分区内容入场：只动透明度与位移，和分段标签的选中反馈同源。
  '@keyframes pcg-enter{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
  '@keyframes pcg-fade{from{opacity:0}to{opacity:1}}',
  // 降级：动画与过渡压到 1ms（保留 opacity 的终值），不删规则——删了会让部分状态停在起止帧之间。
  // **不要在这里加 `transform:none!important`**：位移在有些控件里承载的是**状态**而不是动画
  // （开关圆点就靠 `translateX` 站到蓝区右侧）。一刀切会把「开」和「关」画成同一个样子，
  // 而过渡时长已经是 1ms，本来就不会动。
  '@media (prefers-reduced-motion:reduce){',
  '.dsh-pet-cfg *,.dsh-pet-cfg *::before,.dsh-pet-cfg *::after{',
  'animation-duration:1ms!important;animation-delay:0ms!important;transition-duration:1ms!important',
  '}',
  '}',
].join('\n');
