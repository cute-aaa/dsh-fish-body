/**
 * 桌面会话鱼：把 `/state` 的 `sections.sessionFish` 画进桌宠**自己的那个窗口**里。
 *
 * 为什么不另开窗口：桌面 Helper 的窗口本来就是「宠物包围盒 + 四周透明余量」而且跟着宠物逐帧走
 * （见 sprite/window-fit.js）。鱼围在桌宠旁边，正好落在同一块窗口里——所以这里只加一层
 * 绝对定位的 DOM + 一条 rAF，不新建 BrowserWindow、不新建渲染进程、不新增第二条 `/state` 轮询。
 * 运动完全复用共享层（`shared/session-fish/roam` → `window.PetShared`）：环位、弹簧、碰撞、
 * 偏移上限都与网页端同一份代码，两端因此不会各飘各的。
 *
 * 坐标系：**窗口局部 CSS 像素**。窗口跟着宠物走，所以环心恒定 = 宠物在窗口里的中心；
 * 鱼相对窗口不动，随宠物整体平移——不会被窗口边缘裁掉，也不会在宠物走动时拖出一条尾巴。
 *
 * 必须始终成立：
 * - 鱼层全程 `pointer-events: none`：命中区仍只报本体，鱼所在区域由主进程判成 margin 继续穿透；
 * - 窗口只在「真的有鱼」时按环位撑大（`fishWindowPad`），没鱼立刻收回；拖拽/飞行/漫游中推迟到运动结束；
 * - 任何一步失败都只影响鱼：入口全 try/catch，缺 `PetShared` 的旧产物直接不启用；
 * - 播报先向宿主认领出声权（`/session-fish/claim`），失败按放行——跨面只念一次，但绝不静音。
 * @module dsh-pet/runtime/electron-helper/sprite-fish
 */
'use strict';

/** 撞到东西时的最小相对速度（px/s）：鱼群自己挤一挤不该一直响。 */
const FISH_BUMP_MIN_SPEED = 220;
/** 碰撞音的最小间隔（ms）（与网页端同值）。 */
const FISH_BUMP_GAP_MS = 320;
/** 碰撞音音量：鱼比桌宠轻。 */
const FISH_BUMP_VOLUME = 0.45;

/**
 * 向宿主认领一条播报的出声权：每个 `(会话, 序号)` 全机器只授予一次。
 *
 * 语音链的单槽是每个窗口各一份的，网页与桌面同时显示会话鱼时，两边会各自把同一条播报念一遍。
 * 宿主是两端唯一的共同点，由它裁决。**请求失败一律按放行处理**：宁可偶尔多念一次，
 * 也不能因为一次网络抖动把播报永久静音。
 *
 * @param {string} sessionId - 会话 id。
 * @param {number} lineSeq - 该鱼的播报序号。
 * @returns {Promise<boolean>} 这一次是否由本窗口来念。
 */
async function claimFishSpeak(sessionId, lineSeq) {
  try {
    const response = await fetch(BASE + '/session-fish/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, lineSeq }),
    });
    if (!response.ok) return true;
    const body = await response.json();
    if (!body || body.ok === false) return true;
    return body.granted === true;
  } catch {
    return true;
  }
}

Object.assign(PetSprite.prototype, {
  /**
   * 建鱼层（构造期一次，`sprite/init.js` 的 buildDom 末尾调用）。
   *
   * 鱼层插在 `this.el` 的第一个子节点：后面那些兄弟（气泡、提示、舞台）都是定位元素，
   * 按 DOM 顺序画在它上面，于是鱼永远从宠物背后掠过，不会盖住脸。
   */
  initFish() {
    this.fishSnap = null;
    /** sessionId → { el, media } */
    this.fishEls = new Map();
    /** 素材加载失败的会话（同一个皮肤 404 时不反复重建） */
    this.fishFailed = new Set();
    this.fishRoam = null;
    this.fishRaf = null;
    /** 已向窗口申请的额外余量（px，单边）；与 fishPadDirty 一起决定要不要改窗口尺寸 */
    this.fishPad = { x: 0, y: 0 };
    this.fishPadDirty = false;
    /** 播报基线：sessionId → 已处理过的 lineSeq（首拉只记基线，不补念历史） */
    this.fishSeq = {};
    this.fishSeeded = false;
    /** 构造期的原始余量：加鱼时按它取 max，撤鱼时才能精确还原 */
    this.baseMargin = { t: this.margin.t, r: this.margin.r, b: this.margin.b, l: this.margin.l };
    const layer = document.createElement('div');
    layer.className = 'pet-fish-layer';
    this.el.insertBefore(layer, this.el.firstChild);
    this.fishLayer = layer;
  },

  /**
   * 应用一份会话鱼快照（`/state` 的 `sections.sessionFish` 解析结果）。
   *
   * @param {object|null} snapshot - `S.readSessionFish` 的结果。
   */
  applyFishSnapshot(snapshot) {
    try {
      this.fishSnap = snapshot;
      this.applyFishSpeech(snapshot);
      this.syncFish();
    } catch (error) {
      // 鱼是旁路：出错只记日志，桌宠本体照常
      console.warn('[dsh-pet] 桌面会话鱼处理失败：', error);
    }
  },

  /**
   * 播报：只念「本窗口显示出来的那几条」，且先认领出声权。
   *
   * 序号语义与网页端完全一致（`shared/session-fish` 的 `sessionFishSpeechOf`）：
   * 首拉只记基线，之后序号变大才念；插件重载后序号从头开始时只把基线拉回来。
   *
   * @param {object} snapshot - 会话鱼快照。
   */
  applyFishSpeech(snapshot) {
    if (!snapshot || !snapshot.enabled) return;
    const previous = this.fishSeq;
    if (!this.fishSeeded) {
      for (const fish of snapshot.fishes) previous[fish.sessionId] = fish.lineSeq;
      this.fishSeeded = true;
      return;
    }
    for (const fish of S.selectSessionFishes(snapshot.fishes, snapshot.maxCount)) {
      const before = previous[fish.sessionId] || 0;
      if (before > 0 && fish.lineSeq < before) {
        previous[fish.sessionId] = fish.lineSeq; // 宿主重启过：只看不念
        continue;
      }
      const line = S.sessionFishSpeechOf(fish, before, snapshot);
      previous[fish.sessionId] = fish.lineSeq;
      if (line === undefined) continue;
      void claimFishSpeak(fish.sessionId, fish.lineSeq).then((granted) => {
        if (granted) S.speakNotice(line);
      });
    }
  },

  /** 当前窗口的局部视口（含余量）：鱼的边界就是窗口边界。 */
  fishViewport() {
    return {
      w: this.size + this.margin.l + this.margin.r,
      h: this.winH + this.margin.t + this.margin.b,
    };
  },

  /** 当前桌宠在窗口局部坐标里的锚点（中心、尺寸与身体盒）。 */
  fishAnchor() {
    const ox = this.winOffset.x;
    const oy = this.winOffset.y;
    const hit = this.hitRect;
    return {
      cx: ox + this.size / 2,
      cy: oy + this.winH / 2,
      w: this.size,
      h: this.winH,
      body: {
        left: ox + hit.x,
        top: oy + hit.y,
        right: ox + hit.x + hit.w,
        bottom: oy + hit.y + hit.h,
      },
    };
  },

  /**
   * 把快照同步成 DOM 与引擎：多退少补地增删元素，再重建一次槽位。
   *
   * 幂等：每次 `/state` 变化都会调它，重复调用不该产生新元素或新引擎。
   */
  syncFish() {
    if (!this.fishLayer) return;
    const snapshot = this.fishSnap;
    const width = Math.round(
      Math.min(
        S.SESSION_FISH_SIZE_MAX,
        Math.max(S.SESSION_FISH_SIZE_MIN, snapshot ? snapshot.sizePx : S.SESSION_FISH_SIZE_DEFAULT),
      ),
    );
    const skin = snapshot ? snapshot.skin : S.SESSION_FISH_SKIN_DEFAULT;
    const height = S.sessionFishHeightOf(width, S.sessionFishAspectOf(skin));
    const listed =
      snapshot && snapshot.enabled
        ? S.selectSessionFishes(snapshot.fishes, snapshot.maxCount).filter(
            (fish) => !this.fishFailed.has(fish.sessionId),
          )
        : [];
    // 先按列表增删元素（会话结束/被关掉的那条从这里消失）
    const alive = new Set(listed.map((fish) => fish.sessionId));
    for (const [sessionId, node] of this.fishEls) {
      if (alive.has(sessionId)) continue;
      node.el.remove();
      this.fishEls.delete(sessionId);
    }
    for (const fish of listed) {
      let node = this.fishEls.get(fish.sessionId);
      if (!node) node = this.createFishEl(fish.sessionId, snapshot, width, height);
      if (!node) continue;
      node.el.style.width = width + 'px';
      node.el.style.height = height + 'px';
    }
    const boxes = listed
      .filter((fish) => this.fishEls.has(fish.sessionId))
      .map((fish) => ({ id: fish.sessionId, w: width, h: height }));
    // 窗口余量跟着鱼群走：有鱼按环位撑开，没鱼收回
    this.requestFishPad(width, height, boxes.length > 0);
    if (boxes.length === 0) {
      this.stopFishLoop();
      if (this.fishRoam) this.fishRoam.sync([]);
      return;
    }
    if (!this.fishRoam) {
      this.fishRoam = S.createRoam({
        viewport: () => this.fishViewport(),
        anchor: () => this.fishAnchor(),
        // 桌面端鱼不可拖（全程穿透），所以没有持久化偏移；位置只由环位 + 碰撞决定
        offsets: () => ({}),
        // 桌面没有「右下角竖排」这一说：没有别的窗口可躲，鱼永远围着宠物
        followPet: () => true,
        now: () => Date.now(),
        reducedMotion: () => false,
      });
    }
    this.fishRoam.sync(boxes);
    this.paintFish();
    this.startFishLoop();
  },

  /**
   * 建一条鱼的 DOM（一个盒子 + 一个媒体元素）。
   *
   * @param {string} sessionId - 会话 id。
   * @param {object} snapshot - 快照（取皮肤与渲染方式）。
   * @param {number} width - 显示宽度（px）。
   * @param {number} height - 显示高度（px）。
   * @returns {{el: HTMLElement, media: HTMLElement}|null} 节点；失败返回 null。
   */
  createFishEl(sessionId, snapshot, width, height) {
    const url = BASE + '/session-fish/skin?name=' + encodeURIComponent(snapshot.skin);
    const useImage = snapshot.skinKind === 'image';
    const box = document.createElement('div');
    box.className = 'pet-fish';
    box.setAttribute('data-session-id', sessionId);
    box.style.width = width + 'px';
    box.style.height = height + 'px';
    const media = useImage ? document.createElement('img') : document.createElement('video');
    media.className = 'pet-fish__media';
    if (useImage) {
      media.alt = '';
      media.draggable = false;
      media.onload = () => this.measureFish(snapshot.skin, media.naturalWidth, media.naturalHeight);
    } else {
      media.muted = true;
      media.loop = true;
      media.autoplay = true;
      media.playsInline = true;
      media.preload = 'auto';
      media.onloadedmetadata = () => this.measureFish(snapshot.skin, media.videoWidth, media.videoHeight);
    }
    // 取不到素材（404 / 解码失败）：这一条静默消失，不重试也不刷屏——同一个皮肤下其余鱼同理
    media.onerror = () => this.dropFish(sessionId);
    media.src = url;
    box.appendChild(media);
    this.fishLayer.appendChild(box);
    const node = { el: box, media };
    this.fishEls.set(sessionId, node);
    return node;
  },

  /**
   * 量到素材真实比例：比例变了就按新高度重排一次。
   *
   * @param {string} skin - 皮肤 id。
   * @param {number} width - 素材宽。
   * @param {number} height - 素材高。
   */
  measureFish(skin, width, height) {
    if (!S.rememberSessionFishAspect(skin, width, height)) return;
    this.syncFish();
  },

  /**
   * 丢掉一条加载失败的鱼（并让引擎也把它摘掉）。
   *
   * @param {string} sessionId - 会话 id。
   */
  dropFish(sessionId) {
    this.fishFailed.add(sessionId);
    const node = this.fishEls.get(sessionId);
    if (node) {
      node.el.remove();
      this.fishEls.delete(sessionId);
    }
    try {
      this.syncFish();
    } catch (error) {
      console.warn('[dsh-pet] 桌面会话鱼移除失败：', error);
    }
  },

  /**
   * 申请窗口余量：值变了才生效，且推后到运动结束（改窗口尺寸会打断拖拽/飞行）。
   *
   * @param {number} fishW - 鱼的显示宽度。
   * @param {number} fishH - 鱼的显示高度。
   * @param {boolean} needed - 当前是否真的有鱼。
   */
  requestFishPad(fishW, fishH, needed) {
    const pad = needed ? S.fishWindowPad({ w: this.size, h: this.winH }, { w: fishW, h: fishH }) : { x: 0, y: 0 };
    if (pad.x === this.fishPad.x && pad.y === this.fishPad.y) return;
    this.fishPad = pad;
    this.fishPadDirty = true;
    this.applyFishPad();
  },

  /** 把待生效的余量落到 `margin` 并让主进程重设窗口尺寸（运动中的话留到下一帧再试）。 */
  applyFishPad() {
    if (!this.fishPadDirty) return;
    if (this.dragState.active || this.throwRef !== null || this.moveRef !== null) return;
    this.fishPadDirty = false;
    const base = this.baseMargin;
    const pad = this.fishPad;
    this.margin.l = Math.max(base.l, pad.x);
    this.margin.r = Math.max(base.r, pad.x);
    this.margin.t = Math.max(base.t, pad.y);
    this.margin.b = Math.max(base.b, pad.y);
    // 余量变了 → 窗口尺寸要跟着变：立刻按当前位置重算一次（位置不变，只是窗口变大/变小）
    this.sendBounds(this.pos.x, this.pos.y);
  },

  /** 每帧把引擎算出来的位置写到 DOM（只写 transform 与一个挤压 class）。 */
  paintFish() {
    if (!this.fishRoam) return;
    const bodies = this.fishRoam.bodies();
    const now = Date.now();
    for (const [sessionId, node] of this.fishEls) {
      const body = bodies.get(sessionId);
      if (!body) continue;
      node.el.style.transform = 'translate3d(' + Math.round(body.x) + 'px,' + Math.round(body.y) + 'px,0)';
      node.el.classList.toggle('is-bumping', body.bumpUntil > now);
    }
  },

  /** 起一条 rAF（已在跑就不重复起）：步进物理 → 画一帧 → 结算撞击音。 */
  startFishLoop() {
    if (this.fishRaf !== null) return;
    const tick = () => {
      this.fishRaf = null;
      if (!this.fishLayer) return;
      this.applyFishPad(); // 运动期间挂起的余量变更在这里补上
      const roam = this.fishRoam;
      if (roam) {
        roam.step();
        this.paintFish();
        for (const impact of roam.takeImpacts()) {
          if (impact.speed < FISH_BUMP_MIN_SPEED) continue;
          S.playSfx(soundUrlOf(this.assetRoot, 'bump-soft.wav', this.pet.model || '', this.pet.renderer), {
            volume: FISH_BUMP_VOLUME,
            throttleMs: FISH_BUMP_GAP_MS,
            throttleKey: this.pet.id + ':fish-bump',
          });
        }
      }
      if (this.fishEls.size === 0) return; // 没鱼了就不再排下一帧
      this.fishRaf = requestAnimationFrame(tick);
    };
    this.fishRaf = requestAnimationFrame(tick);
  },

  /** 停掉鱼的运动循环（没有鱼 / 窗口销毁）。 */
  stopFishLoop() {
    if (this.fishRaf === null) return;
    cancelAnimationFrame(this.fishRaf);
    this.fishRaf = null;
  },

  /** 卸载：停循环、清 DOM 与引擎（`dispose` 调用一次）。 */
  disposeFish() {
    this.stopFishLoop();
    this.fishRoam = null;
    for (const node of this.fishEls.values()) node.el.remove();
    this.fishEls.clear();
    if (this.fishLayer) {
      this.fishLayer.remove();
      this.fishLayer = null;
    }
  },
});
