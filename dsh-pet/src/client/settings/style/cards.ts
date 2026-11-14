/**
 * 设置页的容器层：卡片、卡头、小节、说明、栅格、列表行、折叠、头像、底部栏、弹窗、加载条。
 *
 * 层级只靠三样东西表达：卡片边界（1px 描边 + 12px 圆角）、卡片内小节之间的 1px 分隔线、字重与色阶。
 * 不叠阴影、不做玻璃、不给每个块都套卡片——`__section` 存在的意义就是「同一张卡里的第二层分组」，
 * 让页面不至于变成卡片汤。容器查询按内容压力点分两档：600px（三列降两列）与 400px（全部单列）。
 * @module dsh-fish-body/src/client/settings/style/cards
 */

/** 卡片层样式：卡片 → 卡头 → 小节 → 栅格 → 列表 → 折叠 → 头像 → 底部栏 → 弹窗。 */
export const CARDS_CSS = [
  // 分区容器：卡片的纵向节奏由这里给，卡片自己不再带外边距。
  '.dsh-pet-cfg__panel{display:flex;flex-direction:column;gap:var(--pcg-gap);min-width:0;animation:pcg-enter var(--pcg-dur) var(--pcg-ease)}',
  // 多卡分区包一层的容器：display:contents 让它不出盒子，子卡直接吃上面的纵向 flex。
  '.dsh-pet-cfg__group{display:contents}',

  '.dsh-pet-cfg__card{display:flex;flex-direction:column;gap:12px;padding:var(--pcg-pad-y) var(--pcg-pad-x);border:1px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2));border-radius:var(--pcg-radius);background:var(--dsw-alias-settings-card-fill,transparent);min-width:0}',
  '.dsh-pet-cfg__cardHead{display:flex;align-items:center;gap:6px;min-height:20px;min-width:0}',
  '.dsh-pet-cfg__cardTitle{font-size:var(--pcg-fs-title);font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary);min-width:0}',
  // 卡头右侧动作（打开文件夹 / 删除这只）。标题与问号保持左对齐，动作贴右。
  '.dsh-pet-cfg__cardActions{display:flex;align-items:center;gap:6px;margin-left:auto;flex:none}',

  // 小节：同一张卡里的第二层分组。只有相邻小节之间才画分隔线，第一段紧跟卡头时不画。
  '.dsh-pet-cfg__section{display:flex;flex-direction:column;gap:10px;min-width:0}',
  '.dsh-pet-cfg__section+.dsh-pet-cfg__section{padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2)}',
  '.dsh-pet-cfg__sectionTitle{font-size:var(--pcg-fs-label);line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}',

  '.dsh-pet-cfg__grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;align-items:end}',
  '.dsh-pet-cfg__grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 16px;align-items:end}',
  '.dsh-pet-cfg__grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 16px;align-items:end}',
  // 开关组：两列等宽，每个开关自己一行高度，长标签折行而不是被挤窄。
  '.dsh-pet-cfg__switchGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;align-items:center}',

  // 卡片正文里的说明：11–12px 三级色，最多三行，用来替掉过去每个字段挂一个问号的做法。
  '.dsh-pet-cfg__note{margin:0;font-size:var(--pcg-fs-label);line-height:18px;color:var(--dsw-alias-label-tertiary)}',
  '.dsh-pet-cfg__note.is-tight{font-size:var(--pcg-fs-meta);line-height:16px}',
  // 「需重启插件后生效」：与普通说明同尺寸，但换成主色——
  // 它说的是「你现在看到的还不是最终效果」，压成三级灰会被当成又一条可以忽略的提示。
  '.dsh-pet-cfg__note.is-restart{color:var(--dsw-alias-state-business-primary)}',
  // 有重启提示的开关格改成竖排：平时 `.dsh-pet-cfg__switch` 是一行 flex，第二行文本会挤在开关右侧。
  '.dsh-pet-cfg__switch.is-stacked{flex-direction:column;align-items:flex-start;gap:2px}',
  // 父开关关掉时整组降透明（会话鱼「关掉播报后，三类子播报一起失效」）。
  '.dsh-pet-cfg__switchGrid.is-muted .dsh-pet-cfg__switch>label{opacity:.45}',

  // 桌宠选择器行：种类下拉 + 实例 chip，不属于任何卡片，直接坐在分区背景上。
  '.dsh-pet-cfg__picker{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}',
  '.dsh-pet-cfg__kindPicker{width:150px;flex:none}',

  // 头像 + 身份字段：头像定宽 88，右侧 2 列输入**垂直居中**贴着头像——
  // 两行字段只有 50 高，若顶对齐会在头像下方留一块空洞；居中后留白上下平分，看着是刻意的。
  '.dsh-pet-cfg__identity{display:flex;align-items:center;gap:14px;min-width:0}',
  '.dsh-pet-cfg__identityFields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;flex:1 1 auto;min-width:0;align-items:end}',
  // 头像能换的时候整块就是按钮：悬浮出遮罩、点它直接开文件框，没有独立按钮。
  '.dsh-pet-cfg__avatarCol{position:relative;width:88px;flex:none}',
  '.dsh-pet-cfg__avatarImg{display:block;width:100%;height:88px;border-radius:var(--pcg-radius);border:1px solid var(--dsw-alias-border-l2);object-fit:cover;background:var(--dsw-alias-bg-layer-1)}',
  '.dsh-pet-cfg__avatarPick{position:relative;display:block;border-radius:var(--pcg-radius)}',
  // 键盘可达：input 铺满整块且透明（display:none 会让它不可聚焦）；焦点与悬浮一样出遮罩。
  '.dsh-pet-cfg__avatarPick:focus-within{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
  '.dsh-pet-cfg__avatarMask{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:var(--pcg-radius);background:var(--dsw-alias-bg-mask-2);color:var(--dsw-static-neutral-00);font-size:var(--pcg-fs-label);line-height:1;opacity:0;transition:opacity var(--pcg-dur-fast);pointer-events:none}',
  '.dsh-pet-cfg__avatarPick:hover .dsh-pet-cfg__avatarMask,.dsh-pet-cfg__avatarPick:focus-within .dsh-pet-cfg__avatarMask,.dsh-pet-cfg__avatarMask.is-busy{opacity:1}',
  '.dsh-pet-cfg__file{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:0}',

  // 折叠卡：标题行常驻，正文收进裁剪层。高度过渡走 grid-template-rows 的 0fr→1fr，不猜 max-height。
  '.dsh-pet-cfg__card.is-fold{gap:0}',
  '.dsh-pet-cfg__foldToggle{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0;min-height:20px;padding:0;border:none;border-radius:4px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;outline:none}',
  '.dsh-pet-cfg__foldToggle:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
  // 箭头用小三角而不是字符：不依赖字体、缩进也不受行高影响。
  '.dsh-pet-cfg__chevron{flex:none;margin-left:auto;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;color:var(--dsw-alias-label-tertiary);transition:transform var(--pcg-dur-fast) var(--pcg-ease)}',
  '.dsh-pet-cfg__chevron.is-open{transform:rotate(180deg)}',
  '.dsh-pet-cfg__fold{display:grid;grid-template-rows:0fr;transition:grid-template-rows var(--pcg-dur) var(--pcg-ease)}',
  '.dsh-pet-cfg__card.is-open .dsh-pet-cfg__fold{grid-template-rows:1fr}',
  '.dsh-pet-cfg__foldClip{min-height:0;overflow:hidden}',
  '.dsh-pet-cfg__foldBody{display:flex;flex-direction:column;gap:10px;padding-top:10px}',

  // 列表行（音效槽 / hook）：一行一件事，主体在上、元信息收进折叠。
  '.dsh-pet-cfg__rows{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 12px;min-width:0}',
  '.dsh-pet-cfg__row{display:flex;flex-direction:column;gap:2px;min-width:0;padding:5px 8px;border-radius:var(--pcg-radius-sm);transition:background var(--pcg-dur-fast) var(--pcg-ease)}',
  '@media (hover:hover){.dsh-pet-cfg__row:hover{background:var(--dsw-alias-interactive-bg-hover)}}',
  '.dsh-pet-cfg__rowMain{display:flex;align-items:center;gap:6px;min-width:0}',
  // 行内右侧聚成一簇：来源徽标 + 动作贴右，两者相邻。过去动作靠 margin-left:auto 单独贴边，
  // 徽标留在名字旁边，中间空出一大片、动作也读不出「属于这一行」。
  '.dsh-pet-cfg__rowMain>.dsh-pet-cfg__badge{margin-left:auto}',
  '.dsh-pet-cfg__rowMain>.dsh-pet-cfg__btn{flex:none}',
  // 状态徽标：未匹配 / 已登记 / 内置触发点这类「一句话事实」。
  '.dsh-pet-cfg__badge{flex:none;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--pcg-radius-pill);font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
  '.dsh-pet-cfg__badge.is-warn{border-color:var(--dsw-alias-state-warn-secondary);color:var(--dsw-alias-state-warn-label)}',
  '.dsh-pet-cfg__rowMeta{display:flex;align-items:baseline;gap:4px 10px;flex-wrap:wrap;min-width:0;font-size:var(--pcg-fs-meta);line-height:16px;color:var(--dsw-alias-label-tertiary)}',
  '.dsh-pet-cfg__mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Courier New",monospace;font-size:var(--pcg-fs-meta);line-height:16px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;user-select:text}',
  '.dsh-pet-cfg__hookRow{display:flex;align-items:center;gap:6px;min-width:0;padding:5px 8px;border-radius:var(--pcg-radius-sm)}',

  // 会话鱼预览：媒体框 + 一行尺寸/皮肤说明。媒体框沿用 `.dsh-session-fish-preview`（与浮层同一套外观），
  // 但设置页里它独占一格，所以收窄到内容宽度——否则虚线框会横着铺满、右半边空着。
  '.dsh-pet-cfg__preview{display:flex;flex-direction:column;gap:6px;align-items:flex-start;min-width:0;max-width:240px}',
  '.dsh-pet-cfg__preview>.dsh-session-fish-preview{width:fit-content}',
  // 会话鱼顶部：预览在左，两个「长什么样 / 在哪跑」的开关在右。
  '.dsh-pet-cfg__fishTop{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;min-width:0}',
  '.dsh-pet-cfg__fishTop>.dsh-pet-cfg__switchGrid{flex:1 1 240px;min-width:0}',
  // 纵向堆叠：同一段里「一行独占 + 一行两格」的组合。
  '.dsh-pet-cfg__stack{display:flex;flex-direction:column;gap:10px;min-width:0}',
  '.dsh-pet-cfg__actions>.dsh-pet-cfg__inp,.dsh-pet-cfg__actions>select{flex:1 1 140px;min-width:0}',

  '.dsh-pet-cfg__actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
  '.dsh-pet-cfg__path{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:var(--pcg-fs-label);line-height:18px;word-break:break-all;user-select:text;color:var(--dsw-alias-label-secondary)}',
  '.dsh-pet-cfg__path b{color:var(--dsw-alias-label-primary);font-weight:400}',
  // 「打开文件夹」按钮组：按钮 + 行内提示（问是否创建 / 失败说明）。提示跟着行流走，不做浮层。
  '.dsh-pet-cfg__folderBtn{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}',
  '.dsh-pet-cfg__cmd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Courier New",monospace;font-size:var(--pcg-fs-label);line-height:18px;word-break:break-all;user-select:text;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--pcg-radius-sm);background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}',

  // 目录树：等宽前缀画 `├─ / └─ / │`，名字后面跟一句「这个目录存什么」。
  // 缩进靠前缀字符串本身（`white-space:pre`），所以层级不会因为字号或缩放而错位。
  // 说明允许换行：它是给人读的整句，截断或横向滚动都只会让人放弃读它。
  '.dsh-pet-cfg__tree{display:flex;flex-direction:column;gap:2px;min-width:0;padding:2px 0}',
  '.dsh-pet-cfg__treeRow{display:grid;grid-template-columns:auto minmax(0,max-content) minmax(0,1fr) auto;align-items:baseline;gap:8px;font-size:var(--pcg-fs-label);line-height:18px}',
  '.dsh-pet-cfg__treePrefix{grid-column:1;white-space:pre;user-select:none;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Courier New",monospace}',
  // 名字可选中复制：排障时用户要能直接把 logs.txt 的路径贴出来。
  '.dsh-pet-cfg__treeName{grid-column:2;color:var(--dsw-alias-label-primary);font-weight:400;white-space:nowrap;user-select:text}',
  // 说明：次要色、小半档，长度不受限（换行而不是省略号）。
  '.dsh-pet-cfg__treeDesc{grid-column:3;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:var(--pcg-fs-meta);line-height:16px;word-break:break-word}',
  '.dsh-pet-cfg__treeRow>.dsh-pet-cfg__folderBtn{grid-column:4;justify-self:start}',
  // 还没产生的目录降一级：与「有东西」区分开，避免用户去找不存在的文件夹。
  '.dsh-pet-cfg__treeRow.is-missing .dsh-pet-cfg__treeName{color:var(--dsw-alias-label-tertiary)}',
  // 根行顶格、没有枝干：靠半档字重顶上「这是整棵树的根」，不需要缩进或额外图标。
  // 前缀那格不存在（渲染时就跳过了），所以整行改用少一列的网格，名字才真的贴住卡片左边缘。
  '.dsh-pet-cfg__treeRow.is-root{grid-template-columns:minmax(0,max-content) minmax(0,1fr) auto}',
  '.dsh-pet-cfg__treeRow.is-root .dsh-pet-cfg__treeName{grid-column:1;font-weight:500}',
  '.dsh-pet-cfg__treeRow.is-root .dsh-pet-cfg__treeDesc{grid-column:2}',
  '.dsh-pet-cfg__treeRow.is-root>.dsh-pet-cfg__folderBtn{grid-column:3}',
  // 只读参考那一组的徽标：只靠描边与字色区分，不上底色（一列徽标涂色会盖过目录名）。
  '.dsh-pet-cfg__treeBadge{grid-column:4;justify-self:start;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--pcg-radius-pill);font-size:var(--pcg-fs-meta);line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',

  // 快捷键的键帽：看着像一颗键，点一下进捕获态。等宽字体 + 固定最小宽度，改绑后整列不会跳。
  '.dsh-pet-cfg__keycap{min-width:64px;padding:2px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--pcg-radius-sm);background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Courier New",monospace;font-size:var(--pcg-fs-meta);line-height:18px;cursor:pointer;white-space:nowrap}',
  '.dsh-pet-cfg__keycap:hover:not(:disabled){border-color:var(--dsw-alias-border-l1)}',
  '.dsh-pet-cfg__keycap:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
  // 捕获态：描边升到主业务色，文字改成「按一个键…」——唯一的提醒，不再额外挂提示条。
  '.dsh-pet-cfg__keycap.is-capturing{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}',

  // 未保存改动的圆点：跟着分区标签或卡头走，只占 6px，不换行。
  '.dsh-pet-cfg__dot{display:inline-block;flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary);vertical-align:middle}',
  // 行内那颗：跟在字段标签 / 开关文字后面，标记「就是这一项改过」。
  '.dsh-pet-cfg__dot.is-inline{margin-left:5px;vertical-align:1px}',
  // 改动项自己的高亮：标签从次要色升到主色并加半档字重，扫一眼就知道改在哪儿。
  '.dsh-pet-cfg__field.is-dirty>.dsh-pet-cfg__flabel{color:var(--dsw-alias-label-primary);font-weight:500}',
  '.dsh-pet-cfg__switch.is-dirty .dsh-pet-cfg__swText{color:var(--dsw-alias-label-primary);font-weight:500}',
  '.dsh-pet-cfg__row.is-dirty .dsh-pet-cfg__mono,.dsh-pet-cfg__row.is-dirty .dsh-pet-cfg__swText{color:var(--dsw-alias-label-primary);font-weight:500}',

  // 底部常驻操作栏：贴住设置面板的滚动容器底边；背景取面板同款 layer-2，滚上去的卡片不会透出来。
  // 宿主的选项列底部留了 24px 内边距，而 sticky 的 `bottom:0` 只贴到滚动内容盒的底边——
  // 滚动时卡片会从那条 24px 的缝里露出来。用一块同色的阴影把缝补上（被子面板裁掉也不留痕迹）。
  '.dsh-pet-cfg__bar{position:sticky;bottom:0;z-index:2;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 0 4px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);box-shadow:0 24px 0 0 var(--dsw-alias-bg-layer-2)}',
  '.dsh-pet-cfg__barState{display:inline-flex;align-items:center;gap:6px;min-width:0;font-size:var(--pcg-fs-label);line-height:18px;color:var(--dsw-alias-label-secondary)}',
  // 「其中 n 项需重启」用主色：它是这次保存的收尾结论，跟「还剩几项没存」不是同一件事。
  '.dsh-pet-cfg__barState.is-restart{color:var(--dsw-alias-state-business-primary)}',
  '.dsh-pet-cfg__barSpacer{flex:1 1 auto;min-width:8px}',
  '.dsh-pet-cfg__msg{margin-left:4px;font-size:var(--pcg-fs-label);line-height:18px;color:var(--dsw-alias-state-success-primary)}',
  '.dsh-pet-cfg__msg.is-err{color:var(--dsw-alias-state-error-primary)}',

  // 加载 / 失败提示条：就绪后整块不出现，也不占位。
  '.dsh-pet-cfg__banner{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--pcg-radius-sm);background:var(--dsw-alias-interactive-bg-hover);font-size:var(--pcg-fs-label);line-height:18px;color:var(--dsw-alias-label-secondary)}',
  '.dsh-pet-cfg__banner.is-err{border-color:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary)}',

  // 确认弹窗：遮罩 + 居中卡片；入场只动透明度与 6px 位移。
  '.dsh-pet-cfg__mask{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-2);animation:pcg-fade var(--pcg-dur-fast) ease}',
  '.dsh-pet-cfg__dialog{display:flex;flex-direction:column;gap:12px;width:360px;max-width:calc(100vw - 40px);padding:16px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--pcg-radius);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent);animation:pcg-enter var(--pcg-dur) var(--pcg-ease)}',
  '.dsh-pet-cfg__dialogTitle{font-size:var(--pcg-fs-title);font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}',
  '.dsh-pet-cfg__dialogBody{font-size:var(--pcg-fs-body);line-height:20px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
  '.dsh-pet-cfg__dialogActions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}',

  // 容器查询按内容压力点分档，不跟窗口宽度硬绑定（设置页可能被放在任意宽的面板里）。
  '@container (max-width:600px){.dsh-pet-cfg__grid4{grid-template-columns:repeat(2,minmax(0,1fr))}}',
  '@container (max-width:400px){',
  // 极窄时分段标签折成两行而不是横向滚动：藏起来的两个分区没人会去滑。
  '.dsh-pet-cfg__seg{flex-wrap:wrap;overflow:visible}',
  '.dsh-pet-cfg__segItem{flex:1 1 30%}',
  '.dsh-pet-cfg__grid2,.dsh-pet-cfg__grid3,.dsh-pet-cfg__grid4,.dsh-pet-cfg__switchGrid,.dsh-pet-cfg__rows,.dsh-pet-cfg__identityFields{grid-template-columns:minmax(0,1fr)}',
  '.dsh-pet-cfg__identity{flex-direction:column;align-items:stretch}',
  '.dsh-pet-cfg__picker{flex-direction:column;align-items:stretch}',
  '.dsh-pet-cfg__kindPicker{width:100%}',
  '.dsh-pet-cfg__avatarCol{width:72px}',
  '.dsh-pet-cfg__avatarImg{height:72px}',
  '.dsh-pet-cfg__bar{gap:6px}',
  '.dsh-pet-cfg__bar .dsh-pet-cfg__btn{flex:1 1 auto}',
  '}',
].join('\n');
