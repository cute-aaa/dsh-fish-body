'use strict';
/**
 * 桌面宠物窗口：建窗、整窗穿透镜像、宠物状态广播、任务栏保持、两条实时泵。
 *
 * 窗口表与按窗口索引的几张表都由本模块独占（`state` 只给同进程的装配根与 ipc 用，不是对外接口）。
 * 两条泵的生命周期跟着窗口：建窗起跑，`closed` 时停止并清句柄——泵自己不清，因为同一窗口上还有别的清理。
 * @module dsh-pet/runtime/electron-helper/main/windows
 */
const path = require('node:path');
const { pointerZone, decideWindowIgnore, forcedIgnore } = require('../pointer-target.js');
const { TOPMOST_WATCHDOG_ENABLED, TOPMOST_WATCHDOG_TICK_MS } = require('../topmost-watchdog.js');
const { TASKBAR_WATCHDOG_TICK_MS, shouldRunTaskbarWatchdog } = require('../taskbar-watchdog.js');

/** 兜底通道的光标轮询间隔（ms）。 */
const POINTER_POLL_MS = 60;

/**
 * 造窗口能力。
 *
 * @param deps.BrowserWindow - Electron BrowserWindow 构造器。
 * @param deps.screen - Electron screen（逐屏几何）。
 * @param deps.buildDeskGeometry - desktop-geometry.js 的纯函数（屏幕列表 → 几何）。
 * @param deps.dpi - DPI/指针能力（petScale 与 currentPointer）。
 * @param deps.helperDir - runtime/electron-helper 的绝对目录（index.html、preload.js、图标都在里面）。
 * @param deps.isBridge - 是否 bridge 模式（渲染端据此切换协议地址）。
 * @param deps.openTarget - 菜单首项的去向（desktop 唤起应用 / standalone 本机设置页 / web 站点）。
 * @param deps.platform - 托盘与置顶的平台差异（tray-platform.js 的判定）。
 * @param deps.shouldReassertTopmost - 看门狗的纯判定。
 * @param deps.topmostLevel - 平台对应的置顶层级。
 * @param deps.taskbarWatchdogEnabled - 任务栏看门狗总开关（main.js 按 DSH_PET_TASKBAR_WATCHDOG 传入）。
 */
function createWindows({
  BrowserWindow,
  screen,
  buildDeskGeometry,
  dpi,
  helperDir,
  isBridge,
  openTarget,
  platform,
  shouldReassertTopmost,
  topmostLevel,
  taskbarWatchdogEnabled,
}) {
  /** 窗口表：petId -> BrowserWindow */
  const windows = new Map();
  /** win.id -> 上一次请求的内容区矩形（"x,y,w,h"）：pet:set-bounds 的去重基准 */
  const lastRequestedBounds = new Map();
  /** win.id -> 渲染端上报的窗口余量 `{ l, t }`：上边距按气泡加高后余量不再四边相等，命中区不能按宽反推 */
  const winMargins = new Map();
  /** 每窗口当前穿透状态的镜像（Electron 没有取值 API）：所有翻转都经 setWindowIgnore */
  const windowIgnore = new Map();
  /** 每窗口的「鼠标穿透」开关镜像（`pets[].clickThrough`）：true 时任何通道都翻不回可交互 */
  const clickThrough = new Map();
  /** 每窗口「渲染端正拿着鼠标输入」标记，由渲染端经 pet:input-busy 上报 */
  const inputBusy = new Map();
  /** 新渲染端把菜单/聊天框局部矩形单独上报，避免忙碌态下整窗透明余量吞点击 */
  const inputRegions = new Map();
  /** 每窗口「光标停在余量区且非 busy」的连续时长（ms）：到点由兜底通道强制恢复穿透 */
  const offBodyMs = new Map();
  /** 宠物间碰撞 broker 状态：petId -> { x, y, vx, vy, size, bottomPad } */
  const petStates = new Map();
  /** 冒烟期间暂停兜底泵：它按真实光标翻转，会干扰冒烟对渲染端通道的断言 */
  let pointerFallbackPaused = false;

  /** 碰撞站场最多每 16ms 广播一次，位置仍由 IPC 逐帧立即提交。 */
  let petStateTimer = null;

  /** 把当前全量宠物状态广播给所有窗口（碰撞检测的共享站场）。 */
  function broadcastPetStates() {
    if (petStateTimer !== null) {
      clearTimeout(petStateTimer);
      petStateTimer = null;
    }
    const states = {};
    for (const [pid, s] of petStates) {
      states[pid] = { x: s.x, y: s.y, vx: s.vx, vy: s.vy, size: s.size, bottomPad: s.bottomPad };
    }
    for (const win of windows.values()) {
      if (!win.isDestroyed()) win.webContents.send('pet:flight-states', states);
    }
  }

  /** 记录/更新一只宠物的状态并广播。 */
  function updatePetState(petId, partial) {
    const prev = petStates.get(petId) || { x: 0, y: 0, vx: 0, vy: 0, size: 0, bottomPad: 0 };
    const next = Object.assign({}, prev, partial);
    if (petStates.has(petId) && Object.keys(next).every((key) => Object.is(next[key], prev[key]))) return;
    petStates.set(petId, next);
    // 单窗没有碰撞对象；多窗合并同一时间段内的更新，定时回调读取最新状态，保留最后一帧。
    if (windows.size < 2 || petStateTimer !== null) return;
    petStateTimer = setTimeout(broadcastPetStates, 16);
    petStateTimer.unref?.();
  }

  /**
   * 翻转整窗穿透的唯一出口：状态与镜像永远一起更新（穿透期间保留 forward）。
   *
   * 用户开了「鼠标穿透」时这里把结果强制成穿透（见 pointer-target 的 forcedIgnore）：
   * 两条判定通道（渲染端上报 / 兜底轮询）都会经过这里，所以不存在「一条通道翻回来」的半穿透。
   *
   * @param {object} win - 目标窗口。
   * @param {boolean} ignore - 常规通道算出的穿透状态。
   */
  function setWindowIgnore(win, ignore) {
    const next = forcedIgnore(clickThrough.get(win.id) === true, ignore);
    win.setIgnoreMouseEvents(next, { forward: true });
    windowIgnore.set(win.id, next);
  }

  /**
   * 应用一只宠物的「鼠标穿透」开关（渲染端切换、启动落位都走这里）。
   *
   * 打开：立刻强制整窗穿透并广播给渲染端（渲染端据此停掉悬停/提示判定）。
   * 关闭：**不**主动翻成可交互——直接把窗口交还给常规通道（渲染端上报 + 兜底轮询），
   * 否则启动落位那一次「关」会让透明大窗先挡一下鼠标，宠物贴边时还会被钉在可交互状态。
   *
   * @param {object} win - 目标窗口。
   * @param {boolean} on - 是否穿透。
   */
  function setClickThrough(win, on) {
    if (!win || win.isDestroyed()) return;
    const value = on === true;
    clickThrough.set(win.id, value);
    if (value) setWindowIgnore(win, true);
    if (!win.isDestroyed()) win.webContents.send('pet:click-through', value);
  }

  /** 桌面几何：逐屏工作区、外接矩形、主屏下标；边界判定必须走 areas 的并集而不是 hull。 */
  function deskGeometry() {
    return buildDeskGeometry(screen.getAllDisplays(), screen.getPrimaryDisplay().id, process.platform);
  }

  /** 桌面宠物列表（[{id,size,index}]）：宿主经 DSH_PET_PETS 透传；空数组表示明确不建窗。 */
  function petsFromEnv() {
    try {
      const arr = JSON.parse(process.env.DSH_PET_PETS || '');
      if (Array.isArray(arr)) {
        return arr.map((pet, index) => ({
          id: String(pet?.id ?? `pet-${index}`),
          size: Number(pet?.size) > 0 ? Number(pet.size) : 462,
          index,
        }));
      }
    } catch {
      /* fallthrough */
    }
    return [{ id: 'main', size: 462, index: 0 }];
  }

  /** 窗口初始尺寸 = 宠物包围盒 + 四周外扩余量；渲染端首帧会按真实配置精确覆盖。 */
  function petWindowSize(size) {
    const height = (size * 9) / 16;
    const bottomPad = (size * (9 / 16) * (360 - 330)) / 360;
    const m = Math.round(size * 0.5);
    return { width: Math.round(size) + m * 2, height: Math.round(height + bottomPad) + m * 2 };
  }

  /** 单次重申（幂等）：show 的异步重建路径与看门狗共用。 */
  function reassertTaskbar(win) {
    if (!win || win.isDestroyed()) return;
    win.setSkipTaskbar(true);
  }

  /** 把窗口从任务栏摘掉：show 后 Shell 会异步重建按钮，紧跟一次 0ms 的第二次调用才算数。 */
  function keepOffTaskbar(win) {
    reassertTaskbar(win);
    setTimeout(() => reassertTaskbar(win), 0);
  }

  /** 看门狗定时器句柄；null 表示未启动。 */
  let taskbarWatchdogTimer = null;

  /** 启动任务栏看门狗：仅 Windows 且总开关开启；重复调用无副作用。 */
  function startTaskbarWatchdog() {
    if (taskbarWatchdogTimer || !shouldRunTaskbarWatchdog(process.platform, taskbarWatchdogEnabled)) return;
    taskbarWatchdogTimer = setInterval(() => {
      for (const win of windows.values()) reassertTaskbar(win);
    }, TASKBAR_WATCHDOG_TICK_MS);
    taskbarWatchdogTimer.unref?.();
  }

  /** 停止看门狗：进程退出前调用，避免定时器拖住退出。 */
  function stopTaskbarWatchdog() {
    if (!taskbarWatchdogTimer) return;
    clearInterval(taskbarWatchdogTimer);
    taskbarWatchdogTimer = null;
  }

  /** 穿透兜底泵：正规翻转链路只有 forward 鼠标钩子，它在 Windows 上可能静默失效。 */
  function startPointerFallback(win) {
    const pointerTimer = setInterval(() => {
      if (pointerFallbackPaused || win.isDestroyed()) return;
      // 用户开了鼠标穿透：窗口恒穿透，兜底轮询无事可做（判出 false 也只会被 forcedIgnore 压回去）。
      if (clickThrough.get(win.id) === true) return;
      const bounds = win.getBounds();
      if (bounds.width < 8 || bounds.height < 8) return; // 尺寸还没落定（首帧上报前）
      const ignoring = windowIgnore.get(win.id) !== false;
      const busy = inputBusy.get(win.id) === true;
      const point = dpi.currentPointer();
      const margin = winMargins.get(win.id);
      const zone = pointerZone(bounds, point, margin);
      const nextMs = !busy && zone === 'margin' ? (offBodyMs.get(win.id) ?? 0) + POINTER_POLL_MS : 0;
      offBodyMs.set(win.id, nextMs);
      const next = decideWindowIgnore(bounds, point, ignoring, busy, nextMs, inputRegions.get(win.id), margin);
      if (next !== ignoring) setWindowIgnore(win, next);
    }, POINTER_POLL_MS);
    return () => clearInterval(pointerTimer);
  }

  /** 置顶看门狗：WS_EX_TOPMOST 位还在不代表真的在置顶带，低频重钉一次（总开关见 TOPMOST_WATCHDOG_ENABLED）。 */
  function startTopmostWatchdog(win) {
    let lastTopmostAssertMs = Date.now();
    const topmostTimer = setInterval(() => {
      const nowMs = Date.now();
      const due = shouldReassertTopmost(
        {
          nowMs,
          lastAssertMs: lastTopmostAssertMs,
          destroyed: win.isDestroyed(),
          visible: win.isVisible(),
          paused: pointerFallbackPaused,
        },
        TOPMOST_WATCHDOG_ENABLED,
      );
      if (!due) return;
      lastTopmostAssertMs = nowMs;
      win.setAlwaysOnTop(true, topmostLevel(process.platform));
    }, TOPMOST_WATCHDOG_TICK_MS);
    return () => clearInterval(topmostTimer);
  }

  /** 建窗口时的固定参数（与渲染端约定的透明置顶小窗）。 */
  function windowOptions(size, area) {
    return {
      ...size,
      x: area.x, // 初始左上角；renderer 首帧按配置角落/位置校正
      y: area.y,
      show: false,
      useContentSize: true,
      // macOS 默认会把已显示窗口的 y 钳到菜单栏下沿；局部画布的透明余量必须允许伸出屏幕
      enableLargerThanScreen: true,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      // 任务栏按钮万一还是冒出来（唤醒后重建），至少显示宠物图标而不是 Electron 默认原子图
      icon: path.join(helperDir, '..', '..', 'assets', 'logo.png'),
      resizable: false,
      hasShadow: false,
      // 可聚焦：对话输入框/菜单需要焦点才能打字；显示用 showInactive()，不打断其它应用
      focusable: true,
      webPreferences: {
        preload: path.join(helperDir, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        paintWhenInitiallyHidden: false,
        spellcheck: false,
      },
    };
  }

  /** 一只宠物一个窗口；返回窗口，泵与清理都在这里装好。 */
  function createPetWindow(pet, geo, scale) {
    const win = new BrowserWindow(windowOptions(petWindowSize(pet.size * scale), geo.hull));
    win.setAlwaysOnTop(true, topmostLevel(process.platform));
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // 被遮挡的窗口默认暂停渲染，表现成「消失」；关掉后台节流让它持续渲染
    win.webContents.setBackgroundThrottling(false);
    // 屏蔽 Electron 默认右键菜单：右键菜单由渲染端统一自绘，绝无双菜单
    win.webContents.on('context-menu', (event) => event.preventDefault());
    // 渲染端 console 转进主进程日志：layered/live2d 的挂载失败、皮肤 404、pixi 初始化异常都只在这里可见
    // （透明窗口没有 DevTools，出问题时不转发就完全静默）。走 warn：宿主把 helper 的 stderr 当 warn 落盘，
    // console.log 会落到 debug 级被日志过滤掉。
    win.webContents.on('console-message', (event) => {
      const level = String(event.level ?? '');
      const message = String(event.message ?? '');
      if (level !== 'warning' && level !== 'error' && !message.includes('[dsh-pet]')) return;
      console.warn(`[renderer:${level}] ${message}`);
    });
    // DSH_PET_DEBUG=1：透明窗口没有 DevTools，排查渲染后端时把关键现场打到主进程日志。
    // DSH_PET_DEBUG_CLICK=1 额外模拟一次点击，用来核对命中区手势（lastGesture）。
    if (process.env.DSH_PET_DEBUG === '1') {
      const dump = () =>
        win.webContents.executeJavaScript(
          `(() => ({
            sprites: document.querySelectorAll('.pet-sprite').length,
            visual: document.querySelectorAll('.pet-visual').length,
            canvas: document.querySelectorAll('.pet-visual-canvas').length,
            pixi: typeof window.PIXI,
            live2dNs: !!(window.PIXI && window.PIXI.live2d),
            core: typeof window.Live2DCubismCore,
            base: typeof BASE === 'string' ? BASE : String(BASE),
            err: (document.getElementById('pet-error') || {}).textContent || '',
            lastGesture: (window.__dshPetDebug && window.__dshPetDebug.lastGesture) || null,
            lastClick: (window.__dshPetDebug && window.__dshPetDebug.lastClick) || null,
          }))()`,
        );
      const clickPet = () =>
        win.webContents.executeJavaScript(
          `(() => {
            const hit = document.querySelector('.pet-hit');
            if (!hit) return false;
            const r = hit.getBoundingClientRect();
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 71 }));
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 71 }));
            hit.dispatchEvent(new PointerEvent('click', { bubbles: true, clientX: x, clientY: y, pointerId: 71 }));
            return true;
          })()`,
        );
      win.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          void dump()
            .then((state) => console.warn('[dsh-pet-debug] ' + JSON.stringify(state)))
            .catch((error) => console.warn('[dsh-pet-debug] executeJavaScript 失败 ' + String(error)));
          if (process.env.DSH_PET_DEBUG_CLICK !== '1') return;
          setTimeout(() => {
            void clickPet()
              .then(() =>
                setTimeout(() => {
                  void dump()
                    .then((state) => console.warn('[dsh-pet-debug:click] ' + JSON.stringify(state)))
                    .catch(() => undefined);
                }, 1200),
              )
              .catch(() => undefined);
          }, 500);
        }, 12000);
      });
    }
    // 页面级缩放与渲染端 CONFIG.scale 同源；show:false 的窗口 zoomFactor 不生效，须加载后设置
    win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(scale));
    setWindowIgnore(win, true);
    win.on('show', () => keepOffTaskbar(win));
    win.once('ready-to-show', () => {
      keepOffTaskbar(win);
      win.showInactive();
    });
    // 兜底显示：paintWhenInitiallyHidden:false 时可能不产出首帧，ready-to-show 永不触发
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (!win.isDestroyed() && !win.isVisible()) win.showInactive();
      }, 400);
    });
    const stopPointerFallback = startPointerFallback(win);
    const stopTopmostWatchdog = startTopmostWatchdog(win);
    win.on('closed', () => {
      stopPointerFallback();
      stopTopmostWatchdog();
      windows.delete(pet.id);
      petStates.delete(pet.id);
      broadcastPetStates();
      lastRequestedBounds.delete(win.id);
      winMargins.delete(win.id);
      windowIgnore.delete(win.id);
      clickThrough.delete(win.id);
      inputBusy.delete(win.id);
      inputRegions.delete(win.id);
      offBodyMs.delete(win.id);
    });
    win.loadFile(path.join(helperDir, 'index.html'), { query: windowQuery(pet, geo, scale) }).catch((error) => {
      console.error(`[dsh-pet-desktop-helper] page load failed (${pet.id}):`, error);
      win.destroy();
    });
    return win;
  }

  /** 渲染端首帧需要的全部参数：几何逐屏注入，运行期变化再经 pet:displays 推送。 */
  function windowQuery(pet, geo, scale) {
    return {
      configUrl: process.env.DSH_PET_CONFIG_URL || 'http://127.0.0.1:3080/dsh-pet-7340/config',
      bridge: isBridge ? '1' : '0',
      openTarget,
      scale: String(scale),
      petIndex: String(pet.index),
      workAreaW: String(geo.hull.width),
      workAreaH: String(geo.hull.height),
      workAreaX: String(geo.hull.x),
      workAreaY: String(geo.hull.y),
      areas: JSON.stringify(geo.areas),
      workAreas: JSON.stringify(geo.workAreas),
      topInsetRatio: String(geo.topInsetRatio),
      panels: JSON.stringify(geo.panels),
      primaryIndex: String(geo.primaryIndex),
      // X11 的窗口管理器把普通窗口钳在工作区内，窗口探不出屏幕；Windows / macOS 没这个限制。
      // 渲染端据此决定要不要把钳掉的量转成本体在窗口内的偏移（见 fitWindow）。
      isWindowClampedToWorkArea: process.platform === 'linux' ? '1' : '0',
    };
  }

  /** 按 DSH_PET_PETS 建齐所有窗口。 */
  function createPetWindows() {
    const geo = deskGeometry();
    const scale = dpi.petScale();
    for (const pet of petsFromEnv()) windows.set(pet.id, createPetWindow(pet, geo, scale));
    startTaskbarWatchdog();
  }

  /**
   * 关掉当前全部宠物窗口。
   *
   * 只给应用模式的重建用：同进程里没有「重启 helper 进程」这条路，改显示位置只能关窗再建；
   * 不先关掉的话旧窗口会留在桌面上（Map 里被覆盖的只是引用）。
   * 双进程模式靠重启进程达成同一目的，不调它。
   */
  function closeAllPetWindows() {
    for (const win of windows.values()) {
      try {
        win.destroy();
      } catch (e) {
        console.error('[dsh-pet-desktop-helper] window destroy failed:', String(e && e.message ? e.message : e));
      }
    }
    windows.clear();
    petStates.clear();
    if (petStateTimer !== null) {
      clearTimeout(petStateTimer);
      petStateTimer = null;
    }
  }

  /**
   * 托盘「隐藏宠物 / 显示宠物」：整批窗口 hide/showInactive。
   *
   * 用 showInactive 而不是 show：桌宠不该因为从托盘里喊回来就抢走当前窗口的焦点。
   * 隐藏的是窗口不是配置——display 一个字节都不动，所以「显示宠物」只是把同一批窗口放出来。
   */
  function setHidden(hidden) {
    for (const win of windows.values()) {
      if (win.isDestroyed()) continue;
      try {
        if (hidden) win.hide();
        else win.showInactive();
      } catch (e) {
        console.error('[dsh-pet-desktop-helper] window hide/show failed:', String(e && e.message ? e.message : e));
      }
    }
  }

  /**
   * 给全部宠物窗口发一条渲染端命令（目前只有 `home` = 回到初始位置）。
   *
   * 托盘在主进程里，拿不到渲染端的会话位置与拖拽状态；位置复位必须由渲染端自己做（goHome）。
   */
  function broadcastCommand(name) {
    for (const win of windows.values()) {
      if (win.isDestroyed()) continue;
      win.webContents.send('pet:command', name);
    }
  }

  return {
    state: {
      windows,
      lastRequestedBounds,
      winMargins,
      windowIgnore,
      clickThrough,
      inputBusy,
      inputRegions,
      offBodyMs,
      petStates,
    },
    create: createPetWindows,
    closeAll: closeAllPetWindows,
    geometry: deskGeometry,
    setWindowIgnore,
    setClickThrough,
    updatePetState,
    broadcastPetStates,
    keepOffTaskbar,
    stopTaskbarWatchdog,
    setHidden,
    broadcastCommand,
    setPointerFallbackPaused: (paused) => {
      pointerFallbackPaused = paused;
    },
  };
}

module.exports = { createWindows };
