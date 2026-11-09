/**
 * core.js —— 桌宠共享渲染内核（纯 DOM，无框架、无构建）。
 * 被两种形态复用：DSH 浏览器内（client.js 挂到 shell.overlay）与桌面独立窗口（standalone.html）。
 *
 * 渲染后端三选一（config.modelType）：
 *  - webm   ：两层 `<video>`——idle 常驻循环 + action 叠加临时动作。
 *             临时动作播放时 idle 淡出（不是留在底下透出来），播完再淡回，动作之间互不干扰。
 *  - layered：canvas 2D 合成分层 PNG 皮肤（assets/layered.js，surfcore schema 2）。
 *  - live2d ：占位降级（没有 SDK 时显示 🧊）。
 *
 * 音效绑定：某动画名 X 若存在同名音效 X，则播 X；否则回落到配置的默认音效。
 * 点击音效优先级：X-click → X.click → X → 默认 clickSound。
 */
(function () {
  'use strict';

  const API = '/api/fish-body';
  const ASSET = '/fish-body-assets';
  const LAYERED_SRC = `${ASSET}/layered.js`;
  /** 动作与常态交叉淡入淡出的时长（ms）。 */
  const FADE_MS = 140;
  /**
   * dsh-pet 系列 webm 是 640×360 的大留白画布，角色只占约 74% 高、34% 宽。
   * 直接 object-fit:contain 会让宠物在框里显得很小，所以按这个比例放大后再居中。
   */
  const WEBM_CONTENT_RATIO = 0.74;

  function h(tag, style, text) {
    const el = document.createElement(tag);
    if (style) el.style.cssText = style;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // 共享脚本加载（layered.js 只在真的用分层皮肤时才拉）
  const scriptPromises = new Map();
  function loadScript(src) {
    if (scriptPromises.has(src)) return scriptPromises.get(src);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`script-load-failed ${src}`));
      document.head.appendChild(s);
    });
    scriptPromises.set(src, p);
    return p;
  }

  function buildBox(standalone) {
    const box = h('div', [
      'position:fixed',
      'bottom:20px',
      'width:200px',
      'height:240px',
      // 首帧前先藏着（setVisible 的 visible 初值是 false，避免显示后才闪一下）
      'display:none',
      'z-index:2147483000',
      'pointer-events:none',
      'user-select:none',
      'overflow:visible',
      standalone ? 'left:50%;transform:translateX(-50%)' : 'right:24px',
    ].join(';'));
    box.setAttribute('data-fish-body', '1');

    const bubble = h('div', [
      'position:absolute',
      'left:50%',
      'bottom:calc(100% + 8px)',
      'transform:translateX(-50%)',
      'max-width:220px',
      'padding:8px 12px',
      'border-radius:12px',
      'background:var(--dsw-alias-bg-overlay,rgba(24,26,36,.92))',
      'color:var(--dsw-alias-label-primary,#e8eaf0)',
      'font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
      'box-shadow:0 4px 16px rgba(0,0,0,.35)',
      'opacity:0',
      'transition:opacity .18s ease',
      'word-break:break-word',
      'white-space:pre-wrap',
      'pointer-events:none',
      'text-align:center',
    ].join(';'));

    const stage = h('div', [
      'position:relative',
      'width:100%',
      'height:100%',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'overflow:hidden',
      'pointer-events:auto',
      'cursor:grab',
    ].join(';'));

    const videoStyle = [
      'max-width:100%',
      'max-height:100%',
      'object-fit:contain',
      'pointer-events:none',
      'position:absolute',
      'left:50%',
      'top:50%',
      'transform:translate(-50%,-50%)',
      'opacity:1',
    ].join(';');

    const idleEl = h('video', videoStyle);
    idleEl.autoplay = true;
    idleEl.loop = true;
    idleEl.muted = true;
    idleEl.playsInline = true;

    const actionEl = h('video', `${videoStyle};display:none;opacity:0`);
    actionEl.autoplay = false;
    actionEl.loop = false;
    actionEl.muted = true;
    actionEl.playsInline = true;

    const fallback = h('div', [
      'font-size:64px',
      'line-height:1',
      'filter:drop-shadow(0 4px 8px rgba(0,0,0,.25))',
      'display:none',
      'position:absolute',
      'left:50%',
      'top:50%',
      'transform:translate(-50%,-50%)',
    ].join(';'), '🐟');

    const status = h('div', [
      'position:absolute',
      'bottom:2px',
      'right:2px',
      'width:12px',
      'height:12px',
      'border-radius:50%',
      'background:#22c55e',
      'box-shadow:0 0 8px #22c55e',
      'transition:background .3s ease, box-shadow .3s ease',
      'display:none',
    ].join(';'));

    stage.appendChild(idleEl);
    stage.appendChild(actionEl);
    stage.appendChild(fallback);
    stage.appendChild(status);
    box.appendChild(stage);
    box.appendChild(bubble);
    return { box, bubble, stage, idleEl, actionEl, fallback, status };
  }

  function soundSrc(name) {
    if (!name) return null;
    return `${ASSET}/sound/${encodeURIComponent(name)}`;
  }

  const STATUS_COLORS = {
    idle: '#22c55e', thinking: '#f59e0b', working: '#3b82f6', waiting: '#a855f7', success: '#22c55e', error: '#ef4444',
  };
  const STATUS_TEXTS = {
    thinking: '在想了…', working: '在忙…', waiting: '等你回…', success: '搞定啦', error: '哎呀，出错了',
  };

  /**
   * @param {HTMLElement} container 挂载点
   * @param {{standalone?:boolean}} [opts] standalone=true 表示桌面独立窗口（不因 form=desktop 隐藏）
   */
  function mount(container, opts) {
    opts = opts || {};
    const standalone = Boolean(opts.standalone);
    const { box, bubble, stage, idleEl, actionEl, fallback, status } = buildBox(standalone);
    container.appendChild(box);

    const audioPool = [];
    const warmVideos = [];
    const cleanup = [];
    let state = null;
    let currentModel = 'webm';
    let layeredRig = null;
    let layeredToken = 0;
    let layeredWant = null; // 期望的皮肤 id
    let layeredLoading = null; // 正在加载的皮肤 id
    let layeredFailedAt = 0; // 失败退避（避免每 5s 重试刷屏）
    let visible = false;

    /** 动画名 → 资源 key；配置了 webmSet（角色包）时用 <角色>/<动作名>。 */
    function animKey(name) {
      if (!name) return '';
      const cfg = (state && state.config) || {};
      const set = cfg.webmSet || '';
      if (!set || String(name).includes('/')) return name;
      return `${set}/${name}`;
    }

    function el(name) {
      if (!name) return null;
      return `${ASSET}/webm/${encodeURIComponent(animKey(name))}`;
    }

    // ---------- 尺寸 ----------
    let boxW = 0;
    function applySize(cfg) {
      const size = Number(cfg.size) > 0 ? Number(cfg.size) : 200;
      const scale = Number(cfg.scale) > 0 ? Number(cfg.scale) : 1;
      const w = Math.round(clamp(size * scale, 48, 1200));
      if (w === boxW) return;
      boxW = w;
      box.style.width = `${w}px`;
      box.style.height = `${Math.round(w * 1.2)}px`;
      bubble.style.maxWidth = `${Math.round(w * 1.5)}px`;
      fitVideo(idleEl);
      fitVideo(actionEl);
    }

    // ---------- webm 按内容比例放大（见 WEBM_CONTENT_RATIO） ----------
    function fitVideo(v) {
      if (!v || !v.videoWidth || !v.videoHeight) return;
      const stageH = stage.clientHeight || Math.round((boxW || 200) * 1.2);
      const hgt = stageH / WEBM_CONTENT_RATIO;
      const wid = hgt * (v.videoWidth / v.videoHeight);
      v.style.maxWidth = 'none';
      v.style.maxHeight = 'none';
      v.style.width = `${Math.round(wid)}px`;
      v.style.height = `${Math.round(hgt)}px`;
    }
    idleEl.addEventListener('loadedmetadata', () => fitVideo(idleEl));
    actionEl.addEventListener('loadedmetadata', () => fitVideo(actionEl));

    // ---------- 可见性 ----------
    function setVisible(next) {
      if (next === visible) return;
      visible = next;
      box.style.display = next ? 'block' : 'none';
      if (!next) {
        stopLoopAudio();
        try { idleEl.pause(); actionEl.pause(); } catch { /* 忽略 */ }
        layeredRig?.stop();
      } else {
        layeredRig?.start();
        if (currentModel === 'webm' && idleEl.src) idleEl.play().catch(() => {});
      }
    }

    // ---------- 音频 ----------
    function playAudio(src, loop) {
      if (!src) return;
      try {
        const a = new Audio(src);
        a.loop = !!loop;
        a.volume = 0.9;
        a.play().catch(() => {});
        if (loop) audioPool.push(a);
        else a.onended = () => { const i = audioPool.indexOf(a); if (i >= 0) audioPool.splice(i, 1); };
      } catch { /* 忽略音频失败 */ }
    }

    function stopLoopAudio() {
      for (const a of audioPool) { try { a.pause(); } catch { /* 忽略 */ } }
      audioPool.length = 0;
    }

    function soundFor(animName, fallbackName) {
      const sounds = (state && state.assets && state.assets.sounds) || [];
      if (animName && sounds.some((s) => s.name === animName)) return animName;
      return fallbackName || '';
    }

    function clickSoundFor(animName, fallbackName) {
      const sounds = (state && state.assets && state.assets.sounds) || [];
      if (animName) {
        if (sounds.some((s) => s.name === `${animName}-click`)) return `${animName}-click`;
        if (sounds.some((s) => s.name === `${animName}.click`)) return `${animName}.click`;
        if (sounds.some((s) => s.name === animName)) return animName;
      }
      return fallbackName || '';
    }

    // ---------- 气泡 ----------
    function setBubble(text) {
      if (!text) { hideBubble(); return; }
      bubble.textContent = text;
      bubble.style.opacity = '1';
    }
    function hideBubble() {
      bubble.style.opacity = '0';
      delete bubble.dataset.chat;
    }
    function bubbleTimer() {
      clearTimeout(bubble._t);
      bubble._t = setTimeout(hideBubble, 8000);
    }

    // ---------- webm 两层视频 + 交叉淡入淡出 ----------
    let idleKey = null;
    let actionKey = null;
    let actionToken = 0;
    let actionActive = false;

    function setVideoIdle(name) {
      if (!name) { showFallback('🐟'); return; }
      const key = animKey(name);
      if (idleKey === key) return;
      idleKey = key;
      idleEl.style.display = 'block';
      if (!actionActive) idleEl.style.opacity = '1';
      fallback.style.display = 'none';
      idleEl.src = el(name);
      idleEl.play().catch(() => {});
      stopLoopAudio();
      const cfg = (state && state.config) || {};
      playAudio(soundSrc(soundFor(name, cfg.webmIdleSound)), true);
    }

    function warmAction(name) {
      if (!name || warmVideos.some((v) => v.dataset.name === name)) return;
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      v.dataset.name = name;
      v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px';
      v.src = el(name);
      document.body.appendChild(v);
      warmVideos.push(v);
      try { v.load(); } catch { /* 忽略 */ }
    }

    function showActionFrame(token) {
      if (token !== actionToken) return;
      actionActive = true;
      actionEl.style.display = 'block';
      actionEl.style.transition = 'none';
      actionEl.style.opacity = '0';
      actionEl.play().catch(() => {});
      // 兜底：ended/error 都没来（解码异常等）也要把 idle 淡回来，别一直空着
      const dur = Number.isFinite(actionEl.duration) && actionEl.duration > 0 ? actionEl.duration : 6;
      setTimeout(() => {
        if (token === actionToken && actionActive) endAction(token);
      }, Math.min(120000, Math.round(dur * 1000) + 1200));
      // 下一帧再上透明度，确保过渡真的触发
      requestAnimationFrame(() => {
        if (token !== actionToken) return;
        actionEl.style.transition = `opacity ${FADE_MS}ms ease`;
        actionEl.style.opacity = '1';
        idleEl.style.transition = `opacity ${FADE_MS}ms ease`;
        idleEl.style.opacity = '0';
      });
    }

    // 临时动作：播放时 idle 淡出（避免 action 的透明区域露出底下的 idle），播完淡回。
    function playAction(name, isClick) {
      if (!name || currentModel !== 'webm') return;
      const cfg = (state && state.config) || {};
      const sound = isClick ? clickSoundFor(name, cfg.clickSound) : soundFor(name, cfg.clickSound);
      const token = ++actionToken;
      const begin = () => {
        if (token !== actionToken) return;
        showActionFrame(token);
        playAudio(soundSrc(sound), false);
      };

      actionEl.onended = () => endAction(token);
      actionEl.onerror = () => endAction(token);

      const key = animKey(name);
      if (actionKey === key && actionEl.readyState >= 2) {
        try { actionEl.currentTime = 0; } catch { /* 忽略 */ }
        begin();
        return;
      }
      actionKey = key;
      actionEl.style.display = 'none';
      actionEl.onloadeddata = () => { actionEl.onloadeddata = null; begin(); };
      actionEl.src = el(name);
      if (actionEl.readyState >= 2) begin();
    }

    function endAction(token) {
      if (token !== actionToken) return;
      actionActive = false;
      actionEl.onended = null;
      actionEl.onerror = null;
      actionEl.style.transition = `opacity ${FADE_MS}ms ease`;
      actionEl.style.opacity = '0';
      idleEl.style.transition = `opacity ${FADE_MS}ms ease`;
      idleEl.style.opacity = '1';
      setTimeout(() => {
        if (token !== actionToken) return;
        actionEl.style.display = 'none';
      }, FADE_MS + 60);
    }

    function showFallback(emoji) {
      idleEl.style.display = 'none';
      actionEl.style.display = 'none';
      layerCanvasHide();
      fallback.style.display = 'block';
      fallback.textContent = emoji;
    }

    // ---------- layered 皮肤 ----------
    function layerCanvasHide() {
      if (layeredRig) { try { layeredRig.stop(); } catch { /* 忽略 */ } layeredRig.canvas.style.display = 'none'; }
    }

    function disposeLayered() {
      layeredToken++;
      layeredWant = null;
      layeredLoading = null;
      if (layeredRig) {
        try { layeredRig.destroy(); } catch { /* 忽略 */ }
        layeredRig = null;
      }
    }

    async function ensureLayered(skinId) {
      if (!skinId) { showFallback('🖼️'); return; }
      if (layeredRig && layeredWant === skinId) {
        layeredRig.canvas.style.display = 'block';
        if (visible) layeredRig.start();
        return;
      }
      if (layeredLoading === skinId) return; // 正在加载同一个皮肤
      if (layeredFailedAt && Date.now() - layeredFailedAt < 30000 && layeredWant === skinId && !layeredRig) return;
      layeredLoading = skinId;
      layeredWant = skinId;
      const token = ++layeredToken;
      try {
        await loadScript(LAYERED_SRC);
        if (token !== layeredToken) return;
        const base = `${ASSET}/skins/${encodeURIComponent(skinId)}/`;
        const res = await fetch(`${base}manifest.json`);
        if (!res.ok) throw new Error(`manifest ${res.status}`);
        const manifest = await res.json();
        if (token !== layeredToken) return;
        if (layeredRig) {
          try { layeredRig.destroy(); } catch { /* 忽略 */ }
          layeredRig = null;
        }
        const rig = await window.FishBodyLayered.create(manifest, base, {
          width: boxW || 200,
          height: Math.round((boxW || 200) * 1.2),
        });
        if (token !== layeredToken) { try { rig.destroy(); } catch { /* 忽略 */ } return; }
        // 切到分层皮肤：视频层彻底让位（否则 idle 音效/解码还在后台跑）
        try { idleEl.pause(); actionEl.pause(); } catch { /* 忽略 */ }
        stopLoopAudio();
        idleEl.style.display = 'none';
        actionEl.style.display = 'none';
        fallback.style.display = 'none';
        stage.appendChild(rig.canvas);
        layeredRig = rig;
        layeredFailedAt = 0;
        try { window.__fishBodyRig = rig; } catch { /* 只用于调试/自动化 */ }
        if (visible) rig.start(); else rig.stop();
      } catch (e) {
        if (token === layeredToken) {
          layeredFailedAt = Date.now();
          showFallback('🖼️');
        }
      } finally {
        if (layeredLoading === skinId) layeredLoading = null;
      }
    }

    // ---------- 状态应用 ----------
    function resolveModel(cfg) {
      if (cfg.modelType === 'layered' && cfg.layeredSkin) return 'layered';
      if (cfg.modelType === 'live2d') return 'live2d';
      return 'webm';
    }

    function applyState(next) {
      state = next || state;
      if (!state) return;
      const cfg = state.config || {};
      try { window.__fishBodyState = state; } catch { /* 调试用 */ }
      applySize(cfg);

      // 旧宿主没有 desktop 字段（还没升级）：保持旧行为，别把浏览器里的桌宠藏没了
      const hiddenByForm = !standalone && state.desktop !== undefined && state.form === 'desktop';
      const nextVisible = cfg.enabled !== false && !(state.avoidance && state.avoidance.active) && !hiddenByForm;
      setVisible(nextVisible);

      const model = resolveModel(cfg);
      if (model !== currentModel) {
        if (currentModel === 'layered' && model !== 'layered') disposeLayered();
        currentModel = model;
      }

      if (nextVisible) {
        if (model === 'layered') {
          ensureLayered(cfg.layeredSkin);
        } else if (model === 'live2d') {
          disposeLayered();
          showFallback('🧊');
        } else {
          disposeLayered();
          setVideoIdle(cfg.webmIdle);
          warmAction(cfg.webmClick);
        }
      }

      const ws = state.workStatus || {};
      const color = STATUS_COLORS[ws.state] || STATUS_COLORS.idle;
      status.style.background = color;
      status.style.boxShadow = `0 0 8px ${color}`;
      status.style.display = cfg.taskStatus !== false ? 'block' : 'none';
      if (cfg.taskStatus !== false && ws.state && ws.state !== 'idle' && !bubble.dataset.chat) {
        setBubble(ws.detail || ws.currentTool || STATUS_TEXTS[ws.state] || '');
      }
    }

    // ---------- 拖动 ----------
    let downPos = null;
    let dragging = false;
    stage.addEventListener('pointerdown', (e) => {
      downPos = { x: e.clientX, y: e.clientY };
      dragging = false;
      stage.setPointerCapture(e.pointerId);
      layeredRig?.setDragging(true);
    });
    stage.addEventListener('pointermove', (e) => {
      if (currentModel === 'layered' && layeredRig) {
        layeredRig.setPointer(e.clientX, e.clientY);
        const region = layeredRig.regionAt(e.clientX, e.clientY);
        if (region && typeof region.hoverCloseEyes === 'boolean') layeredRig.setHeadHover(region.hoverCloseEyes);
        if (!downPos) stage.style.cursor = region ? 'pointer' : 'grab';
      }
      if (!downPos) return;
      const dx = e.clientX - downPos.x;
      const dy = e.clientY - downPos.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) dragging = true;
      if (dragging) {
        stage.style.cursor = 'grabbing';
        const rect = box.getBoundingClientRect();
        box.style.right = 'auto';
        box.style.bottom = 'auto';
        box.style.transform = 'none';
        box.style.left = `${Math.max(0, Math.min(window.innerWidth - rect.width, rect.left + dx))}px`;
        box.style.top = `${Math.max(0, Math.min(window.innerHeight - rect.height, rect.top + dy))}px`;
        downPos = { x: e.clientX, y: e.clientY };
      }
    });
    stage.addEventListener('pointerup', (e) => {
      stage.style.cursor = 'grab';
      layeredRig?.setDragging(false);
      if (!dragging) onTap(e);
      downPos = null;
      dragging = false;
    });

    async function onTap(e) {
      const cfg = (state && state.config) || {};
      if (currentModel === 'layered' && layeredRig) {
        const hit = layeredRig.pokeAt(e.clientX, e.clientY);
        if (!hit) return; // 点在角色外：不响应
      } else if (currentModel === 'webm') {
        playAction(cfg.webmClick, true);
      }
      try {
        bubble.dataset.chat = '1';
        const res = await fetch(`${API}/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: '（主人戳了戳你，跟主人说句话）' }),
        });
        const data = await res.json();
        if (data && data.ok && data.text) {
          setBubble(data.text);
          bubbleTimer();
          if (layeredRig) layeredRig.talk(2.8);
          if (data.voice && data.voice.dataUrl) {
            const a = new Audio(data.voice.dataUrl);
            a.play().catch(() => {});
          }
        } else {
          hideBubble();
        }
      } catch {
        hideBubble();
      }
    }

    // ---------- 右键菜单 ----------
    const menu = h('div', [
      'position:fixed',
      'z-index:2147483001',
      'background:var(--dsw-alias-bg-overlay,#1e2029)',
      'color:var(--dsw-alias-label-primary,#e8eaf0)',
      'border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35))',
      'border-radius:8px',
      'box-shadow:0 6px 20px rgba(0,0,0,.4)',
      'padding:4px',
      'min-width:150px',
      'font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
      'display:none',
      'pointer-events:auto',
    ].join(';'));
    document.body.appendChild(menu);

    function menuItem(text, onClick) {
      const it = h('div', 'padding:6px 10px;border-radius:5px;cursor:pointer;white-space:nowrap', text);
      it.addEventListener('mouseenter', () => { it.style.background = 'var(--dsw-alias-bg-layer-2,rgba(128,128,128,.2))'; });
      it.addEventListener('mouseleave', () => { it.style.background = 'transparent'; });
      it.addEventListener('click', (e) => { e.stopPropagation(); hideMenu(); onClick(); });
      menu.appendChild(it);
      return it;
    }
    function hideMenu() { menu.style.display = 'none'; }
    function showMenu(x, y) {
      menu.style.display = 'block';
      const r = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(0, Math.min(window.innerWidth - r.width, x))}px`;
      menu.style.top = `${Math.max(0, Math.min(window.innerHeight - r.height, y))}px`;
    }

    menuItem('换个动作', () => {
      if (currentModel === 'layered' && layeredRig) {
        const label = layeredRig.randomGesture();
        setBubble(`换了个动作：${label}`);
        bubbleTimer();
        return;
      }
      const webm = (state && state.assets && state.assets.webm) || [];
      const set = ((state && state.config) || {}).webmSet || '';
      const pool = set ? webm.filter((e) => e.set === set) : webm;
      const list = pool.length ? pool : webm;
      if (list.length > 0) {
        const pick = list[Math.floor(Math.random() * list.length)];
        playAction(pick.id, false); // id 已带角色包前缀（如 shenshen/xxx）
        setBubble(`换了个动作：${pick.name}`);
        bubbleTimer();
      } else setBubble('没有可用的动作');
    });

    menuItem('换点击音效', async () => {
      const sounds = (state && state.assets && state.assets.sounds) || [];
      const cur = (state && state.config) ? state.config.clickSound : '';
      if (sounds.length === 0) { setBubble('没有可用的音效'); return; }
      const idx = Math.max(0, sounds.findIndex((s) => s.name === cur));
      const next = sounds[(idx + 1) % sounds.length];
      playAudio(soundSrc(next.name), false);
      try {
        await fetch(`${API}/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: [{ op: 'set', path: ['clickSound'], value: next.name }] }) });
      } catch { /* 持久化失败不阻塞 */ }
      setBubble(`点击音效换成：${next.name}`);
      bubbleTimer();
    });

    menuItem('查余额', async () => {
      const cfg = (state && state.config) || {};
      setBubble('查余额中…');
      try {
        const res = await fetch(`${API}/balance`);
        const d = await res.json();
        if (d.ok && d.balance && Array.isArray(d.balance.value) && d.balance.value[0]) {
          const w = d.balance.value[0];
          const amount = parseFloat(w.balance) || 0;
          const fullRef = w.currency === 'USD' ? 5 : 20; // 与 dsh-pet 一致的档位基准
          const anim = amount <= 0 ? cfg.webmBalanceEmpty : (amount >= fullRef ? cfg.webmBalanceFull : cfg.webmBalanceNormal);
          if (anim && currentModel === 'webm') playAction(anim, false);
          else if (layeredRig) layeredRig.talk(2.2);
          setBubble(`余额：${w.balance} ${w.currency}`);
        } else {
          if (cfg.webmBalanceEmpty && currentModel === 'webm') playAction(cfg.webmBalanceEmpty, false);
          setBubble('查不到余额：' + (d.message || d.reason || '未知'));
        }
      } catch { setBubble('查余额失败'); }
      bubbleTimer();
    });

    stage.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY);
    });
    document.addEventListener('click', hideMenu);
    const onKey = (e) => { if (e.key === 'Escape') hideMenu(); };
    document.addEventListener('keydown', onKey);
    cleanup.push(() => {
      document.removeEventListener('click', hideMenu);
      document.removeEventListener('keydown', onKey);
      if (menu.parentNode) menu.parentNode.removeChild(menu);
    });

    // ---------- SSE ----------
    let es = null;
    function connect() {
      try {
        es = new EventSource(`${API}/events`);
        es.onmessage = (ev) => {
          try { applyState(JSON.parse(ev.data)); } catch { /* 忽略坏帧 */ }
        };
        cleanup.push(() => es && es.close());
      } catch { /* 无 SSE 时退化到轮询 */ }
    }

    fetch(`${API}/state`).then((r) => r.json()).then(applyState).catch(() => {});
    connect();

    cleanup.push(() => {
      if (bubble._t) clearTimeout(bubble._t);
      stopLoopAudio();
      disposeLayered();
      for (const v of warmVideos) {
        try { v.pause(); v.remove(); } catch { /* 忽略 */ }
      }
      if (box.parentNode) box.parentNode.removeChild(box);
    });

    return {
      update: applyState,
      dispose() { for (const fn of cleanup) { try { fn(); } catch { /* 忽略 */ } } },
    };
  }

  window.FishBodyCore = { mount };
})();
