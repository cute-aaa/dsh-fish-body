/**
 * 桌面 Helper 渲染端入口：配置加载、错误处理、启动装配与素材注入。
 * 依赖链（index.html 顺序加载）：shared-core.js → constants.js → sprite.js → events.js → 本文件。
 * 配置唯一来源是宿主 /config 的成品聚合（一步 fetch → S.flattenConfigPets 拍平），失败大声报错并每 5s
 * 重试，没有静默兜底。窗口 = 宠物包围盒 + 四周外扩余量，宠物移动由本页逐帧上报给主进程。
 * 不实现宠物行为与系统通知（见 sprite.js）。
 * @module dsh-fish-body/runtime/electron-helper/renderer
 */
'use strict';

// 配置（大声报错；失败 5s 重试）
function showError(message) {
  console.error('[fish-body] ' + message);
  window.__dshPetDebug.configOk = false;
  errorEl.textContent = 'dsh-pet 配置错误：' + message;
  errorEl.classList.add('visible');
}
function hideError() {
  errorEl.classList.remove('visible');
  errorEl.textContent = '';
}
function scheduleReboot() {
  if (bootTimer) return;
  bootTimer = setTimeout(() => {
    bootTimer = null;
    void boot();
  }, 5000);
}

/**
 * 连续启动失败次数（成功一次即清零）。首次失败多半是启动竞态：主进程不等 bridge 回调服务就绪
 * 就建窗，首帧 fetch 会打空；5s 重试就自愈，不该闪红条。持续失败才是真配置错误，照旧大声报。
 */
let bootFailures = 0;

async function loadConfig() {
  // 唯一配置入口：宿主 /config 的成品聚合（已合并并保证绝对正确），一步拉取 → 拍平，零校验零兜底
  const res = await fetch(BASE + '/config', { cache: 'no-store' });
  if (!res.ok) throw new Error(`config http ${res.status}`);
  const merged = await res.json();
  // 接口统一 200 + 实体：失败时状态码仍是 200，得看体里的 ok。
  if (merged && merged.ok === false) throw new Error('config ' + String(merged.reason ?? 'failed'));
  return {
    pets: S.flattenConfigPets(merged),
    // 拖拽抛掷物理参数（顶层全局，所有宠物共用；合并器已填内置默认）
    physics: (merged && merged.main && merged.main.physics) || S.DEFAULT_PHYSICS,
    // 抛掷锁定在当前屏幕（根字段；合并器已填内置默认 false）
    confineToScreen: (merged && merged.main && merged.main.confineToScreen) === true,
    // 音效总闸（全局一份，只读 main 条目；合并器已填内置默认 true）
    sfxEnabled: (merged && merged.main && merged.main.sfxEnabled) === true,
    // 音效常驻预热（内置默认开，只有显式 false 才关）
    sfxKeepAlive: !(merged && merged.main && merged.main.sfxKeepAlive === false),
    // 音效总音量（缺省由共享播放器按 0.5 处理）
    sfxVolume: merged && merged.main ? merged.main.sfxVolume : undefined,
    // 字体（全局一份，合并器已填内置默认）：字体族在此注入全局变量，字号由每只宠物按自己的尺寸算
    font: (merged && merged.main && merged.main.font) || S.DEFAULT_FONT,
    // 语音：音色与音量（缺省由共享层按默认音色 / 最大音量处理）
    voiceName: (merged && merged.main && merged.main.voiceName) || '',
    // 音量只在播放入口用，缺省由共享层按最大音量处理，这里不兜 1
    voiceVolume: merged && merged.main ? merged.main.voiceVolume : undefined,
  };
}

/**
 * 拉本宠物的音效索引：宿主已按搜索链算好优先级、填好内置默认，这里只负责取回来并预热素材。
 * 失败只告警一次并返回空索引（事件槽仍有内置默认音），绝不阻断启动。
 *
 * @param {object} pet - 成品配置里本窗口的宠物。
 * @returns {Promise<object>} 索引（失败时是空索引）。
 */
async function loadSfxIndex(pet) {
  const root = pet.assetRoot || pet.id;
  const query =
    BASE +
    '/sound/' +
    encodeURIComponent(root) +
    '/index?renderer=' +
    encodeURIComponent(pet.renderer || 'webm') +
    '&model=' +
    encodeURIComponent(pet.model || '');
  try {
    const res = await fetch(query, { cache: 'no-store' });
    if (!res.ok) throw new Error('index http ' + res.status);
    const body = await res.json();
    if (body && body.ok === false) throw new Error('index ' + String(body.reason || 'failed'));
    const index = {
      events: body.events || {},
      animations: body.animations || {},
      hooks: body.hooks || {},
      origin: body.origin || {},
    };
    // 预热事件槽素材：第一下不依赖「取文件 + 解码」的延迟，也避免首声走回退路径。
    for (const file of Object.values(index.events)) S.preloadSfx(soundUrlOf(root, file, pet.model || '', pet.renderer));
    return index;
  } catch (e) {
    console.warn(
      '[fish-body] 音效索引加载失败 pet=' +
        pet.id +
        '：' +
        (e && e.message ? String(e.message) : String(e)) +
        '（改用内置默认音效）',
    );
    return { events: {}, animations: {}, hooks: {}, origin: {} };
  }
}

// 启动（配置校验通过才建 sprite；失败大声报错 + 5s 自动重试）
async function boot() {
  try {
    const cfg = await loadConfig();
    config = cfg;
    // 音效：总闸交给共享播放器（常热 AudioContext + 预解码 + 常驻保活），关着就挂起不占设备。
    S.configureSfx({
      enabled: cfg.sfxEnabled === true,
      volume: cfg.sfxVolume,
      keepAlive: cfg.sfxKeepAlive !== false,
    });
    // 语音：本窗口固定是桌面端；音色、总开关与音量直接取成品配置，不走懒加载——
    // 懒加载要等第一次播放才去拉 /config，撞上 bridge 起步竞态就永远读不到开关（读失败只试一次）。
    S.setVoiceBase(BASE);
    S.setSurface('desktop');
    S.setVoiceConfig(cfg.voiceName, cfg.voiceVolume);
    bootFailures = 0;
    hideError();
    // 字体族进 documentElement：对话窗/得分弹窗挂在 body 下、继承不到宠物根容器，只能走全局变量。
    // 必须等 /config 拉回来之后才设（字体族来自配置）。
    document.documentElement.style.setProperty('--dsh-pet-font-family', S.fontStackOf(cfg.font.family));
    const pets = cfg.pets.filter((p) => S.isDesktopVisible(p.display));
    if (pets.length === 0) {
      // 全部宠物只在网页显示是合法状态，不是配置错误：没有桌面宠物就表示本窗口没活儿干，
      // 安静关掉、不弹条、不重试。托盘是否还在看 main 条目的 trayEnabled，与这里无关。
      // 宿主流由 syncDesktop() 在配置变化时重建 Helper；手动流需自行重启。
      hideError();
      console.info('[fish-body] no desktop pets; closing this helper window (tray kept only if trayEnabled)');
      window.close();
      return;
    }
    // 本窗口只承载一只宠物：petIndex 由主进程按 DSH_PET_PETS 顺序注入
    const pet = pets[CONFIG.petIndex];
    if (!pet) {
      showError('petIndex=' + CONFIG.petIndex + ' 超出桌面宠物列表（共 ' + pets.length + ' 只），本窗口不创建宠物');
      scheduleReboot();
      return;
    }
    for (const s of sprites) s.dispose();
    sprites = [new PetSprite(pet)];
    // 音效索引：本窗只养一只宠物，按它的素材根 / 渲染方式 / 皮肤拉一份；失败只降级成内置默认。
    sfxIndex = await loadSfxIndex(pet);
    for (const s of sprites) s.applySfx(sfxIndex);
    window.__dshPetDebug.configOk = true;
    window.__dshPetDebug.spriteCount = sprites.length;
    for (const s of sprites) s.playIdle();
    startLoops();
  } catch (e) {
    const msg = '配置加载失败：' + (e && e.message ? String(e.message) : String(e));
    // 首次失败先静默（多半是启动竞态，见 bootFailures 的说明），下一次 5s 重试仍失败才报。
    bootFailures += 1;
    if (bootFailures > 1) showError(msg);
    else console.error('[fish-body] ' + msg + ' (first boot, retrying)');
    scheduleReboot();
  }
}

// 注入打字资源：气泡字体 + 点击/拖拽光标图标（与浏览器同一套素材，host 经 /dsh-pet-7340/ 提供）
function injectAssets() {
  const style = document.createElement('style');
  style.textContent =
    '@font-face{font-family:"DymonShouXieTi";src:url("' +
    BASE +
    '/font/' +
    'Dymon-ShouXieTi.otf") format("opentype");font-display:swap;font-weight:400}' +
    '.pet-hit{cursor:url("' +
    BASE +
    '/pic/cursor-grab.png") 16 16, grab}' +
    '.pet-hit.dragging{cursor:url("' +
    BASE +
    '/pic/cursor-grabbing.png") 16 16, grabbing}';
  document.head.appendChild(style);
  // 统一右键菜单样式（与浏览器注入同一份 MENU_CSS）
  const menuStyle = document.createElement('style');
  menuStyle.textContent = S.MENU_CSS;
  document.head.appendChild(menuStyle);
  // 悬浮提示样式（与浏览器注入同一份 TIP_BASE_CSS + TOOLTIP_CSS，取代命中层上的原生 title 提示）
  const tipStyle = document.createElement('style');
  tipStyle.textContent = S.TIP_BASE_CSS + '\n' + S.TOOLTIP_CSS;
  document.head.appendChild(tipStyle);
}

// 显示器几何变化（改分辨率/缩放、插拔屏、旋转）：主进程重算后推来，渲染端就地重挂视口与边界。
if (window.petBridge && window.petBridge.onDisplays) {
  window.petBridge.onDisplays((geo) => {
    // 变化前的视口原点必须在 applyDeskGeometry 之前取：relayout 靠它把旧视口相对坐标还原成
    // 世界坐标，否则合盖/开盖时视口原点一平移，宠物就会被误判越界。
    const prevView = { x: VIEW.x, y: VIEW.y, w: VIEW.w, h: VIEW.h };
    if (!applyDeskGeometry(geo)) return;
    for (const s of sprites) s.relayout(prevView);
  });
}

// 托盘 / 快捷键命令：「回到初始位置」与「暂停 / 恢复」。
// 托盘与全局快捷键都在主进程，不知道会话位置与拖拽状态，所以复位由这里做（与右键菜单同一条 goHome）；
// 暂停要落到**本窗口的语音模块**上：窗口被 hide() 之后页面还在跑，不在这里静音就会从看不见的宠物那儿出声。
if (window.petBridge && window.petBridge.onCommand) {
  window.petBridge.onCommand((name) => {
    if (name === 'pause' || name === 'resume') {
      if (S && typeof S.setVoicePaused === 'function') S.setVoicePaused(name === 'pause');
      return;
    }
    if (name !== 'home') return;
    for (const s of sprites) {
      if (s.dragState.active || s.throwRef !== null) continue;
      s.goHome();
    }
  });
}

// 窗口内容区尺寸异常时按当前位置重新规整。
// 守卫：拖拽/飞行/漫游中绝不重设位置——这三种状态下位置由输入或物理驱动，而 position() 会把
// 宠物拉回 customPos。跨屏时 Windows 会因 WM_DPICHANGED 主动改窗口尺寸，不设防就会看到宠物跳回上一个落点。
window.addEventListener('resize', () => {
  for (const s of sprites) {
    if (s.dragState.active || s.throwRef !== null || s.moveRef !== null) continue;
    s.position();
  }
});

injectAssets();
void boot();
