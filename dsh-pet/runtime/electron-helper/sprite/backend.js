/**
 * 桌面 Helper 的非 webm 画面层：按 `pets[].renderer` 挂 layered（分层 PNG 合成）或 live2d（pixi + Cubism）。
 *
 * 只负责「视觉与动作」：播放链、拖拽、抛掷、气泡、菜单、穿透判定仍在既有文件里，一行不搬。
 * 与 webm 的接缝只有三处：`frontEl()`（前台可视元素）、`switchTo` 的非 webm 分支（换动作）、
 * 冻结/解冻（暂停与续播）；其余代码读到的仍是原来的 `this.front / videoA / videoB`。
 *
 * layered 的装配数学来自 `layered-core.js`（window.PetLayered，源 src/client/pet/render/layered），
 * 与浏览器端同一份实现；live2d 的 pixi / pip 依赖走宿主 `/vendor` 的 UMD，按 Core → pixi → cubism4 加载。
 * 必须始终成立：任何挂载失败只告警并把舞台留空，绝不抛出到构造链——透明窗口一崩就只剩一个看不见的进程。
 * @module dsh-pet/runtime/electron-helper/sprite-backend
 */
'use strict';

/** 换动作后合成的「播完」时刻（ms）：canvas 后端没有 ended 事件，靠它把既有动画链推下去。 */
const BACKEND_ACTION_MS = 2200;
/** layered 的呼吸/摇摆周期与动作时长，与浏览器端 render/layered.ts 同值。 */
const BREATH_MS = 3200;
const SWAY_MS = 5200;
const BLINK_GAP_MIN_MS = 2600;
const BLINK_GAP_MAX_MS = 5200;
const BLINK_MS = 130;
const HOP_MS = 460;
const MOUTH_MS = 760;
const DECAY = 3;

/** 拼一个皮肤资源地址（与宿主 /skin 路由同形）。 */
const skinUrlOf = (root, rel) => BASE + '/skin/' + encodeURIComponent(root) + '/' + rel;

/** 取图：优先 createImageBitmap（零拷贝），退回 Image。 */
async function loadSkinImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('皮肤图 HTTP ' + res.status + ' ' + url);
  const blob = await res.blob();
  if (typeof window.createImageBitmap === 'function') return window.createImageBitmap(blob);
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('皮肤图解码失败 ' + url));
    img.src = URL.createObjectURL(blob);
  });
}

/** 皮肤 manifest 声明的交互手势 → 装配动作：pat=摸头、poke=戳身、tailpet=摸尾。 */
const GESTURE_KINDS = {
  pat: 'jelly',
  poke: 'hop',
  tailpet: 'wag',
  wag: 'wag',
  tail: 'wag',
  hop: 'hop',
  jump: 'hop',
  blink: 'blink',
  talk: 'talk',
  speak: 'talk',
  mouth: 'mouth',
  jelly: 'jelly',
};

/** webm 动画池的动作名 → 装配动作（按顺序匹配，先中先得）。 */
const NAME_RULES = [
  [/blink|眨/, 'blink'],
  [/wag|tail|摇尾|甩尾/, 'wag'],
  [/hop|jump|跳|跃/, 'hop'],
  [/talk|say|speak|说|碎碎念|对话|聊/, 'talk'],
  [/mouth|张嘴|嘴|吃/, 'mouth'],
  [/pat|poke|摸|戳|点击|回应|click|tap/, 'jelly'],
  [/余额|钱/, 'jelly'],
  [/工作状态|busy|work/, 'blink'],
];

/**
 * 动作名 → 装配动作。
 *
 * 先认皮肤清单里的手势 id（regions/menu 用的那套词汇），再回落到 webm 池的动作名关键词：
 * layered 没有逐帧素材，动画池里的名字只有「说 / 摸 / 跳 / 余额」这几类语义值得翻译。
 *
 * @param {string} name - 动画名或手势 id。
 * @returns {'blink'|'wag'|'hop'|'talk'|'mouth'|'jelly'|null} 装配动作；无对应时为 null（保持待机循环）。
 */
function actionKind(name) {
  const key = String(name || '')
    .trim()
    .toLowerCase();
  if (GESTURE_KINDS[key] !== undefined) return GESTURE_KINDS[key];
  for (const [re, kind] of NAME_RULES) {
    if (re.test(key)) return kind;
  }
  return null;
}

/**
 * 注入一个经典脚本并等全局就绪（幂等）。
 *
 * @param {string} src - 脚本地址（http://127.0.0.1:PORT/vendor/...）。
 * @param {() => boolean} ready - 全局就绪判定。
 * @param {string} label - 失败文案里的名字。
 * @returns {Promise<void>}
 */
function ensureScript(src, ready, label) {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => (ready() ? resolve() : reject(new Error(label + ' 未就绪')));
    script.onerror = () => reject(new Error(label + ' 脚本加载失败'));
    document.head.appendChild(script);
  });
}

/** 依次加载 Cubism Core、pixi、pixi-live2d-display（顺序即依赖），返回 live2d 命名空间。 */
async function ensureLive2dRuntime() {
  await ensureScript(
    BASE + '/cubism/live2dcubismcore.min.js',
    () => window.Live2DCubismCore !== undefined,
    'Cubism Core',
  );
  await ensureScript(BASE + '/vendor/pixi.min.js', () => window.PIXI !== undefined, 'pixi');
  await ensureScript(
    BASE + '/vendor/live2d-cubism4.min.js',
    () => window.PIXI.live2d !== undefined,
    'pixi-live2d-display',
  );
  if (!window.PIXI || !window.PIXI.live2d) throw new Error('PIXI.live2d 未注册');
  return window.PIXI.live2d;
}

/** 画布舞台：宿主尺寸 = 宠物尺寸的正方形，底部对齐（与浏览器 layered/live2d 的画布口径一致）。 */
function createCanvasHost(sprite, host) {
  const canvas = document.createElement('canvas');
  canvas.className = 'pet-visual-canvas';
  canvas.width = sprite.size;
  canvas.height = sprite.size;
  canvas.style.cssText =
    'position:absolute;left:50%;bottom:0;transform:translateX(-50%);' +
    'width:' +
    sprite.size +
    'px;height:' +
    sprite.size +
    'px;pointer-events:none;';
  host.appendChild(canvas);
  return canvas;
}

/**
 * 挂载 layered：manifest → 分层图 → canvas 合成（呼吸/摇摆/眨眼/嘴/尾巴/弹跳/挤压）。
 *
 * @param {PetSprite} sprite - 宠物实例（读 assetRoot / size）。
 * @param {HTMLElement} host - 画面包装层（squash 的 transform 落点）。
 * @param {object} api - 由 mountBackend 建的句柄，用于回写 canvas 与动作。
 */
async function mountLayered(sprite, host, api) {
  const root = sprite.assetRoot;
  const res = await fetch(skinUrlOf(root, 'manifest.json'));
  if (!res.ok) throw new Error('皮肤 manifest HTTP ' + res.status + '（' + root + '）');
  const skin = window.PetLayered.parseSkinManifest(await res.json());
  if (skin === null) throw new Error('皮肤 manifest 解析失败：' + root);
  api.skin = skin;
  const layers = await Promise.all(
    skin.layers.map(async (layer) => ({
      role: layer.role,
      group: layer.group,
      image: await loadSkinImage(skinUrlOf(root, layer.file)),
    })),
  );
  const openMouth =
    skin.rig.mouth && skin.rig.mouth.open ? await loadSkinImage(skinUrlOf(root, skin.rig.mouth.open)) : null;
  if (api.destroyed) return;

  const canvas = createCanvasHost(sprite, host);
  canvas.width = skin.canvas.w;
  canvas.height = skin.canvas.h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('canvas 2d 上下文不可用');

  let tMs = 0;
  let lastMs = performance.now();
  let mouth = 0;
  let gazeX = 0;
  let gazeY = 0;
  let tail = 0;
  let hopT = 0;
  let hopActive = false;
  let jelly = 0;
  let blinkT = 0;
  let nextBlinkAt = lastMs + BLINK_GAP_MIN_MS;
  let mouthActionT = 0;
  let mouthAction = false;
  let talk = false;
  let talkTimer = null;
  api.canvas = canvas;

  const loop = () => {
    if (api.destroyed) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - lastMs) / 1000));
    lastMs = now;
    tMs += dt * 1000;
    if (now >= nextBlinkAt) {
      blinkT = 1;
      nextBlinkAt = now + BLINK_MS + BLINK_GAP_MIN_MS + Math.random() * (BLINK_GAP_MAX_MS - BLINK_GAP_MIN_MS);
    }
    blinkT = Math.max(0, blinkT - dt * (1000 / BLINK_MS));
    if (hopActive) {
      hopT += dt * (1000 / HOP_MS);
      if (hopT >= 1) {
        hopT = 0;
        hopActive = false;
      }
    }
    if (mouthAction) {
      mouthActionT += dt * (2000 / MOUTH_MS);
      mouth = Math.sin(Math.min(mouthActionT, 1) * Math.PI);
      if (mouthActionT >= 2) {
        mouthAction = false;
        mouth = 0;
      }
    }
    if (talk) mouth = 0.5 + 0.5 * Math.sin((tMs / 140) * 0.5);
    tail *= Math.max(0, 1 - dt * DECAY);
    jelly = Math.max(0, jelly - dt * DECAY);
    const state = {
      breath: (tMs / BREATH_MS) * Math.PI * 2,
      sway: (tMs / SWAY_MS) * Math.PI * 2,
      blink: blinkT,
      gazeX,
      gazeY,
      mouth,
      tail,
      hop: hopActive ? hopT : 0,
      jelly,
    };
    window.PetLayered.drawPoses(ctx, window.PetLayered.computePoses(skin, layers, openMouth, state));
    api.frame = requestAnimationFrame(loop);
  };
  loop();

  api.playAction = (name) => {
    const kind = actionKind(name);
    // 命中区手势（regions 的 gesture）与动画名同一条路：记录最后一次，供 DSH_PET_DEBUG 探针核对。
    if (window.__dshPetDebug) window.__dshPetDebug.lastGesture = { name: String(name), kind, at: Date.now() };
    switch (kind) {
      case 'blink':
        blinkT = 1;
        break;
      case 'wag':
        tail = 1;
        break;
      case 'hop':
        hopActive = true;
        hopT = 0;
        break;
      case 'talk':
        talk = true;
        if (talkTimer !== null) window.clearTimeout(talkTimer);
        talkTimer = window.setTimeout(() => {
          talk = false;
          mouth = 0;
        }, 1600);
        break;
      case 'mouth':
        mouthAction = true;
        mouthActionT = 0;
        break;
      case 'jelly':
        jelly = 1;
        break;
      default:
        // 其它名字来自 webm 动画池，layered 没有对应装配：什么都不做，呼吸循环照常。
        break;
    }
  };
  api.destroy = () => {
    if (api.frame) cancelAnimationFrame(api.frame);
    if (talkTimer !== null) window.clearTimeout(talkTimer);
  };
  /**
   * 视口坐标 → 命中区手势（canvas 坐标换算后交给 PetLayered.hitTest）。
   *
   * @param {number} clientX - 视口 x。
   * @param {number} clientY - 视口 y。
   * @returns {string|undefined} 区域声明的 gesture（缺省回落区域 id）；没命中返回 undefined。
   */
  api.gestureAt = (clientX, clientY) => {
    if (!skin || !api.canvas) return undefined;
    const rect = api.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return undefined;
    const x = ((clientX - rect.left) / rect.width) * skin.canvas.w;
    const y = ((clientY - rect.top) / rect.height) * skin.canvas.h;
    const id = window.PetLayered.hitTest(skin, x, y);
    if (id === undefined) return undefined;
    const region = (skin.interaction.regions || []).find((item) => item.id === id);
    return (region && region.gesture) || id;
  };
  api.ready = true;
  console.log('[dsh-pet] 桌面 layered 已挂载 pet=' + sprite.pet.id + ' 皮肤=' + root);
}

/**
 * 挂载 live2d：pixi Application + Cubism 模型，按 manifest 列表选模型（pets[].model 优先）。
 *
 * @param {PetSprite} sprite - 宠物实例（读 assetRoot / size / model）。
 * @param {HTMLElement} host - 画面包装层。
 * @param {object} api - 后端句柄。
 */
async function mountLive2d(sprite, host, api) {
  const root = sprite.assetRoot;
  const cubism = await ensureLive2dRuntime();
  if (api.destroyed) return;
  const listRes = await fetch(skinUrlOf(root, 'models'));
  const models = listRes.ok ? ((await listRes.json()).models || []).filter((m) => typeof m === 'string') : [];
  const configured = sprite.pet.model;
  const chosen = configured && models.includes(configured) ? configured : models[0];
  if (chosen === undefined) throw new Error('皮肤目录没有 .model3.json：' + root);
  if (api.destroyed) return;

  const pixi = window.PIXI;
  const app = new pixi.Application({
    width: sprite.size,
    height: sprite.size,
    transparent: true,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  cubism.Live2DModel.registerTicker(pixi.Ticker);
  const canvasHost = document.createElement('div');
  canvasHost.className = 'pet-visual-canvas';
  canvasHost.style.cssText =
    'position:absolute;left:50%;bottom:0;transform:translateX(-50%);' +
    'width:' +
    sprite.size +
    'px;height:' +
    sprite.size +
    'px;pointer-events:none;';
  canvasHost.appendChild(app.view);
  host.appendChild(canvasHost);
  const model = await cubism.Live2DModel.from(skinUrlOf(root, chosen), { autoInteract: false });
  if (api.destroyed) {
    model.destroy();
    return;
  }
  app.stage.addChild(model);
  const scale = sprite.size / Math.max(model.internalModel.originalWidth, model.internalModel.originalHeight);
  model.anchor.set(0.5, 0.5);
  model.scale.set(scale);
  model.x = sprite.size / 2;
  model.y = sprite.size / 2;
  api.canvas = canvasHost;
  api.app = app;
  api.model = model;
  api.playAction = (name) => {
    if (window.__dshPetDebug) window.__dshPetDebug.lastGesture = { name: String(name), kind: 'tap', at: Date.now() };
    if (/tap|click|点击|摸|戳/i.test(name)) {
      model.tap(sprite.size / 2, sprite.size / 2);
      return;
    }
    void model.motion('Idle', undefined, cubism.MotionPriority.IDLE);
  };
  api.destroy = () => {
    model.destroy();
    app.destroy(true, { children: true, texture: true, baseTexture: true });
  };
  api.ready = true;
  console.log('[dsh-pet] 桌面 live2d 已挂载 pet=' + sprite.pet.id + ' 模型=' + chosen);
}

Object.assign(PetSprite.prototype, {
  /** 当前前台可视元素：webm 是 <video>（A/B 双缓冲），其它后端是承载画布的包装层。 */
  frontEl() {
    if (this.backend) return this.backend.el;
    return this.front === 0 ? this.videoA : this.videoB;
  },

  /**
   * 建非 webm 的画面层并异步挂载。
   *
   * @param {HTMLElement} stage - 宠物舞台节点（与视频同一层）。
   */
  mountBackend(stage) {
    const el = document.createElement('div');
    el.className = 'pet-visual';
    stage.appendChild(el);
    const api = { kind: this.renderer, el, ready: false, destroyed: false, frame: 0, playAction: null, destroy: null };
    this.backend = api;
    const mount = this.renderer === 'live2d' ? mountLive2d : mountLayered;
    mount(this, el, api).catch((error) => {
      console.warn(
        '[dsh-pet] 桌面 ' +
          this.renderer +
          ' 挂载失败 pet=' +
          this.pet.id +
          '：' +
          (error instanceof Error ? error.message : String(error)),
      );
    });
  },

  /**
   * 非 webm 的换动作：状态机照常推进（动画名同一套池），画面交给后端。
   *
   * 没有 ended 事件，按固定时长合成一次，让 handleEnded 的睡觉/事件/随机链分支照旧运行。
   *
   * @param {string} next - 动画名（来自 webm 动画池或菜单点播）。
   * @param {boolean} nextOnce - 是否只播一次。
   * @param {string|null} playbackId - 第三方点播编号（非空时要回执）。
   */
  switchBackend(next, nextOnce, playbackId) {
    this.anim = next;
    this.once = !nextOnce;
    this.pending = null;
    this.playback = playbackId || null;
    if (this.backend && typeof this.backend.playAction === 'function') this.backend.playAction(next);
    this.flashMirror();
    // 点击的 Q 弹：视频路径等新源首帧再压；画布后端没有换源，直接压当前这层。
    if (this.pendingSquash) {
      this.pendingSquash = false;
      this.startSquash(this.backend && this.backend.el);
    }
    if (playbackId) this.reportPlayback(playbackId, 'playing');
    if (this.endTimer !== null) window.clearTimeout(this.endTimer);
    this.endTimer = window.setTimeout(() => {
      this.endTimer = null;
      this.handleEnded();
    }, BACKEND_ACTION_MS);
  },

  /** 非 webm 的镜像：画布由 CSS translateX 居中，镜像要落在包装层上（见 startSquash 的 transform 口径）。 */
  flashMirror() {
    const el = this.backend && this.backend.el;
    if (el) el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
  },

  /** 非 webm 的冻结/解冻：canvas 没有 pause，停在原地就是「冻住」，只需停掉换动作计时器。 */
  setBackendPaused(paused) {
    if (!this.backend) return;
    if (!paused) return;
    if (this.endTimer !== null) {
      window.clearTimeout(this.endTimer);
      this.endTimer = null;
    }
  },

  /** 卸载后端（窗口销毁/切换渲染方式时调用）。 */
  disposeBackend() {
    if (!this.backend) return;
    this.backend.destroyed = true;
    if (typeof this.backend.destroy === 'function') this.backend.destroy();
    if (this.endTimer !== null) {
      window.clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    this.backend = null;
  },
});
