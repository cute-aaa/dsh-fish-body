/**
 * 面板里的悬浮提示：替代原生 title（延迟、字体与样式都由浏览器决定，改不动）。
 *
 * 气泡挂在 body 上、position:fixed 按光标摆位：消息列表是 overflow:auto 的滚动容器，
 * 挂在列表里的伪元素气泡会被裁掉（贴顶/贴底的消息看不到提示）。
 * 节点构造、尺寸实测、摆位与收起监听都在 shared/tooltip 的共享控制器里（与设置页 data-tip 气泡同一份实现），
 * 本模块只管「谁触发、说什么」；外观在 ./panel-css 的 .pet-chat-tip。
 * @module dsh-fish-body/src/client/chat/tooltip
 */
import { createTipBubble, type TipBubble } from '../../shared/tooltip.ts';

/** 气泡 class（外观见 ./panel-css；定位与显隐在 shared/tooltip 的基类里）。 */
export const TIP_CLASS = 'pet-chat-tip';

/** 光标与气泡的间隙（px）：与设置页的 data-tip 气泡一致，视觉上不贴手。 */
const TIP_GAP_PX = 10;

/** 唯一的那个气泡（共享控制器）；面板里悬停很频繁，反复建删会让气泡闪，所以复用。 */
let tipBubble: TipBubble | undefined;

/** 取共享控制器，第一次用时就地建（收起监听也由它登记、由它回收）。 */
function tip(): TipBubble {
  tipBubble ??= createTipBubble({ className: TIP_CLASS, gapPx: TIP_GAP_PX });
  return tipBubble;
}

/**
 * 在光标处显示气泡。
 *
 * @param text - 气泡正文；每次重设，同一个气泡服务所有触发元素。
 * @param cursor - 光标位置（视口坐标）。
 */
function showTip(text: string, cursor: { x: number; y: number }): void {
  tip().show(text, cursor);
}

/**
 * 触发元素的悬停属性：光标进入时在光标处出气泡，离开即收起。
 *
 * 不接 focus：点击按钮也会让它获得焦点，于是点图/点播放之后气泡会一直挂在屏幕上，
 * 键盘用户的可读名靠元素上的 `aria-label`。
 *
 * @param text - 气泡正文（已翻译）。
 */
export function tipAttrs(text: string): {
  onMouseEnter: (event: { clientX: number; clientY: number }) => void;
  onMouseLeave: () => void;
} {
  return {
    onMouseEnter: (event) => showTip(text, { x: event.clientX, y: event.clientY }),
    onMouseLeave: () => tipBubble?.hide(),
  };
}

/** 卸载面板时回收气泡与全局监听；样式标签由 ./styles 释放。 */
export function disposeTip(): void {
  tipBubble?.dispose();
  tipBubble = undefined;
}
