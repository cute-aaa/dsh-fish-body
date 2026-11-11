/**
 * 菜单节点类型：叶子、分支与挂载句柄。
 *
 * 纯类型声明，不含实现。
 * 必须始终成立：叶子带 action 或 anim（至少其一），分支必须带 children，二者不可兼得。
 * @module dsh-pet/src/shared/menu/types
 */
import { type PetDisplay, type RendererKind } from '../types.ts';

/** 叶子：可点击的菜单项。 */
export interface MenuLeaf {
  label: string;
  /** 播放的动画名（点播动作）；action 优先于 anim */
  anim?: string;
  /** 自定义动作：打开网站 / 查看余额 / 立即碎碎念 / 打开对话弹窗 / 打开待办面板 / 回到初始位置 /
   *  重载配置（桌面端专属，重启桌面 Helper 并按最新配置重建窗口）/ 重启插件（宿主重新组合本插件，
   *  改完宿主代码不必重启整个 profile）/ 改显示位置（目标值见 display，两端都注入）/
   *  渲染器自带动作（目标值见 rendererAction）/ 第三方菜单项（只把 owner 与 label 上报给注册方，
   *  具体做什么由它决定）。手动触发均不受 whisperEnabled 影响——那个字段只关自动轮询。 */
  action?:
    | 'open-site'
    | 'show-balance'
    | 'whisper'
    | 'chat'
    | 'todo'
    | 'home'
    | 'reload'
    | 'reload-plugin'
    | 'set-display'
    | 'set-renderer'
    | 'set-model'
    | 'set-size'
    | 'set-click-through'
    | 'set-provider-voice'
    | 'renderer-action'
    | 'sleep'
    | 'wake'
    | 'third-party';
  /** set-display 的目标显示位置（与设置页的下拉框同一套取值） */
  display?: PetDisplay;
  /** set-renderer 的目标渲染方式（与 pets[].renderer 同一套取值） */
  renderer?: RendererKind;
  /** set-model 的目标模型（layered 皮肤 id / live2d .model3.json 相对路径） */
  model?: string;
  /** set-size 的目标画框宽度（px，当前渲染方式）；缺省 = 删掉该渲染方式的覆盖，回落 pets[].size */
  size?: number;
  /** set-click-through 的目标值：true = 该宠物桌面窗整窗忽略鼠标（只作用于桌面端）。
   *  必填——当前值只有渲染端自己知道（菜单树是纯数据），所以「切换」由建叶子的一方取反后写进来。 */
  clickThrough?: boolean;
  /** set-provider-voice 的目标语音实现 id（目前是 `gsv`） */
  voiceProvider?: string;
  /** set-provider-voice 的目标音色 id（该实现扫描到的音色目录名） */
  providerVoice?: string;
  /** renderer-action 的动作名：layered 的装配手势 id / live2d 的 `motion:<组>:<序号>` 或 `expression:<名>` */
  rendererAction?: string;
  /** third-party：注册它的 owner（身份键，只用于回传，不显示）；同一个 owner 的项收在同一分组下，
   *  只有一项时跳过这层直接平铺。 */
  owner?: string;
  /** 项目右侧的灰色小字（如快捷键）：纯视觉提示，不参与文本匹配也不影响动作分发，缺省不占位。 */
  hint?: string;
  /** 指定配图（表情包池内的名称）：与 action='whisper' 并用时表示「用这张图说一句」，
   *  其余动作忽略它。名称由宿主在生成前校验是否仍在池内。 */
  image?: string;
  /** 该项左侧的缩略图地址（完整 URL，已编码）。缺省 = 只有文字，不占位。 */
  thumb?: string;
  /** 置灰且不可点：选项本身有意义（让人知道有这项），但当前素材/配置用不了它。 */
  disabled?: boolean;
}

/** 分支：带子菜单的项。 */
export interface MenuBranch {
  label: string;
  children: MenuNode[];
}

/**
 * 滑块行：数值型菜单项（目前只有「大小」）。
 *
 * 为什么菜单里能有滑块：右键菜单是自绘 DOM（不是系统菜单），能塞原生控件；拖动只更新读数，
 * **松手（change）才派发** `action`，避免拖动过程中反复写盘/重建窗口。派发沿用 `set-size` 的路径，
 * 两端（网页 / 桌面）的既有分发不用分叉。
 */
export interface MenuSlider {
  /** 判别键与语义：`'size'` = 画框宽度（px）。 */
  readonly slider: 'size';
  /** 无障碍名称与派发时的动作名（屏幕上不显示，读数在右侧）。 */
  readonly label: string;
  /** 打开菜单时的生效值。 */
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** 松手后派发的动作（沿用 set-size，值放在 MenuLeaf.size）。 */
  readonly action: 'set-size';
}

export type MenuNode = MenuLeaf | MenuBranch | MenuSlider;

/** 第三方菜单项（宿主经 /state 的 sections.menu 下发的快照，一条 = 一个可点项）。 */
export interface MenuMoreItem {
  /** 注册方身份；同时也是一级分组名（显示用） */
  owner: string;
  /** 项名（显示用，也是回传给注册方的标识） */
  label: string;
}

/** 右键菜单挂载句柄。 */
export interface ContextMenuMount {
  /** 已挂载的根元素（document.body 下） */
  el: HTMLElement;
  /** 关闭并清理（幂等） */
  close: () => void;
}
