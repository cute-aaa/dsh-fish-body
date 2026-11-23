/**
 * 指针拖拽（src/client/pet/motion/drag.ts）的契约测试：按下态与拖拽阈值、松手三种去向（原地放下/甩抛/弹弓）、
 * 点击互动与「刚拖完」的忽略窗口、冻结时本地解冻。
 * 用假 DOM 元素、假指针事件与假 rAF 驱动，断言落在记录的回调上。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PHYSICS } from '../../../shared/physics/constants.ts';
import { createDrag, type DragCard } from './drag.ts';

/** 假根元素：只留拖拽用到的几个方法。 */
function fakeEl() {
  const classes = new Set<string>();
  return {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    hasClass: (name: string) => classes.has(name),
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => true,
    dispatchEvent: () => true,
    style: { transform: '' },
    /** 盒 200×112.5，左上角 (400, 300)。 */
    getBoundingClientRect: () => ({ left: 400, top: 300, right: 600, bottom: 412.5, width: 200, height: 112.5 }),
  };
}

/** 造一个指针事件；只需要处理器读到的字段。 */
function pointer(el: ReturnType<typeof fakeEl>, x: number, y: number, button = 0, pointerType = 'mouse') {
  return {
    button,
    pointerId: 1,
    pointerType,
    clientX: x,
    clientY: y,
    currentTarget: el as unknown as HTMLDivElement,
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

/** 假 window：只收 mouseup 监听，用来模拟指针捕获丢失后唯一到达的那次松开。 */
function withFakeWindow() {
  const scope = globalThis as { window?: unknown };
  const previous = scope.window;
  const listeners = new Set<(e: MouseEvent) => void>();
  scope.window = {
    addEventListener: (type: string, fn: (e: MouseEvent) => void) => {
      if (type === 'mouseup') listeners.add(fn);
    },
    removeEventListener: (type: string, fn: (e: MouseEvent) => void) => {
      if (type === 'mouseup') listeners.delete(fn);
    },
  };
  return {
    /** 还挂着的 mouseup 监听数。 */
    get count(): number {
      return listeners.size;
    },
    /** 派发一次 mouseup；默认是左键完全松开。 */
    mouseUp(x: number, y: number, init: { button?: number; buttons?: number } = {}): void {
      const event = { button: init.button ?? 0, buttons: init.buttons ?? 0, clientX: x, clientY: y } as MouseEvent;
      for (const fn of [...listeners]) fn(event);
    },
    restore(): void {
      scope.window = previous;
    },
  };
}

/** node 里没有 MouseEvent：长按菜单会构造一个 contextmenu，这里用最小替身顶住。 */
function withFakeMouseEvent() {
  const scope = globalThis as { MouseEvent?: unknown };
  const previous = scope.MouseEvent;
  scope.MouseEvent = class {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
  return {
    restore: (): void => {
      scope.MouseEvent = previous;
    },
  };
}

/** 假时钟 + 假 rAF。 */
function withFakeFrames() {
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const previousNow = performance.now;
  let now = 100000;
  let pending: Array<{ id: number; cb: () => void }> = [];
  let seq = 0;
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: () => void) => {
    const id = ++seq;
    pending.push({ id, cb });
    return id;
  };
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => {
    pending = pending.filter((entry) => entry.id !== id);
  };
  performance.now = () => now;
  return {
    advance(ms: number): void {
      now += ms;
    },
    /** 跑若干帧：`requestAnimationFrame` 的回调会自己续帧，这里按 16ms 一拍推进。 */
    flush(count = 1, ms = 16): void {
      for (let i = 0; i < count; i++) {
        now += ms;
        const batch = pending;
        pending = [];
        for (const entry of batch) entry.cb();
      }
    },
    get queued(): number {
      return pending.length;
    },
    restore(): void {
      (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = previousRaf;
      (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = previousCancel;
      performance.now = previousNow;
    },
  };
}

/** 造一套能力 + 全部回调的记录。 */
function harness(extra: Partial<DragCard> = {}) {
  const el = fakeEl();
  const stage = fakeEl();
  let box: { x: number; y: number } | null = { x: 400, y: 300 };
  const calls = {
    stopFlight: 0,
    stopAutonomy: 0,
    releaseLock: 0,
    plays: [] as string[],
    flights: [] as Array<{ px: number; py: number; vx: number; vy: number }>,
    places: [] as Array<{ x: number; y: number }>,
    clicks: 0,
    squashes: 0,
    seqs: 0,
    tipOn: [] as boolean[],
    hooks: [] as string[],
  };
  const card: DragCard = {
    petId: 'main',
    size: 200,
    halfW: 100,
    halfH: 56.25,
    physics: DEFAULT_PHYSICS,
    dragAnims: ['drag1'],
    clickAnims: ['click1'],
    idleAnims: ['idle1'],
    currentAnim: 'idle1',
    setOnce: () => {},
    playAnim: (name) => calls.plays.push(name),
    bumpSeq: () => {
      calls.seqs++;
    },
    markSquash: () => {
      calls.squashes++;
    },
    resumeWork: () => false,
    stopAutonomy: () => {
      calls.stopAutonomy++;
    },
    stopFlight: () => {
      calls.stopFlight++;
    },
    startFlight: (px, py, vx, vy) => calls.flights.push({ px, py, vx, vy }),
    isFrozen: () => false,
    releaseLock: () => {
      calls.releaseLock++;
    },
    grabVelocity: () => null,
    playSfx: (slot: string) => {
      // 拖拽成立与甩出也会走这个入口，这里只统计点击那一下。
      if (slot === 'click') calls.clicks++;
    },
    // 拖拽成立会触发内置 hook 点（hook-drag.wav）：这里记下来，供「不响事件音效」的断言用。
    playHook: (hook: string) => calls.hooks.push(hook),
    tipOn: () => false,
    placeTip: () => {},
    setTipOn: (on) => calls.tipOn.push(on),
    root: () => el as unknown as HTMLDivElement,
    box: () => box,
    // 默认给一份「一个 1280×800 视口、盒 200 宽」的界限；要测阻力就在 extra 里换一份更窄的。
    dragLimits: () => ({ minX: 0, maxX: 1280 - 200, minY: 0, maxY: 800 - 112.5 }),
    setBox: (next) => {
      box = next;
    },
    commitPlace: (point) => calls.places.push(point),
    ...extra,
  };
  return {
    drag: createDrag(() => card),
    el,
    stage,
    calls,
    setBox: (next: { x: number; y: number }) => {
      box = next;
    },
  };
}

describe('createDrag —— 按下与阈值', () => {
  test('非左键：不进入按下态', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el } = harness();
      drag.onPointerDown(pointer(el, 500, 350, 2));
      assert.equal(drag.isActive(), false);
    } finally {
      frames.restore();
    }
  });

  test('左键按下：进入按下态，停飞、停弹簧、停走位各一次', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      assert.equal(drag.isActive(), true);
      assert.equal(calls.stopFlight, 1);
      assert.equal(calls.stopAutonomy, 1);
      assert.deepEqual(calls.tipOn, [false]);
    } finally {
      frames.restore();
    }
  });

  test('冻结时按下：本地解冻一次', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness({ isFrozen: () => true });
      drag.onPointerDown(pointer(el, 500, 350));
      assert.equal(calls.releaseLock, 1);
    } finally {
      frames.restore();
    }
  });

  test('未超过阈值的移动：不算拖拽，不播拖拽动画', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerMove(pointer(el, 502, 351));
      assert.deepEqual(calls.plays, []);
    } finally {
      frames.restore();
    }
  });

  test('超过阈值：进入拖拽并播拖拽动画，但不改写舞台位移（抓取点不跳）', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, stage, calls } = harness();
      stage.style.transform = 'translateY(10px)';
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerMove(pointer(el, 540, 350));
      assert.deepEqual(calls.plays, ['drag1']);
      // 拖拽成立不出事件音效，只走内置 hook 点（hook-drag.wav）：那一声归用户自己决定。
      assert.deepEqual(calls.hooks, ['drag']);
      assert.equal(calls.clicks, 0, '拖拽不该冒充点击音效');
      assert.equal(stage.style.transform, 'translateY(10px)', '舞台位移应保持恒定');
    } finally {
      frames.restore();
    }
  });
});

describe('createDrag —— 松手去向', () => {
  test('没拖动就松手：既不放也不飞，提示按松手位置复位', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerUp(pointer(el, 500, 350));
      assert.deepEqual(calls.places, []);
      assert.deepEqual(calls.flights, []);
      assert.deepEqual(calls.tipOn, [false, true]);
    } finally {
      frames.restore();
    }
  });

  test('慢慢拖动后松手：原地放下，提交的是当前包围盒', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      frames.advance(50);
      drag.onPointerMove(pointer(el, 540, 350));
      frames.advance(50);
      drag.onPointerMove(pointer(el, 560, 350));
      frames.advance(400); // 停顿够久，估算不出速度
      drag.onPointerUp(pointer(el, 560, 350));
      assert.equal(calls.flights.length, 0);
      assert.equal(calls.places.length, 1);
    } finally {
      frames.restore();
    }
  });

  test('快速甩动后松手：起飞而不是原地放下', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      frames.advance(20);
      drag.onPointerMove(pointer(el, 600, 350));
      frames.advance(20);
      drag.onPointerMove(pointer(el, 700, 350));
      frames.advance(20);
      drag.onPointerMove(pointer(el, 800, 350));
      drag.onPointerUp(pointer(el, 800, 350));
      assert.equal(calls.places.length, 0);
      assert.equal(calls.flights.length, 1);
      assert.ok(calls.flights[0]!.vx > 0, `应向右飞：${calls.flights[0]!.vx}`);
    } finally {
      frames.restore();
    }
  });

  test('弹弓：两次按下间隔够短，按拉距反向起飞', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls, setBox } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerUp(pointer(el, 500, 350));
      frames.advance(60);
      // 第二次按下后往左上拽：松手应往右下飞。
      drag.onPointerDown(pointer(el, 500, 350));
      frames.advance(60);
      drag.onPointerMove(pointer(el, 420, 300));
      // 弹簧跟随只在真实 rAF 里推进，这里直接给出被拉到的位置。
      setBox({ x: 380, y: 280 });
      frames.advance(20);
      drag.onPointerUp(pointer(el, 420, 300));
      assert.equal(calls.flights.length, 1);
      const flight = calls.flights[0]!;
      assert.ok(flight.vx > 0 && flight.vy > 0, `拉向左上应往右下飞：vx=${flight.vx} vy=${flight.vy}`);
    } finally {
      frames.restore();
    }
  });
});

describe('createDrag —— 鼠标松开兜底', () => {
  test('指针捕获丢失、只来 mouseup：照样完成松手结算并复位拖拽态', () => {
    const frames = withFakeFrames();
    const win = withFakeWindow();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      frames.advance(50);
      drag.onPointerMove(pointer(el, 540, 350));
      frames.advance(400); // 停顿够久，结算是「原地放下」
      win.mouseUp(560, 350);
      assert.equal(calls.places.length, 1, '捕获丢失后 mouseup 应该完成松手结算');
      assert.equal(el.hasClass('dragging'), false, '拖拽类应该被摘掉');
      assert.deepEqual(calls.tipOn, [false, true], '提示应该复位');
    } finally {
      frames.restore();
      win.restore();
    }
  });

  test('正常 pointerup 之后再来的 mouseup：不结算第二次', () => {
    const frames = withFakeFrames();
    const win = withFakeWindow();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      frames.advance(50);
      drag.onPointerMove(pointer(el, 540, 350));
      frames.advance(400);
      drag.onPointerUp(pointer(el, 560, 350));
      assert.equal(win.count, 0, 'pointerup 之后不该还挂着兜底监听');
      win.mouseUp(560, 350);
      assert.equal(calls.places.length, 1, '同一次松手只能结算一次');
    } finally {
      frames.restore();
      win.restore();
    }
  });

  test('dispose：摘掉兜底监听，之后的 mouseup 不再结算', () => {
    const frames = withFakeFrames();
    const win = withFakeWindow();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerMove(pointer(el, 540, 350));
      frames.advance(400);
      drag.dispose();
      assert.equal(win.count, 0, 'dispose 后不该留监听');
      win.mouseUp(560, 350);
      assert.equal(calls.places.length, 0, '卸载后不该再结算');
    } finally {
      frames.restore();
      win.restore();
    }
  });

  test('右键松开或还有别的键按着：不算松手', () => {
    const frames = withFakeFrames();
    const win = withFakeWindow();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerMove(pointer(el, 540, 350));
      frames.advance(400);
      win.mouseUp(560, 350, { button: 2 });
      win.mouseUp(560, 350, { buttons: 2 });
      assert.equal(calls.places.length, 0, '非左键松开不该结算');
      win.mouseUp(560, 350);
      assert.equal(calls.places.length, 1, '左键松开仍然要结算');
    } finally {
      frames.restore();
      win.restore();
    }
  });
});

describe('createDrag —— 按压已结束时松手', () => {
  test('长按菜单结束了这次按压：松手照样摘类与复位提示，但不抛掷', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const frames = withFakeFrames();
    const win = withFakeWindow();
    const mouseEvent = withFakeMouseEvent();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350, 0, 'touch'));
      assert.equal(el.hasClass('dragging'), true, '按下时应该带上拖拽类');
      t.mock.timers.tick(500); // 长按到点：菜单接管，本次按压结束
      drag.onPointerUp(pointer(el, 500, 350, 0, 'touch'));
      assert.equal(el.hasClass('dragging'), false, '松手应该摘掉拖拽类');
      assert.deepEqual(calls.places, [], '按压已被菜单结束，不该原地放下');
      assert.deepEqual(calls.flights, [], '按压已被菜单结束，不该抛掷');
      assert.deepEqual(calls.tipOn, [false, true], '提示应该复位');
    } finally {
      frames.restore();
      win.restore();
      mouseEvent.restore();
    }
  });
});

describe('createDrag —— 边界阻力', () => {
  /** 阻力终点：`bound + over*dim*c/(dim + c*over)`（与 shared/physics/rubberband 同一条曲线）。 */
  const resisted = (over: number, dim: number, c = 0.55): number => (over * dim * c) / (dim + c * over);

  test('越界拖拽：目标位移被阻力收窄，松手落点贴住阻力终点（不跳）', () => {
    const frames = withFakeFrames();
    try {
      // 界限收紧到 [0,500]：指针从 500 拖到 900（+400），原始目标 = 400 + 400 = 800，已越界。
      const { drag, el, calls } = harness({ dragLimits: () => ({ minX: 0, maxX: 500, minY: 0, maxY: 687.5 }) });
      drag.onPointerDown(pointer(el, 500, 350));
      frames.advance(50);
      drag.onPointerMove(pointer(el, 900, 350));
      frames.flush(90); // 弹簧收敛到目标（过阻尼，~30 帧就到）
      frames.advance(400); // 停顿够久，松手走「原地放下」
      drag.onPointerUp(pointer(el, 900, 350));

      const placed = calls.places[calls.places.length - 1]!;
      assert.equal(calls.places.length, 1);
      assert.ok(placed.x > 500, `仍要越过界限（否则就成硬夹取了）：${placed.x}`);
      assert.ok(placed.x < 800, `必须比指针原始目标更近：${placed.x} < 800`);
      const expected = 500 + resisted(300, 500);
      assert.ok(Math.abs(placed.x - expected) < 1, `落点应贴住阻力终点 ${expected.toFixed(2)}：${placed.x}`);
      assert.ok(Math.abs(placed.y - 300) < 1, `未越界的那一轴不受影响：${placed.y}`);
    } finally {
      frames.restore();
    }
  });

  test('界限内拖拽：逐位等于指针目标（阻力不影响正常拖动）', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness({ dragLimits: () => ({ minX: 0, maxX: 500, minY: 0, maxY: 687.5 }) });
      drag.onPointerDown(pointer(el, 500, 350));
      frames.advance(50);
      drag.onPointerMove(pointer(el, 560, 350)); // 目标 460，仍在 [0,500]
      frames.flush(90);
      frames.advance(400);
      drag.onPointerUp(pointer(el, 560, 350));
      const placed = calls.places[calls.places.length - 1]!;
      assert.ok(Math.abs(placed.x - 460) < 1, `界限内应一比一跟手：${placed.x}`);
    } finally {
      frames.restore();
    }
  });
});

describe('createDrag —— 点击', () => {
  test('单击：点击音效 + 点击动画 + 标记 Q 弹 + 递增换源序号', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerUp(pointer(el, 500, 350));
      drag.onClick();
      assert.equal(calls.clicks, 1);
      assert.deepEqual(calls.plays, ['click1']);
      assert.equal(calls.squashes, 1);
      assert.equal(calls.seqs, 1);
    } finally {
      frames.restore();
    }
  });

  test('刚拖完的 100ms 内：点击被忽略', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerMove(pointer(el, 540, 350));
      frames.advance(400);
      drag.onPointerUp(pointer(el, 540, 350));
      assert.equal(drag.justDragged(), true);
      drag.onClick();
      assert.equal(calls.clicks, 0);
      frames.advance(150);
      drag.onClick();
      assert.equal(calls.clicks, 1);
    } finally {
      frames.restore();
    }
  });

  test('点击动画池为空：照样出声，但不播动画', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness({ clickAnims: [] });
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerUp(pointer(el, 500, 350));
      drag.onClick();
      assert.equal(calls.clicks, 1);
      assert.deepEqual(calls.plays, []);
    } finally {
      frames.restore();
    }
  });
});
