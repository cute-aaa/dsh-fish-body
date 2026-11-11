/**
 * 桌面托盘的行为契约（runtime/electron-helper/main/tray.js）。
 *
 * 必须成立：勾选来自配置、点一下写回相反的一档；显示位置/音量/隐藏/重载/重启/复位/退出都在菜单里，
 * 且各自打到该打的端点或 IPC 命令（退出按运行形态决定自己退、交给宿主退、还是只停桌面助手）。
 * 依赖全由调用方注入（含 Electron 的 Tray/Menu/nativeImage 与 petWindows），所以不需要真的 Electron。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** 托盘模块是给 Helper 用的 CJS，没有类型声明：这里按用到的形状窄化。 */
interface TrayModule {
  createTray(deps: Record<string, unknown>): {
    start(): Promise<void>;
    refresh(): Promise<void>;
    exists(): boolean;
    destroy(): void;
  };
  /** 大小档位（托盘侧的一手来源；测试用它比对 shared/menu/tree.ts 的同一张表）。 */
  SIZE_PRESETS: ReadonlyArray<{ readonly label: string; readonly scale: number }>;
  /** 画框宽度的区间与步进（比对 shared/pet-size.ts 的 SIZE_MIN / SIZE_MAX）。 */
  SIZE_RANGE: { readonly min: number; readonly max: number; readonly step: number };
}

/** 一条菜单项：只断言用到的字段。 */
interface MenuItem {
  label: string;
  type?: string;
  checked?: boolean;
  /** 置灰不可点（步进到区间边界时用）。 */
  enabled?: boolean;
  click?: () => void;
  submenu?: MenuItem[];
}

const { createTray, SIZE_PRESETS, SIZE_RANGE } = createRequire(import.meta.url)(
  '../../runtime/electron-helper/main/tray.js',
) as TrayModule;

/** 造一套假依赖：记录宿主请求、菜单模板、退出调用与窗口命令。 */
function harness(options: {
  appMode?: boolean;
  isBridge?: boolean;
  canQuit?: boolean;
  volume?: number;
  pets?: Array<Record<string, unknown>>;
}) {
  const requests: string[] = [];
  const bodies: string[] = [];
  const quits: string[] = [];
  const menus: MenuItem[][] = [];
  const windowCalls: string[] = [];

  class FakeTray {
    setToolTip(): void {}
    setContextMenu(menu: unknown): void {
      menus.push((menu as { template: MenuItem[] }).template);
    }
    on(): void {}
    popUpContextMenu(): void {}
    destroy(): void {}
  }

  const deps = {
    app: { quit: () => quits.push('app.quit') },
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template: MenuItem[]) => ({ template }) },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => false, resize: () => ({ setTemplateImage: () => {} }) }),
    },
    hostRequest: async (method: string, url: string, body?: string) => {
      requests.push(method + ' ' + url);
      if (body !== undefined) bodies.push(body);
      if (url.endsWith('/config')) {
        return {
          status: 200,
          body: JSON.stringify({
            main: { pets: options.pets ?? [], voiceVolume: options.volume ?? 1 },
          }),
        };
      }
      if (url.endsWith('/quit')) {
        return { status: 200, body: JSON.stringify({ canQuit: options.canQuit === true }) };
      }
      return { status: 200, body: '{}' };
    },
    callbackUrl: () => 'http://127.0.0.1:1/bridge',
    isBridge: options.isBridge ?? false,
    appMode: options.appMode ?? false,
    petRoute: '/dsh-pet-7340',
    platform: { templateImage: false, leftClickPopsMenu: false },
    helperDir: '.',
    petWindows: {
      setHidden: (hidden: boolean) => windowCalls.push('hidden=' + String(hidden)),
      broadcastCommand: (name: string) => windowCalls.push('cmd=' + name),
      // 鼠标穿透的就地翻窗：托盘与宠物窗口同进程，点了先改窗口再写配置。
      state: { windows: new Map(options.pets?.map((pet) => [String(pet.id), { id: pet.id }]) ?? []) },
      setClickThrough: (win: { id?: unknown }, value: boolean) =>
        windowCalls.push('clickThrough=' + String(win?.id) + ':' + String(value)),
    },
  };

  const tray = createTray(deps);
  return { tray, requests, bodies, quits, menus, windowCalls };
}

/** 取最后一次构建出来的菜单模板。 */
function lastMenu(menus: MenuItem[][]): MenuItem[] {
  const menu = menus[menus.length - 1];
  assert.ok(menu, '托盘应已构建出菜单');
  return menu;
}

describe('createTray —— 勾选与点击', () => {
  test('勾选状态来自配置：含 desktop / both 的两只被打勾', async () => {
    const { tray, menus } = harness({
      pets: [
        { label: 'a', id: 'a', display: 'both' },
        { label: 'b', id: 'b', display: 'web' },
        { label: 'c', id: 'c', display: 'desktop' },
      ],
    });
    await tray.start();
    const items = lastMenu(menus).filter((item) => item.type === 'checkbox');
    assert.deepEqual(
      items.map((item) => item.checked),
      [true, false, true],
    );
  });

  test('点一下写回相反的一档：both→web，web→both，desktop→none，none→desktop', async () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['both', 'web'],
      ['web', 'both'],
      ['desktop', 'none'],
      ['none', 'desktop'],
    ];
    for (const [from, to] of cases) {
      const { tray, menus, requests, bodies } = harness({ pets: [{ label: 'a', id: 'a', display: from }] });
      await tray.start();
      const item = lastMenu(menus).find((entry) => entry.type === 'checkbox');
      assert.ok(item?.click, '每只宠物都应有可点的开关项');
      item.click();
      assert.ok(requests.includes('POST /dsh-pet-7340/pet-display'), `display=${from} 时应把新值写回宿主`);
      assert.equal(
        (JSON.parse(bodies[0] ?? '{}') as { display?: string }).display,
        to,
        `display=${from} 应写成 ${to}（浏览器位保持不动）`,
      );
    }
  });
});

describe('createTray —— 退出项的分支', () => {
  test('应用模式：自己 app.quit()，不请求宿主', async () => {
    const { tray, menus, quits, requests } = harness({
      appMode: true,
      pets: [{ label: 'a', id: 'a', display: 'both' }],
    });
    await tray.start();
    const quit = lastMenu(menus).find((item) => item.label === '退出');
    assert.ok(quit?.click, '应用模式必须有退出项');
    quit.click();
    assert.deepEqual(quits, ['app.quit']);
    assert.equal(
      requests.some((request) => request.startsWith('POST') && request.endsWith('/quit')),
      false,
    );
  });

  test('bridge 且宿主允许：把退出交给宿主（自己退会被当成崩溃重启）', async () => {
    const { tray, menus, quits, requests } = harness({
      isBridge: true,
      canQuit: true,
      pets: [{ label: 'a', id: 'a', display: 'both' }],
    });
    await tray.start();
    const quit = lastMenu(menus).find((item) => item.label === '退出');
    assert.ok(quit?.click, '宿主允许时应有退出项');
    quit.click();
    assert.deepEqual(quits, [], 'bridge 下不得自己退');
    assert.ok(requests.includes('POST /dsh-pet-7340/quit'), '必须把退出请求交给宿主');
  });

  test('bridge 且宿主不允许退出应用：退出项仍在，只停桌面助手', async () => {
    const { tray, menus, requests } = harness({
      isBridge: true,
      canQuit: false,
      pets: [{ label: 'a', id: 'a', display: 'both' }],
    });
    await tray.start();
    const quit = lastMenu(menus).find((item) => item.label === '退出');
    assert.ok(quit?.click, 'DSH 宿主内也要有退出入口（只结束桌面侧）');
    quit.click();
    assert.ok(requests.includes('POST /dsh-pet-7340/desktop/stop'), '应停桌面助手而不是退出 DSH');
    assert.equal(
      requests.some((request) => request === 'POST /dsh-pet-7340/quit'),
      false,
      '宿主没有退出能力时不该去请求 POST /quit（GET 探能力那条不算）',
    );
  });
});

describe('createTray —— 显示位置 / 音量 / 隐藏 / 维护项', () => {
  /** 取一级菜单里的某一项。 */
  const item = (menus: MenuItem[][], label: string): MenuItem | undefined =>
    lastMenu(menus).find((entry) => entry.label === label);

  test('显示位置：单宠物时摊平成四项，当前值打勾，点一下写回', async () => {
    const { tray, menus, requests, bodies } = harness({ pets: [{ id: 'main', display: 'desktop' }] });
    await tray.start();
    const branch = item(menus, '显示位置');
    assert.ok(branch?.submenu, '托盘要有「显示位置」');
    assert.deepEqual(
      branch.submenu.map((entry) => entry.label),
      ['仅网页', '仅桌面', '两者', '都不'],
    );
    assert.deepEqual(
      branch.submenu.map((entry) => entry.checked),
      [false, true, false, false],
      '当前 display=desktop 应勾在「仅桌面」',
    );
    branch.submenu[0]?.click?.();
    assert.ok(requests.includes('POST /dsh-pet-7340/pet-display'));
    assert.deepEqual(JSON.parse(bodies[0] ?? '{}'), { id: 'main', display: 'web' });
  });

  test('显示位置：多宠物时每只一层子菜单', async () => {
    const { tray, menus } = harness({
      pets: [
        { id: 'a', name: '甲', display: 'web' },
        { id: 'b', name: '乙', display: 'desktop' },
      ],
    });
    await tray.start();
    const branch = item(menus, '显示位置');
    assert.ok(branch?.submenu);
    assert.deepEqual(
      branch.submenu.map((entry) => entry.label),
      ['甲', '乙'],
    );
    assert.equal(branch.submenu[0]?.submenu?.[0]?.label, '仅网页');
  });

  test('音量：五档、当前值打勾，点一下写 voiceVolume 并刷新菜单', async () => {
    const { tray, menus, requests, bodies } = harness({
      volume: 0.5,
      pets: [{ id: 'main', display: 'desktop' }],
    });
    await tray.start();
    const branch = item(menus, '音量');
    assert.ok(branch?.submenu);
    assert.deepEqual(
      branch.submenu.map((entry) => entry.label),
      ['静音', '25%', '50%', '75%', '100%'],
    );
    assert.deepEqual(
      branch.submenu.map((entry) => entry.checked),
      [false, false, true, false, false],
    );
    branch.submenu[1]?.click?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(requests.includes('POST /dsh-pet-7340/voice/volume'));
    assert.deepEqual(JSON.parse(bodies[0] ?? '{}'), { volume: 0.25 });
    assert.ok(menus.length >= 2, '改完音量要重画菜单（勾选跟着走）');
  });

  test('隐藏宠物：点一下整批窗口隐藏，标签变「显示宠物」', async () => {
    const { tray, menus, windowCalls } = harness({ pets: [{ id: 'main', display: 'desktop' }] });
    await tray.start();
    const hide = item(menus, '隐藏宠物');
    assert.ok(hide?.click, '托盘要有隐藏项');
    hide.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(windowCalls, ['hidden=true']);
    assert.ok(
      lastMenu(menus).some((entry) => entry.label === '显示宠物'),
      '隐藏后同一位置变成「显示宠物」',
    );
  });

  test('回到初始位置：给全部宠物窗口发 home 命令（位置状态在渲染端）', async () => {
    const { tray, menus, windowCalls } = harness({ pets: [{ id: 'main', display: 'desktop' }] });
    await tray.start();
    item(menus, '回到初始位置')?.click?.();
    assert.deepEqual(windowCalls, ['cmd=home']);
  });

  test('重载配置 / 重启插件：各自打到宿主的维护端点', async () => {
    const { tray, menus, requests } = harness({ pets: [{ id: 'main', display: 'desktop' }] });
    await tray.start();
    item(menus, '重载配置')?.click?.();
    item(menus, '重启插件')?.click?.();
    assert.ok(requests.includes('POST /dsh-pet-7340/reload'));
    assert.ok(requests.includes('POST /dsh-pet-7340/plugin-restart'));
  });
});

describe('createTray —— 鼠标穿透 / 大小', () => {
  /** 取一级菜单里的某一项。 */
  const item = (menus: MenuItem[][], label: string): MenuItem | undefined =>
    lastMenu(menus).find((entry) => entry.label === label);

  test('鼠标穿透：单宠物摊成一项，勾选来自配置，点了先翻窗再写配置', async () => {
    const { tray, menus, requests, bodies, windowCalls } = harness({
      pets: [{ id: 'main', name: '鱼生', display: 'desktop', clickThrough: true }],
    });
    await tray.start();
    const toggle = item(menus, '鼠标穿透');
    assert.ok(toggle, '托盘要有「鼠标穿透」');
    assert.equal(toggle.type, 'checkbox');
    assert.equal(toggle.checked, true, '配置里开着就该打勾');
    toggle.click?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(windowCalls, ['clickThrough=main:false'], '托盘与宠物窗口同进程：先就地翻窗');
    assert.ok(requests.includes('POST /dsh-pet-7340/pet-click-through'), '再把目标值写进配置');
    assert.deepEqual(JSON.parse(bodies[0] ?? '{}'), { id: 'main', value: false });
  });

  test('鼠标穿透：多宠物时每只一项，勾选各自独立（不能做成互斥的 radio）', async () => {
    const { tray, menus } = harness({
      pets: [
        { id: 'a', name: '甲', display: 'desktop', clickThrough: false },
        { id: 'b', name: '乙', display: 'web', clickThrough: true },
      ],
    });
    await tray.start();
    const branch = item(menus, '鼠标穿透');
    assert.ok(branch?.submenu, '多宠物时每只一层');
    assert.deepEqual(
      branch.submenu.map((entry) => entry.label),
      ['甲', '乙'],
    );
    assert.deepEqual(
      branch.submenu.map((entry) => entry.checked),
      [false, true],
    );
    assert.deepEqual(
      branch.submenu.map((entry) => entry.type),
      ['checkbox', 'checkbox'],
    );
  });

  test('大小：原生菜单没有滑块 → 步进项 + 快捷档位 + 恢复默认', async () => {
    const { tray, menus, requests, bodies } = harness({
      pets: [{ id: 'main', name: '鱼生', display: 'desktop', size: 462, renderer: 'layered', sizes: { layered: 620 } }],
    });
    await tray.start();
    const branch = item(menus, '大小');
    assert.ok(branch?.submenu, '托盘要有「大小」');
    // 462×0.7=323.4→320，462×1.35=623.7→620，462×1.8=831.6→830（档位取整到 10px，与右键菜单同一算法）
    assert.deepEqual(
      branch.submenu.filter((entry) => entry.label).map((entry) => entry.label),
      ['更小（−40px）', '更大（+40px）', '小（320px）', '中（462px）', '大（620px）✓', '特大（830px）', '恢复默认大小'],
    );
    assert.ok(
      branch.submenu.some((entry) => entry.type === 'separator'),
      '步进与档位之间要有分隔线',
    );
    branch.submenu[0]?.click?.();
    assert.ok(requests.includes('POST /dsh-pet-7340/pet-size'));
    assert.deepEqual(JSON.parse(bodies[0] ?? '{}'), { id: 'main', size: 580 }, '更小 = 当前值 −40');
    branch.submenu[1]?.click?.();
    assert.deepEqual(JSON.parse(bodies[1] ?? '{}'), { id: 'main', size: 660 }, '更大 = 当前值 +40');
  });

  test('大小：步进夹在区间内，到边置灰', async () => {
    const low = harness({ pets: [{ id: 'a', display: 'desktop', size: SIZE_RANGE.min }] });
    await low.tray.start();
    const lowItems = item(low.menus, '大小')?.submenu ?? [];
    assert.equal(lowItems[0]?.enabled, false, '已在下限：更小置灰');
    lowItems[1]?.click?.();
    assert.deepEqual(JSON.parse(low.bodies[0] ?? '{}'), { id: 'a', size: SIZE_RANGE.min + 40 });

    const high = harness({ pets: [{ id: 'b', display: 'desktop', size: SIZE_RANGE.max }] });
    await high.tray.start();
    const highItems = item(high.menus, '大小')?.submenu ?? [];
    assert.equal(highItems[1]?.enabled, false, '已在上限：更大置灰');
    highItems[0]?.click?.();
    assert.deepEqual(JSON.parse(high.bodies[0] ?? '{}'), { id: 'b', size: SIZE_RANGE.max - 40 });
  });

  test('大小：没写覆盖时按 pets[].size 打勾', async () => {
    const { tray, menus } = harness({ pets: [{ id: 'main', display: 'desktop', size: 462 }] });
    await tray.start();
    const branch = item(menus, '大小');
    assert.deepEqual(
      branch?.submenu?.map((entry) => entry.checked),
      [undefined, undefined, undefined, false, true, false, false, undefined],
      '缺省回落 size：462 命中「中」；步进、分隔线与恢复默认不打勾',
    );
  });

  test('大小：恢复默认 = 不传 size（删掉该渲染方式的覆盖）', async () => {
    const { tray, menus, requests, bodies } = harness({
      pets: [{ id: 'main', display: 'desktop', size: 462, renderer: 'webm', sizes: { webm: 520 } }],
    });
    await tray.start();
    const reset = item(menus, '大小')?.submenu?.find((entry) => entry.label === '恢复默认大小');
    assert.ok(reset?.click);
    reset.click();
    assert.ok(requests.includes('POST /dsh-pet-7340/pet-size'));
    assert.deepEqual(JSON.parse(bodies[0] ?? '{}'), { id: 'main' }, '没有 size 键 = 删掉覆盖');
  });

  test('大小：多宠物时每只一层子菜单', async () => {
    const { tray, menus } = harness({
      pets: [
        { id: 'a', name: '甲', display: 'desktop', size: 300 },
        { id: 'b', name: '乙', display: 'web', size: 420 },
      ],
    });
    await tray.start();
    const branch = item(menus, '大小');
    assert.deepEqual(
      branch?.submenu?.map((entry) => entry.label),
      ['甲', '乙'],
    );
    assert.equal(branch?.submenu?.[1]?.submenu?.[4]?.label, '中（420px）✓', '没写覆盖时按 pets[].size 命中「中」');
  });
});

describe('createTray —— 档位表与 shared 菜单同步', () => {
  test('托盘 SIZE_PRESETS 与 shared/menu/tree.ts 的同一张表逐项相等', () => {
    const source = readFileSync(fileURLToPath(new URL('../shared/menu/tree.ts', import.meta.url)), 'utf8');
    const block = /export const SIZE_PRESETS[^=]*=\s*\[([\s\S]*?)\];/.exec(source);
    assert.ok(block, 'shared/menu/tree.ts 里应有 SIZE_PRESETS');
    const parsed = [...block[1].matchAll(/label:\s*'([^']+)',\s*scale:\s*([\d.]+)/g)].map((m) => ({
      label: m[1],
      scale: Number(m[2]),
    }));
    assert.ok(parsed.length > 0, '应解析出档位');
    assert.deepEqual(
      parsed,
      SIZE_PRESETS.map(({ label, scale }) => ({ label, scale })),
      '主进程拿不到 shared-core，只能各存一份：两张表必须一致',
    );
  });

  test('托盘 SIZE_RANGE 与 shared/pet-size.ts 的 SIZE_MIN / SIZE_MAX 一致', () => {
    const source = readFileSync(fileURLToPath(new URL('../shared/pet-size.ts', import.meta.url)), 'utf8');
    const min = Number(/export const SIZE_MIN = (\d+);/.exec(source)?.[1]);
    const max = Number(/export const SIZE_MAX = (\d+);/.exec(source)?.[1]);
    assert.ok(Number.isFinite(min) && Number.isFinite(max), '应解析出 SIZE_MIN / SIZE_MAX');
    assert.equal(SIZE_RANGE.min, min, '托盘步进的下限必须与宿主校验一致');
    assert.equal(SIZE_RANGE.max, max, '托盘步进的上限必须与宿主校验一致');
    assert.ok(SIZE_RANGE.step > 0 && SIZE_RANGE.step <= 100, '步进要能细调（40px）');
  });
});

describe('createTray —— 重建后刷新', () => {
  test('refresh 重读配置：勾选跟着变，菜单被替换', async () => {
    const pets: Array<Record<string, unknown>> = [{ label: 'a', id: 'a', display: 'both' }];
    const { tray, menus } = harness({ pets });
    await tray.start();
    assert.equal(lastMenu(menus)[0].checked, true);
    pets[0] = { label: 'a', id: 'a', display: 'web' };
    await tray.refresh();
    assert.equal(menus.length, 2, 'refresh 应重新设置一次菜单');
    assert.equal(lastMenu(menus)[0].checked, false, '配置变了勾选要跟着变');
  });

  test('没建托盘时 refresh 什么都不做（托盘开关关掉的情况）', async () => {
    const { tray, menus } = harness({ pets: [] });
    await tray.refresh();
    assert.equal(menus.length, 0);
  });
});
