/**
 * 设置页的设计尺度与基础层：`--pcg-*` 只留本页独有的间距 / 圆角 / 控件高度，字号与动效改吃跨表面令牌。
 *
 * 为什么还要一层自有变量：`--dsw-*` 只给颜色与个别圆角，间距与字号没有 token，
 * 而本页有 6 个分区、几十个控件，散落的 px 会让「同一层的东西看起来不一样」。
 * 字号档（`--pcg-fs-*`）与动效三档（`--pet-dur-*` / `--pet-ease`）已收敛到 `src/shared/motion-tokens.ts`：
 * 这里只做别名，值不变，六个表面因此共用同一套时长与字号。颜色一律取 `--dsw-*`（见 `./controls` 与 `./cards`）。
 * 基础层同时负责根容器的排版与降级动效：`prefers-reduced-motion` 下把过渡与动画压到最小，
 * 但保留透明度变化——它承载状态反馈，不该跟着动画一起消失；同理，承载状态的位移也必须留着。
 *
 * 排版光学规则（P7，落在有对应字号档的选择器上，不为对称硬加）：
 * - ≥14px 的标题档：`letter-spacing:var(--pet-tracking-title)`（-0.01em，大字默认偏松）；
 * - 11px 的元信息档：`letter-spacing:var(--pet-tracking-meta)`（+0.01em，小字默认偏挤）；
 * - 正文（13px）保持 0：它是连续阅读的主体，加任一方向都会让长句发涩。
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
  // 控件与排版：字号是跨表面令牌的别名（值不变，改令牌即全表面生效）
  '--pcg-ctl-h:28px;--pcg-fs-title:var(--pet-fs-title);--pcg-fs-body:var(--pet-fs-body);',
  '--pcg-fs-label:var(--pet-fs-label);--pcg-fs-meta:var(--pet-fs-meta);',
  '--pcg-leading:20px;',
  // 动效不再在本页定义：--pet-dur-fast / --pet-dur / --pet-ease 由 shared/motion-tokens 注入到 :root。
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
