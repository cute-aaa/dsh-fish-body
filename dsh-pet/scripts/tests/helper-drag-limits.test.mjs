/**
 * 桌面 Helper 的拖拽界限：坐标系与松手夹取必须与 `fitWindow` 同一份。
 *
 * 为什么用 vm + 真实 shared-core：`sprite/window-fit.js` 与 `sprite/input.js` 是经典脚本，只往
 * `PetSprite.prototype` 上挂方法、靠全局 `S`（= `window.PetShared`）取共享纯逻辑。这里把
 * `shared-core.js` 与这两个文件依次加载进同一个 vm 上下文，于是 `reachLimits` 用的是**打包后的真身**，
 * 桩只提供 `VIEW` / `WORK_AREAS` / `CONFIG` 与一点 DOM。
 *
 * 钉住三件事：
 *   1. 非钳制（Windows / macOS）平台：`area` 原点必须是 0——`this.pos` 是 VIEW 相对坐标，
 *      写 `VIEW.x` 会把这层偏移再算一次（副屏在左时右边界提前一个屏宽，正是审阅报告的 1558）；
 *   2. 钳制（X11）平台：`area` 取本体中心所在那块屏的工作区；
 *   3. 松手落位过同一份界限——界外松手不许把位置留在界外，否则下次按下会被夹回（看着像倒抽）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HELPER = fileURLToPath(new URL('../../runtime/electron-helper/', import.meta.url));
const sharedCore = readFileSync(HELPER + 'shared-core.js', 'utf8');
const windowFitSource = readFileSync(HELPER + 'sprite/window-fit.js', 'utf8');
const inputSource = readFileSync(HELPER + 'sprite/input.js', 'utf8');

/** 双屏、副屏在左：主进程下发的 hull 是 (−1920, 0, 3840, 1040)，÷scale(=1) 后原样进 VIEW。 */
const VIEW_DUAL = { x: -1920, y: 0, w: 3840, h: 1040 };

/** 同一拓扑的逐屏工作区，已按 −VIEW.x / −VIEW.y 平移成视口相对矩形（constants.js::applyDeskGeometry 的做法）。 */
const WORK_AREAS_DUAL = [
  { x: 0, y: 0, width: 1920, height: 1040 },
  { x: 1920, y: 0, width: 1920, height: 1040 },
];

/** 越界允许量：审阅报告的复算用的是四边 100px（比真实 hitRect 推出的小一点，便于手算对照）。 */
const REACH_100 = { left: 100, right: 100, top: 100, bottom: 100 };

/** 本体尺寸：与宠物默认尺寸同量级。 */
const BODY_W = 462;
const BODY_H = 520;

/**
 * 造一个跑起来的上下文：真实 shared-core + 真实 window-fit.js / input.js + 桩全局。
 *
 * @param {{clamped?: boolean, workAreas?: object[], view?: object}} [o] - 平台与桌面几何。
 * @returns {{Sprite: Function, context: object, S: object}} 原型已挂好 helper 方法的构造器。
 */
function makeHarness(o = {}) {
  const { clamped = false, workAreas = WORK_AREAS_DUAL, view = VIEW_DUAL } = o;
  class Sprite {}
  const context = vm.createContext({
    PetSprite: Sprite,
    VIEW: { ...view },
    WORK_AREAS: workAreas,
    CONFIG: { scale: 1, isWindowClampedToWorkArea: clamped },
    toScreen: (v) => v,
    toLocal: (v) => v,
    document: { createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }) },
    window: { __dshPetDebug: {} },
    performance: { now: () => 0 },
    console,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(sharedCore, context);
  // helper 在真机上靠经典脚本的顶层 var 把 PetShared 挂到 window，再由 constants.js 取成全局 S。
  // vm 里全局对象就是 context 本身，所以手动补上这两跳（不加载 constants.js：它要真 URL 参数）。
  context.window.PetShared = context.PetShared;
  context.S = context.PetShared;
  vm.runInContext(windowFitSource, context);
  vm.runInContext(inputSource, context);
  return { Sprite, context, S: context.S };
}

/**
 * 造一只只够跑界限与松手路径的宠物。
 *
 * @param {Function} Sprite - {@link makeHarness} 拿到的构造器（原型上已有 helper 方法）。
 * @param {object} [o] - 覆盖字段（位置、半宽高…）。
 * @returns {object} 宠物桩。
 */
function makeSprite(Sprite, o = {}) {
  const sprite = Object.create(Sprite.prototype);
  return Object.assign(sprite, {
    pet: { id: 'main' },
    size: BODY_W,
    winH: BODY_H,
    halfW: BODY_W / 2,
    halfH: BODY_H / 2,
    hitRect: { x: 154, y: 100, w: 154, h: 300 },
    winOffset: { x: 0, y: 0 },
    margin: { t: 0, r: 0, b: 0, l: 0 },
    pos: { x: 700, y: 200 },
    el: { style: {} },
    hit: { classList: { add() {}, remove() {} } },
    physics: {},
    dragTrail: [],
    dragState: { active: false },
    customPos: null,
    sleeping: false,
    tipOn: false,
    justDragged: false,
    stopDragFollow() {},
    startDragFollow() {},
    stopThrow() {},
    stopMove() {},
    syncInputBusy() {},
    setTip() {},
    playOnce() {},
    startThrow() {},
    position() {},
    reportWindow() {},
    markPoseDirty() {},
    renderTip() {},
    resumeWorkStatusAnim() {
      return true;
    },
    ...o,
  });
}

test('非钳制平台：area 原点归零，副屏在左时右边界不提前一个屏宽', () => {
  const { Sprite, S } = makeHarness({ clamped: false });
  const sprite = makeSprite(Sprite);
  // 本用例只验 area 与坐标：reach 固定成四边 100，便于与审阅报告的复算逐位对照
  sprite.reachInset = () => ({ ...REACH_100 });

  // 反例基准（改前的写法）：把 VIEW.x 当 area 原点，同一套公式算出来的右边界
  const misaligned = S.reachLimits({
    area: { x: VIEW_DUAL.x, y: VIEW_DUAL.y, width: VIEW_DUAL.w, height: VIEW_DUAL.h },
    bodyWidth: BODY_W,
    bodyHeight: BODY_H,
    reach: REACH_100,
  });
  assert.equal(misaligned.maxX, 1558, '反例基准：坐标系错位时右边界落在 1558');

  const limits = sprite.dragLimits();
  assert.equal(limits.minX, -REACH_100.left, '左边界 = 0 − reach.left');
  assert.equal(limits.maxX, VIEW_DUAL.w - BODY_W + REACH_100.right, '右边界 = 3840 − 462 + 100');
  assert.notEqual(limits.maxX, 1558, '不许退回坐标系错位时的 1558（右侧半块屏拖不过去）');
  assert.equal(limits.minY, -REACH_100.top);
  assert.equal(limits.maxY, VIEW_DUAL.h - BODY_H + REACH_100.bottom);
});

test('钳制平台：area 取本体中心所在那块屏的工作区', () => {
  const { Sprite } = makeHarness({ clamped: true });
  const onLeft = makeSprite(Sprite, { pos: { x: 700, y: 200 } }); // 中心 931 → 左屏
  onLeft.reachInset = () => ({ ...REACH_100 });
  assert.deepEqual({ ...onLeft.reachArea() }, { x: 0, y: 0, width: 1920, height: 1040 });
  assert.equal(onLeft.dragLimits().maxX, 1920 - BODY_W + REACH_100.right);

  const onRight = makeSprite(Sprite, { pos: { x: 2500, y: 200 } }); // 中心 2731 → 右屏
  onRight.reachInset = () => ({ ...REACH_100 });
  assert.deepEqual({ ...onRight.reachArea() }, { x: 1920, y: 0, width: 1920, height: 1040 });
  assert.equal(onRight.dragLimits().minX, 1920 - REACH_100.left);
});

test('界外落点被同一份界限夹回', () => {
  const { Sprite } = makeHarness({ clamped: false });
  const sprite = makeSprite(Sprite);
  sprite.reachInset = () => ({ ...REACH_100 });
  // 返回值在 vm 里造出来，跨 realm 的 deepStrictEqual 会比对原型，先摊平成本地对象
  assert.deepEqual(
    { ...sprite.clampBodyToArea(5000, 5000) },
    {
      x: VIEW_DUAL.w - BODY_W + REACH_100.right,
      y: VIEW_DUAL.h - BODY_H + REACH_100.bottom,
    },
  );
  assert.deepEqual({ ...sprite.clampBodyToArea(-9999, -9999) }, { x: -REACH_100.left, y: -REACH_100.top });
});

test('onPointerUp：拖到界外松手，落点留在界限内（下次按下不会再被夹回）', () => {
  const { Sprite } = makeHarness({ clamped: false });
  const sprite = makeSprite(Sprite);
  sprite.reachInset = () => ({ ...REACH_100 });
  // 弹簧跟随后的实际位置越了右界：橡皮筋允许越界显示，松手必须落回界限内
  sprite.pos = { x: 3600, y: 200 };
  sprite.dragState = {
    active: true,
    dragging: true,
    sling: false,
    anchor: null,
    anchorX: 3600,
    anchorY: 200,
    petX: 3600,
    petY: 200,
  };

  sprite.onPointerUp({ clientX: 0, clientY: 0, screenX: 0, screenY: 0 });

  assert.equal(sprite.dragState.active, false, '松手后拖拽状态应结束');
  assert.notEqual(sprite.customPos, null, '原地放下走 customPos 分支');
  const landX = sprite.customPos.rx * VIEW_DUAL.w - sprite.halfW;
  const landY = sprite.customPos.ry * VIEW_DUAL.h - sprite.halfH;
  const maxX = VIEW_DUAL.w - BODY_W + REACH_100.right;
  assert.ok(landX <= maxX + 0.5, '落点不许留在界外：' + landX);
  assert.ok(Math.abs(landX - maxX) < 1.5, '越界松手应夹到右边界，实际 ' + landX);
  assert.ok(Math.abs(landY - 200) < 1.5, '纵向本来在界内，不该被动过：' + landY);
});

test('源码守卫：界限收口到 dragLimits()，不再把 VIEW.x 当 area 原点', () => {
  assert.equal(inputSource.includes('dragLimits()'), true, 'onPointerMove 应走 window-fit.js::dragLimits');
  assert.equal(inputSource.includes('clampBodyToArea'), true, '松手落位应走同一份界限');
  assert.equal(/x:\s*VIEW\.x/.test(inputSource), false, '不许再把 VIEW.x 当 area 原点（坐标系错位）');
  assert.equal(inputSource.includes('S.resolveRect(WORK_AREAS'), false, '工作区解析应收口到 reachArea()');
});
