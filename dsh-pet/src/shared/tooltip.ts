/**
 * 宠物悬浮提示：替代原生 title（它的样式、字体、延迟全由浏览器或系统决定，改不动），按光标位置显示。
 * 本模块给 class、样式、摆位纯函数与一份共用控制器；三处气泡只留各自的字号 / 最大宽 / 层级差异。
 * 坐标一律是各端自己的视口坐标（fixed 定位），宠物走动或窗口位移不会带着提示漂。
 * 尺寸取宠物宽的 CSS 变量（两端变量名不同），用回退兼容，调用方无需传尺寸。
 * 不用 DSH 主题变量：它只存在于 DSH 页面，桌面 Electron 页里没有，会退化成透明底。
 * @module dsh-fish-body/src/shared/tooltip
 */
/** 提示框 class（两端共用）。 */
export const TOOLTIP_CLASS = 'pet-tooltip';

/**
 * 提示基类：三处气泡（宠物页/桌面、设置页、对话面板）共用的一段布局。
 *
 * 只放两端语义相同的部分——定位方式、初始静态位置、显隐过渡、不吃指针事件。
 * 不含 z-index（2 / 2147483000 三处不同）、不含字号与最大宽（三处不同）、不含任何 `--dsw-*`
 * （桌面 Helper 页没有宿主变量，写进去就是死值）。
 */
export const TIP_BASE_CLASS = 'pet-tip-base';

/** 提示基类样式：与 {@link TIP_BASE_CLASS} 一一对应，由各表面的注入器各带一份。 */
export const TIP_BASE_CSS = [
  '.pet-tip-base{position:fixed;left:0;top:0;pointer-events:none;opacity:0;',
  // 时长与缓动走插件令牌，回落值等于令牌现值：令牌层还没注入时观感不跳。
  'transition:opacity var(--pet-dur-fast,120ms) var(--pet-ease,ease)}',
  '.pet-tip-base.is-on{opacity:1}',
].join('');

/** 光标与提示框之间的间隙（占宠物宽度比例）：462px 的宠物下约 10px，与原生提示的偏移观感接近。 */
export const TOOLTIP_GAP_RATIO = 0.022;

/** 一个点（视口坐标）。 */
export type TipPoint = { x: number; y: number };
/** 矩形（与 TipPoint 同坐标系）。 */
export type TipRect = { x: number; y: number; w: number; h: number };

/** 光标位置 + 提示框实测尺寸 + 允许范围 → 提示框左上角坐标。
 *  摆法与原生提示一致：优先放光标右下，右边装不下翻到左侧，下边装不下翻到上方，翻完仍越界就夹回范围内。
 *  尺寸必须实测（offsetWidth/offsetHeight）：翻边判据依赖真实宽高，估算偏大会贴着边就翻、偏小会越界被裁。
 *  @param cursor - 光标位置。
 *  @param tip - 提示框实测尺寸（px）。
 *  @param bounds - 允许显示的范围：桌面端是窗口 ∩ 光标所在屏的工作区，浏览器端是整个视口。
 *  @param gap - 光标与提示框的间隙（px）。 */
export function tooltipPlacement(
  cursor: TipPoint,
  tip: { w: number; h: number },
  bounds: TipRect,
  gap: number,
): TipPoint {
  const clamp = (v: number, lo: number, hi: number): number => (hi < lo ? lo : Math.min(Math.max(v, lo), hi));
  const rightMax = bounds.x + bounds.w;
  const bottomMax = bounds.y + bounds.h;
  let x = cursor.x + gap;
  if (x + tip.w > rightMax) x = cursor.x - gap - tip.w;
  x = clamp(x, bounds.x, rightMax - tip.w);
  let y = cursor.y + gap;
  if (y + tip.h > bottomMax) y = cursor.y - gap - tip.h;
  y = clamp(y, bounds.y, bottomMax - tip.h);
  return { x, y };
}

/** 提示框样式 —— 两端注入同一份（浏览器并入插件 CSS，桌面由 renderer.js 建 style 标签）。
 *  只留宠物侧独有的外观：定位方式、初始位置、显隐与过渡都在 {@link TIP_BASE_CSS}（节点上同时挂基类）。 */
export const TOOLTIP_CSS = [
  '.pet-tooltip{',
  'max-width:calc(var(--dsh-pet-size,var(--pet-size,462px))*0.8);',
  'padding:calc(var(--dsh-pet-size,var(--pet-size,462px))*0.010) calc(var(--dsh-pet-size,var(--pet-size,462px))*0.021);',
  'border-radius:calc(var(--dsh-pet-size,var(--pet-size,462px))*0.016);',
  // 白底黑字：对齐原生提示的观感，深色胶囊落在浅色宠物身上太抢眼
  'background:rgba(255,255,255,.96);color:#1f1f1f;',
  // 细边框：白底压在浅色宠物或浅色页面上会糊成一片，靠它划出轮廓
  'border:1px solid rgba(0,0,0,.12);',
  // 字体与气泡同一套；字体族走全局配置变量（注入在 documentElement），继承不到宠物根容器
  'font-family:var(--dsh-pet-font-family,"ShangshouSoftCandy","Yuanti SC","YouYuan","幼圆","Comic Sans MS","PingFang SC","Microsoft YaHei",sans-serif);',
  // 字号对齐 Windows 原生提示（9pt ≈ 12px）：462px 的宠物下 0.026 → 约 12px。
  // --dsh-pet-font-tip 由两端按该宠物尺寸算好注入（shared/fonts.ts 的 resolveFontPx），未注入时回退原表达式。
  'font-size:var(--dsh-pet-font-tip,calc(var(--dsh-pet-size,var(--pet-size,462px))*0.026));line-height:1.4;',
  // nowrap + 截断：宽度锁成一行才好和光标一起摆（换行会让宽度随位置跳变）
  'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
  // 不设 backdrop-filter：白底没必要，原生提示也没有毛玻璃
  'box-shadow:0 calc(var(--dsh-pet-size,var(--pet-size,462px))*0.004) calc(var(--dsh-pet-size,var(--pet-size,462px))*0.013) rgba(0,0,0,.18);',
  // 层级低于气泡：两者不抢同一块地方（提示跟光标、气泡在头顶），保留层序只是兜底
  'z-index:2}',
].join('');

/** 一份气泡的构造参数。 */
export interface TipBubbleOptions {
  /** 该表面专属的 class（外观与它绑定）；基类会自动加在前面。 */
  className: string;
  /** 光标与气泡的间隙（px）。 */
  gapPx: number;
  /**
   * 气泡被收起时的回调（含控制器自己挂的 `scroll` / `pointerdown` 收起）。
   *
   * 给「页面侧还记着当前悬停元素」的调用方用：收起由控制器单出口负责，页面只失效自己的记账，
   * 不必再挂一份同样的监听（同一事件两次 hide）。缺省表示不需要通知。
   */
  onHide?: (() => void) | undefined;
}

/** 一份气泡控制器：懒建单例元素、按光标显示、收起与回收。 */
export interface TipBubble {
  /** 在光标处显示；每次重设正文，同一个元素服务所有触发元素。 */
  show: (text: string, cursor: TipPoint) => void;
  /** 收起：只摘显隐，元素留着复用（悬停很频繁，反复建删会让气泡闪）。 */
  hide: () => void;
  /** 回收：摘监听与节点，之后还能再用（下次 show 会重建）。 */
  dispose: () => void;
}

/**
 * 造一份提示气泡控制器：三处气泡（设置页、对话面板、宠物页）共用同一套建节点、量尺寸、摆位与收起逻辑。
 *
 * @remarks
 * 摆位用 {@link tooltipPlacement}：越界先翻边、仍越界就夹回视口，两个方向都不会丢字。
 * 监听挂在 `document` 上并走捕获：元素自身的滚动不冒泡，只有捕获才能收到（气泡是 fixed 定位，
 * 内容一滚就僵在原地，必须立刻收起）。
 * @param o - 专属 class 与间隙。
 * @returns 控制器；不同表面各持一份，互不干扰。
 */
export function createTipBubble(o: TipBubbleOptions): TipBubble {
  let el: HTMLDivElement | undefined;
  let detach: (() => void) | undefined;

  /** 收起当前气泡（不碰监听与节点）；收起是单出口：调用方也只从这里的回调得知。 */
  const hideNow = (): void => {
    el?.classList.remove('is-on');
    o.onHide?.();
  };

  /** 取气泡元素，没有就建一个挂到 body——挂在滚动容器里会被裁掉。 */
  const ensure = (): HTMLDivElement => {
    if (el !== undefined && el.parentNode === document.body) return el;
    const node = document.createElement('div');
    node.setAttribute('class', TIP_BASE_CLASS + ' ' + o.className);
    node.setAttribute('role', 'tooltip');
    document.body.appendChild(node);
    el = node;
    // 监听目标当场捕获：回收时全局可能已经不在（宿主换页、测试拆环境），不能回头再读 window
    const root = document;
    root.addEventListener('scroll', hideNow, true);
    root.addEventListener('pointerdown', hideNow, true);
    detach = () => {
      root.removeEventListener('scroll', hideNow, true);
      root.removeEventListener('pointerdown', hideNow, true);
      detach = undefined;
    };
    return node;
  };

  return {
    show: (text, cursor) => {
      const node = ensure();
      node.textContent = text;
      // 先归零再量：位置不定时量到的仍是真实宽高，不归零会按上一处坐标判断翻边
      node.style.left = '0px';
      node.style.top = '0px';
      const placed = tooltipPlacement(
        cursor,
        { w: node.offsetWidth, h: node.offsetHeight },
        { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
        o.gapPx,
      );
      node.style.left = placed.x + 'px';
      node.style.top = placed.y + 'px';
      node.classList.add('is-on');
    },
    hide: hideNow,
    dispose: () => {
      detach?.();
      el?.remove();
      el = undefined;
    },
  };
}
