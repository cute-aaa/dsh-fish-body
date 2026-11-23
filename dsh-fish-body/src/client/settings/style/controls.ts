/**
 * 设置页的控件层：字段、输入、按钮、开关、分段标签、chip、滑块，以及两类自绘下拉。
 *
 * 尺寸统一由 `--pcg-`* 决定（控件 28px、圆角 8px），字号与动效取跨表面令牌（`--pet-fs-*` / `--pet-dur-*`），
 * 颜色一律取 `--dsw-*`；悬浮反馈只在 `@media (hover:hover)` 出，避免触屏点一下粘一个 hover 底色；
 * 按下反馈放在 `:active`（`transform:var(--pet-press)`，`--pet-press-dur`），这是本页唯一的「按下去有反应」的手感来源。
 * 焦点环只有一个出口：`box-shadow:var(--pet-focus-ring)`（令牌里的回落链保证桌面端也有色可显）。
 * 下拉浮层（`dsh-pet-mp__*` 模型选择器 / `dsh-pet-sel__*` 通用单选）是既有实现原样搬入：
 * 原生 `<select>` 的展开面板由系统绘制，字号与圆角不受 token 控制，与同排输入框不同源。
 * @module dsh-fish-body/src/client/settings/style/controls
 */

/** 控件层样式：字段 → 输入 → 按钮 → 开关 → 分段标签 → chip → 滑块 → 下拉浮层。 */
export const CONTROLS_CSS = [
  // 字段：标签在上、控件在下；标签行只在真有附加元素（改动点）时多一根。
  '.dsh-pet-cfg__field{display:flex;flex-direction:column;gap:4px;min-width:0}',
  '.dsh-pet-cfg__flabel{display:inline-flex;align-items:center;gap:5px;min-width:0;font-size:var(--pcg-fs-label);line-height:18px;color:var(--dsw-alias-label-secondary)}',
  // 字段说明的宿主：说明本身走 data-tip 气泡（见 ./tip-layer），这里只给可悬浮的标签一点提示感。
  '.dsh-pet-cfg__flabel[data-tip]{cursor:help}',

  '.dsh-pet-cfg__inp{box-sizing:border-box;width:100%;min-height:var(--pcg-ctl-h);padding:3px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--pcg-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--pcg-fs-body);outline:none;transition:border-color var(--pet-dur-fast) var(--pet-ease)}',
  '.dsh-pet-cfg__inp:focus{border-color:var(--dsw-alias-state-business-primary)}',
  '.dsh-pet-cfg__inp:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
  // 人设复用输入框的边框与字号，只补高度与纵向缩放；没有长度上限，右下角只显示字数、不阻断输入。
  '.dsh-pet-cfg__persona{display:flex;flex-direction:column;gap:2px;min-width:0}',
  '.dsh-pet-cfg__area{min-height:62px;resize:vertical;line-height:18px}',
  '.dsh-pet-cfg__count{font-size:var(--pcg-fs-meta);letter-spacing:var(--pet-tracking-meta);color:var(--dsw-alias-label-tertiary);text-align:right}',
  // 只读读数：不能编辑的值（如自动算出的随机动作占比）不该长成输入框。
  '.dsh-pet-cfg__readout{display:inline-flex;align-items:center;min-height:var(--pcg-ctl-h);font-size:var(--pcg-fs-body);color:var(--dsw-alias-label-secondary)}',

  // 按钮：三档变化（描边 / 主色 / 危险）+ 两档尺寸（默认 / sm）+ 一种「文字按钮」。
  '.dsh-pet-cfg__btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:var(--pcg-ctl-h);padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--pcg-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--pcg-fs-label);line-height:18px;white-space:nowrap;cursor:pointer;transition:background var(--pet-dur-fast) var(--pet-ease),border-color var(--pet-dur-fast) var(--pet-ease),transform var(--pet-press-dur) var(--pet-ease)}',
  '@media (hover:hover){.dsh-pet-cfg__btn:hover:not(:disabled):not(.is-primary){background:var(--dsw-alias-interactive-bg-hover)}}',
  '.dsh-pet-cfg__btn:active:not(:disabled){transform:var(--pet-press)}',
  '.dsh-pet-cfg__btn:focus-visible{outline:none;box-shadow:var(--pet-focus-ring)}',
  '.dsh-pet-cfg__btn:disabled{opacity:.5;cursor:default}',
  // 实心主按钮必须排除在通用 hover 外：半透明 hover 会顶掉 button-info-fill，让蓝色按钮一悬停就发白。
  '.dsh-pet-cfg__btn.is-primary{border-color:var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-inverted,var(--dsw-static-neutral-00,#fff))}',
  '@media (hover:hover){.dsh-pet-cfg__btn.is-primary:hover:not(:disabled){border-color:var(--dsw-alias-button-info-hover);background:var(--dsw-alias-button-info-hover)}}',
  '.dsh-pet-cfg__btn.is-danger{border-color:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary)}',
  '.dsh-pet-cfg__btn.is-sm{min-height:24px;padding:0 10px;font-size:var(--pcg-fs-meta);letter-spacing:var(--pet-tracking-meta)}',
  // 文字按钮：列表行里的次要动作（试听 / 打开文件夹），不描边、不吃行高。
  '.dsh-pet-cfg__btn.is-text{min-height:22px;padding:0 6px;border-color:transparent;color:var(--dsw-alias-label-secondary);font-size:var(--pcg-fs-meta);letter-spacing:var(--pet-tracking-meta)}',
  '@media (hover:hover){.dsh-pet-cfg__btn.is-text:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}',

  // 开关：视觉是 34×20 的轨道 + 16 的圆点，语义仍是 checkbox（这些开关随「保存」整包落盘）。
  // 圆点必须是真节点而非 `input::after`：input 是替换元素，伪元素在部分引擎里不生成，
  // 那时开关只剩一条会换色的色条。input 透明铺在轨道正上方，点轨道等于点它，label 不会二次触发。
  '.dsh-pet-cfg__switch{display:flex;align-items:center;min-width:0;font-size:var(--pcg-fs-body);color:var(--dsw-alias-label-primary)}',
  '.dsh-pet-cfg__switch>label{position:relative;display:inline-flex;align-items:center;gap:8px;min-width:0;cursor:pointer}',
  '.dsh-pet-cfg__switch input[type=checkbox]{appearance:none;-webkit-appearance:none;position:absolute;top:50%;left:0;z-index:1;width:34px;height:20px;margin:0;padding:0;border:0;background:transparent;opacity:0;cursor:pointer;transform:translateY(-50%)}',
  '.dsh-pet-cfg__switch input[type=checkbox]:disabled{cursor:default}',
  '.dsh-pet-cfg__swTrack{position:relative;flex:none;box-sizing:border-box;width:34px;height:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--pcg-radius-pill);background:var(--dsw-alias-interactive-bg-hover);transition:background var(--pet-dur-fast) var(--pet-ease),border-color var(--pet-dur-fast) var(--pet-ease),transform var(--pet-press-dur) var(--pet-ease)}',
  // 圆点的垂直居中交给 `margin:auto` 而不是写死 `top`：留白由浏览器按剩余空间平分，
  // 125% / 150% 缩放这种小数像素下也不会一边 1px、一边 2px 地「看着偏上」。
  // 直径 14（内容 12 + 1px 描边）：上下各留 2px 轨道底色，圆点和轨道描边不会再糊成一片。
  '.dsh-pet-cfg__swKnob{position:absolute;top:0;bottom:0;left:2px;width:12px;height:12px;margin:auto 0;border:1px solid var(--dsw-alias-border-l2);border-radius:50%;background:var(--dsw-alias-switch-thumb,var(--dsw-alias-bg-layer-1));transition:transform var(--pet-dur-fast) var(--pet-ease),border-color var(--pet-dur-fast) var(--pet-ease)}',
  '.dsh-pet-cfg__swText{min-width:0;overflow-wrap:anywhere}',
  '@media (hover:hover){.dsh-pet-cfg__switch>label:hover>input[type=checkbox]:not(:disabled)+.dsh-pet-cfg__swTrack{border-color:var(--dsw-alias-border-l3)}}',
  // 按下反馈：整条轨道轻微内缩，与按钮的 `:active` 同一档手感（缩放值是控件内部细则，不进按钮档）。
  '.dsh-pet-cfg__switch>label:active>.dsh-pet-cfg__swTrack{transform:scale(.96)}',
  '.dsh-pet-cfg__switch input[type=checkbox]:checked+.dsh-pet-cfg__swTrack{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
  '.dsh-pet-cfg__switch input[type=checkbox]:checked+.dsh-pet-cfg__swTrack>.dsh-pet-cfg__swKnob{transform:translateX(14px);border-color:var(--dsw-alias-state-business-primary)}',
  '.dsh-pet-cfg__switch input[type=checkbox]:disabled+.dsh-pet-cfg__swTrack,.dsh-pet-cfg__switch input[type=checkbox]:disabled~.dsh-pet-cfg__swText{opacity:.45}',
  '.dsh-pet-cfg__switch input[type=checkbox]:focus-visible+.dsh-pet-cfg__swTrack{box-shadow:var(--pet-focus-ring)}',
  // 父开关关掉时，从属开关整块降透明：一眼看出「这一组现在不生效」，而不是逐个阅读禁用原因。
  '.dsh-pet-cfg__switch.is-muted>label{opacity:.45}',

  // 分段标签（顶层分区）：一条轨道 + 选中块；窄容器改横向滚动，不折成三行。
  '.dsh-pet-cfg__seg{display:flex;align-items:center;gap:2px;box-sizing:border-box;width:100%;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);overflow-x:auto;scrollbar-width:none}',
  '.dsh-pet-cfg__seg::-webkit-scrollbar{display:none}',
  '.dsh-pet-cfg__segItem{display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:1 0 auto;min-width:70px;height:26px;padding:0 12px;border:none;border-radius:var(--pcg-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--pcg-fs-body);line-height:var(--pcg-leading);white-space:nowrap;cursor:pointer;transition:background var(--pet-dur-fast) var(--pet-ease),color var(--pet-dur-fast) var(--pet-ease)}',
  '@media (hover:hover){.dsh-pet-cfg__segItem:hover:not(.is-active){color:var(--dsw-alias-label-primary)}}',
  '.dsh-pet-cfg__segItem.is-active{background:var(--dsw-alias-button-ghost-active-fill,var(--dsw-alias-bg-layer-1));box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:500}',
  '.dsh-pet-cfg__segItem:focus-visible{outline:none;box-shadow:var(--pet-focus-ring)}',

  // 实例 chip：第二层选择，视觉上比分段标签更轻（胶囊、细描边）。
  '.dsh-pet-cfg__chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;flex:1 1 auto}',
  '.dsh-pet-cfg__chip{display:inline-flex;align-items:center;max-width:220px;height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--pcg-radius-pill);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--pcg-fs-label);line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;transition:background var(--pet-dur-fast) var(--pet-ease),border-color var(--pet-dur-fast) var(--pet-ease),color var(--pet-dur-fast) var(--pet-ease)}',
  '@media (hover:hover){.dsh-pet-cfg__chip:hover:not(.is-active){border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}}',
  '.dsh-pet-cfg__chip.is-active{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:500}',
  '.dsh-pet-cfg__chip.is-add{border-style:dashed;color:var(--dsw-alias-label-secondary)}',
  '.dsh-pet-cfg__chip:focus-visible{outline:none;box-shadow:var(--pet-focus-ring)}',

  // 滑块：原生 range 在各家 Chromium 里外观差很多，只统一高度与强调色。
  '.dsh-pet-cfg__range{width:100%;height:var(--pcg-ctl-h);accent-color:var(--dsw-alias-button-info-fill);cursor:pointer}',
  '.dsh-pet-cfg__range:disabled{cursor:default;opacity:.5}',
  // 大小：滑块吃满剩余宽度，数字框定宽放右边做精确输入（462 这类值滑块对不准）。
  '.dsh-pet-cfg__sizeRow{display:flex;align-items:center;gap:10px;min-width:0;flex:1 1 auto}',
  '.dsh-pet-cfg__sizeRow>.dsh-pet-cfg__range{flex:1;min-width:0;width:auto}',
  '.dsh-pet-cfg__sizeRow>input[type=number]{width:88px;flex:none}',

  // 卡头问号：整页只剩这一种说明入口（字段说明走 data-tip + aria-description）。
  '.dsh-pet-cfg__q{display:inline-flex;align-items:center;justify-content:center;flex:none;width:14px;height:14px;border:1px solid var(--dsw-alias-label-tertiary);border-radius:50%;color:var(--dsw-alias-label-tertiary);font-size:10px;font-style:normal;line-height:1;cursor:help;user-select:none}',
  '.dsh-pet-cfg__qWrap{display:inline-flex;flex:none;align-items:center}',
  // 悬浮说明气泡：由 ./tip-layer 按光标挂到 body 上，不画在触发元素里（贴边会被裁掉）。
  // 定位、初始透明与过渡在 shared/tooltip 的基类（pet-tip-base）里；本类只留设置页的外观差异。
  '.pet-cfg-tip{z-index:2147483000;max-width:320px;padding:6px 10px;border-radius:var(--pcg-radius-sm);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-00);font-size:var(--pcg-fs-label);font-style:normal;font-weight:400;line-height:18px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}',

  // 模型选择器（dsh-pet-mp__*）：触发器沿用输入框外观，浮层 fixed 脱离设置页的滚动容器。
  '.dsh-pet-mp{position:relative;min-width:0;display:flex;flex-direction:column;gap:4px}',
  '.dsh-pet-mp__trigger{display:flex;align-items:center;gap:6px;width:100%;min-height:var(--pcg-ctl-h);padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--pcg-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:var(--pcg-fs-body);line-height:20px;text-align:left;cursor:pointer;outline:none}',
  '.dsh-pet-mp__trigger:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}',
  '.dsh-pet-mp__trigger:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:var(--pet-focus-ring)}',
  '.dsh-pet-mp__trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.dsh-pet-mp__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
  '.dsh-pet-mp__sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex-shrink:1000;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary))}',
  '.dsh-pet-mp__chevron{flex:none;margin-left:auto;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));transition:transform var(--pet-dur-fast)}',
  '.dsh-pet-mp__chevron.is-open{transform:rotate(180deg)}',
  '.dsh-pet-mp__panel{position:fixed;z-index:2147483000;display:flex;flex-direction:column;gap:4px;padding:4px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--pcg-radius);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary)}',
  '.dsh-pet-mp__search{box-sizing:border-box;width:100%;height:var(--pcg-ctl-h);padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--pcg-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:var(--pcg-fs-body);outline:none}',
  '.dsh-pet-mp__search:focus{border-color:var(--dsw-alias-state-business-primary)}',
  // overflow-x 必须显式 hidden：只设 overflow-y 时 CSS 会把另一轴抬成 auto，条目 width:100% 会多出 16px。
  '.dsh-pet-mp__list{display:flex;flex-direction:column;min-height:0;overflow-x:hidden;overflow-y:auto;scrollbar-width:thin}',
  '.dsh-pet-mp__group{padding:6px 8px 2px;font-size:var(--pcg-fs-meta);letter-spacing:var(--pet-tracking-meta);line-height:16px;color:var(--dsw-alias-label-tertiary)}',
  '.dsh-pet-mp__item,.dsh-pet-sel__item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;border-radius:var(--pcg-radius-sm);background:transparent;color:inherit;font:inherit;font-size:var(--pcg-fs-body);line-height:20px;text-align:left;cursor:pointer}',
  '.dsh-pet-mp__item:hover:not(:disabled),.dsh-pet-mp__item.is-active,.dsh-pet-sel__item:hover:not(:disabled),.dsh-pet-sel__item.is-active{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh-pet-mp__item:disabled,.dsh-pet-sel__item:disabled,.dsh-pet-sel__item.is-disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.dsh-pet-mp__name,.dsh-pet-sel__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
  // 置灰原因（缺权重/缺参考音频）：贴在名称右侧，与右键菜单的 hint 同义。
  '.dsh-pet-sel__hint{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--pcg-fs-meta);letter-spacing:var(--pet-tracking-meta);line-height:16px;color:var(--dsw-alias-label-tertiary)}',
  '.dsh-pet-mp__check,.dsh-pet-sel__check{flex:none;margin-left:auto}',
  '.dsh-pet-mp__status{padding:8px;font-size:var(--pcg-fs-label);line-height:18px;color:var(--dsw-alias-label-tertiary)}',

  // 通用单选下拉（dsh-pet-sel__*）：触发器叠加在输入框外观之上，浮层与模型选择器同一套。
  '.dsh-pet-sel{position:relative;min-width:0}',
  '.dsh-pet-sel__trigger{display:flex;align-items:center;gap:6px;text-align:left;cursor:pointer}',
  '.dsh-pet-sel__trigger:disabled{cursor:default}',
  // 箭头用小三角而不是字符：不依赖字体，旋转时的基线与折叠卡一致。
  '.dsh-pet-sel__chevron{flex:none;margin-left:auto;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;color:var(--dsw-alias-label-tertiary);transition:transform var(--pet-dur-fast)}',
  '.dsh-pet-sel__chevron.is-open{transform:rotate(180deg)}',
  '.dsh-pet-sel__panel{position:fixed;z-index:2147483000;display:flex;flex-direction:column;gap:2px;padding:4px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--pcg-radius);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary)}',
  '.dsh-pet-sel__list{display:flex;flex-direction:column;min-height:0;overflow-x:hidden;overflow-y:auto;scrollbar-width:thin}',
  '.dsh-pet-sel__item[aria-selected="true"],.dsh-pet-mp__item[aria-checked="true"]{color:var(--dsw-alias-state-business-primary)}',

  // 设置搜索：输入框一行（计数贴右），搜索态下结果列表替掉分区面板。
  '.dsh-pet-cfg__search{display:flex;align-items:center;gap:8px;min-width:0}',
  '.dsh-pet-cfg__searchInp{box-sizing:border-box;flex:1 1 auto;min-width:0;height:var(--pcg-ctl-h);padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--pcg-radius-pill);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--pcg-fs-body);outline:none;transition:border-color var(--pet-dur-fast) var(--pet-ease)}',
  '.dsh-pet-cfg__searchInp:focus{border-color:var(--dsw-alias-state-business-primary)}',
  // 原生清除按钮的宽度不受本页 token 控制，只让它跟文字同色，别在深色主题里变成一个亮白叉。
  '.dsh-pet-cfg__searchInp::-webkit-search-cancel-button{cursor:pointer;filter:grayscale(1);opacity:.6}',
  '.dsh-pet-cfg__searchCount{flex:none;min-width:20px;font-size:var(--pcg-fs-meta);letter-spacing:var(--pet-tracking-meta);line-height:16px;text-align:right;color:var(--dsw-alias-label-tertiary)}',
  // 结果列表按内容高度走（不写 min-height:0）：宿主容器是固定高度时，列方向 flex 会把 0 基准的
  // 子项压扁，行被裁掉且看不出来；上限 60vh 只是防止 40 条结果把整页顶出去。
  '.dsh-pet-cfg__searchList{display:flex;flex-direction:column;gap:2px;max-height:60vh;overflow-y:auto;scrollbar-width:thin}',
  '.dsh-pet-cfg__searchRow{display:flex;align-items:baseline;gap:8px;width:100%;padding:6px 8px;border:none;border-radius:var(--pcg-radius-sm);background:transparent;color:inherit;font:inherit;font-size:var(--pcg-fs-body);line-height:20px;text-align:left;cursor:pointer}',
  '@media (hover:hover){.dsh-pet-cfg__searchRow:hover{background:var(--dsw-alias-interactive-bg-hover)}}',
  '.dsh-pet-cfg__searchRow.is-active{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh-pet-cfg__searchRow:focus-visible{outline:none;box-shadow:var(--pet-focus-ring)}',
  // 路径（分区 › 卡片）与值都收窄：一行里最重要的一直是中间那个名称。
  '.dsh-pet-cfg__searchPath{flex:none;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--pcg-fs-meta);letter-spacing:var(--pet-tracking-meta);color:var(--dsw-alias-label-tertiary)}',
  '.dsh-pet-cfg__searchName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-pet-cfg__searchValue{flex:none;max-width:42%;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--pcg-fs-meta);letter-spacing:var(--pet-tracking-meta);color:var(--dsw-alias-label-tertiary)}',
  // 命中高亮：点结果跳过去之后短暂标出「搜到的是这几项」，到点自己摘掉（见 search.ts）。
  '.dsh-pet-cfg .is-search-hit{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:var(--pcg-radius-sm)}',
].join('\n');
