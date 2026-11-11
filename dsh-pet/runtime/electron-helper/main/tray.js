'use strict';
/**
 * 系统托盘：桌面模式的显示开关与「退出」入口。
 *
 * 托盘是桌面模式唯一不进浏览器的入口——某只宠物改成 web/none 后窗口与右键菜单一起消失，
 * 只有托盘还能把它切回来。菜单是静态的：切换 display 后宿主会重启本进程，新进程按新配置重建。
 * @module dsh-pet/runtime/electron-helper/main/tray
 */

const path = require('node:path');

/** 显示位置取值与文案：与 shared/menu/tree.ts 的 DISPLAY_LABELS 必须一致（主进程拿不到 shared-core）。 */
const DISPLAY_ORDER = ['web', 'desktop', 'both', 'none'];
const DISPLAY_LABELS = { web: '仅网页', desktop: '仅桌面', both: '两者', none: '都不' };

/**
 * 大小档位：必须与 shared/menu/tree.ts 的 `SIZE_PRESETS` 同值（主进程拿不到 shared-core，只能各存一份）。
 * 契约测试会比对这两张表，改一处漏改另一处即红。
 */
const SIZE_PRESETS = [
  { label: '小', scale: 0.7 },
  { label: '中', scale: 1 },
  { label: '大', scale: 1.35 },
  { label: '特大', scale: 1.8 },
];

/** 档位对应的画框宽度：与右键「大小」同一算法（基准倍率取整到 10px，基准本身原样）。 */
function presetSizeOf(base, scale) {
  return scale === 1 ? base : Math.round((base * scale) / 10) * 10;
}

/**
 * 画框宽度的区间与步进（托盘「更小 / 更大」用）。
 *
 * 必须与 shared/pet-size.ts 的 `SIZE_MIN` / `SIZE_MAX` 一致——主进程拿不到 shared-core；
 * 契约测试会解析那份源码逐项比对。托盘是 Electron **原生**菜单，塞不了滑块，
 * 所以这里用「±40px 步进 + 快捷档位」逼近连续调节。
 */
const SIZE_MIN = 120;
const SIZE_MAX = 2048;
const SIZE_STEP_PX = 40;

/** 音量档位：托盘只给这几档，精确值仍可在设置页的滑块上调。 */
const VOLUME_STEPS = [0, 0.25, 0.5, 0.75, 1];

/** 档位文案：0 写「静音」，其余写百分比（与设置页滑块的读数同单位）。 */
function volumeLabel(value) {
  return value === 0 ? '静音' : Math.round(value * 100) + '%';
}

/**
 * 造托盘能力。
 *
 * @param deps.app - Electron app（退出）。
 * @param deps.Tray - Electron Tray 构造器。
 * @param deps.Menu - Electron Menu（模板 → 菜单）。
 * @param deps.nativeImage - Electron nativeImage（图标）。
 * @param deps.hostRequest - 与宿主通信（读配置、改 display、请求退出）。
 * @param deps.callbackUrl - bridge 回调地址（建托盘前要等它就绪）。
 * @param deps.isBridge - 是否由宿主以 bridge 模式拉起。
 * @param deps.appMode - 是否同进程应用模式。
 * @param deps.petRoute - 宠物路由前缀。
 * @param deps.platform - 托盘平台差异（tray-platform.js 的判定结果）。
 * @param deps.helperDir - runtime/electron-helper 的绝对目录（图标在包的 assets/ 下）。
 */
function createTray({
  app,
  Tray,
  Menu,
  nativeImage,
  hostRequest,
  callbackUrl,
  isBridge,
  appMode,
  petRoute,
  platform,
  helperDir,
  petWindows,
}) {
  const isDesktopDisplay = (display) => display === 'desktop' || display === 'both';

  /** 翻转「桌面位」：both↔web、desktop↔none——浏览器位保持不动，因此不制造新的单向门 */
  const toggleDisplay = (display) =>
    display === 'both' ? 'web' : display === 'web' ? 'both' : display === 'desktop' ? 'none' : 'desktop';

  let tray = null;
  /** 托盘「隐藏宠物」的当前状态：只影响窗口显隐，不动配置（下一次重建进程会回到「显示」）。 */
  let hidden = false;

  /** 写回某只宠物的 display：宿主写完配置会重启本进程，响应可能永远不回（同 sprite.js 的 setPetDisplay） */
  function traySetPetDisplay(id, display) {
    hostRequest('POST', petRoute + '/pet-display', JSON.stringify({ id, display })).catch((e) => {
      console.error('[dsh-pet-desktop-helper] tray pet-display failed:', String(e && e.message ? e.message : e));
    });
  }

  /**
   * 写回某只宠物当前渲染方式的画框宽度（`size === undefined` = 删掉覆盖，回落 `pets[].size`）。
   *
   * 与右键「大小」同一端点；宿主写盘后会重启 Helper，所以同样不 await、不刷新菜单——
   * 本进程随即被换掉，重画没有意义。
   */
  function traySetPetSize(id, size) {
    const body = size === undefined ? { id } : { id, size };
    hostRequest('POST', petRoute + '/pet-size', JSON.stringify(body)).catch((e) => {
      console.error('[dsh-pet-desktop-helper] tray pet-size failed:', String(e && e.message ? e.message : e));
    });
  }

  /**
   * 切某只宠物的「鼠标穿透」。
   *
   * 托盘与宠物窗口在同一个进程里：先就地翻窗（`setClickThrough` 会强制整窗穿透并把最终值回推渲染端），
   * 再把目标值写进配置（`/pet-click-through` 不重启 Helper，下一次启动按配置落位）。
   * 写完刷新一次菜单，勾选跟着走。
   */
  function traySetClickThrough(id, value) {
    const win = petWindows && petWindows.state && petWindows.state.windows ? petWindows.state.windows.get(id) : null;
    if (win && typeof petWindows.setClickThrough === 'function') petWindows.setClickThrough(win, value);
    hostRequest('POST', petRoute + '/pet-click-through', JSON.stringify({ id, value }))
      .then(() => refreshTray())
      .catch((e) => {
        console.error(
          '[dsh-pet-desktop-helper] tray pet-click-through failed:',
          String(e && e.message ? e.message : e),
        );
      });
  }

  /**
   * 写播放音量（全局 0–1）。这条**不会**重启 Helper：音量是播放端增益，写盘后广播 config 即可；
   * 写完顺手刷新一次菜单，让新档位打上勾。
   */
  function traySetVolume(volume) {
    hostRequest('POST', petRoute + '/voice/volume', JSON.stringify({ volume }))
      .then(() => refreshTray())
      .catch((e) => {
        console.error('[dsh-pet-desktop-helper] tray voice volume failed:', String(e && e.message ? e.message : e));
      });
  }

  /** 托盘里的维护动作：两个都会把本进程换掉（重载配置 / 重新组合插件），所以不 await、不重试。 */
  function trayPost(route, label) {
    hostRequest('POST', petRoute + route).catch((e) => {
      console.error('[dsh-pet-desktop-helper] tray ' + label + ' failed:', String(e && e.message ? e.message : e));
    });
  }

  /** 「隐藏宠物 / 显示宠物」：整批窗口 hide/showInactive，改的是显隐不是配置。 */
  function toggleHidden() {
    if (!petWindows || typeof petWindows.setHidden !== 'function') return;
    hidden = !hidden;
    petWindows.setHidden(hidden);
    void refreshTray();
  }

  /** 托盘图标：包内 logo 缩到 16×16（macOS 要模板图，否则深色菜单栏下看不见） */
  function trayIcon() {
    const file = path.join(helperDir, '..', '..', 'assets', 'logo.png');
    let img = nativeImage.createFromPath(file);
    if (img.isEmpty()) {
      // 读不到图标 = 托盘不可见但菜单逻辑照跑，最难查的一种坏法：必须留下能定位的日志
      console.error('[dsh-pet-desktop-helper] tray icon missing or unreadable: ' + file);
      return img;
    }
    img = img.resize({ width: 16, height: 16 });
    if (platform.templateImage) img.setTemplateImage(true);
    return img;
  }

  /**
   * 托盘「退出」是否该出现。
   *
   * 独立应用与手动 start-desktop 流可以自己 app.quit()；isBridge 下本进程由宿主拉起，
   * 自己退会被当成崩溃按退避重启，必须先问宿主（GET /quit 的 canQuit）。
   * @returns 可以自己退出时为 true；探测失败按不支持处理，菜单项因此不出现。
   */
  async function canQuitSelf() {
    if (appMode || !isBridge) return true;
    try {
      return JSON.parse((await hostRequest('GET', petRoute + '/quit')).body || '{}').canQuit === true;
    } catch (e) {
      console.error('[dsh-pet-desktop-helper] quit capability probe failed:', String(e && e.message ? e.message : e));
      return false;
    }
  }

  /**
   * 按当前配置拼托盘菜单；返回 null 表示此时不该有托盘（开关关掉 / 配置里没有宠物）。
   *
   * 独立成函数是为了应用模式的重建：那边改 display 只重建窗口、不重启进程，
   * 勾选状态得靠这里重读一次刷新，否则菜单和配置对不上。
   */
  async function buildMenu() {
    const resp = await hostRequest('GET', petRoute + '/config');
    const merged = JSON.parse(resp.body || '{}');
    // 托盘开关（main 条目的 trayEnabled）：只有显式 false 才不建，缺失或写坏时保持建，
    // 免得一份老配置或一个错值让托盘无声消失。与下面的 pets 取自同一份成品配置。
    if (merged && merged.main && merged.main.trayEnabled === false) return null;
    // 成品聚合的形状是 { <条目>: <整份配置文档> }：顶层键不是宠物，宠物在各条目的 pets 数组里
    // （与渲染端同一契约）。托盘要 id/name/display（可见性）、size/sizes/renderer（当前生效宽度）
    // 与 clickThrough（鼠标穿透）——这三组各自对应一个子菜单，不吹条目级字段。
    const pets = Object.values(merged)
      .flatMap((conf) => (conf && Array.isArray(conf.pets) ? conf.pets : []))
      .map((pet) => {
        const sizes = pet && pet.sizes && typeof pet.sizes === 'object' && !Array.isArray(pet.sizes) ? pet.sizes : {};
        const renderer = String((pet && pet.renderer) || 'webm');
        const ownSize = Number(sizes[renderer]);
        return {
          id: String((pet && pet.id) || ''),
          name: String((pet && pet.name) || '').trim(), // host 已保证 name 缺失时回落 id
          display: String((pet && pet.display) || ''),
          baseSize: Number(pet && pet.size) || 0,
          renderer,
          // 当前渲染方式的覆盖值；缺键 = 跟随 baseSize（与 shared/pet-size 的 renderSizeOf 同口径）。
          overrideSize: Number.isFinite(ownSize) && ownSize > 0 ? ownSize : undefined,
          clickThrough: pet && pet.clickThrough === true,
        };
      })
      .filter((pet) => pet.id);
    if (!pets.length) return null; // 配置里没有任何宠物：没有可切换的对象，不建托盘
    const canQuit = await canQuitSelf();
    // 当前音量：读成品配置的 main.voiceVolume（缺省 1 = 满音量，与 shared/voice.ts 的 clamp 口径一致）。
    const rawVolume = merged && merged.main ? merged.main.voiceVolume : undefined;
    const currentVolume = typeof rawVolume === 'number' && Number.isFinite(rawVolume) ? rawVolume : 1;

    /**
     * 托盘「退出」：能退出整个应用就退出，否则只结束桌面助手。
     *
     * BRIDGE 模式下不能自己 app.quit()——宿主会按崩溃退避重启，点了只是闪一下；
     * 所以走宿主：有 shutdownApp 就 POST /quit（整个应用退出），没有就 POST /desktop/stop
     * （只停桌面助手，DSH 继续跑，直到下次配置写入或重启插件）。
     */
    const quitApp = () => {
      if (!isBridge || appMode) {
        app.quit();
        return;
      }
      trayPost(canQuit ? '/quit' : '/desktop/stop', 'quit');
    };

    /** 每只宠物的四个显示位置（单宠物时摊平，多宠物时每只一层，与动作树的摊平口径一致）。 */
    const displayItems = (pet) =>
      DISPLAY_ORDER.map((display) => ({
        label: DISPLAY_LABELS[display],
        type: 'radio',
        checked: pet.display === display,
        click: () => traySetPetDisplay(pet.id, display),
      }));
    const displayMenu =
      pets.length === 1
        ? displayItems(pets[0])
        : pets.map((pet) => ({
            label: pet.name || pet.id,
            submenu: displayItems(pet),
          }));

    /**
     * 每只宠物的鼠标穿透开关（checkbox：勾 = 该窗整窗忽略鼠标）。
     *
     * 单宠物时直接摊成一项「鼠标穿透」；多宠物时每只一层（勾选态各自独立，不能做成 radio）。
     * 托盘是窗内右键菜单在「宠物点不到」时唯一还能开关它的地方，所以这一项必须在托盘里有。
     */
    const clickThroughItems = () =>
      pets.length === 1
        ? [
            {
              label: '鼠标穿透',
              type: 'checkbox',
              checked: pets[0].clickThrough,
              click: () => traySetClickThrough(pets[0].id, !pets[0].clickThrough),
            },
          ]
        : [
            {
              label: '鼠标穿透',
              submenu: pets.map((pet) => ({
                label: pet.name || pet.id,
                type: 'checkbox',
                checked: pet.clickThrough,
                click: () => traySetClickThrough(pet.id, !pet.clickThrough),
              })),
            },
          ];

    /** 每只宠物当前渲染方式的大小档位（与右键「大小」同一套算法与勾选语义）。 */
    const sizeItems = (pet) => {
      const current = pet.overrideSize === undefined ? pet.baseSize : pet.overrideSize;
      const shown = (text, size) => text + '（' + size + 'px）';
      // 原生菜单没有滑块：这两项是替身，点一次挪 40px，到区间边界置灰。
      const items = [
        {
          label: '更小（−' + SIZE_STEP_PX + 'px）',
          enabled: current > SIZE_MIN,
          click: () => traySetPetSize(pet.id, Math.max(SIZE_MIN, current - SIZE_STEP_PX)),
        },
        {
          label: '更大（+' + SIZE_STEP_PX + 'px）',
          enabled: current < SIZE_MAX,
          click: () => traySetPetSize(pet.id, Math.min(SIZE_MAX, current + SIZE_STEP_PX)),
        },
        { type: 'separator' },
      ];
      for (const preset of SIZE_PRESETS) {
        const size = presetSizeOf(pet.baseSize, preset.scale);
        const checked = current === size;
        items.push({
          label: checked ? shown(preset.label, size) + '✓' : shown(preset.label, size),
          type: 'radio',
          checked,
          click: () => traySetPetSize(pet.id, size),
        });
      }
      // 恢复默认 = 删掉当前渲染方式的覆盖，回落 pets[].size。与右键菜单同形：普通项、不打勾
      // （当前值由上面哪个档位带 ✓ 表达——基准值本身就是「中」，两个勾并存只会让人犯迷糊）。
      items.push({
        label: '恢复默认大小',
        click: () => traySetPetSize(pet.id, undefined),
      });
      return items;
    };
    const sizeMenu =
      pets.length === 1
        ? sizeItems(pets[0])
        : pets.map((pet) => ({
            label: pet.name || pet.id,
            submenu: sizeItems(pet),
          }));

    return Menu.buildFromTemplate([
      ...pets.map((pet) => ({
        label: pet.name || pet.id,
        type: 'checkbox',
        checked: isDesktopDisplay(pet.display),
        click: () => traySetPetDisplay(pet.id, toggleDisplay(pet.display)),
      })),
      { type: 'separator' },
      // 显示位置：右键菜单那一项的四选一，这里对全部宠物（或逐只）生效。
      { label: '显示位置', submenu: displayMenu },
      // 鼠标穿透：右键菜单同名项的托盘版本——宠物开了穿透就点不到它自己，这里是唯一出口。
      ...clickThroughItems(),
      // 大小：写 pets[].sizes[当前渲染方式]，宿主写盘后重启 Helper 生效（同「显示位置」）。
      { label: '大小', submenu: sizeMenu },
      // 音量：写 voiceVolume，不重启进程；当前档位打勾（不在档位上的精确值四项都不勾）。
      {
        label: '音量',
        submenu: VOLUME_STEPS.map((value) => ({
          label: volumeLabel(value),
          type: 'radio',
          checked: Math.abs(currentVolume - value) < 0.001,
          click: () => traySetVolume(value),
        })),
      },
      { label: hidden ? '显示宠物' : '隐藏宠物', click: toggleHidden },
      { type: 'separator' },
      { label: '重载配置', click: () => trayPost('/reload', 'reload') },
      { label: '重启插件', click: () => trayPost('/plugin-restart', 'plugin-restart') },
      // 回到初始位置：位置状态在渲染端（会话位置 + 拖拽），托盘只能发命令让它自己复位。
      {
        label: '回到初始位置',
        click: () => {
          if (petWindows && typeof petWindows.broadcastCommand === 'function') petWindows.broadcastCommand('home');
        },
      },
      { type: 'separator' },
      { label: '退出', click: quitApp },
    ]);
  }

  /**
   * 建托盘：列出配置里全部宠物（含 display 为 web/none 的——它们当前勾是空的，点一下就能送回来，
   * 这是托盘相对宠物右键菜单的增量）。勾 = 当前 display 含 desktop/both。
   */
  async function startTray() {
    try {
      // 请求行要携带回调 URL，而端口在 startBridgeCallback 的 listen 回调里才有值（最多等 2s）
      for (let i = 0; isBridge && !callbackUrl() && i < 100; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      const menu = await buildMenu();
      if (menu === null) return;
      tray = new Tray(trayIcon());
      tray.setToolTip('dsh-pet 桌面宠物');
      tray.setContextMenu(menu);
      // Windows 上 setContextMenu 只接管右键，左键默认什么都不做（macOS 相反：左键即弹菜单）
      if (platform.leftClickPopsMenu) tray.on('click', () => tray.popUpContextMenu());
    } catch (e) {
      console.error('[dsh-pet-desktop-helper] tray init failed:', String(e && e.message ? e.message : e));
    }
  }

  /** 重读配置并刷新菜单勾选；没建托盘时什么都不做（应用模式重建窗口后调用）。 */
  async function refreshTray() {
    if (!tray) return;
    try {
      const menu = await buildMenu();
      if (menu !== null) tray.setContextMenu(menu);
    } catch (e) {
      console.error('[dsh-pet-desktop-helper] tray refresh failed:', String(e && e.message ? e.message : e));
    }
  }

  return {
    start: startTray,
    refresh: refreshTray,
    exists: () => tray !== null,
    destroy() {
      if (!tray) return;
      try {
        tray.destroy();
      } catch (e) {
        console.error('[dsh-pet-desktop-helper] tray destroy failed:', String(e && e.message ? e.message : e));
      }
      tray = null;
    },
  };
}

/** 画框宽度的区间与步进（导出给契约测试比对 shared/pet-size.ts）。 */
const SIZE_RANGE = { min: SIZE_MIN, max: SIZE_MAX, step: SIZE_STEP_PX };

module.exports = { createTray, SIZE_PRESETS, SIZE_RANGE };
