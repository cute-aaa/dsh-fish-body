/**
 * 会话鱼运动：槽位纯函数（环位 / 竖排 / 夹取 / 让开桌宠 / 互相分离）与引擎动力学（弹簧收敛、
 * 屏边反弹、鱼鱼分离、鱼撞桌宠、拖拽落点换算）。
 *
 * 全部无 DOM：锚点、视口、时钟都注入，所以能直接跑在 node:test 里。
 * @module dsh-pet/src/client/session-fish/roam.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PetAnchor } from './pet-anchor.ts';
import { createRoam, pushOutOfBody, resolveFishSlots, ROAM_EDGE_PX, type FishBox, type RoamViewport } from './roam.ts';

const VIEWPORT: RoamViewport = { w: 1000, h: 800 };

/** 一个桌宠锚点：中心 (500,400)，舞台 400×225，身体盒内缩同实现。 */
function anchor(over: Partial<PetAnchor> = {}): PetAnchor {
  const w = over.w ?? 400;
  const h = over.h ?? 225;
  const cx = over.cx ?? 500;
  const cy = over.cy ?? 400;
  return {
    cx,
    cy,
    w,
    h,
    body: over.body ?? {
      left: cx - w / 2 + w * 0.15,
      top: cy - h / 2 + h * 0.1,
      right: cx + w / 2 - w * 0.15,
      bottom: cy + h / 2 - h * 0.12,
    },
  };
}

/** 一条鱼（96×54）。 */
function fish(id: string, over: Partial<FishBox> = {}): FishBox {
  return { id, w: over.w ?? 96, h: over.h ?? 54 };
}

/** 槽位中心。 */
function centerOf(slot: { x: number; y: number }, box: FishBox): { x: number; y: number } {
  return { x: slot.x + box.w / 2, y: slot.y + box.h / 2 };
}

describe('resolveFishSlots 环位', () => {
  test('一条鱼落在桌宠正上方，且贴着舞台外沿', () => {
    const box = fish('a');
    const slots = resolveFishSlots({
      mode: 'ring',
      anchor: anchor(),
      viewport: VIEWPORT,
      fishes: [box],
      offsets: {},
    });
    const slot = slots.get('a');
    assert.ok(slot);
    const center = centerOf(slot, box);
    assert.ok(Math.abs(center.x - 500) <= 1, '水平居中');
    assert.ok(center.y < 400, '在桌宠上方');
    assert.ok(center.y > 400 - 225, '但不会跑到舞台顶以上太多');
  });

  test('两条鱼一上一下，角度均匀分布', () => {
    const a = fish('a');
    const b = fish('b');
    const slots = resolveFishSlots({
      mode: 'ring',
      anchor: anchor(),
      viewport: VIEWPORT,
      fishes: [a, b],
      offsets: {},
    });
    const ca = centerOf(slots.get('a')!, a);
    const cb = centerOf(slots.get('b')!, b);
    assert.ok(ca.y < 400 && cb.y > 400);
  });

  test('贴边时槽位互相分离：不在角落叠成一坨', () => {
    const corner = anchor({ cx: 900, cy: 740 });
    const fishes = [fish('a'), fish('b'), fish('c'), fish('d')];
    const slots = resolveFishSlots({
      mode: 'ring',
      anchor: corner,
      viewport: VIEWPORT,
      fishes,
      offsets: {},
    });
    for (const box of fishes) {
      const slot = slots.get(box.id)!;
      assert.ok(slot.x >= ROAM_EDGE_PX - 0.01, '留左边距');
      assert.ok(slot.x + box.w <= VIEWPORT.w - ROAM_EDGE_PX + 0.01, '留右边距');
      assert.ok(slot.y >= ROAM_EDGE_PX - 0.01);
      assert.ok(slot.y + box.h <= VIEWPORT.h - ROAM_EDGE_PX + 0.01);
    }
    for (let i = 0; i < fishes.length; i += 1) {
      for (let j = i + 1; j < fishes.length; j += 1) {
        const a = slots.get(fishes[i].id)!;
        const b = slots.get(fishes[j].id)!;
        const overlapX = Math.min(a.x + fishes[i].w, b.x + fishes[j].w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + fishes[i].h, b.y + fishes[j].h) - Math.max(a.y, b.y);
        assert.ok(overlapX <= 1 || overlapY <= 1, '槽位不重叠');
      }
    }
  });

  test('偏移生效并受上限约束：拖得再远也还在桌宠旁边', () => {
    const box = fish('a');
    const near = resolveFishSlots({
      mode: 'ring',
      anchor: anchor(),
      viewport: VIEWPORT,
      fishes: [box],
      offsets: { a: { dx: 30, dy: 0 } },
    }).get('a')!;
    const base = resolveFishSlots({
      mode: 'ring',
      anchor: anchor(),
      viewport: VIEWPORT,
      fishes: [box],
      offsets: {},
    }).get('a')!;
    assert.ok(Math.abs(near.x - base.x - 30) <= 1, '偏移直接加到槽位上');

    const far = resolveFishSlots({
      mode: 'ring',
      anchor: anchor(),
      viewport: VIEWPORT,
      fishes: [box],
      offsets: { a: { dx: 5000, dy: 0 } },
    }).get('a')!;
    const farCenter = centerOf(far, box);
    assert.ok(farCenter.x < VIEWPORT.w, '夹在视口内');
  });

  test('槽位让开桌宠身体：不会压在身体盒里', () => {
    const box = fish('a');
    const pet = anchor();
    // 偏移把槽位直接推到身体中心
    const slots = resolveFishSlots({
      mode: 'ring',
      anchor: pet,
      viewport: VIEWPORT,
      fishes: [box],
      offsets: { a: { dx: pet.cx - 500, dy: pet.cy - 200 } },
    });
    const slot = slots.get('a')!;
    const boxRect = { left: slot.x, top: slot.y, right: slot.x + box.w, bottom: slot.y + box.h };
    const overlaps =
      boxRect.left < pet.body.right &&
      boxRect.right > pet.body.left &&
      boxRect.top < pet.body.bottom &&
      boxRect.bottom > pet.body.top;
    assert.equal(overlaps, false, '槽位被推出身体盒');
  });

  test('没有桌宠或关掉跟随时：右下角竖排，越靠上越靠后', () => {
    const fishes = [fish('a'), fish('b')];
    const slots = resolveFishSlots({ mode: 'stack', anchor: null, viewport: VIEWPORT, fishes, offsets: {} });
    const a = slots.get('a')!;
    const b = slots.get('b')!;
    assert.ok(a.x > VIEWPORT.w / 2);
    assert.ok(b.y < a.y);
    assert.ok(a.y + 54 <= VIEWPORT.h);
  });

  test('空列表：没有槽位', () => {
    const slots = resolveFishSlots({ mode: 'ring', anchor: anchor(), viewport: VIEWPORT, fishes: [], offsets: {} });
    assert.equal(slots.size, 0);
  });
});

describe('pushOutOfBody', () => {
  test('重叠时沿最浅轴整段推开，方向背离桌宠', () => {
    const box = fish('a');
    const body = { left: 400, top: 300, right: 600, bottom: 500 };
    const pushed = pushOutOfBody({ x: 380, y: 380 }, box, body);
    assert.ok(pushed.x + box.w <= body.left + 0.01 || pushed.x >= body.right - 0.01);
  });

  test('不重叠时原样返回', () => {
    const slot = { x: 0, y: 0 };
    assert.deepEqual(pushOutOfBody(slot, fish('a'), { left: 400, top: 300, right: 600, bottom: 500 }), slot);
  });
});

describe('createRoam 动力学', () => {
  /** 造一个可控时钟与视口的引擎。 */
  function makeEngine(options: { anchor?: PetAnchor | null; followPet?: boolean; reduced?: boolean } = {}) {
    let now = 1_000;
    const deps = {
      viewport: () => VIEWPORT,
      anchor: () => (options.anchor === undefined ? anchor() : options.anchor),
      offsets: () => ({}),
      followPet: () => options.followPet !== false,
      now: () => now,
      reducedMotion: () => options.reduced === true,
    };
    const roam = createRoam(deps);
    return {
      roam,
      /** 推进 `frames` 帧（每帧 16ms）。 */
      advance(frames: number): void {
        for (let index = 0; index < frames; index += 1) {
          now += 16;
          roam.step();
        }
      },
      at(): number {
        return now;
      },
    };
  }

  test('新鱼直接落在槽位上（不飞入）', () => {
    const { roam } = makeEngine();
    roam.sync([fish('a')]);
    const body = roam.bodies().get('a')!;
    const slot = roam.slots().get('a')!;
    assert.deepEqual({ x: body.x, y: body.y }, { x: slot.x, y: slot.y });
  });

  test('弹簧收敛：目标变了会走过去，并停在目标附近', () => {
    const { roam, advance } = makeEngine();
    roam.sync([fish('a')]);
    const body = roam.bodies().get('a')!;
    body.x = 20;
    body.y = 20;
    advance(120); // ~2s
    const slot = roam.slots().get('a')!;
    assert.ok(Math.abs(body.x - slot.x) < 4, '横向收敛');
    assert.ok(Math.abs(body.y - slot.y) < 4, '纵向收敛');
  });

  test('减少动态效果：直接吸附，不累积速度', () => {
    const { roam, advance } = makeEngine({ reduced: true });
    roam.sync([fish('a')]);
    const body = roam.bodies().get('a')!;
    body.x = 10;
    body.y = 10;
    advance(2);
    const slot = roam.slots().get('a')!;
    assert.equal(body.x, slot.x);
    assert.equal(body.vx, 0);
  });

  test('屏边反弹：冲出去会被夹回来并反向', () => {
    const { roam, advance } = makeEngine();
    roam.sync([fish('a')]);
    const body = roam.bodies().get('a')!;
    body.x = ROAM_EDGE_PX + 1;
    body.y = 200;
    body.vx = -900;
    body.vy = 0;
    advance(3);
    assert.ok(body.x >= ROAM_EDGE_PX - 0.01);
    assert.ok(body.vx >= 0, '撞左墙后速度反向');
  });

  test('鱼撞桌宠：会被推开并记一次挤压', () => {
    const pet = anchor();
    const { roam, advance } = makeEngine({ anchor: pet });
    roam.sync([fish('a')]);
    // 先跑一帧把时钟与槽位定下来（首帧是「吸附」，不会算碰撞）。
    advance(1);
    const body = roam.bodies().get('a')!;
    // 再把它放进身体盒正中央
    body.x = pet.cx - body.w / 2;
    body.y = pet.cy - body.h / 2;
    advance(1);
    const center = { x: body.x + body.w / 2, y: body.y + body.h / 2 };
    const nearestX = Math.min(pet.body.right, Math.max(pet.body.left, center.x));
    const nearestY = Math.min(pet.body.bottom, Math.max(pet.body.top, center.y));
    assert.ok(Math.hypot(center.x - nearestX, center.y - nearestY) >= Math.max(body.w, body.h) * 0.45 - 1);
    assert.ok(body.bumpUntil > 0, '记了挤压');
    assert.ok(roam.takeImpacts().some((impact) => impact.id === 'a'));
  });

  test('拖一条鱼压到另一条身上：对方被推开并记挤压', () => {
    const { roam, advance } = makeEngine();
    roam.sync([fish('a'), fish('b')]);
    advance(1); // 首帧吸附定钟
    const a = roam.bodies().get('a')!;
    const b = roam.bodies().get('b')!;
    const before = { x: b.x, y: b.y };
    // 把 a 拖到 b 的位置上
    roam.beginDrag('a', { x: a.x + 10, y: a.y + 10 });
    roam.dragTo({ x: b.x + 10, y: b.y + 10 });
    advance(1);
    assert.ok(Math.hypot(b.x - before.x, b.y - before.y) > 1, '另一条被推开了');
    assert.ok(b.bumpUntil > 0, '被撞的那条记了挤压');
    roam.endDrag();
  });

  test('拖拽落点 → 偏移：相对槽位换算，并且松手后带速度', () => {
    const { roam, advance } = makeEngine();
    roam.sync([fish('a')]);
    advance(1); // 首帧吸附定钟
    const body = roam.bodies().get('a')!;
    const start = { x: body.x + 20, y: body.y + 20 };
    roam.beginDrag('a', start);
    advance(1);
    // 快速向右甩：两次位移跨过 20ms，初速估算才拿得到有效窗口
    roam.dragTo({ x: start.x + 60, y: start.y });
    advance(1);
    roam.dragTo({ x: start.x + 140, y: start.y });
    advance(1);
    const saved = roam.endDrag();
    assert.ok(saved);
    assert.equal(saved.id, 'a');
    assert.ok(Math.abs(saved.offset.dx) > 40, '偏移跟着落点走');
    assert.ok(Math.abs(saved.offset.dy) < 40);
    assert.ok(Math.hypot(body.vx, body.vy) > 0, '甩出去有初速');
  });

  test('原地按一下（没移动）不算拖动，也不产生偏移', () => {
    const { roam } = makeEngine();
    roam.sync([fish('a')]);
    const body = roam.bodies().get('a')!;
    roam.beginDrag('a', { x: body.x + 10, y: body.y + 10 });
    assert.equal(roam.endDrag(), null);
  });

  test('删掉的鱼不再出现在状态里；关掉跟随后回到右下角', () => {
    let follow = true;
    let now = 1_000;
    const roam = createRoam({
      viewport: () => VIEWPORT,
      anchor: () => anchor(),
      offsets: () => ({}),
      followPet: () => follow,
      now: () => now,
    });
    roam.sync([fish('a'), fish('b')]);
    roam.sync([fish('a')]);
    assert.equal(roam.bodies().size, 1);
    follow = false;
    now += 16;
    roam.step();
    const slot = roam.slots().get('a')!;
    assert.ok(slot.x > VIEWPORT.w / 2, '竖排在右侧');
    assert.ok(slot.y + 54 <= VIEWPORT.h);
  });
});
