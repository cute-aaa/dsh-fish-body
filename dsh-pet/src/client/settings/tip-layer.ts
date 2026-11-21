/**
 * 设置页的悬浮说明气泡：把 `data-tip` 的悬停从 CSS 伪元素改成挂在 body 的单例气泡。
 *
 * 伪元素只能锚在触发元素上，右列与贴顶的说明会被窗口边缘或滚动容器裁掉；这里用
 * `shared/tooltip` 的共享控制器按光标摆位，越界先翻边、仍越界就夹回视口，两个方向都不会丢字。
 * 触发元素仍是 `data-tip` 属性（见 ./ui），本模块用事件委托统一接管，不逐个挂监听。
 * 全局状态只有一份监听与一个气泡：`attachTipLayer()` 装、它返回的函数拆，重复装返回同一份。
 * 节点构造、尺寸实测、收起与「滚动/按下即收」的监听都在共享控制器里（与对话面板同一份实现），
 * 本模块只管「谁触发、说什么」；收起后控制器回调回来作废本模块的记账，页面侧不再另挂同样的监听。
 * @module dsh-fish-body/src/client/settings/tip-layer
 */
import { createTipBubble, type TipBubble } from '../../shared/tooltip.ts';

/** 气泡 class，外观在 ./css（定位与显隐在 shared/tooltip 的基类里）。 */
const TIP_CLASS = 'pet-cfg-tip';

/** 触发元素的属性名：选择器与取值都从它派生，改名只改一处。 */
const TIP_ATTR = 'data-tip';

/** 光标与气泡的间隙（px）。 */
const TIP_GAP_PX = 10;

/** 触发元素用到的最小子集：只读 `data-tip`。 */
interface TipTrigger {
  getAttribute: (name: string) => string | null;
}

/** 事件目标用到的最小子集：从命中节点往上找触发元素。 */
interface ClosestHost {
  closest: (selector: string) => TipTrigger | null;
}

/** 三类事件里本模块用到的字段；结构化类型让测试不必造真 PointerEvent。 */
interface HoverEvent {
  target: EventTarget | null;
  relatedTarget?: EventTarget | null;
  clientX: number;
  clientY: number;
}

/** 唯一的那个气泡（共享控制器）；悬停很频繁，反复建删会让气泡闪。 */
let bubble: TipBubble | undefined;

/** 当前挂着气泡的触发元素，用于跳过「在同一元素内移动」的重复派发。 */
let current: TipTrigger | undefined;

/** 这一层的解除函数；`undefined` 表示没装。 */
let detach: (() => void) | undefined;

/** 作废「当前元素」记账：气泡已被收起（含滚动/按下），同一元素再进入时应该重新出气泡。 */
function forgetCurrent(): void {
  current = undefined;
}

/** 收起气泡：元素留着复用，只摘显隐（`current` 由控制器的收起回调作废）。 */
function hideTip(): void {
  bubble?.hide();
}

/** 取共享控制器，第一次用时就地建；收起通知回流到本模块的记账。 */
function tip(): TipBubble {
  bubble ??= createTipBubble({ className: TIP_CLASS, gapPx: TIP_GAP_PX, onHide: forgetCurrent });
  return bubble;
}

/** 从事件目标往上找触发元素；不在说明元素上时返回 `undefined`。 */
function triggerOf(node: EventTarget | null): TipTrigger | undefined {
  const host = node as unknown as ClosestHost | null;
  if (host === null || typeof host.closest !== 'function') return undefined;
  return host.closest('[' + TIP_ATTR + ']') ?? undefined;
}

/**
 * 在光标处显示说明。
 *
 * @param text - 气泡正文。
 * @param cursor - 光标位置（视口坐标）。
 */
function showTip(text: string, cursor: { x: number; y: number }): void {
  tip().show(text, cursor);
}

/** 光标进入触发元素：换一条说明就重摆，同一元素内移动不动。 */
function onOver(event: HoverEvent): void {
  const trigger = triggerOf(event.target);
  if (trigger === undefined || trigger === current) return;
  const text = trigger.getAttribute(TIP_ATTR);
  if (text === null || text === '') return;
  showTip(text, { x: event.clientX, y: event.clientY });
  current = trigger;
}

/** 光标离开：移进触发元素自己的子节点也会派发 pointerout，只有真离开才收。 */
function onOut(event: HoverEvent): void {
  const from = triggerOf(event.target);
  if (from === undefined) return;
  if (triggerOf(event.relatedTarget ?? null) === from) return;
  hideTip();
}

/**
 * 装上说明气泡层。
 *
 * @returns 拆除函数：摘监听、摘气泡，可重复调用。
 */
export function attachTipLayer(): () => void {
  if (detach !== undefined) return detach;
  // 监听目标当场捕获：拆的时候全局可能已经不在（宿主换页、测试拆环境），不能回头再读 window
  const root = document;
  // 只有「谁触发、说什么」两条归本模块；滚动/按下即收由共享控制器自己挂在 document 上（单出口），
  // 它收起后经 onHide 回调作废 current，不需要页面再挂一份同样的监听。
  root.addEventListener('pointerover', onOver);
  root.addEventListener('pointerout', onOut);
  detach = () => {
    root.removeEventListener('pointerover', onOver);
    root.removeEventListener('pointerout', onOut);
    // 控制器自己挂在 document 上的收起监听与节点一并回收
    bubble?.dispose();
    bubble = undefined;
    current = undefined;
    detach = undefined;
  };
  return detach;
}
