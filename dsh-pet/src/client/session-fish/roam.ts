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
 * @module dsh-pet/src/client/session-fish/roam
 */
import { estimateReleaseVelocity, trimTrail } from '../../shared/physics/release.ts';
import { springStep } from '../../shared/physics/spring.ts';
import type { DragSample } from '../../shared/physics/throw.ts';
import type { PetAnchor, Rect } from './pet-anchor.ts';

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
  /** 拖到某处。 */
  dragTo(pointer: { x: number; y: number }): void;
  /** 松手：返回要持久化的偏移（没有拖动过则 null）。 */
  endDrag(): { readonly id: string; readonly offset: FishOffset } | null;
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
/** 偏移上限 = 环半径 × 这个比例：拖得再远也还在「桌宠旁边」。 */
const OFFSET_LIMIT_RATIO = 1.6;
/** 槽位互相分离的迭代轮数：够把贴角时的重叠摊开，又不至于每帧跑太多。 */
const SLOT_RELAX_PASSES = 8;
/** 拖拽轨迹保留的采样数（超过就丢最旧的）。 */
const TRAIL_KEEP = 32;

/** 两矩形是否相交。 */
function overlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** 圆角矩形：鱼的身体框。 */
function boxOf(slot: Slot, fish: FishBox): Rect {
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
export function pushOutOfBody(slot: Slot, fish: FishBox, body: Rect): Slot {
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

/** 偏移量钳到上限：持久化里存的是原始值，用的时候再收口。 */
function clampOffset(offset: FishOffset | undefined, limit: number): FishOffset {
  if (!offset || !Number.isFinite(offset.dx) || !Number.isFinite(offset.dy)) return { dx: 0, dy: 0 };
  const length = Math.hypot(offset.dx, offset.dy);
  if (length <= limit || length === 0) return offset;
  const scale = limit / length;
  return { dx: offset.dx * scale, dy: offset.dy * scale };
}

/** 环半径（px）：贴着一只 16:9 的桌宠画椭圆，横轴按宽度、纵轴按高度分开算。 */
function ringRadiiOf(anchor: PetAnchor, fish: FishBox): { rx: number; ry: number } {
  return {
    rx: anchor.w * RING_RATIO_X + fish.w * 0.4 + RING_GAP_PX,
    ry: anchor.h * RING_RATIO_Y + fish.h * 0.5 + RING_GAP_PX,
  };
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
    let limit: number;
    if (ring && anchor) {
      const radii = ringRadiiOf(anchor, fish);
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(1, fishes.length);
      base = {
        x: anchor.cx + Math.cos(angle) * radii.rx - fish.w / 2,
        y: anchor.cy + Math.sin(angle) * radii.ry - fish.h / 2,
      };
      limit = Math.max(radii.rx, radii.ry) * OFFSET_LIMIT_RATIO;
    } else {
      const stackGap = fish.h + STACK_GAP_PX;
      base = {
        x: viewport.w - 12 - fish.w,
        y: viewport.h - 12 - fish.h - index * stackGap,
      };
      limit = Math.max(fish.w, fish.h) * 3;
    }
    const offset = clampOffset(request.offsets[fish.id], limit);
    const moved = { x: base.x + offset.dx, y: base.y + offset.dy };
    const clamped = clampIntoViewport(moved.x, moved.y, fish, viewport);
    slots.push(anchor && ring ? pushOutOfBody(clamped, fish, anchor.body) : clamped);
  }
  separateSlots(slots, fishes, viewport);
  return new Map(fishes.map((fish, index) => [fish.id, slots[index]]));
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

  const computeSlots = (): Map<string, Slot> =>
    resolveFishSlots({
      mode: deps.followPet === undefined || deps.followPet() ? 'ring' : 'stack',
      anchor: deps.anchor(),
      viewport: deps.viewport(),
      fishes: fishes(),
      offsets: deps.offsets(),
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
    slots = computeSlots();
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
    slots = computeSlots();
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

  const dragTo = (pointer: { x: number; y: number }): void => {
    const body = dragging === null ? undefined : bodies.get(dragging);
    if (!body) return;
    const viewport = deps.viewport();
    const next = clampIntoViewport(pointer.x - grabDx, pointer.y - grabDy, body, viewport);
    body.x = next.x;
    body.y = next.y;
    moved = true;
    trail.push({ t: now(), x: pointer.x, y: pointer.y });
    if (trail.length > TRAIL_KEEP) trail = trail.slice(-TRAIL_KEEP);
  };

  const endDrag = (): { readonly id: string; readonly offset: FishOffset } | null => {
    const id = dragging;
    dragging = null;
    if (id === null) return null;
    const body = bodies.get(id);
    if (!body || !moved) return null;
    const ts = now();
    const released = estimateReleaseVelocity(trimTrail(trail, ts), ts);
    if (released) {
      body.vx = released.vx;
      body.vy = released.vy;
    }
    // 落点相对「无偏移槽位」的差就是新的偏移：鱼因此留在你放它的方向，仍在桌宠旁边。
    const anchor = deps.followPet === undefined || deps.followPet() ? deps.anchor() : null;
    const base = resolveFishSlots({
      mode: anchor ? 'ring' : 'stack',
      anchor,
      viewport: deps.viewport(),
      fishes: fishes(),
      offsets: {},
    });
    const baseSlot = base.get(id);
    if (!baseSlot) return null;
    const radii = anchor ? ringRadiiOf(anchor, body) : null;
    const limit = radii ? Math.max(radii.rx, radii.ry) * OFFSET_LIMIT_RATIO : Math.max(body.w, body.h) * 3;
    const dx = body.x - baseSlot.x;
    const dy = body.y - baseSlot.y;
    return { id, offset: clampOffset({ dx, dy }, limit) };
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
