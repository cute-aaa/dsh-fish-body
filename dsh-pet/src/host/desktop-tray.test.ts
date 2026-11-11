/**
 * 桌面托盘的行为契约（runtime/electron-helper/main/tray.js）。
 *
 * 必须成立：勾选来自配置、点一下写回相反的一档；显示位置/音量/隐藏/重载/重启/复位/退出都在菜单里，
 * 且各自打到该打的端点或 IPC 命令（退出按运行形态决定自己退、交给宿主退、还是只停桌面助手）。
 * 依赖全由调用方注入（含 Electron 的 Tray/Menu/nativeImage 与 petWindows），所以不需要真的 Electron。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

/** 托盘模块是给 Helper 用的 CJS，没有类型声明：这里按用到的形状窄化。 */
interface TrayModule {
  createTray(deps: Record<string, unknown>): {
    start(): Promise<void>;
    refresh(): Promise<void>;
    exists(): boolean;
    destroy(): void;
  };
}

/** 一条菜单项：只断言用到的字段。 */
interface MenuItem {
  label: string;
  type?: string;
  checked?: boolean;
  click?: () => void;
  submenu?: MenuItem[];
}

const { createTray } = createRequire(import.meta.url)('../../runtime/electron-helper/main/tray.js') as TrayModule;

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
