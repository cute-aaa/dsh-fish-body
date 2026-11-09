/**
 * layered.js —— layered-PNG 皮肤渲染器（surfcore 皮肤格式，schema 2 / `rig: "layered"`）。
 *
 * 纯 canvas 2D 合成，零依赖、零构建：按 manifest.layers 顺序把 18 张分层 PNG
 * 画到同一张画布上，并按 rigOptions 做
 *   呼吸 / 摇摆（body）、转头 + 倾斜（head）、视线（iris 位移）、
 *   眨眼（eye.white / iris 淡出 + 睫毛下移）、张嘴（mouth_open + cover）、
 *   果冻挤压（jelly）、跳跃（hop）、摸摸闭眼（hoverCloseEyes）。
 *
 * 与 webm 方案的分工：core.js 决定用哪个渲染器；这里只管「一个皮肤怎么动」。
 * 命中区按 manifest.interaction.regions（ellipse / rect）做点击判定，
 * 命中 region.sound 时播放 interaction.sounds 里对应的音效。
 *
 * 用法：
 *   const rig = await FishBodyLayered.create(manifest, '/fish-body-assets/skins/feiyu-05/', { width, height });
 *   stage.appendChild(rig.canvas); rig.start();
 */
(function () {
  'use strict';

  /** 图层解码后的预缩放比例（1280 → 768）：降显存、降每帧采样成本。 */
  const PRESCALE = 0.6;
  /** 画布后备尺寸上限（设备像素）。 */
  const MAX_BACK = 768;
  /** 内部更新频率上限（渲染跟随 rAF）。 */
  const MAX_DT = 0.05;
  /** 限帧：高刷屏（120/165Hz）上不必每帧都重绘 18 层。 */
  const FRAME_MS = 15;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------- 2D 仿射矩阵（canvas setTransform 的 a,b,c,d,e,f） ----------
  // x' = a*x + c*y + e ; y' = b*x + d*y + f
  const I = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  /** 先应用 q，再应用 p（即 p ∘ q）。 */
  function mul(p, q) {
    return {
      a: p.a * q.a + p.c * q.b,
      b: p.b * q.a + p.d * q.b,
      c: p.a * q.c + p.c * q.d,
      d: p.b * q.c + p.d * q.d,
      e: p.a * q.e + p.c * q.f + p.e,
      f: p.b * q.e + p.d * q.f + p.f,
    };
  }
  function tr(x, y) { return { a: 1, b: 0, c: 0, d: 1, e: x, f: y }; }
  function rotAbout(px, py, r) {
    if (!r) return I;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    return mul(mul(tr(px, py), { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }), tr(-px, -py));
  }
  function scaleAbout(px, py, sx, sy) {
    return mul(mul(tr(px, py), { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }), tr(-px, -py));
  }

  function layerKind(def) {
    const role = String(def.role || '');
    if (role === 'hair.back') return 'hairBack';
    if (role === 'mouth') return 'mouth';
    if (role === 'face') return 'face';
    if (role.startsWith('eye.white')) return 'eyeWhite';
    if (role.startsWith('eye.iris')) return 'eyeIris';
    if (role.startsWith('eye.lash')) return 'eyeLash';
    if (def.group === 'head') return 'head';
    return 'body';
  }

  function sideOf(def) {
    return String(def.role || '').endsWith('.r') ? 'r' : 'l';
  }

  // ---------- 位图加载 ----------
  async function fetchBitmap(url, w, h) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error('load-failed ' + res.status + ' ' + url);
    const blob = await res.blob();
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      } catch { /* 老浏览器不支持 resize 参数 → 走 <img> */ }
      try {
        return await createImageBitmap(blob);
      } catch { /* 继续降级 */ }
    }
    const img = await loadImage(url);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image-load-failed ' + url));
      img.src = url;
    });
  }

  class LayeredRig {
    /**
     * @param {object} manifest surfcore 皮肤 manifest
     * @param {string} baseUrl 皮肤目录 URL（以 / 结尾）
     * @param {{width?:number,height?:number}} [opts]
     */
    constructor(manifest, baseUrl, opts) {
      this.manifest = manifest;
      this.baseUrl = String(baseUrl || '').replace(/\/?$/, '/');
      this.opts = opts || {};
      this.W = Number(manifest.canvas?.w) || 1280;
      this.H = Number(manifest.canvas?.h) || 1280;

      const o = manifest.rigOptions || {};
      this.opt = {
        headPivot: o.headPivot || [this.W / 2, this.H / 2],
        backHairPivot: o.backHairPivot || [this.W / 2, this.H * 0.25],
        mouthPivot: o.mouthPivot || [this.W / 2, this.H * 0.37],
        gazeCenter: o.gazeCenter || [this.W / 2, this.H * 0.31],
        eyeCenters: o.eyeCenters || { l: [this.W / 2, this.H / 2], r: [this.W / 2, this.H / 2] },
        motion: { breath: 0.011, sway: 0.008, headTurn: 16, gazeMax: [6, 4.5], ...(o.motion || {}) },
        blinkLash: o.blinkLash ?? 26,
        headTilt: o.headTilt ?? 0.012,
        jelly: o.jelly !== false,
        mouth: o.mouth || null,
        hoverCloseEyes: manifest.interaction?.hoverCloseEyes === true,
        cursor: manifest.interaction?.cursor || 'pointer',
        regions: Array.isArray(manifest.interaction?.regions) ? manifest.interaction.regions : [],
      };

      // 画布可视区域：优先用所有图层的真实不透明范围（不同皮肤的 hitbox 松紧不一，
      // 直接用 hitbox 会让角色在宠物框里偏小），拿不到再退回 hitbox。
      this.crop = null;
      this.artBoxSampled = false;

      this.canvas = document.createElement('canvas');
      this.canvas.setAttribute('data-fish-body-layered', '1');
      this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none';
      this.ctx = this.canvas.getContext('2d');

      this.layers = [];
      this.bitmaps = [];
      this.view = { w: 1, h: 1, g: 1, offX: 0, offY: 0, matrix: I };

      // 运行时状态
      this.t = 0;
      this.blinkPhase = 'idle';
      this.blinkTimer = 0;
      this.nextBlink = 2.5;
      this.blinkValue = 0;
      this.hoverEye = 0;
      this.headHover = false;
      this.headHoverTimer = 0;
      this.patTimer = 0;
      this.talkEnvelope = 0;
      this.talking = false;
      this.mouthDemo = 0;
      this.mouthDemoTotal = 1;
      this.mouthOpen = o.mouth?.rest === 'open' ? 1 : 0;
      this.hop = 0;
      this.hopVel = 0;
      this.jelly = 0;
      this.jellyVel = 0;
      this.squash = 0;
      this.dragging = false;
      this.gaze = { x: 0, y: 0 };
      this.gazeTarget = { x: 0, y: 0 };
      this.headTurn = 0;
      this.headTurnTarget = 0;

      this.sounds = new Map();
      this.raf = null;
      this.last = 0;
      this.running = false;
      this.resizeObserver = null;
    }

    // ---------- 初始化 ----------
    /** 皮肤目录内的相对路径 → URL（逐段编码，兼容空格/中文文件名）。 */
    url(file) {
      return this.baseUrl + String(file).split('/').map((seg) => encodeURIComponent(seg)).join('/');
    }

    async init() {
      const bw = Math.max(1, Math.round(this.W * PRESCALE));
      const bh = Math.max(1, Math.round(this.H * PRESCALE));
      const defs = Array.isArray(this.manifest.layers) ? this.manifest.layers : [];

      const results = await Promise.all(defs.map(async (def) => {
        try {
          const bmp = await fetchBitmap(this.url(def.file), bw, bh);
          return { def, bmp, kind: layerKind(def), side: sideOf(def) };
        } catch {
          return { def, bmp: null, kind: layerKind(def), side: sideOf(def) };
        }
      }));
      this.layers = results.filter((r) => r.bmp);
      this.bitmaps = this.layers.map((r) => r.bmp);

      this.crop = this.computeArtBox() ?? this.cropFromHitbox();
      await this.loadMouthOverlay();
      this.layout();
      this.start();
      return this;
    }

    /** 张嘴素材（open / openCover）与嘴部模式。 */
    async loadMouthOverlay() {
      const m = this.opt.mouth;
      this.mouthMode = 'none';
      if (!m) return;
      const bw = Math.max(1, Math.round(this.W * PRESCALE));
      const bh = Math.max(1, Math.round(this.H * PRESCALE));
      if (m.open) {
        this.mouthMode = 'swap';
        try { this.mouthOpenBmp = await fetchBitmap(this.url(m.open), bw, bh); } catch { /* 缺素材就不张嘴 */ }
      }
      if (m.openCover) {
        try { this.mouthCoverBmp = await fetchBitmap(this.url(m.openCover), bw, bh); } catch { /* 可选 */ }
      }
      if (this.mouthMode === 'none' && m.rest === 'open') this.mouthMode = 'squash';
    }

    /** 音效池（每个音效 3 份，连点可叠）。 */
    async loadSounds() {
      const defs = this.manifest.interaction?.sounds;
      if (!defs || typeof defs !== 'object') return;
      for (const [id, file] of Object.entries(defs)) {
        if (typeof file !== 'string' || !file) continue;
        const pool = [];
        for (let i = 0; i < 3; i++) {
          try {
            const a = new Audio(this.url(file));
            a.preload = 'auto';
            a.volume = 0.8;
            pool.push(a);
          } catch { /* 忽略音频构造失败 */ }
        }
        if (pool.length) this.sounds.set(id, { pool, i: 0 });
      }
    }

    // ---------- 布局 ----------
    /** hitbox 兜底（+3% 余量）。 */
    cropFromHitbox() {
      const hb = this.manifest.hitbox;
      if (hb && Number(hb.w) > 0 && Number(hb.h) > 0) {
        const padX = hb.w * 0.03;
        const padY = hb.h * 0.03;
        return {
          x: Math.max(0, hb.x - padX),
          y: Math.max(0, hb.y - padY),
          w: Math.min(this.W, hb.w + padX * 2),
          h: Math.min(this.H, hb.h + padY * 2),
        };
      }
      return { x: 0, y: 0, w: this.W, h: this.H };
    }

    /**
     * 用所有图层的真实不透明范围算可视框（低分辨率采样，一次，很便宜）。
     * 不同皮肤的 hitbox 松紧差很多，直接用 hitbox 会让某些角色在框里偏小。
     */
    computeArtBox() {
      const N = 128;
      const c = document.createElement('canvas');
      c.width = N;
      c.height = N;
      const x = c.getContext('2d', { willReadFrequently: true });
      if (!x) return null;
      let minX = N, minY = N, maxX = -1, maxY = -1;
      for (const layer of this.layers) {
        x.clearRect(0, 0, N, N);
        try { x.drawImage(layer.bmp, 0, 0, N, N); } catch { continue; }
        let data;
        try { data = x.getImageData(0, 0, N, N).data; } catch { continue; }
        for (let yy = 0; yy < N; yy++) {
          for (let xx = 0; xx < N; xx++) {
            if (data[(yy * N + xx) * 4 + 3] > 8) {
              if (xx < minX) minX = xx;
              if (xx > maxX) maxX = xx;
              if (yy < minY) minY = yy;
              if (yy > maxY) maxY = yy;
            }
          }
        }
      }
      if (maxX < 0 || maxY < 0) return null;
      const sx = this.W / N;
      const sy = this.H / N;
      const pad = Math.max(2 * sx, 2 * sy); // 采样粗糙度补偿
      const box = {
        x: Math.max(0, minX * sx - pad),
        y: Math.max(0, minY * sy - pad),
        w: 0,
        h: 0,
      };
      box.w = Math.min(this.W - box.x, (maxX - minX + 1) * sx + pad * 2);
      box.h = Math.min(this.H - box.y, (maxY - minY + 1) * sy + pad * 2);
      // 太小的框不可信（素材异常），退回 hitbox
      if (box.w < this.W * 0.15 || box.h < this.H * 0.15) return null;
      this.artBoxSampled = true;
      return box;
    }

    layout() {
      const rect = this.canvas.getBoundingClientRect();
      const cssW = rect.width || this.opts.width || 200;
      const cssH = rect.height || this.opts.height || 240;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      let backW = Math.max(32, Math.round(cssW * dpr));
      let backH = Math.max(32, Math.round(cssH * dpr));
      const longest = Math.max(backW, backH);
      if (longest > MAX_BACK) {
        const k = MAX_BACK / longest;
        backW = Math.max(32, Math.round(backW * k));
        backH = Math.max(32, Math.round(backH * k));
      }
      if (this.canvas.width !== backW || this.canvas.height !== backH) {
        this.canvas.width = backW;
        this.canvas.height = backH;
      }
      const crop = this.crop;
      const g = Math.min(backW / crop.w, backH / crop.h);
      const offX = (backW - crop.w * g) / 2 - crop.x * g;
      const offY = (backH - crop.h * g) / 2 - crop.y * g;
      this.view = { w: backW, h: backH, g, offX, offY, matrix: { a: g, b: 0, c: 0, d: g, e: offX, f: offY } };
    }

    /** 屏幕坐标（clientX/clientY）→ 画布坐标。 */
    toCanvas(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const v = this.view;
      const bx = ((clientX - rect.left) / Math.max(1, rect.width)) * v.w;
      const by = ((clientY - rect.top) / Math.max(1, rect.height)) * v.h;
      // view.matrix：device = canvas * g + off
      return { x: (bx - v.offX) / v.g, y: (by - v.offY) / v.g };
    }

    /** 画布坐标 → 屏幕坐标（调试/自动化用：点某个命中区）。 */
    clientPoint(canvasX, canvasY) {
      const rect = this.canvas.getBoundingClientRect();
      const v = this.view;
      const bx = canvasX * v.g + v.offX;
      const by = canvasY * v.g + v.offY;
      return {
        x: rect.left + (bx / v.w) * rect.width,
        y: rect.top + (by / v.h) * rect.height,
      };
    }

    /** 是否点在角色身上（hitbox 内）。 */
    hitTest(clientX, clientY) {
      const c = this.toCanvas(clientX, clientY);
      const hb = this.manifest.hitbox;
      if (!hb) return { hit: true, canvasX: c.x, canvasY: c.y };
      const inside = c.x >= hb.x && c.x <= hb.x + hb.w && c.y >= hb.y && c.y <= hb.y + hb.h;
      return { hit: inside, canvasX: c.x, canvasY: c.y };
    }

    /** 命中的交互区（pot / head / body …）；没命中返回 null。 */
    regionAt(clientX, clientY) {
      const t = this.hitTest(clientX, clientY);
      if (!t.hit) return null;
      return this.regionAtCanvas(t.canvasX, t.canvasY);
    }

    regionAtCanvas(x, y) {
      for (const r of this.opt.regions) {
        const s = r.shape;
        if (!s) continue;
        if (s.type === 'ellipse') {
          const dx = (x - s.cx) / (s.rx || 1);
          const dy = (y - s.cy) / (s.ry || 1);
          if (dx * dx + dy * dy <= 1) return r;
        } else if (s.type === 'rect') {
          if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return r;
        }
      }
      return null;
    }

    /** 该点应该用什么光标。 */
    cursorAt(clientX, clientY) {
      const region = this.regionAt(clientX, clientY);
      if (region) return region.cursor || this.opt.cursor;
      return this.hitTest(clientX, clientY).hit ? this.opt.cursor : 'default';
    }

    setPointer(clientX, clientY) {
      const c = this.toCanvas(clientX, clientY);
      const [gx, gy] = this.opt.gazeCenter;
      this.gazeTarget.x = clamp((c.x - gx) / (this.W * 0.2), -1, 1);
      this.gazeTarget.y = clamp((c.y - gy) / (this.H * 0.17), -1, 1);
      this.headTurnTarget = clamp((c.x - this.W / 2) / (this.W * 0.33), -1, 1);
    }

    setHeadHover(v) {
      if (v === this.headHover) return;
      this.headHover = v;
      this.headHoverTimer = 0;
    }

    setDragging(v) {
      if (v === this.dragging) return;
      this.dragging = v;
      this.setHeadHover(false);
      this.jellyImpulse(v ? -0.18 : 0.22);
    }

    jellyImpulse(v) {
      if (!this.opt.jelly) return;
      this.jellyVel += v * 6;
    }

    // ---------- 动作 ----------
    blink() {
      if (this.blinkPhase === 'idle') {
        this.blinkPhase = 'close';
        this.blinkTimer = 0;
      }
    }

    pat(seconds = 1.4) {
      this.patTimer = seconds;
      this.setHeadHover(true);
      this.blink();
    }

    poke() {
      this.hopVel = 300;
      this.blink();
      this.jellyImpulse(-0.3);
    }

    hop() {
      this.hopVel = 420;
      this.jellyImpulse(-0.16);
    }

    talk(seconds = 2.6) {
      this.talkEnvelope = seconds;
    }

    startTalk() { this.talking = true; }
    stopTalk() { this.talking = false; }

    /** 「张个嘴」演示：完整地张嘴→闭嘴。 */
    mouthDemo2(seconds = 2.4) {
      this.mouthDemo = seconds;
      this.mouthDemoTotal = seconds;
    }

    playSound(id) {
      const s = this.sounds.get(id);
      if (!s) return false;
      const a = s.pool[s.i++ % s.pool.length];
      try { a.currentTime = 0; } catch { /* 元数据未就绪时不能 seek */ }
      try { const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch { return false; }
      return true;
    }

    /**
     * 点击：命中交互区 → 按 region 的 gesture 播动作 + 音效。
     * @returns {null|{id:string,gesture:string,sound:string|null}} 命中的 region
     */
    pokeAt(clientX, clientY) {
      const region = this.regionAt(clientX, clientY);
      if (!region) return null;
      const gesture = region.gesture || 'pat';
      if (gesture === 'poke') this.poke();
      else if (gesture === 'hop') this.hop();
      else {
        this.pat(1.4);
        this.jellyImpulse(0.08);
      }
      let sound = null;
      if (region.sound && this.playSound(region.sound)) sound = region.sound;
      return { id: region.id, gesture, sound };
    }

    /** 随便动一下（右键菜单「换个动作」用）。 */
    randomGesture() {
      const pick = Math.floor(Math.random() * 4);
      if (pick === 0) this.hop();
      else if (pick === 1) { this.talk(1.8); }
      else if (pick === 2) { this.mouthDemo2(1.6); }
      else { this.pat(1.2); }
      return ['跳一下', '说句话', '张个嘴', '摸摸'][pick];
    }

    // ---------- 主循环 ----------
    start() {
      if (this.running) return;
      this.running = true;
      if (typeof ResizeObserver === 'function') {
        this.resizeObserver = new ResizeObserver(() => this.layout());
        this.resizeObserver.observe(this.canvas);
      } else {
        window.addEventListener('resize', this.onResize = () => this.layout());
      }
      this.last = performance.now();
      const tick = (now) => {
        if (!this.running) return;
        this.raf = requestAnimationFrame(tick);
        const elapsed = now - this.last;
        if (elapsed < FRAME_MS) return;
        const dt = Math.min(MAX_DT, Math.max(0, elapsed / 1000));
        this.last = now;
        if (document.hidden) return;
        try {
          this.update(dt);
          this.render();
          this.lastError = null;
        } catch (e) {
          // 单帧失败不炸掉整个桌宠；把错误留在 lastError 供调试
          this.lastError = e instanceof Error ? `${e.message}` : String(e);
          try { window.__fishErr = this.lastError; } catch { /* 忽略 */ }
        }
      };
      this.raf = requestAnimationFrame(tick);
    }

    stop() {
      this.running = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
    }

    destroy() {
      this.stop();
      try { this.resizeObserver?.disconnect(); } catch { /* 忽略 */ }
      if (this.onResize) window.removeEventListener('resize', this.onResize);
      for (const b of this.bitmaps) { try { b.close?.(); } catch { /* 忽略 */ } }
      this.bitmaps.length = 0;
      this.layers.length = 0;
      this.sounds.clear();
      if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }

    // ---------- 每帧状态 ----------
    update(dt) {
      this.t += dt;

      // 眨眼状态机
      if (this.blinkPhase === 'idle') {
        this.blinkTimer += dt;
        if (this.blinkTimer >= this.nextBlink) {
          this.blinkPhase = 'close';
          this.blinkTimer = 0;
        }
      } else {
        this.blinkTimer += dt;
        if (this.blinkPhase === 'close' && this.blinkTimer > 0.07) {
          this.blinkPhase = 'hold';
          this.blinkTimer = 0;
        } else if (this.blinkPhase === 'hold' && this.blinkTimer > 0.05) {
          this.blinkPhase = 'open';
          this.blinkTimer = 0;
        } else if (this.blinkPhase === 'open' && this.blinkTimer > 0.1) {
          this.blinkPhase = 'idle';
          this.blinkTimer = 0;
          this.nextBlink = 2.4 + Math.random() * 4.2;
        }
      }

      if (this.patTimer > 0) this.patTimer -= dt;
      const patting = this.patTimer > 0;

      const baseBlink = (this.blinkPhase === 'close' || this.blinkPhase === 'hold') ? 1 : 0;
      const targetBlink = patting ? 1 : baseBlink;
      this.blinkValue = lerp(this.blinkValue, targetBlink, clamp(dt / (this.blinkPhase === 'open' ? 0.08 : 0.05), 0, 1));

      this.headHoverTimer = this.headHover ? this.headHoverTimer + dt : 0;
      const wantHoverClose = this.headHover && this.headHoverTimer > 0.1;
      this.hoverEye = lerp(this.hoverEye, wantHoverClose ? 1 : 0, clamp(dt / 0.16, 0, 1));
      this.eyeClose = Math.max(this.blinkValue, this.hoverEye);

      if (this.talkEnvelope > 0) this.talkEnvelope -= dt;
      const speaking = this.talking || this.talkEnvelope > 0;

      // 嘴
      if (this.mouthMode !== 'none') {
        const rest = this.opt.mouth?.rest === 'open' ? 1 : 0;
        let pulse = rest;
        let driven = false;
        if (this.mouthDemo > 0) {
          this.mouthDemo = Math.max(0, this.mouthDemo - dt);
          const tt = 1 - this.mouthDemo / this.mouthDemoTotal;
          const wave = 0.5 - 0.5 * Math.cos(tt * Math.PI * 4);
          pulse = rest + (rest === 1 ? -1 : 1) * 0.92 * wave;
          driven = true;
        } else if (speaking) {
          const env = this.talking ? 1 : clamp(this.talkEnvelope / 0.18, 0, 1);
          const syl = Math.max(0, Math.sin(this.t * 13.0));
          const gap = 0.55 + 0.45 * Math.sin(this.t * 2.7 + 0.6);
          const speech = syl * gap;
          pulse = rest === 1 ? 1 - (1 - speech) * env * 0.92 : speech * env;
          driven = true;
        }
        const target = clamp(pulse, 0, 1);
        this.mouthOpen = lerp(this.mouthOpen, target, clamp(dt / (driven ? 0.055 : 0.12), 0, 1));
      }

      this.gaze.x = lerp(this.gaze.x, this.gazeTarget.x, clamp(dt * 8, 0, 1));
      this.gaze.y = lerp(this.gaze.y, this.gazeTarget.y, clamp(dt * 8, 0, 1));
      this.headTurn = lerp(this.headTurn, this.headTurnTarget, clamp(dt * 5, 0, 1));

      if (Math.abs(this.hop) > 0.01 || Math.abs(this.hopVel) > 0.01) {
        this.hopVel += -this.hop * 900 * dt - this.hopVel * 9 * dt;
        this.hop += this.hopVel * dt;
        if (Math.abs(this.hop) < 0.2 && Math.abs(this.hopVel) < 1) {
          this.hop = 0;
          this.hopVel = 0;
        }
      }

      if (this.opt.jelly) {
        this.jellyVel += (-this.jelly * 260 - this.jellyVel * 12) * dt;
        this.jelly = clamp(this.jelly + this.jellyVel * dt, -0.35, 0.35);
      }

      this.squash = lerp(this.squash, this.dragging ? 1 : 0, clamp(dt * 10, 0, 1));
      this.speaking = speaking;
      this.patting = patting;
    }

    // ---------- 每帧绘制 ----------
    render() {
      const ctx = this.ctx;
      const v = this.view;
      const W = this.W;
      const H = this.H;
      const m = this.opt.motion;
      const breath = Math.sin(this.t * 1.9);
      const sway = Math.sin(this.t * 0.62);
      const patting = this.patting;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, v.w, v.h);
      if (!this.layers.length) return;

      // ---- body：呼吸 / 摇摆 / 果冻 / 拖动挤压 / 跳 ----
      const cx = W / 2;
      const ch = H;
      let bodySx = 1 - breath * (m.breath * 0.36) + this.squash * 0.06;
      let bodySy = 1 + breath * m.breath - this.squash * 0.075;
      if (this.opt.jelly) {
        bodySy *= 1 + this.jelly;
        bodySx *= 1 - this.jelly * 0.55;
      }
      const bodyRot = sway * m.sway + this.squash * 0.02 + (patting ? Math.sin(this.t * 7) * 0.006 : 0);
      const bodyY = ch + breath * 1.6 - this.hop - (patting ? Math.sin(this.t * 9) * 2.2 : 0);
      // position=(cx, bodyY)、pivot=(cx, ch) → T(cx,bodyY)·R·S·T(-cx,-ch)
      // = T(0, bodyY-ch) · rotAbout(cx,ch) · scaleAbout(cx,ch)
      const bodyM = mul(
        tr(0, bodyY - ch),
        mul(rotAbout(cx, ch, bodyRot), scaleAbout(cx, ch, bodySx, bodySy)),
      );

      // ---- 后发 ----
      const bp = this.opt.backHairPivot;
      const backHairM = rotAbout(bp[0], bp[1], -sway * 0.012 - this.headTurn * 0.004);

      // ---- 头 ----
      const hp = this.opt.headPivot;
      const patSway = patting ? Math.sin(this.t * 6.2) * 5 : 0;
      const headX = hp[0] + this.headTurn * m.headTurn + patSway;
      const headY = hp[1] + this.gaze.y * -2.5 + (this.speaking ? Math.sin(this.t * 7.5) * 1.6 : 0);
      const headRot = this.headTurn * this.opt.headTilt
        + (this.speaking ? Math.sin(this.t * 3.2) * 0.004 : 0)
        + (patting ? -0.02 : 0);
      // position 相对 pivot 的位移 + 绕 pivot 旋转
      const headM = mul(tr(headX - hp[0], headY - hp[1]), rotAbout(hp[0], hp[1], headRot));

      const viewM = v.matrix;
      const eyeClose = this.eyeClose || 0;
      const gx = this.gaze.x * m.gazeMax[0];
      const gy = this.gaze.y * m.gazeMax[1];
      const bl = this.opt.blinkLash;

      for (const layer of this.layers) {
        const kind = layer.kind;
        let M;
        let alpha = 1;
        if (kind === 'hairBack') M = mul(bodyM, backHairM);
        else if (kind === 'body') M = bodyM;
        else M = headM; // head / face / mouth / eye*

        if (kind === 'eyeIris') {
          alpha = 1 - eyeClose;
          M = mul(M, tr(gx, gy));
        } else if (kind === 'eyeWhite') {
          alpha = 1 - eyeClose;
        } else if (kind === 'eyeLash') {
          const off = typeof bl === 'number' ? [0, bl] : (bl[layer.side] || bl.l || [0, 0]);
          M = mul(M, tr(gx * 0.25 + eyeClose * (off[0] || 0), eyeClose * (off[1] || 0)));
        } else if (kind === 'mouth') {
          if (this.opt.mouth?.hideBase) alpha = 1 - clamp(this.mouthOpen * 8, 0, 1);
          // rest=open 的皮肤（原图张嘴）：靠纵向压扁闭嘴，说话时再张开
          if (this.mouthMode === 'squash') {
            const mp = this.opt.mouthPivot;
            const min = this.opt.mouth?.squashMin ?? 0.2;
            const open = clamp(this.mouthOpen, 0, 1);
            const k = 1 - open;
            M = mul(M, scaleAbout(mp[0], mp[1], 1 - 0.05 * k, min + (1 - min) * open));
          }
        }

        const tm = mul(viewM, M);
        ctx.setTransform(tm.a, tm.b, tm.c, tm.d, tm.e, tm.f);
        ctx.globalAlpha = alpha;
        ctx.drawImage(layer.bmp, 0, 0, W, H);

        if (kind === 'mouth') this.drawMouth(headM, viewM);
      }

      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /** 嘴部叠加：先画盖住原嘴线的补丁，再画嘴洞（随张开度纵向展开）。 */
    drawMouth(headM, viewM) {
      if (this.mouthMode !== 'swap' || !this.mouthOpenBmp) return;
      const open = clamp(this.mouthOpen, 0, 1);
      const vis = clamp(open * 5, 0, 1);
      if (this.mouthCoverBmp) {
        const cm = mul(viewM, headM);
        this.ctx.setTransform(cm.a, cm.b, cm.c, cm.d, cm.e, cm.f);
        this.ctx.globalAlpha = vis;
        this.ctx.drawImage(this.mouthCoverBmp, 0, 0, this.W, this.H);
      }
      const op = this.opt.mouth?.openPivot || this.opt.mouthPivot;
      const off = this.opt.mouth?.openOffset || [0, 0];
      const sx = 0.94 + 0.06 * open;
      const sy = 0.18 + 0.82 * open;
      const mouthLocal = mul(tr(op[0] + off[0], op[1] + off[1]), scaleAbout(op[0], op[1], sx, sy));
      const tm = mul(viewM, mul(headM, mouthLocal));
      this.ctx.setTransform(tm.a, tm.b, tm.c, tm.d, tm.e, tm.f);
      this.ctx.globalAlpha = vis;
      this.ctx.drawImage(this.mouthOpenBmp, 0, 0, this.W, this.H);
    }
  }

  /**
   * 建一个 layered rig（已加载完所有图层、已开始绘制）。
   * @param {object} manifest
   * @param {string} baseUrl 皮肤目录 URL（以 / 结尾）
   * @param {{width?:number,height?:number}} [opts]
   */
  async function create(manifest, baseUrl, opts) {
    if (!manifest || !Array.isArray(manifest.layers)) throw new Error('invalid-layered-manifest');
    const rig = new LayeredRig(manifest, baseUrl, opts);
    await rig.init();
    await rig.loadSounds();
    return rig;
  }

  window.FishBodyLayered = { create, LayeredRig };
})();
