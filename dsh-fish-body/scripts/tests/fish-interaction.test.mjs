/**
 * 桌面会话鱼的交互契约：拖拽、关闭、命中判定与窗口可交互判定。
 *
 * 为什么用 vm + 真实 shared-core：桌面 Helper 是经典脚本，靠 `window.PetShared` 取共享纯逻辑。
 * 这里把 `shared-core.js` 与 `sprite/fish.js` 依次加载进同一个 vm 上下文，于是用的就是**打包后的真身**
 * （`createRoam` 的槽位/牵引绳、`readSessionFish`、`fishWindowPad`…），只把 DOM 与 fetch 换成桩。
 *
 * 钉住四件事：
 *   1. 鱼盒子在余量区，命中判定按「窗口坐标 − 本体偏移」换算；
 *   2. 拖拽走的是共享引擎，落点写进本窗口的 localStorage（key 与网页端同名但不同源）；
 *   3. × 立刻移除并按 `POST /session-fish {action:'close'}` 通知宿主；
 *   4. `fishBusy` 只在悬停/拖拽时为真——否则整块余量区会变成可点击，桌面就没法点穿。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HELPER = fileURLToPath(new URL('../../runtime/electron-helper/', import.meta.url));
const sharedCore = readFileSync(HELPER + 'shared-core.js', 'utf8');
const fishSource = readFileSync(HELPER + 'sprite/fish.js', 'utf8');

/**
 * 极简元素桩：够 fish.js 建鱼、改样式、挂事件、量矩形。
 *
 * @param {string} tag - 标签名（只做记录）。
 */
function makeElement(tag) {
  const el = {
    tag,
    className: '',
    textContent: '',
    title: '',
    type: '',
    style: {},
    children: [],
    handlers: {},
    removed: false,
    classList: {
      _set: new Set(),
      add(name) {
        this._set.add(name);
      },
      remove(name) {
        this._set.delete(name);
      },
      toggle(name, on) {
        if (on) this._set.add(name);
        else this._set.delete(name);
      },
      contains(name) {
        return this._set.has(name);
      },
    },
    setAttribute() {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    insertBefore(child) {
      this.children.unshift(child);
      return child;
    },
    remove() {
      this.removed = true;
    },
    addEventListener(name, fn) {
      (this.handlers[name] ??= []).push(fn);
    },
    getBoundingClientRect() {
      return { x: 0, y: 0, width: 96, height: 54 };
    },
  };
  return el;
}

/**
 * 造一个跑起来的上下文：真实 shared-core + 真实 fish.js + 桩 DOM。
 *
 * @returns {{Sprite: Function, context: object, posts: object[], offsetsKey: string}} 可用的构造器与记录。
 */
function makeHarness() {
  /** 本窗口的 localStorage（`file://` 页面）。 */
  const store = new Map();
  const posts = [];
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  class Sprite {}
  const context = vm.createContext({
    PetSprite: Sprite,
    BASE: 'http://127.0.0.1:3099/dsh-pet-7340',
    toScreen: (v) => v,
    toLocal: (v) => v,
    soundUrlOf: (root, file) => 'http://x/sound/' + root + '/' + file,
    document: { createElement: (tag) => makeElement(tag) },
    window: { localStorage, petBridge: {}, __dshPetDebug: {} },
    localStorage,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    fetch: (url, init) => {
      posts.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, granted: true }) });
    },
    console,
    setTimeout,
    clearTimeout,
    JSON,
    Math,
    Date,
    Number,
    Map,
    Set,
    Object,
    Promise,
  });
  vm.runInContext(sharedCore, context);
  // helper 在真机上靠经典脚本的顶层 var 把 PetShared 挂到 window，再由 constants.js 取成全局 S。
  // vm 里全局对象就是 context 本身，所以这里手动补上这两跳（不加载 constants.js：它要真 URL 参数）。
  context.window.PetShared = context.PetShared;
  context.S = context.PetShared;
  vm.runInContext(fishSource, context);
  return { Sprite, context, posts, store };
}

/**
 * 造一只已经挂好鱼层的宠物（几何取小尺寸，鱼群都落在窗口内）。
 *
 * @param {object} harness - {@link makeHarness} 的返回。
 * @param {object} snapshot - `sections.sessionFish.data`。
 */
function makePet(harness, snapshot) {
  const { Sprite } = harness;
  const pet = new Sprite();
  Object.assign(pet, {
    pet: { id: 'main', display: 'desktop' },
    assetRoot: 'main',
    size: 200,
    winH: 130,
    hitRect: { x: 60, y: 40, w: 80, h: 60 },
    winOffset: { x: 40, y: 60 },
    margin: { t: 40, r: 40, b: 40, l: 40 },
    pos: { x: 100, y: 100 },
    el: makeElement('div'),
    dragState: { active: false },
    throwRef: null,
    moveRef: null,
    sendBounds() {},
    setInteractive() {},
    syncInputBusy() {},
    playSfxSlot() {},
  });
  pet.initFish();
  pet.applyFishSnapshot(harness.context.window.PetShared.readSessionFish(snapshot));
  return pet;
}

/** 一份最小快照：一条鱼，已有一条播报。 */
function snapshotOf(over = {}) {
  return {
    enabled: true,
    sizePx: 96,
    maxCount: 6,
    bubbleMs: 12_000,
    skin: '写代码.webm',
    skinKind: 'video',
    followPet: true,
    speakEnabled: true,
    speakProgress: true,
    speakTurnEnd: true,
    speakWaiting: true,
    ts: 1,
    fishes: [
      {
        sessionId: 's1',
        state: 'working',
        task: '改 index.ts',
        line: '忙起来了',
        lineKind: 'progress',
        lineSeq: 3,
        lineAt: Date.now(),
        done: false,
        planPending: false,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    ...over,
  };
}

/** 视口内的假指针事件（窗口坐标）。 */
function pointerEvent(lx, ly, winOffset) {
  return {
    button: 0,
    clientX: lx + winOffset.x,
    clientY: ly + winOffset.y,
    pointerId: 1,
    currentTarget: { setPointerCapture() {}, releasePointerCapture() {} },
    preventDefault() {},
  };
}

test('鱼盒子可交互：命中判定按「窗口坐标 − 本体偏移」换算', () => {
  const harness = makeHarness();
  const pet = makePet(harness, snapshotOf());
  const body = pet.fishRoam.bodies().get('s1');
  assert.ok(body, '应当建出一条鱼的刚体');
  // 层坐标 → 窗口坐标 = 加 winOffset
  assert.equal(pet.fishAt(body.x + pet.winOffset.x + 5, body.y + pet.winOffset.y + 5), 's1');
  assert.equal(pet.fishAt(0, 0), null, '窗口别处不该命中');
});

test('拖拽走共享引擎，松手把偏移写进本窗口的 localStorage', () => {
  const harness = makeHarness();
  const pet = makePet(harness, snapshotOf());
  const before = pet.fishRoam.bodies().get('s1');
  const grab = { x: before.x + 20, y: before.y + 20 };
  pet.onFishPointerDown('s1', pointerEvent(grab.x, grab.y, pet.winOffset));
  assert.ok(pet.fishDrag, '按下后进入拖拽态');
  assert.equal(pet.fishBusy(), true, '拖拽期间必须算「正在用输入」');
  pet.onFishPointerMove(pointerEvent(grab.x + 60, grab.y + 40, pet.winOffset));
  assert.equal(pet.fishDrag.moved, true);
  pet.onFishPointerUp(pointerEvent(grab.x + 60, grab.y + 40, pet.winOffset));
  assert.equal(pet.fishDrag, null);
  const stored = JSON.parse(harness.store.get('dsh-pet:session-fish-offsets'));
  assert.ok(stored.s1, '偏移按会话记下来');
  assert.ok(Math.hypot(stored.s1.dx, stored.s1.dy) > 10, '偏移跟着落点走');
  // 跨 realm 的对象原型不同，deepEqual 会误判，这里走一遍 JSON
  assert.deepEqual(JSON.parse(JSON.stringify(pet.fishOffsets)), stored, '内存里的偏移同步更新（引擎下一帧就读它）');
});

test('按一下不算拖动：不写偏移、不进拖拽态', () => {
  const harness = makeHarness();
  const pet = makePet(harness, snapshotOf());
  const body = pet.fishRoam.bodies().get('s1');
  pet.onFishPointerDown('s1', pointerEvent(body.x + 20, body.y + 20, pet.winOffset));
  pet.onFishPointerUp(pointerEvent(body.x + 21, body.y + 20, pet.winOffset));
  assert.equal(harness.store.has('dsh-pet:session-fish-offsets'), false, '手抖不该记位置');
});

test('点 ×：立刻移除并通知宿主关掉这条鱼', async () => {
  const harness = makeHarness();
  const pet = makePet(harness, snapshotOf());
  const node = pet.fishEls.get('s1');
  assert.ok(node);
  pet.closeFish('s1');
  assert.equal(node.el.removed, true, '本地立刻消失，不等快照');
  assert.equal(pet.fishEls.has('s1'), false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const close = harness.posts.find((post) => post.body && post.body.action === 'close');
  assert.ok(close, '必须通知宿主');
  assert.equal(close.body.sessionId, 's1');
  assert.match(close.url, /\/session-fish$/);
});

test('没悬停、没拖拽时 fishBusy 为假（余量区继续穿透）', () => {
  const harness = makeHarness();
  const pet = makePet(harness, snapshotOf());
  assert.equal(pet.fishBusy(), false);
  pet.fishHover = 's1';
  assert.equal(pet.fishBusy(), true);
});

test('鱼没了窗口余量归零；有鱼时按环位撑开', () => {
  const harness = makeHarness();
  const pet = makePet(harness, snapshotOf());
  assert.ok(pet.margin.l > 40, '有鱼时左右余量被撑大');
  pet.applyFishSnapshot(harness.context.window.PetShared.readSessionFish(snapshotOf({ fishes: [] })));
  assert.equal(pet.margin.l, 40, '鱼没了回到构造期余量');
  assert.equal(pet.fishEls.size, 0);
});
