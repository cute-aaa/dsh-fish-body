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
/** 拖动判定阈值（px）：小于它算一次点击（与网页端同值），避免手抖把「点一下」变成「拖走」。 */
const FISH_DRAG_THRESHOLD_PX = 4;
/** 本地存储键：与网页端同名（两个页面不同源，各记各的，互不覆盖）。 */
const FISH_OFFSETS_KEY = 'dsh-pet:session-fish-offsets';
/** 一次存储里最多保留多少条（与网页端同值）。 */
const FISH_OFFSETS_MAX = 60;

/**
 * 读本窗口记住的拖拽偏移。
 *
 * 桌面窗口是 `file://` 页面，`localStorage` 与 DSH 网页不同源——所以桌面拖过的位置只在桌面有效，
 * 网页那份不受影响（两边各自记，谁也覆盖不到谁）。
 *
 * @returns {Record<string, {dx: number, dy: number}>} 会话 id → 相对槽位的偏移。
 */
function readFishOffsets() {
  try {
    const raw = window.localStorage.getItem(FISH_OFFSETS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      if (!Number.isFinite(value.dx) || !Number.isFinite(value.dy)) continue;
      out[id] = { dx: value.dx, dy: value.dy };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 记一条偏移（其他会话的保留，最多 {@link FISH_OFFSETS_MAX} 条）。
 *
 * @param {string} sessionId - 会话 id。
 * @param {{dx: number, dy: number}} offset - 相对槽位的偏移（px）。
 * @returns {Record<string, {dx: number, dy: number}>} 新的全量偏移表。
 */
function writeFishOffset(sessionId, offset) {
  const current = readFishOffsets();
  const next = { [sessionId]: { dx: offset.dx, dy: offset.dy } };
  for (const [id, value] of Object.entries(current)) {
    if (id === sessionId) continue;
    if (Object.keys(next).length >= FISH_OFFSETS_MAX) break;
    next[id] = value;
  }
  try {
    window.localStorage.setItem(FISH_OFFSETS_KEY, JSON.stringify(next));
  } catch {
    /* 存储满 / 被禁用：这次拖拽仍生效到本次刷新为止 */
  }
  return next;
}

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
    /** sessionId → { el, media, bubble, line } */
    this.fishEls = new Map();
    /** 素材加载失败的会话（同一个皮肤 404 时不反复重建） */
    this.fishFailed = new Set();
    /** 用户点 × 本地隐藏的会话（快照里没有它了就解除，下一轮对话还会出现） */
    this.fishHidden = new Set();
    this.fishRoam = null;
    this.fishRaf = null;
    /** 已向窗口申请的额外余量（px，单边）；与 fishPadDirty 一起决定要不要改窗口尺寸 */
    this.fishPad = { x: 0, y: 0 };
    this.fishPadDirty = false;
    /** 播报基线：sessionId → 已处理过的 lineSeq（首拉只记基线，不补念历史） */
    this.fishSeq = {};
    this.fishSeeded = false;
    /** 拖拽中的那条鱼：{ sessionId, pointerId, startX, startY, moved }（层坐标） */
    this.fishDrag = null;
    /** 当前光标悬停的那条鱼（主进程靠它 + 控件矩形把余量区那条鱼圈成可交互） */
    this.fishHover = null;
    /** 刚拖完的时间窗：吞掉随后的 click（触屏/合成事件里 click 可能晚于 pointerup） */
    this.fishClickSuppressUntil = 0;
    /** 本窗口记住的拖拽偏移（`file://` 与网页不同源，各记各的） */
    this.fishOffsets = readFishOffsets();
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
            (fish) => !this.fishFailed.has(fish.sessionId) && !this.fishHidden.has(fish.sessionId),
          )
        : [];
    // 会话真的消失了（结束/被淘汰）：本地隐藏标记随之解除，下一轮对话它还会回来（与网页端同语义）
    const known = new Set((snapshot ? snapshot.fishes : []).map((fish) => fish.sessionId));
    for (const id of [...this.fishHidden]) if (!known.has(id)) this.fishHidden.delete(id);
    // 先按列表增删元素（会话结束/被关掉的那条从这里消失）
    const alive = new Set(listed.map((fish) => fish.sessionId));
    for (const [sessionId, node] of this.fishEls) {
      if (alive.has(sessionId)) continue;
      node.el.remove();
      this.fishEls.delete(sessionId);
      if (this.fishHover === sessionId) this.fishHover = null;
      if (this.fishDrag && this.fishDrag.sessionId === sessionId) this.fishDrag = null;
    }
    for (const fish of listed) {
      let node = this.fishEls.get(fish.sessionId);
      if (!node) node = this.createFishEl(fish.sessionId, snapshot, width, height);
      if (!node) continue;
      node.el.style.width = width + 'px';
      node.el.style.height = height + 'px';
      this.updateFishBubble(node, fish);
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
        // 桌面端拖过的位置记在本窗口的 localStorage（与网页不同源，各记各的）
        offsets: () => this.fishOffsets,
        // 桌面没有「右下角竖排」这一说：没有别的窗口可躲，鱼永远围着宠物
        followPet: () => true,
        now: () => Date.now(),
        reducedMotion: () => false,
      });
    }
    this.fishRoam.sync(boxes);
    this.paintFish();
    this.startFishLoop();
    // 鱼集合变了 → 控件矩形也变了：主进程要知道哪些新区域可以接点击
    if (typeof this.syncInputBusy === 'function') this.syncInputBusy();
  },

  /**
   * 建一条鱼的 DOM（一个盒子 + 媒体元素 + 气泡 + 关闭按钮）。
   *
   * 盒子可拖：`pointerdown` 交给引擎、超过阈值才算拖动；右上角的 × 只在悬停时出现，
   * 点它就是「关掉这一条」（宿主随后把它从快照里移掉）。两者都在这块盒子里，
   * 而主进程只在这块盒子被悬停时把窗口翻成可交互（`fishBusy` + 控件矩形）。
   *
   * @param {string} sessionId - 会话 id。
   * @param {object} snapshot - 快照（取皮肤与渲染方式）。
   * @param {number} width - 显示宽度（px）。
   * @param {number} height - 显示高度（px）。
   * @returns {{el: HTMLElement, media: HTMLElement, bubble: HTMLElement, line: string}|null} 节点。
   */
  createFishEl(sessionId, snapshot, width, height) {
    const url = BASE + '/session-fish/skin?name=' + encodeURIComponent(snapshot.skin);
    const useImage = snapshot.skinKind === 'image';
    const box = document.createElement('div');
    box.className = 'pet-fish';
    box.setAttribute('data-session-id', sessionId);
    box.style.width = width + 'px';
    box.style.height = height + 'px';
    box.addEventListener('pointerdown', (e) => this.onFishPointerDown(sessionId, e));
    box.addEventListener('pointermove', (e) => this.onFishPointerMove(e));
    box.addEventListener('pointerup', (e) => this.onFishPointerUp(e));
    box.addEventListener('pointercancel', (e) => this.onFishPointerUp(e));
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
    // 气泡：显示这一条鱼最近一句播报（与网页端同一套显隐规则：完成常驻、其余停留 bubbleMs）
    const bubble = document.createElement('div');
    bubble.className = 'pet-fish__bubble';
    bubble.setAttribute('aria-hidden', 'true');
    box.appendChild(bubble);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pet-fish__close';
    close.textContent = '×';
    close.title = '关闭这条会话鱼';
    // 按下就吞掉：否则会同时开始拖这条鱼
    close.addEventListener('pointerdown', (e) => e.stopPropagation());
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.closeFish(sessionId);
    });
    box.appendChild(close);
    this.fishLayer.appendChild(box);
    const node = { el: box, media, bubble, line: '' };
    this.fishEls.set(sessionId, node);
    return node;
  },

  /**
   * 把这一条鱼的播报写进气泡（内容变了才写 DOM）。
   *
   * @param {{bubble: HTMLElement, line: string}} node - 鱼节点。
   * @param {object} fish - 快照里的那一条。
   */
  updateFishBubble(node, fish) {
    node.entry = fish;
    const text = fish.line ?? fish.task ?? '';
    if (text === node.line) return;
    node.line = text;
    node.bubble.textContent = text;
  },

  /**
   * 点 ×：本地立刻隐藏并请宿主把这条鱼移掉（与网页端同一条动作）。
   *
   * @param {string} sessionId - 会话 id。
   */
  closeFish(sessionId) {
    this.fishHidden.add(sessionId);
    const node = this.fishEls.get(sessionId);
    if (node) {
      node.el.remove();
      this.fishEls.delete(sessionId);
    }
    if (this.fishHover === sessionId) this.fishHover = null;
    try {
      this.syncFish();
    } catch (error) {
      console.warn('[dsh-pet] 桌面会话鱼关闭失败：', error);
    }
    void S.postAction(BASE + '/session-fish', { action: 'close', sessionId }).then((ok) => {
      if (!ok) console.warn('[dsh-pet] 关闭会话鱼未送达 session=' + sessionId);
    });
  },

  /**
   * 层坐标（= 窗口坐标减去本体偏移）下命中的鱼。
   *
   * @param {number} wx - 窗口内 x（CSS px）。
   * @param {number} wy - 窗口内 y（CSS px）。
   * @returns {string|null} 命中的会话 id。
   */
  fishAt(wx, wy) {
    if (!this.fishRoam) return null;
    const lx = wx - this.winOffset.x;
    const ly = wy - this.winOffset.y;
    for (const [sessionId, body] of this.fishRoam.bodies()) {
      if (!this.fishEls.has(sessionId)) continue;
      if (lx >= body.x && lx <= body.x + body.w && ly >= body.y && ly <= body.y + body.h) return sessionId;
    }
    return null;
  },

  /** 本窗口此刻是否需要「借 busy + 控件矩形」把鱼圈成可交互（悬停或正在拖一条鱼）。 */
  fishBusy() {
    return this.fishDrag !== null || this.fishHover !== null;
  },

  /** 鱼盒子的窗口内矩形（主进程据此放行点击）。 */
  fishRects() {
    const rects = [];
    for (const node of this.fishEls.values()) {
      const r = node.el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        rects.push({ x: toScreen(r.x), y: toScreen(r.y), width: toScreen(r.width), height: toScreen(r.height) });
      }
    }
    return rects;
  },

  /**
   * 按下一条鱼：交给引擎「拿着」，阈值内不算拖动（仍是一次点击）。
   *
   * @param {string} sessionId - 会话 id。
   * @param {PointerEvent} e - 指针事件（窗口坐标）。
   */
  onFishPointerDown(sessionId, e) {
    if (e.button !== 0 || !this.fishRoam) return;
    const lx = e.clientX - this.winOffset.x;
    const ly = e.clientY - this.winOffset.y;
    this.fishRoam.beginDrag(sessionId, { x: lx, y: ly });
    this.fishDrag = { sessionId, pointerId: e.pointerId, startX: lx, startY: ly, moved: false };
    const node = this.fishEls.get(sessionId);
    if (node) node.el.classList.add('is-dragging');
    // 拖拽期间窗口必须保持可交互：交给主进程的 dragging 租约（见 input.js 的 syncInputRegions）
    if (typeof this.syncInputBusy === 'function') this.syncInputBusy();
    this.setInteractive(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 个别环境没有捕获：拖动仍按 move 事件生效 */
    }
    e.preventDefault();
  },

  /**
   * 拖动一条鱼：超过阈值才真的拖（鱼跟手，引擎负责夹进可达区）。
   *
   * @param {PointerEvent} e - 指针事件（窗口坐标）。
   */
  onFishPointerMove(e) {
    const drag = this.fishDrag;
    if (!drag) return;
    const lx = e.clientX - this.winOffset.x;
    const ly = e.clientY - this.winOffset.y;
    if (!drag.moved) {
      if (Math.abs(lx - drag.startX) + Math.abs(ly - drag.startY) < FISH_DRAG_THRESHOLD_PX) return;
      drag.moved = true;
    }
    this.fishRoam?.dragTo({ x: lx, y: ly });
    this.paintFish(); // 不等下一帧：跟手要即时
    e.preventDefault();
  },

  /**
   * 松开一条鱼：拖动过才存偏移（随后的 click 被时间窗吞掉）。
   *
   * @param {PointerEvent} e - 指针事件（窗口坐标）。
   */
  onFishPointerUp(e) {
    const drag = this.fishDrag;
    if (!drag) return;
    this.fishDrag = null;
    const node = this.fishEls.get(drag.sessionId);
    if (node) node.el.classList.remove('is-dragging');
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* 没有捕获可释放 */
    }
    const pointer = {
      x: Number.isFinite(e.clientX) ? e.clientX - this.winOffset.x : drag.startX,
      y: Number.isFinite(e.clientY) ? e.clientY - this.winOffset.y : drag.startY,
    };
    const saved = this.fishRoam?.endDrag(drag.moved ? pointer : undefined);
    if (drag.moved && saved) {
      // 松手时间窗：触屏/合成事件的 click 可能在 pointerup 之后才到
      this.fishClickSuppressUntil = Date.now() + 400;
      this.fishOffsets = writeFishOffset(saved.id, saved.offset);
      this.paintFish();
    }
    if (typeof this.syncInputBusy === 'function') this.syncInputBusy();
    if (drag.moved) e.preventDefault();
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
    // 拖鱼期间绝不能改窗口尺寸：窗口一动，指针相对窗口的坐标就跳，正在拖的那条会脱手
    if (this.dragState.active || this.fishDrag !== null || this.throwRef !== null || this.moveRef !== null) return;
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

  /** 每帧把引擎算出来的位置写到 DOM（只写 transform、气泡显隐与两个 class）。 */
  paintFish() {
    if (!this.fishRoam) return;
    const bodies = this.fishRoam.bodies();
    const now = Date.now();
    const snapshot = this.fishSnap;
    const bubbleMs = snapshot ? snapshot.bubbleMs : 12_000;
    const anchor = this.fishAnchor();
    for (const [sessionId, node] of this.fishEls) {
      const body = bodies.get(sessionId);
      if (!body) continue;
      node.el.style.transform = 'translate3d(' + Math.round(body.x) + 'px,' + Math.round(body.y) + 'px,0)';
      node.el.classList.toggle('is-bumping', body.bumpUntil > now);
      // 气泡：与网页端同一条显隐规则（完成常驻，其余在播报后停留 bubbleMs）；
      // 朝向背离宠物那一侧，免得盖住本体。
      const fish = node.entry;
      const show = fish !== undefined && S.isSessionFishBubbleVisible(fish, now, bubbleMs);
      node.el.classList.toggle('is-talking', show);
      node.el.classList.toggle('is-flipped', body.x + body.w / 2 > anchor.cx);
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
    this.fishDrag = null;
    this.fishHover = null;
    for (const node of this.fishEls.values()) node.el.remove();
    this.fishEls.clear();
    if (this.fishLayer) {
      this.fishLayer.remove();
      this.fishLayer = null;
    }
  },
});
