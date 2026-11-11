/**
 * 桌面 Helper 的非 webm 画面层：按 `pets[].renderer` 挂 layered（分层 PNG 合成）或 live2d（pixi + Cubism）。
 *
 * 只负责「视觉与动作」：播放链、拖拽、抛掷、气泡、菜单、穿透判定仍在既有文件里，一行不搬。
 * 与 webm 的接缝只有三处：`frontEl()`（前台可视元素）、`switchTo` 的非 webm 分支（换动作）、
 * 冻结/解冻（暂停与续播）；其余代码读到的仍是原来的 `this.front / videoA / videoB`。
 *
 * layered 的装配数学来自 `layered-core.js`（window.PetLayered，源 src/client/pet/render/layered），
 * 与浏览器端同一份实现；live2d 的 pixi / pip 依赖走宿主 `/vendor` 的 UMD，按 Core → pixi → cubism4 加载。
 * **两个 core（layered-core.js / shared-core.js）都是构建产物**：改完 src 必须重跑 `npm run build:desktop-core`
 * 再重启 Helper；否则页面加载到的是旧核心。旧核心少了新导出时本文件会降级（见 optionalProbe / pixelSideOf），
 * 绝不把「核心比本文件旧」变成「宠物窗口还在、画面全透明」。
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

/**
 * 取 core 里的可选探测函数；缺了就降级并告警一次。
 *
 * 为什么需要这道闸：`layered-core.js` 是构建产物（改 src 后要重跑 build:desktop-core），
 * 页面可能加载到比本文件旧的核心。旧核心少一个函数时如果直接调用，挂载会抛错 → 舞台留空 →
 * 用户看到的是「宠物窗口还在、画面全透明」。这里宁可少一层优化（整幅绘制 / 默认锚点），也要让画面出来。
 *
 * @param {string} name - 全局 PetLayered 上的函数名。
 * @returns {Function|null} 拿到的函数；缺了返回 null。
 */
function optionalProbe(name) {
  const core = window.PetLayered;
  const fn = core ? core[name] : undefined;
  if (typeof fn === 'function') return fn;
  console.warn(
    '[dsh-pet] layered-core.js 缺少 ' +
      name +
      '（核心比 sprite/backend.js 旧）：已降级为整幅绘制；' +
      '改过 src/client/pet/render/layered 后请重跑 npm run build:desktop-core 再重启桌面 Helper',
  );
  return null;
}

/**
 * 取后备分辨率的计算函数（shared-core.js 的 renderPixelSide）；旧核心缺它时用等价的一行兜底。
 *
 * @returns {(css:number, native:number, dpr:number) => number} 计算函数。
 */
function pixelSideOf() {
  const fn = typeof S.renderPixelSide === 'function' ? S.renderPixelSide : null;
  if (fn !== null) return fn;
  console.warn('[dsh-pet] shared-core.js 缺少 renderPixelSide（核心比本文件旧）：按显示尺寸 × DPR 就地算');
  return (css, native, dpr) => {
    const scale = Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, 2) : 1;
    return Math.max(1, Math.min(Math.round(native) || 1, Math.round(css * scale)));
  };
}

/**
 * 把量到的内容顶写成气泡锚点变量（.pet-bubble 的 bottom 读它）。
 *
 * @param {PetSprite} sprite - 宠物实例（变量写在它的根节点上，气泡是根节点的子节点）。
 * @param {number|null} ratio - 内容顶比例；null 时保持 webm 的默认锚点。
 */
function applyBubbleAnchor(sprite, ratio) {
  if (ratio === null || !Number.isFinite(ratio)) return;
  sprite.el.style.setProperty('--pet-bubble-y', Math.round(S.bubbleAnchorY(ratio, sprite.size)) + 'px');
}

/**
 * 找分层皮肤清单：先根布局后子目录布局（见 shared/layered-paths）。
 *
 * @param {string} root - 素材根。
 * @returns {Promise<{skin: object, base: string}>} 解析好的清单与地址前缀。
 */
async function loadLayeredManifest(root, skinId) {
  let status = 0;
  // 选中某套皮肤：它自己的清单优先，找不到再退回「根 → layered/」的老口径
  const paths = skinId ? [skinId + '/manifest.json'].concat(S.LAYERED_MANIFEST_PATHS) : S.LAYERED_MANIFEST_PATHS;
  for (const path of paths) {
    const res = await fetch(skinUrlOf(root, path));
    if (!res.ok) {
      status = res.status;
      continue;
    }
    const skin = window.PetLayered.parseSkinManifest(await res.json());
    if (skin === null) throw new Error('皮肤 manifest 解析失败：' + root + '/' + path);
    return { skin, base: S.layeredBaseOf(path) };
  }
  throw new Error('皮肤 manifest HTTP ' + status + '（' + root + '）');
}

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
/**
 * 动作名 → 装配动作。
 *
 * 词表只有一份：`layered-core.js` 的 `PetLayered.assemblyActionOf`（源 src/client/pet/render/layered/gestures.ts），
 * 与浏览器端共用——两端各写一套的话，点同一只宠物会一端有反应、另一端没有。
 *
 * @param {string} name - 动画名或手势 id。
 * @returns {string|null} 装配动作；无对应语义时为 null（保持待机循环）。
 */
function actionKind(name) {
  const pick = window.PetLayered && window.PetLayered.assemblyActionOf;
  return typeof pick === 'function' ? pick(String(name || '')) : null;
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

/**
 * 画布舞台：宿主尺寸 = 宠物尺寸的正方形，底部对齐（与浏览器 layered/live2d 的画布口径一致）。
 *
 * 只负责建节点与 CSS 尺寸；**后备分辨率**由 mountLayered 按显示尺寸与 DPR 设（见 setCanvasPixels）。
 */
function createCanvasHost(sprite, host) {
  const canvas = document.createElement('canvas');
  canvas.className = 'pet-visual-canvas';
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
 * 设画布后备分辨率与绘制变换（与浏览器端 render/layered 的 applyCanvasPixels 同口径）。
 *
 * 内容坐标永远是清单的逻辑尺寸，所以绘制前给 ctx 设「后备边 / 原生边」的缩放；
 * 后备边由 {@link pixelSideOf} 取到的计算函数夹在「显示尺寸 × DPR」与「素材原生边」之间。
 * 只有像素边真的变了才重建画布（重建会清空内容并重置变换）。
 *
 * @param {HTMLCanvasElement} canvas - 画面画布。
 * @param {CanvasRenderingContext2D} ctx - 它的 2d 上下文。
 * @param {object} skin - 皮肤清单（读 canvas.w / canvas.h）。
 * @param {number} size - 画框宽度（CSS px）。
 * @param {(css:number, native:number, dpr:number) => number} sideOf - 后备边计算（见 pixelSideOf）。
 * @returns {number} 本次的后备像素边。
 */
function setCanvasPixels(canvas, ctx, skin, size, sideOf) {
  const side = sideOf(size, skin.canvas.w, window.devicePixelRatio || 1);
  if (canvas.width !== side || canvas.height !== Math.max(1, Math.round((side * skin.canvas.h) / skin.canvas.w))) {
    canvas.width = side;
    canvas.height = Math.max(1, Math.round((side * skin.canvas.h) / skin.canvas.w));
  }
  const k = canvas.width / skin.canvas.w;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  return side;
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
  const { skin, base } = await loadLayeredManifest(root, sprite.pet.model);
  api.skin = skin;
  // 探测能力可能缺（核心比本文件旧）：缺了就降级成整幅绘制 / 不量锚点，画面照常出来。
  const measureBox = optionalProbe('measureLayerBox');
  const measureTop = optionalProbe('measureVisualTopRatio');
  const sideOf = pixelSideOf();
  const boxOf = (image) => (measureBox === null ? null : measureBox(image, skin.canvas.w, skin.canvas.h));
  // 每层领一次「不透明包围盒」（源像素）：之后每帧只采样这一块。实测一套 19 层 1024² 皮肤，
  // 各层有效区域合计只有画布的 1.8 倍（平均 9.6%），整幅绘制等于白采样 20 个全幅位图。
  const layers = await Promise.all(
    skin.layers.map(async (layer) => {
      const image = await loadSkinImage(skinUrlOf(root, base + layer.file));
      const box = boxOf(image);
      return { role: layer.role, group: layer.group, image, ...(box === null ? {} : { box }) };
    }),
  );
  let openMouth = null;
  if (skin.rig.mouth && skin.rig.mouth.open) {
    const image = await loadSkinImage(skinUrlOf(root, base + skin.rig.mouth.open));
    const box = boxOf(image);
    openMouth = { image, ...(box === null ? {} : { box }) };
  }
  if (api.destroyed) return;

  const canvas = createCanvasHost(sprite, host);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('canvas 2d 上下文不可用');
  // 后备分辨率通常小于素材原生边（462 vs 1024）：要求高质量重采样，缩小时不糊边、不发锯齿。
  ctx.imageSmoothingQuality = 'high';
  // 后备分辨率跟随显示尺寸（尾随 DPR、上限素材原生边）：这是「拖动与动画都卡」的主因之一——
  // 原先恒按 1024² 全幅绘制，显示在 462px 上等于多算 4.9 倍像素。
  setCanvasPixels(canvas, ctx, skin, sprite.size, sideOf);
  // 量一次内容顶：方形皮肤的头顶在舞台顶以上，气泡贴着它才不会盖脸（见 shared/bubble-anchor）。
  applyBubbleAnchor(
    sprite,
    measureTop === null
      ? null
      : measureTop((probe, w, h) => {
          for (const layer of layers) probe.drawImage(layer.image, 0, 0, w, h);
        }),
  );

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
  /** 帧耗时统计（每 2s 写一次 window.__dshPetDebug.frameMs）：两次单调时钟读数的代价可以忽略，
   *  而透明窗口没有 DevTools，「拖不动」只能靠日志里的这个数判断是绘制还是窗口移动的问题。 */
  const debug = !!window.__dshPetDebug;
  let frameSamples = 0;
  let frameCostMs = 0;
  let lastReportMs = lastMs;
  /** 上次用的 DPR：跨屏移动会变，发现变化就重建后备画布（见 loop）。 */
  let lastDpr = window.devicePixelRatio || 1;
  api.canvas = canvas;

  const loop = () => {
    if (api.destroyed) return;
    const now = performance.now();
    // DPR 变了（拖到另一块屏 / 系统缩放变化）：按新密度重建后备画布，否则画面会糊或白烧像素。
    if ((window.devicePixelRatio || 1) !== lastDpr) {
      lastDpr = window.devicePixelRatio || 1;
      setCanvasPixels(canvas, ctx, skin, sprite.size, sideOf);
    }
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
    if (debug) {
      // 只统计「绘制本身」的耗时：它是这次优化唯一直接影响的量，窗口移动/合成不在里面。
      frameCostMs += performance.now() - now;
      frameSamples += 1;
      if (now - lastReportMs >= 2000) {
        window.__dshPetDebug.frameMs = Math.round((frameCostMs / Math.max(1, frameSamples)) * 100) / 100;
        frameCostMs = 0;
        frameSamples = 0;
        lastReportMs = now;
      }
    }
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
 * 动作与外观走叠加层（sprite/overlay.js）：运行库的 motion 队列一次只能一条，点第二个动作会把
 * 待机一起掐掉；热键动作要能叠着播、外观要能同时挂多个。待机仍交给运行库（它自己循环 Idle、带眨眼）。
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

  // 菜单与叠加层共用同一份清单：动作组给菜单分组，动作表给「点哪个文件」，
  // 外观表给「挂哪个 exp3」。分成两套遍历必然漂移（序号对不上就点 A 播 B）。
  api.actionGroups = [];
  api.expressions = [];
  api.motions = new Map();
  api.expressionFiles = new Map();
  let settings = null;
  try {
    const settingsRes = await fetch(skinUrlOf(root, chosen));
    if (settingsRes.ok) {
      settings = await settingsRes.json();
      api.actionGroups = window.PetShared.model3ActionGroups(settings);
      for (const motion of window.PetShared.model3Motions(settings)) api.motions.set(motion.action, motion);
      for (const item of window.PetShared.model3ExpressionRefs(settings)) api.expressionFiles.set(item.name, item.file);
      api.expressions = [...api.expressionFiles.keys()];
    }
  } catch {
    // 读不到模型清单只影响动作菜单，画面照常；下一行起不再提这事。
  }
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
    // 内容顶探测要在画完一帧后读回像素（见 measureVisualTopRatio）：不保帧缓冲读到的会是空画面。
    preserveDrawingBuffer: true,
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
  // 逐模型修正：把「纯黑遮罩源」从可见绘制里去掉（与浏览器端同一张表）。
  // 只压 getDrawableOpacity：遮罩绘制忽略不透明度，裁切不受影响。
  const core = model.internalModel.coreModel;
  const hiddenDrawables = S.hiddenDrawableIndexesOf(chosen);
  if (hiddenDrawables.length > 0) {
    const originalOpacity = core.getDrawableOpacity?.bind(core);
    const skip = new Set(hiddenDrawables);
    if (originalOpacity) core.getDrawableOpacity = (index) => (skip.has(index) ? 0 : originalOpacity(index));
  }
  // 叠加层：每条动作/外观一对独立队列，挂在 model.update() 之前写入参数。
  const overlay = createOverlay(cubism, () => model.internalModel.coreModel);
  const ticker = () => overlay.tick();
  model.internalModel.on('beforeModelUpdate', ticker);
  api.activeExpressions = () => overlay.active('expression');
  // 量一次内容顶：方形画布的头顶在舞台顶以上，气泡贴着它才不会盖脸（见 shared/bubble-anchor）。
  app.renderer.render(app.stage);
  {
    const measureTop = optionalProbe('measureVisualTopRatio');
    applyBubbleAnchor(
      sprite,
      measureTop === null ? null : measureTop((probe, w, h) => probe.drawImage(app.view, 0, 0, w, h)),
    );
  }

  /** 动作/外观文件缓存：同一条点第二次不必再发请求。 */
  const files = new Map();
  /** 取一份动作/外观 JSON（带缓存；失败返回 null，菜单点了没反应但不炸）。 */
  async function fetchJson(rel) {
    if (files.has(rel)) return files.get(rel);
    try {
      const res = await fetch(skinUrlOf(root, rel));
      if (!res.ok) return null;
      const json = await res.json();
      files.set(rel, json);
      return json;
    } catch {
      return null;
    }
  }

  api.playAction = (name) => {
    // 菜单动作名与浏览器端同格式（见 shared/menu/renderer-actions）：motion:<组>:<序号> / expression:<名>。
    const key = String(name);
    const motion = api.motions.get(key);
    if (motion) {
      if (window.__dshPetDebug) window.__dshPetDebug.lastGesture = { name: key, kind: 'motion', at: Date.now() };
      void fetchJson(motion.file).then((json) => {
        if (json === null || api.destroyed) return;
        overlay.play(key, 'motion', json, {
          hold: motion.hold,
          fadeSeconds: motion.fadeSeconds,
          raw: json,
        });
      });
      return;
    }
    if (key === window.PetShared.MOTION_RESET) {
      overlay.stopKind('motion');
      return;
    }
    if (key === window.PetShared.EXPRESSION_RESET) {
      overlay.stopKind('expression');
      return;
    }
    if (key.startsWith('expression:')) {
      const expression = key.slice('expression:'.length);
      const file = api.expressionFiles.get(expression);
      if (window.__dshPetDebug) window.__dshPetDebug.lastGesture = { name: key, kind: 'expression', at: Date.now() };
      if (file === undefined) return;
      void fetchJson(file).then((json) => {
        if (json === null || api.destroyed) return;
        // 外观是开关：挂着就摘、没挂就挂——所以「外观」菜单可以同时勾好几个。
        overlay.toggle(expression, 'expression', json);
      });
      return;
    }
    if (/tap|click|点击|摸|戳/i.test(key)) {
      model.tap(sprite.size / 2, sprite.size / 2);
      return;
    }
    void model.motion('Idle', undefined, cubism.MotionPriority.IDLE);
  };
  api.destroy = () => {
    model.internalModel.off('beforeModelUpdate', ticker);
    overlay.destroy();
    files.clear();
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
