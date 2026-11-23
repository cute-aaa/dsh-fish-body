/**
 * 窗口落位与上报：把「本体屏幕位置」换算成窗口矩形，把窗口管理器钳掉的那截转成本体偏移，再报给主进程。
 *
 * 四边都钳：贴顶时窗口停在 y=0，本体在窗口内下移，窗口上方那截余量正好留给气泡。
 * PetSprite 由 sprite.js 定义，本文件只往原型上挂方法，必须在其后加载。
 * @module dsh-fish-body/runtime/electron-helper/sprite-window-fit
 */
'use strict';

/**
 * 单轴钳制：`max < min`（本体比工作区还大）时贴住起点，与 shared/motion.js 的 clampAxis 同口径。
 *
 * @param {number} want - 期望值。
 * @param {number} min - 下界。
 * @param {number} max - 上界。
 * @returns {number} 夹进 `[min, max]` 的值（退化区间取 `min`）。
 */
function clampBodyAxis(want, min, max) {
  return Math.min(Math.max(want, min), Math.max(min, max));
}

Object.assign(PetSprite.prototype, {
  /**
   * 越界允许量：命中区至少留 MIN_REACHABLE_PX 在屏幕内，其余部分可以挂到屏幕外。
   * 与网页端 clampReachableBox 同一条规则：宠物能挂出去，但右键永远点得到。
   * 上/下按「命中区的另一条边」留：挂在上方时留的是底边，挂在下方时留的是顶边。
   */
  reachInset() {
    const hit = this.hitRect;
    const keep = S.MIN_REACHABLE_PX;
    return {
      left: hit.x + hit.w - keep,
      right: this.size - hit.x - keep,
      top: hit.y + hit.h - keep,
      bottom: this.winH - hit.y - keep,
    };
  },

  /**
   * 拖拽与落位用的工作区：**与 `this.pos` 同坐标系**（VIEW 相对）。
   *
   * VIEW 与 WORK_AREAS 本身就是视口相对矩形（constants.js 的 applyDeskGeometry 已按 −VIEW.x/−VIEW.y 平移），
   * `this.pos` 也是相对 VIEW 的（position() 按比例还原、sendBounds 取 fit.x + offsetX）。所以非钳制平台
   * 的「整块视口就是可用范围」必须写成原点 0，不能写 VIEW.x：副屏在左时 VIEW.x = −1920，会把这层偏移
   * 再算一次，右边界提前一个屏宽——宠物刚过中线就撞进高阻力区，右侧那块屏拖不过去。
   */
  reachArea() {
    if (CONFIG.isWindowClampedToWorkArea) {
      const area = S.resolveRect(WORK_AREAS, this.pos.x + this.halfW, this.pos.y + this.halfH);
      if (area) return area;
    }
    return { x: 0, y: 0, width: VIEW.w, height: VIEW.h };
  },

  /**
   * 拖拽界限：与松手夹取（fitWindow → fitWindowInArea → reachLimits）同一条公式、同一份 area。
   * 阻力只改「拖的过程」，落点由同一条界限决定，两者不一致就会在松手瞬间跳一下。
   */
  dragLimits() {
    return S.reachLimits({
      area: this.reachArea(),
      bodyWidth: this.size,
      // 纵向是「精灵总高」（含脚底透明垫），与 fitWindow 的 bodyHeight 同基准
      bodyHeight: this.winH,
      reach: this.reachInset(),
    });
  },

  /** 把本体左上角夹进 {@link PetSprite#dragLimits}：界外松手不许把位置留在界外（下次按下会被夹回 = 倒抽）。 */
  clampBodyToArea(x, y) {
    const limits = this.dragLimits();
    return {
      x: clampBodyAxis(x, limits.minX, limits.maxX),
      y: clampBodyAxis(y, limits.minY, limits.maxY),
    };
  },

  /**
   * 算窗口落位并就地应用本体偏移；所有位移经 sendBounds 逐帧走到这里。
   *
   * @returns 窗口内容区（屏幕坐标系，CSS 像素）x/y/width/height 与本体在窗口内的偏移 offsetX/offsetY。
   */
  fitWindow() {
    const width = this.size + this.margin.l + this.margin.r;
    const height = this.winH + this.margin.t + this.margin.b;
    // 工作区取本体中心所在那块屏：窗口跨屏时按本体所在屏钳，与「窗口被关在单屏工作区内」一致
    const area = CONFIG.isWindowClampedToWorkArea
      ? S.resolveRect(WORK_AREAS, this.pos.x + this.halfW, this.pos.y + this.halfH)
      : undefined;
    const fit = S.fitWindowInArea({
      bodyX: this.pos.x,
      bodyY: this.pos.y,
      width,
      height,
      bodyWidth: this.size,
      // 纵向是「精灵总高」（含脚底透明垫），不是视频高：偏移上限按精灵算才对得上窗口尺寸
      bodyHeight: this.winH,
      insetX: this.margin.l,
      insetY: this.margin.t,
      reach: this.reachInset(),
      area,
    });
    this.applyWinOffset(fit.offsetX, fit.offsetY);
    return { x: fit.x, y: fit.y, width, height, offsetX: fit.offsetX, offsetY: fit.offsetY };
  },

  /** 本体在窗口内的偏移落到 DOM；逐帧调用，值没变就不写样式。 */
  applyWinOffset(x, y) {
    if (this.winOffset.x === x && this.winOffset.y === y) return;
    this.winOffset.x = x;
    this.winOffset.y = y;
    this.el.style.left = x + 'px';
    this.el.style.top = y + 'px';
    window.__dshPetDebug.winOffset = { x, y };
  },

  /**
   * 把窗口落位连同宠物状态报给主进程：命中区判定与跨窗碰撞站场都读这一份。
   *
   * @param fit - fitWindow 的返回值。
   */
  reportWindow(fit) {
    if (!window.petBridge) return;
    // 命中区一并上报（窗口局部 CSS 坐标）：比例随渲染方式变，主进程算不出正确结果，
    // 只能由渲染端给。窗口被系统钳回工作区后本体偏移也会变，所以每次随 setBounds 一起报。
    const hit = this.hitRect;
    // 完整状态一次捎带：size/bottomPad 让静止宠物从首帧起就登记进碰撞站场；
    // vx/vy 带当前速度（飞行中实时值、静止/拖拽 = 0），避免落地后残留旧速度干扰碰撞动量。
    const fly = this.throwState;
    window.petBridge.setBounds(
      toScreen(fit.x + VIEW.x),
      toScreen(fit.y + VIEW.y),
      toScreen(fit.width),
      toScreen(fit.height),
      toScreen(this.pos.x), // 包围盒左上角（碰撞站场用：窗口坐标 ≠ 包围盒坐标）
      toScreen(this.pos.y),
      toScreen(this.size),
      toScreen(this.bottomPad),
      fly ? toScreen(fly.vx) : 0,
      fly ? toScreen(fly.vy) : 0,
      // 窗口原点到本体原点的距离（DIP）：主进程据此算命中区，它不再恒等于余量——窗口被钳后
      // 偏移变大，只能按上报值算，不能按「窗口宽/4」反推（见 spriteHitRect）。
      toScreen(fit.offsetX),
      toScreen(fit.offsetY),
      // 命中区（窗口局部 CSS 坐标）：本体原点 + 命中框偏移。主进程只用它判「该不该可交互」。
      {
        x: toScreen(fit.offsetX + hit.x),
        y: toScreen(fit.offsetY + hit.y),
        width: toScreen(hit.w),
        height: toScreen(hit.h),
      },
    );
  },
});
