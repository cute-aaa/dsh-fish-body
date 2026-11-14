/**
 * 会话鱼的运动引擎：把「鱼该在桌宠旁边的哪个位置」算成槽位，再让鱼用弹簧走过去，途中互相碰撞。
 *
 * 这是一份轻量的桌宠运动实现：复用桌宠的弹簧（`springStep`）、甩抛初速估算（`estimateReleaseVelocity`）
 * 与同一套视口坐标口径，但不碰 DOM、不读配置、不开 rAF——纯计算 + 一个可注入的时钟，
 * 所以能脱离浏览器单测（`roam.test.ts` 里没有 DOM）。
 *
 * 三层职责分得很清：
 * 1. {@link resolveFishSlots} 纯函数：环位 / 竖排 → 夹进视口 → 让开桌宠身体 → 槽位之间分离。
 *    槽位只由几何决定，同输入必得同输出，所以贴角时不会因为「目标点互相打架」而抖。
 * 2. 动力学（{@link createRoam} 内部）：每帧对槽位做一次过阻尼弹簧，再结算屏边、鱼↔桌宠、鱼↔鱼。
 * 3. DOM：完全交给调用方（浮层每帧读 {@link Roam.bodies} 写 transform）。
 *
 * 必须始终成立：拖拽中的那条鱼是运动学的——不被弹簧与碰撞改动，只把别人推开；
 * 同一帧最多一次速度结算，绝不按增量叠加（重叠会持续几帧，叠加会让同一对碰撞反复注入动量）。
 *
 * 网页浮层与桌面 Helper 共用这一份（桌面经 `shared-core.js` 拿到 `window.PetShared`）：
 * 几何、偏移上限与「拖到哪就落在哪」的口径因此只有一处实现。
 * @module dsh-fish-body/src/shared/session-fish/roam
 */
import { estimateReleaseVelocity, trimTrail } from '../physics/release.ts';
import { springStep } from '../physics/spring.ts';
import type { DragSample } from '../physics/throw.ts';

/**
 * 边坐标矩形（左 / 上 / 右 / 下）。
 *
 * 与 `shared/types` 的 `Rect`（x / y / 宽 / 高）是两套口径：鱼的身体盒与碰撞判定全都按边算，
 * 混用会让「重叠多少」这类式子到处乘加减。名字分开，就不会有人误把两种矩形互相传。
 */
export interface FishRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** 一条鱼的当前尺寸（px）：宽度取设置，高度按皮肤比例算好传进来。 */
export interface FishBox {
  readonly id: string;
  readonly w: number;
  readonly h: number;
}

/** 一条鱼相对槽位的持久化偏移（px）；拖拽后落点与槽位的差就存这个。 */
export interface FishOffset {
  readonly dx: number;
  readonly dy: number;
}

/**
 * 桌宠锚点：舞台中心、尺寸与「鱼不该压上去的那块身体」。
 *
 * 网页端从 `.dsh-pet-stage` 的 `getBoundingClientRect()` 现读（见 `client/session-fish/pet-anchor`），
 * 桌面端按窗口局部坐标直接算——两端的形状一致，运动引擎才只写一份。
 */
export interface PetAnchor {
  /** 舞台中心 x（px）。 */
  readonly cx: number;
  /** 舞台中心 y（px）。 */
  readonly cy: number;
  /** 舞台宽（px）。 */
  readonly w: number;
  /** 舞台高（px，16:9）。 */
  readonly h: number;
  /** 身体盒：舞台矩形按固定比例内缩（左右各让 15%，上 10%、下 12%）。 */
  readonly body: FishRect;
}

/** 视口尺寸（px）。 */
export interface RoamViewport {
  readonly w: number;
  readonly h: number;
}

/** 槽位求解的输入。 */
export interface SlotRequest {
  /** `ring` = 围着桌宠排；`stack` = 右下角竖排（没有桌宠或用户关掉跟随时）。 */
  readonly mode: 'ring' | 'stack';
  /** 桌宠锚点；`ring` 模式下为 null 时自动退回 `stack`。 */
  readonly anchor: PetAnchor | null;
  readonly viewport: RoamViewport;
  /** 参与排布的鱼，顺序决定环位角度（调用方按创建时间排好，位置才稳定）。 */
  readonly fishes: readonly FishBox[];
  /** 每条鱼的偏移；缺省按 0 处理。 */
  readonly offsets: Readonly<Record<string, FishOffset>>;
}

/** 一个槽位：鱼左上角的视口坐标（px）。 */
export interface Slot {
  readonly x: number;
  readonly y: number;
}

/** 一条鱼的当帧运动状态。 */
export interface FishBody {
  readonly id: string;
  w: number;
  h: number;
  /** 左上角视口坐标（px）。 */
  x: number;
  y: number;
  /** 速度（px/s）。 */
  vx: number;
  vy: number;
  /** 这一帧撞上了东西（调用方据此加挤压动画与碰撞音）。 */
  bumpUntil: number;
}

/** 一次撞击（相对速度，px/s）。 */
export interface FishImpact {
  readonly id: string;
  readonly speed: number;
}

/** 引擎依赖：全部用取值函数，避免捕获渲染期快照。 */
export interface RoamDeps {
  /** 当前视口尺寸。 */
  viewport(): RoamViewport;
  /** 当前桌宠锚点；没有桌宠时 null。 */
  anchor(): PetAnchor | null;
  /** 当前持久化偏移。 */
  offsets(): Readonly<Record<string, FishOffset>>;
  /** 是否围桌宠转（设置项）。 */
  followPet?(): boolean;
  /** 当前时间（ms）。 */
  now?(): number;
  /** 是否减少动态效果（true 时槽位直接吸附、不做速度积分）。 */
  reducedMotion?(): boolean;
}

/** 运动引擎对外能力。 */
export interface Roam {
  /** 同步鱼列表：保留仍在的、丢掉没了的、按顺序决定环位。 */
  sync(fishes: readonly FishBox[]): void;
  /** 当帧的槽位（调试与测试用）。 */
  slots(): ReadonlyMap<string, Slot>;
  /** 当帧的鱼状态（调用方只读）。 */
  bodies(): ReadonlyMap<string, FishBody>;
  /** 推进一帧。 */
  step(): void;
  /** 开始拖某条鱼；`pointer` 是视口坐标。 */
  beginDrag(id: string, pointer: { x: number; y: number }): void;
  /** 拖到某处；越出「牵引绳」或视口时鱼停在边界上（拖动预览就是最终落点）。 */
  dragTo(pointer: { x: number; y: number }): void;
  /**
   * 松手：返回要持久化的偏移（没有拖动过则 null）。
   *
   * @param pointer - 松手时的指针位置；最后一次 pointermove 与松手常常不是同一点。
   */
  endDrag(pointer?: { x: number; y: number }): { readonly id: string; readonly offset: FishOffset } | null;
  /** 当前被拖的鱼；没有则 null。 */
  draggingId(): string | null;
  /** 取走这一帧累积的撞击（读后清空）。 */
  takeImpacts(): readonly FishImpact[];
  /** 清空全部状态（重置位置后调用）。 */
  reset(): void;
}

/** 离视口边缘的最小留白（px）：右上角的关闭按钮要留得住。 */
export const ROAM_EDGE_PX = 8;
/** 环半径的横向比例：桌宠宽 × 它 + 鱼宽 × 0.4 + 间隙；再大就围得太散，再小会贴脸。 */
const RING_RATIO_X = 0.52;
/** 环半径的纵向比例：桌宠高 × 它 + 鱼高 × 0.5 + 间隙（16:9 的桌宠要用椭圆，正圆会上下离得太远）。 */
const RING_RATIO_Y = 0.55;
/** 环位与身体之间的间隙（px）。 */
const RING_GAP_PX = 8;
/** 竖排模式下的行距（px）。 */
const STACK_GAP_PX = 12;
/** 弹簧力度：比桌宠的跟手弹簧硬一点，鱼小、跟得紧才不生硬。 */
const SPRING_POWER = 1.4;
/** 单帧最大时间步（s）：切后台回来时不要一步跳出屏幕。 */
const MAX_DT = 1 / 30;
/** 速度上限（px/s）。 */
const MAX_SPEED = 900;
/** 屏边、桌宠、鱼之间的恢复系数。 */
const EDGE_RESTITUTION = 0.5;
const PET_RESTITUTION = 0.35;
const FISH_RESTITUTION = 0.5;
/** 挤压动画的持续时间（ms）。 */
const BUMP_MS = 260;
/**
 * 偏移上限 = 环半径 × 这个比例：拖得再远也还在「桌宠旁边」，但要比环宽得多。
 *
 * 1.6 的旧值只有 240px 左右（鱼 96 / 桌宠 200 时），拖动时鱼跟着光标跑到哪儿都能去，
 * 松手却被拽回环边——看起来就是「放下的位置不对」。3× 让可达范围覆盖大半个屏幕，
 * 同时保证鱼仍然围着桌宠（拖动时就能看见这个边界，松手不再位移）。
 */
export const OFFSET_LIMIT_RATIO = 3;
/** 竖排模式的偏移上限 = 鱼尺寸 × 它（没有桌宠时不受环半径约束，按鱼自身大小给）。 */
const STACK_OFFSET_LIMIT = 6;
/** 槽位互相分离的迭代轮数：够把贴角时的重叠摊开，又不至于每帧跑太多。 */
const SLOT_RELAX_PASSES = 8;
/** 拖拽轨迹保留的采样数（超过就丢最旧的）。 */
const TRAIL_KEEP = 32;

/** 两矩形是否相交。 */
function overlap(a: FishRect, b: FishRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** 圆角矩形：鱼的身体框。 */
function boxOf(slot: Slot, fish: FishBox): FishRect {
  return { left: slot.x, top: slot.y, right: slot.x + fish.w, bottom: slot.y + fish.h };
}

/** 鱼的中心与半径：碰撞按外接圆算（素材是长方形，圆比矩形稳，也不会卡角）。 */
function circleOf(body: { x: number; y: number }, fish: { w: number; h: number }) {
  return { x: body.x + fish.w / 2, y: body.y + fish.h / 2, r: Math.max(fish.w, fish.h) * 0.45 };
}

/** 夹进视口；视口比鱼还小时退回左上角，避免出现负数区间。 */
function clampIntoViewport(x: number, y: number, fish: FishBox, viewport: RoamViewport): Slot {
  const maxX = Math.max(ROAM_EDGE_PX, viewport.w - fish.w - ROAM_EDGE_PX);
  const maxY = Math.max(ROAM_EDGE_PX, viewport.h - fish.h - ROAM_EDGE_PX);
  return {
    x: Math.min(maxX, Math.max(ROAM_EDGE_PX, x)),
    y: Math.min(maxY, Math.max(ROAM_EDGE_PX, y)),
  };
}

/**
 * 把槽位从桌宠身体里推出来：取四种「推出去」里位移最小的那一种。
 *
 * 不能只按重叠量推：鱼整个落在身体内部时，重叠量最小的轴并不等于能出去的方向
 * （往身体里再推一点反而更近）。所以逐个算出上下左右四条出路，取最小位移。
 *
 * @param slot - 待修正的槽位。
 * @param fish - 鱼的尺寸。
 * @param body - 桌宠身体框。
 * @returns 修正后的槽位；不重叠时原值返回。
 */
export function pushOutOfBody(slot: Slot, fish: FishBox, body: FishRect): Slot {
  const box = boxOf(slot, fish);
  if (!overlap(box, body)) return slot;
  const exits = [
    { x: slot.x - (box.right - body.left), y: slot.y },
    { x: slot.x + (body.right - box.left), y: slot.y },
    { x: slot.x, y: slot.y - (box.bottom - body.top) },
    { x: slot.x, y: slot.y + (body.bottom - box.top) },
  ];
  let best = exits[0];
  let bestCost = Math.hypot(best.x - slot.x, best.y - slot.y);
  for (const exit of exits.slice(1)) {
    const cost = Math.hypot(exit.x - slot.x, exit.y - slot.y);
    if (cost < bestCost) {
      best = exit;
      bestCost = cost;
    }
  }
  return best;
}

/** 槽位两两分离：各自让一半，只在本帧的槽位副本上迭代，不改速度。 */
function separateSlots(slots: Slot[], fishes: readonly FishBox[], viewport: RoamViewport): void {
  for (let pass = 0; pass < SLOT_RELAX_PASSES; pass += 1) {
    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) {
        const a = boxOf(slots[i], fishes[i]);
        const b = boxOf(slots[j], fishes[j]);
        if (!overlap(a, b)) continue;
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        const alongX = overlapX <= overlapY;
        const sign = alongX
          ? (a.left + a.right) / 2 >= (b.left + b.right) / 2
            ? 1
            : -1
          : (a.top + a.bottom) / 2 >= (b.top + b.bottom) / 2
            ? 1
            : -1;
        const half = (alongX ? overlapX : overlapY) / 2;
        slots[i] = clampIntoViewport(
          slots[i].x + (alongX ? sign * half : 0),
          slots[i].y + (alongX ? 0 : sign * half),
          fishes[i],
          viewport,
        );
        slots[j] = clampIntoViewport(
          slots[j].x - (alongX ? sign * half : 0),
          slots[j].y - (alongX ? 0 : sign * half),
          fishes[j],
          viewport,
        );
      }
    }
  }
}

/**
 * 偏移量钳到上限：持久化里存的是原始值，用的时候再收口。
 *
 * @param offset - 原始偏移（可能来自存储、脏数据）。
 * @param limit - 上限长度（px）。
 * @returns 长度不超过 `limit` 的偏移；非法输入按 `{0,0}`。
 */
export function clampOffset(offset: FishOffset | undefined, limit: number): FishOffset {
  if (!offset || !Number.isFinite(offset.dx) || !Number.isFinite(offset.dy)) return { dx: 0, dy: 0 };
  const length = Math.hypot(offset.dx, offset.dy);
  if (length <= limit || length === 0) return offset;
  const scale = limit / length;
  return { dx: offset.dx * scale, dy: offset.dy * scale };
}

/**
 * 环半径（px）：贴着一只 16:9 的桌宠画椭圆，横轴按宽度、纵轴按高度分开算。
 *
 * @param anchor - 桌宠的尺寸（只用宽高）。
 * @param fish - 鱼的尺寸（只用宽高）。
 * @returns 横向与纵向半径。
 */
export function ringRadiiOf(
  anchor: Pick<PetAnchor, 'w' | 'h'>,
  fish: Pick<FishBox, 'w' | 'h'>,
): { rx: number; ry: number } {
  return {
    rx: anchor.w * RING_RATIO_X + fish.w * 0.4 + RING_GAP_PX,
    ry: anchor.h * RING_RATIO_Y + fish.h * 0.5 + RING_GAP_PX,
  };
}

/**
 * 桌宠窗口为「绕着它游的鱼」需要额外留出的余量（px，单边）。
 *
 * 桌面端把鱼画在桌宠同一个窗口里（不新增窗口/进程），而窗口原本只按桌宠尺寸 + 气泡余量撑开，
 * 环位会伸到窗口外被裁掉。这里按环几何算出「还要多宽多高」，桌面端只按这个值加大透明余量
 * （余量全程点击穿透），鱼群因此永远落在窗口内。
 *
 * @param body - 桌宠本体尺寸（宽 × 高，含脚底垫）。
 * @param fish - 鱼的显示尺寸。
 * @returns 左右/上下各自要加的最小余量；已经装得下时是 0。
 */
export function fishWindowPad(
  body: { readonly w: number; readonly h: number },
  fish: { readonly w: number; readonly h: number },
): { readonly x: number; readonly y: number } {
  const radii = ringRadiiOf(body, fish);
  const x = radii.rx + fish.w / 2 + ROAM_EDGE_PX - body.w / 2;
  const y = radii.ry + fish.h / 2 + ROAM_EDGE_PX - body.h / 2;
  return { x: Math.max(0, Math.ceil(x)), y: Math.max(0, Math.ceil(y)) };
}

/**
 * 这条鱼的偏移上限（px）：环模式按环半径，竖排按鱼自身尺寸。
 *
 * @param request - 模式与锚点（只看这两项）。
 * @param fish - 鱼的尺寸。
 * @returns 允许的最大偏移长度。
 */
export function offsetLimitOf(request: Pick<SlotRequest, 'mode' | 'anchor'>, fish: FishBox): number {
  if (request.mode === 'ring' && request.anchor !== null) {
    const radii = ringRadiiOf(request.anchor, fish);
    return Math.max(radii.rx, radii.ry) * OFFSET_LIMIT_RATIO;
  }
  return Math.max(fish.w, fish.h) * STACK_OFFSET_LIMIT;
}

/**
 * 求解一组槽位（纯函数，无副作用）。
 *
 * 顺序：理想位置 → 夹进视口 → 让开桌宠身体 → 槽位互相分离。
 * 四步都只依赖输入几何，所以同一帧反复算得到同一结果，弹簧的目标点不会自己抖。
 *
 * @param request - 模式、锚点、视口、鱼与偏移。
 * @returns 每条鱼左上角的视口坐标。
 */
export function resolveFishSlots(request: SlotRequest): Map<string, Slot> {
  const { fishes, viewport } = request;
  const ring = request.mode === 'ring' && request.anchor !== null;
  const anchor = request.anchor;
  const slots: Slot[] = [];
  for (let index = 0; index < fishes.length; index += 1) {
    const fish = fishes[index];
    let base: Slot;
    if (ring && anchor) {
      const radii = ringRadiiOf(anchor, fish);
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(1, fishes.length);
      base = {
        x: anchor.cx + Math.cos(angle) * radii.rx - fish.w / 2,
        y: anchor.cy + Math.sin(angle) * radii.ry - fish.h / 2,
      };
    } else {
      const stackGap = fish.h + STACK_GAP_PX;
      base = {
        x: viewport.w - 12 - fish.w,
        y: viewport.h - 12 - fish.h - index * stackGap,
      };
    }
    const offset = clampOffset(request.offsets[fish.id], offsetLimitOf(request, fish));
    const moved = { x: base.x + offset.dx, y: base.y + offset.dy };
    const clamped = clampIntoViewport(moved.x, moved.y, fish, viewport);
    slots.push(anchor && ring ? pushOutOfBody(clamped, fish, anchor.body) : clamped);
  }
  separateSlots(slots, fishes, viewport);
  return new Map(fishes.map((fish, index) => [fish.id, slots[index]]));
}

/** 一次拖拽/落点的解：能落到的槽位 + 该写的偏移 + 此刻的偏移上限。 */
export interface FishPlacement {
  /** 这条鱼真正能到的左上角（视口坐标）。 */
  readonly slot: Slot;
  /** 相对槽位的偏移（写进存储的那一份）。 */
  readonly offset: FishOffset;
  /** 本次允许的最大偏移长度（px）。 */
  readonly limit: number;
}

/**
 * 把「想把鱼放到哪里」翻译成「它能落在哪里」——拖动与松手共用这一个函数。
 *
 * 为什么必须共用：松手时若用另一套算法算偏移，落点与随后渲染出来的槽位就会差一截，
 * 鱼会在松手瞬间被弹簧拽走（实测偏差可达数百 px）。这里先用「本鱼偏移归零、其余保持现状」
 * 解出基准槽位，再取「落点 − 基准」钳到上限；最后按真实偏移再解一次，把视口夹取 / 让开身体 /
 * 槽位分离造成的残差补掉（一次修正即可，残差很小）。
 *
 * @param request - 当前几何（模式、锚点、视口、鱼、偏移）。
 * @param drop - 期望的落点（鱼左上角的视口坐标）。
 * @param id - 被拖的那条鱼。
 * @returns 落点解；该鱼不在场时 null。
 */
export function placeFish(request: SlotRequest, drop: Slot, id: string): FishPlacement | null {
  const fish = request.fishes.find((entry) => entry.id === id);
  if (!fish) return null;
  const limit = offsetLimitOf(request, fish);
  const base = resolveFishSlots({ ...request, offsets: { ...request.offsets, [id]: { dx: 0, dy: 0 } } }).get(id);
  if (!base) return null;
  let offset = clampOffset({ dx: drop.x - base.x, dy: drop.y - base.y }, limit);
  let slot = resolveFishSlots({ ...request, offsets: { ...request.offsets, [id]: offset } }).get(id) ?? base;
  const residual = { dx: drop.x - slot.x, dy: drop.y - slot.y };
  if (Math.hypot(residual.dx, residual.dy) > 0.5) {
    offset = clampOffset({ dx: offset.dx + residual.dx, dy: offset.dy + residual.dy }, limit);
    slot = resolveFishSlots({ ...request, offsets: { ...request.offsets, [id]: offset } }).get(id) ?? slot;
  }
  return { slot, offset, limit };
}

/** 引擎构造的默认时钟。 */
const defaultNow = (): number => Date.now();

/**
 * 造运动引擎。
 *
 * @param deps - 视口、锚点、偏移、时间与「减少动态效果」的取值函数。
 * @returns 可反复调用的引擎；一个浮层一个实例。
 */
export function createRoam(deps: RoamDeps): Roam {
  const now = deps.now ?? defaultNow;
  const bodies = new Map<string, FishBody>();
  const order: string[] = [];
  /** 当前帧的槽位；`step` 与拖拽落点换算都读它。 */
  let slots: Map<string, Slot> = new Map();
  /** 上一次 `step` 的时间；0 = 还没跑过。 */
  let lastTs = 0;
  let dragging: string | null = null;
  /** 拖拽起点相对鱼左上角的偏移：抓哪儿就从哪儿跟手。 */
  let grabDx = 0;
  let grabDy = 0;
  /** 拖拽轨迹：松手时据此估初速（与桌宠甩抛同一份算法）。 */
  let trail: DragSample[] = [];
  let moved = false;
  let impacts: FishImpact[] = [];

  const fishes = (): FishBox[] =>
    order.flatMap((id) => {
      const body = bodies.get(id);
      return body === undefined ? [] : [{ id, w: body.w, h: body.h }];
    });

  /** 首次出现的鱼直接落在它的槽位上（不飞入），避免从左上角划一道。 */
  const placeAtSlot = (id: string): void => {
    const body = bodies.get(id);
    const slot = slots.get(id);
    if (!body || !slot) return;
    body.x = slot.x;
    body.y = slot.y;
    body.vx = 0;
    body.vy = 0;
  };

  const sync = (list: readonly FishBox[]): void => {
    order.length = 0;
    for (const fish of list) {
      order.push(fish.id);
      const existing = bodies.get(fish.id);
      if (existing) {
        // 尺寸变了（改了设置里的宽度 / 换了皮肤比例）：保留位置，只更新盒子。
        existing.w = fish.w;
        existing.h = fish.h;
        continue;
      }
      bodies.set(fish.id, { id: fish.id, w: fish.w, h: fish.h, x: 0, y: 0, vx: 0, vy: 0, bumpUntil: 0 });
    }
    for (const id of [...bodies.keys()]) {
      if (!order.includes(id)) bodies.delete(id);
    }
    slots = resolveFishSlots(slotRequest());
    for (const id of order) {
      const body = bodies.get(id);
      // x/y 都是 0 说明是刚建的：直接落到槽位。已有位置的不动，免得改设置时鱼群瞬移。
      if (body && body.x === 0 && body.y === 0) placeAtSlot(id);
    }
  };

  /** 屏边反弹：撞墙把法向速度反向并衰减，位置贴回墙内。 */
  const bounceEdges = (body: FishBody, viewport: RoamViewport): void => {
    const maxX = Math.max(ROAM_EDGE_PX, viewport.w - body.w - ROAM_EDGE_PX);
    const maxY = Math.max(ROAM_EDGE_PX, viewport.h - body.h - ROAM_EDGE_PX);
    if (body.x < ROAM_EDGE_PX) {
      body.x = ROAM_EDGE_PX;
      if (body.vx < 0) body.vx = -body.vx * EDGE_RESTITUTION;
    } else if (body.x > maxX) {
      body.x = maxX;
      if (body.vx > 0) body.vx = -body.vx * EDGE_RESTITUTION;
    }
    if (body.y < ROAM_EDGE_PX) {
      body.y = ROAM_EDGE_PX;
      if (body.vy < 0) body.vy = -body.vy * EDGE_RESTITUTION;
    } else if (body.y > maxY) {
      body.y = maxY;
      if (body.vy > 0) body.vy = -body.vy * EDGE_RESTITUTION;
    }
  };

  /** 鱼撞桌宠：圆 vs 矩形，沿最近点法向整段推出，速度按恢复系数反弹。 */
  const collideAnchor = (body: FishBody, anchor: PetAnchor, ts: number): void => {
    const circle = circleOf(body, body);
    const nearestX = Math.min(anchor.body.right, Math.max(anchor.body.left, circle.x));
    const nearestY = Math.min(anchor.body.bottom, Math.max(anchor.body.top, circle.y));
    const dx = circle.x - nearestX;
    const dy = circle.y - nearestY;
    const distance = Math.hypot(dx, dy);
    if (distance >= circle.r) return;
    // 圆心落在矩形内部时最近点就是自己：改用「离哪条边最近」定法向。
    let nx: number;
    let ny: number;
    let push: number;
    if (distance < 1e-6) {
      const left = circle.x - anchor.body.left;
      const right = anchor.body.right - circle.x;
      const top = circle.y - anchor.body.top;
      const bottom = anchor.body.bottom - circle.y;
      const min = Math.min(left, right, top, bottom);
      if (min === left) {
        nx = -1;
        ny = 0;
        push = left + circle.r;
      } else if (min === right) {
        nx = 1;
        ny = 0;
        push = right + circle.r;
      } else if (min === top) {
        nx = 0;
        ny = -1;
        push = top + circle.r;
      } else {
        nx = 0;
        ny = 1;
        push = bottom + circle.r;
      }
    } else {
      nx = dx / distance;
      ny = dy / distance;
      push = circle.r - distance;
    }
    body.x += nx * push;
    body.y += ny * push;
    const vn = body.vx * nx + body.vy * ny;
    if (vn < 0) {
      body.vx -= (1 + PET_RESTITUTION) * vn * nx;
      body.vy -= (1 + PET_RESTITUTION) * vn * ny;
    }
    body.bumpUntil = ts + BUMP_MS;
    impacts.push({ id: body.id, speed: Math.abs(vn) });
  };

  /** 鱼撞鱼：圆 vs 圆，两边各让一半，法向速度按恢复系数交换。 */
  const collidePairs = (ts: number): void => {
    for (let i = 0; i < order.length; i += 1) {
      const a = bodies.get(order[i]);
      if (!a) continue;
      for (let j = i + 1; j < order.length; j += 1) {
        const b = bodies.get(order[j]);
        if (!b) continue;
        const ca = circleOf(a, a);
        const cb = circleOf(b, b);
        const dx = cb.x - ca.x;
        const dy = cb.y - ca.y;
        const distance = Math.hypot(dx, dy);
        const minDistance = ca.r + cb.r;
        // 圆心完全重合（被拖到正上方）：法向定不出来，按「往右分开」处理，否则两条会一直叠着。
        const nx = distance < 1e-6 ? 1 : dx / distance;
        const ny = distance < 1e-6 ? 0 : dy / distance;
        const gap = distance < 1e-6 ? 0 : distance;
        if (gap >= minDistance) continue;
        const push = (minDistance - gap) / 2;
        const aDragging = dragging === a.id;
        const bDragging = dragging === b.id;
        // 被拖的那条是运动学的：只把对方推开，自己不动。
        if (!aDragging) {
          a.x -= nx * (bDragging ? push * 2 : push);
          a.y -= ny * (bDragging ? push * 2 : push);
        }
        if (!bDragging) {
          b.x += nx * (aDragging ? push * 2 : push);
          b.y += ny * (aDragging ? push * 2 : push);
        }
        const relative = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        // 挤压动画与碰撞音按「被撞的那条」记：被拖的那条是手，不算它撞了。
        if (!aDragging) a.bumpUntil = ts + BUMP_MS;
        if (!bDragging) b.bumpUntil = ts + BUMP_MS;
        if (relative > 0 && !aDragging && !bDragging) {
          const impulse = ((1 + FISH_RESTITUTION) * relative) / 2;
          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          b.vx += impulse * nx;
          b.vy += impulse * ny;
        }
        if (relative > 0) {
          if (!aDragging) impacts.push({ id: a.id, speed: relative });
          if (!bDragging) impacts.push({ id: b.id, speed: relative });
        }
      }
    }
  };

  const step = (): void => {
    const ts = now();
    const viewport = deps.viewport();
    slots = resolveFishSlots(slotRequest());
    const reduced = deps.reducedMotion?.() === true;
    const dt = lastTs === 0 ? 0 : Math.min(MAX_DT, Math.max(0, (ts - lastTs) / 1000));
    lastTs = ts;

    for (const id of order) {
      const body = bodies.get(id);
      if (!body) continue;
      if (id === dragging) continue; // 拖拽中：位置由 dragTo 直接写
      const slot = slots.get(id);
      if (!slot) continue;
      if (reduced || dt === 0) {
        // 减少动态效果 / 首帧：直接吸附，不做速度积分（弹簧也不会累积出速度）。
        body.x = slot.x;
        body.y = slot.y;
        body.vx = 0;
        body.vy = 0;
        continue;
      }
      body.vx = springStep(body.vx, body.x, slot.x, dt, SPRING_POWER);
      body.vy = springStep(body.vy, body.y, slot.y, dt, SPRING_POWER);
      const speed = Math.hypot(body.vx, body.vy);
      if (speed > MAX_SPEED) {
        body.vx = (body.vx / speed) * MAX_SPEED;
        body.vy = (body.vy / speed) * MAX_SPEED;
      }
      body.x += body.vx * dt;
      body.y += body.vy * dt;
    }
    for (const id of order) {
      const body = bodies.get(id);
      if (!body || id === dragging) continue;
      bounceEdges(body, viewport);
    }
    const anchor = deps.followPet === undefined || deps.followPet() ? deps.anchor() : null;
    if (anchor) {
      for (const id of order) {
        const body = bodies.get(id);
        if (body && id !== dragging) collideAnchor(body, anchor, ts);
      }
    }
    collidePairs(ts);
  };

  /** 当前这一帧的求解输入（拖拽与落点都用它，绝不另拼一份口径）。 */
  const slotRequest = (): SlotRequest => ({
    mode: deps.followPet === undefined || deps.followPet() ? 'ring' : 'stack',
    anchor: deps.anchor(),
    viewport: deps.viewport(),
    fishes: fishes(),
    offsets: deps.offsets(),
  });

  const beginDrag = (id: string, pointer: { x: number; y: number }): void => {
    const body = bodies.get(id);
    if (!body) return;
    dragging = id;
    grabDx = pointer.x - body.x;
    grabDy = pointer.y - body.y;
    trail = [{ t: now(), x: pointer.x, y: pointer.y }];
    moved = false;
    body.vx = 0;
    body.vy = 0;
  };

  /**
   * 拖到某处：鱼跟手，但落点用 {@link placeFish} 收口——越出牵引绳、压到桌宠身上、
   * 或被视口夹住时**当场**停在边界上。松手因此不再有回弹（拖动预览就是最终落点）。
   */
  const dragTo = (pointer: { x: number; y: number }): void => {
    const body = dragging === null ? undefined : bodies.get(dragging);
    if (!body || dragging === null) return;
    const placement = placeFish(slotRequest(), { x: pointer.x - grabDx, y: pointer.y - grabDy }, dragging);
    if (placement) {
      body.x = placement.slot.x;
      body.y = placement.slot.y;
    }
    moved = true;
    trail.push({ t: now(), x: pointer.x, y: pointer.y });
    if (trail.length > TRAIL_KEEP) trail = trail.slice(-TRAIL_KEEP);
  };

  const endDrag = (pointer?: { x: number; y: number }): { readonly id: string; readonly offset: FishOffset } | null => {
    const id = dragging;
    if (id === null) return null;
    // 松手坐标才是最终落点：最后一次 pointermove 常常早于松手好几像素（触屏/快速甩动更明显）。
    // 只在「确实拖动过」时才采纳，否则一次点击会被当成拖动。
    if (pointer !== undefined && moved) dragTo(pointer);
    dragging = null;
    const body = bodies.get(id);
    if (!body || !moved) return null;
    const ts = now();
    const released = estimateReleaseVelocity(trimTrail(trail, ts), ts);
    // 用与拖动同一个求解器算偏移，并把鱼落到它解出来的槽位上：
    // 于是「存下来的偏移」与「下一帧渲染的槽位」必然一致，松手瞬间不再位移。
    const placement = placeFish(slotRequest(), { x: body.x, y: body.y }, id);
    if (released) {
      body.vx = released.vx;
      body.vy = released.vy;
    } else {
      body.vx = 0;
      body.vy = 0;
    }
    if (!placement) return null;
    body.x = placement.slot.x;
    body.y = placement.slot.y;
    return { id, offset: placement.offset };
  };

  return {
    sync,
    slots: () => slots,
    bodies: () => bodies,
    step,
    beginDrag,
    dragTo,
    endDrag,
    draggingId: () => dragging,
    takeImpacts: () => {
      const taken = impacts;
      impacts = [];
      return taken;
    },
    reset: () => {
      bodies.clear();
      order.length = 0;
      slots = new Map();
      lastTs = 0;
      dragging = null;
      trail = [];
      impacts = [];
    },
  };
}
