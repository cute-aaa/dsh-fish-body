/**
 * R1「鼠标穿透」多处入口同步的接缝测试（无需真 Electron、无需托盘环境）。
 *
 * 缺陷本体：穿透状态只有一个写入口（`main/windows.js` 的 setClickThrough），但托盘菜单只在
 * 托盘自己的动作里重画；右键菜单那条路径（渲染端 IPC）翻完窗口后托盘仍显示旧勾选。
 *
 * 修法是「单一出口 + 变更广播」，因此这里的证据也必须分三层，缺一层就会留下「广播存在但没人订阅」
 * 或「订阅了但订阅错东西」这类只有真机才暴露的接线错误：
 *   ① 广播计数：真实 createWindows，一次真变化 → 监听者 1 次且参数正确；同值 0 次；首次登记 1 次。
 *   ② 组合接线：真实 createWindows + 真实 createTray 按 main.js 的方式接起来，翻一只 → 菜单恰好多画
 *      一次且只有该只翻转；再翻同值 → 不重画。
 *   ③ 装配守卫：main.js 顶层 require('electron') 无法在 node 里加载，只能读源码断言它订阅的是
 *      `onClickThroughChange` 且回调调的是 `tray.scheduleRefresh`（沿用 desktop-reload.test.ts 的写法）。
 *
 * 用 Node 内置 test runner（node:test），不引入任何 npm 依赖。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** 一条菜单项：只断言用到的字段。 */
interface MenuItem {
  label: string;
  type?: string;
  checked?: boolean;
  click?: () => void;
  submenu?: MenuItem[];
}

/** windows.js 暴露的形状（Helper 的 CJS，没有类型声明，按用到的窄化）。 */
interface WindowsApi {
  readonly state: { windows: Map<string, FakeWindow> };
  setClickThrough(win: FakeWindow, on: boolean): void;
  clickThroughOf(petId: string): boolean | undefined;
  onClickThroughChange(listener: (petId: string, value: boolean) => void): () => void;
}

/** tray.js 暴露的形状。 */
interface TrayApi {
  start(): Promise<void>;
  refresh(): Promise<void>;
  scheduleRefresh(): Promise<void>;
  exists(): boolean;
  destroy(): void;
}

/** 只实现 windows.js 用到的那几个方法（其余调用会立刻暴露成 TypeError，正是我们要的）。 */
interface FakeWindow {
  id: number;
  destroyed: boolean;
  readonly sends: Array<[string, boolean]>;
  isDestroyed(): boolean;
  setIgnoreMouseEvents(next: boolean, options?: { forward?: boolean }): void;
  webContents: { send(channel: string, payload: boolean): void };
}

const require_ = createRequire(import.meta.url);
const { createWindows } = require_('../../runtime/electron-helper/main/windows.js') as {
  createWindows(deps: Record<string, unknown>): WindowsApi;
};
const { createTray } = require_('../../runtime/electron-helper/main/tray.js') as {
  createTray(deps: Record<string, unknown>): TrayApi;
};

/** 造一个假窗口：Electron 的取值 API 不存在，所以只要 id / isDestroyed / 两个被调用的方法。 */
function fakeWindow(id: number): FakeWindow {
  const sends: Array<[string, boolean]> = [];
  const win: FakeWindow = {
    id,
    destroyed: false,
    sends,
    isDestroyed: () => win.destroyed,
    setIgnoreMouseEvents: () => {},
    webContents: {
      send: (channel: string, payload: boolean) => sends.push([channel, payload]),
    },
  };
  return win;
}

/** 让排队的 promise 链跑完（托盘刷新是 async 且跨了 await hostRequest）。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** 取最后一次构建出来的菜单模板。 */
function lastMenu(menus: MenuItem[][]): MenuItem[] {
  const menu = menus[menus.length - 1];
  assert.ok(menu, '应已构建出菜单');
  return menu;
}

/** 取「鼠标穿透」子菜单里各只的勾（多宠物 → 每只一项）。 */
function clickThroughChecks(menus: MenuItem[][]): Array<boolean | undefined> {
  const branch = lastMenu(menus).find((item) => item.label === '鼠标穿透');
  assert.ok(branch?.submenu, '多宠物时「鼠标穿透」应是每只一层的子菜单');
  return branch.submenu.map((entry) => entry.checked);
}

describe('R1 广播计数 —— 真实 createWindows 的 setClickThrough', () => {
  test('一次真变化广播 1 次且参数为 (petId, value)；同值 0 次；首次登记算变更', () => {
    const petWindows = createWindows({});
    const events: Array<[string, boolean]> = [];
    const off = petWindows.onClickThroughChange((petId, value) => events.push([petId, value]));
    const win = fakeWindow(41);
    petWindows.state.windows.set('a', win);

    // 首次登记：镜像里没有这个 win.id（prev === undefined），同样要广播——旧构建遗留的
    // 「配置与运行期不一致」正是靠这一次让托盘追上。
    petWindows.setClickThrough(win, true);
    assert.equal(events.length, 1, '首次登记应广播 1 次');
    assert.deepEqual(events[0], ['a', true], '回调参数应是 (petId, value)');

    // 同值重复调用：启动落位与渲染端重复上报都会撞上，收敛掉才不会每次多读两遍宿主配置。
    petWindows.setClickThrough(win, true);
    assert.equal(events.length, 1, '同值不应再广播');

    petWindows.setClickThrough(win, false);
    assert.equal(events.length, 2, '真变化要广播');
    assert.deepEqual(events[1], ['a', false]);

    off();
    petWindows.setClickThrough(win, true);
    assert.equal(events.length, 2, '退订之后不再收到回调');
  });

  test('回推渲染端仍无条件发（同值也发，防渲染端漂移）', () => {
    const petWindows = createWindows({});
    const win = fakeWindow(42);
    petWindows.state.windows.set('a', win);

    petWindows.setClickThrough(win, true);
    petWindows.setClickThrough(win, true);
    assert.deepEqual(win.sends, [
      ['pet:click-through', true],
      ['pet:click-through', true],
    ]);
  });

  test('变更日志走 console.error 且每次变化一行（真机取证只认这一行）', () => {
    const petWindows = createWindows({});
    const win = fakeWindow(43);
    petWindows.state.windows.set('main', win);
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => lines.push(args.map((arg) => String(arg)).join(' '));
    try {
      petWindows.setClickThrough(win, true);
      petWindows.setClickThrough(win, true);
      petWindows.setClickThrough(win, false);
    } finally {
      console.error = original;
    }
    assert.deepEqual(lines, [
      '[fish-body-desktop] click-through changed pet=main value=true',
      '[fish-body-desktop] click-through changed pet=main value=false',
    ]);
  });

  test('clickThroughOf 按 petId 读运行期镜像：未建窗 / 已销毁一律 undefined（回落配置）', () => {
    const petWindows = createWindows({});
    assert.equal(petWindows.clickThroughOf('a'), undefined, '窗口还没建：不知道');

    const win = fakeWindow(44);
    petWindows.state.windows.set('a', win);
    assert.equal(petWindows.clickThroughOf('a'), undefined, '窗口在但还没被设过：仍是不知道');
    petWindows.setClickThrough(win, true);
    assert.equal(petWindows.clickThroughOf('a'), true);

    win.destroyed = true;
    assert.equal(petWindows.clickThroughOf('a'), undefined, '窗口销毁后不得留一条过期勾选');
    assert.equal(petWindows.clickThroughOf('nobody'), undefined, '没有这只宠物时同样回落');
  });

  test('监听者抛错不影响窗口翻转（窗口状态是用户直接感知的那一面）', () => {
    const petWindows = createWindows({});
    const win = fakeWindow(45);
    petWindows.state.windows.set('a', win);
    petWindows.onClickThroughChange(() => {
      throw new Error('订阅者坏了');
    });
    const original = console.error;
    console.error = () => {};
    try {
      petWindows.setClickThrough(win, true);
    } finally {
      console.error = original;
    }
    assert.equal(petWindows.clickThroughOf('a'), true, '监听者抛错不得留下半翻的状态');
    assert.deepEqual(win.sends, [['pet:click-through', true]], '回推渲染端照旧');
  });
});

describe('R1 组合接线 —— 真实 createWindows + 真实 createTray（按 main.js 的接法）', () => {
  /** 造一套托盘依赖：config 夹具可改（用于验证销毁后回落配置）。 */
  function harness(pets: Array<Record<string, unknown>>) {
    const menus: MenuItem[][] = [];
    const requests: string[] = [];
    const bodies: string[] = [];
    class FakeTray {
      setToolTip(): void {}
      setContextMenu(menu: unknown): void {
        menus.push((menu as { template: MenuItem[] }).template);
      }
      on(): void {}
      popUpContextMenu(): void {}
      destroy(): void {}
    }
    const petWindows = createWindows({});
    const tray = createTray({
      app: { quit: () => {} },
      Tray: FakeTray,
      Menu: { buildFromTemplate: (template: MenuItem[]) => ({ template }) },
      nativeImage: {
        createFromPath: () => ({ isEmpty: () => false, resize: () => ({ setTemplateImage: () => {} }) }),
      },
      hostRequest: async (method: string, url: string, body?: string) => {
        requests.push(method + ' ' + url);
        if (body !== undefined) bodies.push(body);
        if (url.endsWith('/config')) return { status: 200, body: JSON.stringify({ main: { pets, voiceVolume: 1 } }) };
        return { status: 200, body: '{}' };
      },
      callbackUrl: () => 'http://127.0.0.1:1/bridge',
      isBridge: false,
      appMode: false,
      petRoute: '/dsh-pet-7340',
      platform: { templateImage: false, leftClickPopsMenu: false },
      helperDir: '.',
      petWindows,
    });
    // main.js 的装配：广播 → 合并刷新
    petWindows.onClickThroughChange(() => void tray.scheduleRefresh());
    return { tray, menus, requests, bodies, petWindows };
  }

  test('翻一只 → 菜单恰好多画一次，只该只翻转；同值再翻不多画', async () => {
    const { tray, menus, petWindows } = harness([
      { id: 'a', name: '甲', display: 'desktop', clickThrough: false },
      { id: 'b', name: '乙', display: 'desktop', clickThrough: false },
    ]);
    await tray.start();
    assert.equal(menus.length, 1, '启动建一次菜单');
    assert.deepEqual(clickThroughChecks(menus), [false, false]);

    const winA = fakeWindow(101);
    const winB = fakeWindow(102);
    petWindows.state.windows.set('a', winA);
    petWindows.state.windows.set('b', winB);

    // 右键菜单那条路径的真实动作：只调 setClickThrough（不碰托盘），托盘靠广播跟上。
    petWindows.setClickThrough(winA, true);
    await settle();
    assert.equal(menus.length, 2, '一次真变化 → 恰好多画一次（不能是 0，也不能是两次）');
    assert.deepEqual(clickThroughChecks(menus), [true, false], '只有甲翻转，乙不受影响');

    // 同值：渲染端重复上报 / 启动落位重复调用
    petWindows.setClickThrough(winA, true);
    await settle();
    assert.equal(menus.length, 2, '同值不重画');

    petWindows.setClickThrough(winB, true);
    await settle();
    assert.equal(menus.length, 3);
    assert.deepEqual(clickThroughChecks(menus), [true, true], '两只互不串值');
  });

  test('窗口销毁后回落配置值：不留过期勾选', async () => {
    const { tray, menus, petWindows } = harness([
      { id: 'a', name: '甲', display: 'desktop', clickThrough: false },
      { id: 'b', name: '乙', display: 'desktop', clickThrough: true },
    ]);
    await tray.start();
    const winA = fakeWindow(103);
    const winB = fakeWindow(104);
    petWindows.state.windows.set('a', winA);
    petWindows.state.windows.set('b', winB);
    petWindows.setClickThrough(winA, true);
    petWindows.setClickThrough(winB, false);
    await settle();
    assert.deepEqual(clickThroughChecks(menus), [true, false], '运行期镜像优先于配置');

    winA.destroyed = true;
    await tray.scheduleRefresh();
    assert.deepEqual(
      clickThroughChecks(menus),
      [false, false],
      '窗口没了 → clickThroughOf 返回 undefined → 回落 pets[].clickThrough',
    );
  });

  test('托盘项自己点：先翻窗（触发广播）再写配置，两条触发各一轮刷新且勾最终正确', async () => {
    const { tray, menus, petWindows, requests } = harness([
      { id: 'main', name: '鱼生', display: 'desktop', clickThrough: false },
    ]);
    await tray.start();
    const win = fakeWindow(105);
    petWindows.state.windows.set('main', win);

    const toggle = lastMenu(menus).find((item) => item.label === '鼠标穿透');
    assert.ok(toggle, '单宠物时摊成一项');
    assert.equal(toggle.checked, false);
    toggle.click?.();
    await settle();

    assert.ok(requests.includes('POST /dsh-pet-7340/pet-click-through'), '写配置照旧');
    assert.equal(
      lastMenu(menus).find((item) => item.label === '鼠标穿透')?.checked,
      true,
      '勾选最终跟着走（合并语义见 tray.scheduleRefresh）',
    );
    assert.equal(menus.length, 3, '广播一轮 + 写盘回执补跑一轮：托盘路径两条触发源各一轮，不会画成三遍');
  });

  test('scheduleRefresh 永不抛：托盘没建时也只是什么都不做', async () => {
    const { tray, menus } = harness([{ id: 'a', display: 'desktop', clickThrough: false }]);
    await tray.scheduleRefresh(); // 未 start：tray 为 null
    assert.equal(menus.length, 0);
    assert.equal(tray.exists(), false);
  });

  test('一次 burst 里的连续真变化：合并后仍停在最后那个值，且不逐次重画', async () => {
    const { tray, menus, petWindows } = harness([
      { id: 'a', name: '甲', display: 'desktop', clickThrough: false },
      { id: 'b', name: '乙', display: 'desktop', clickThrough: true },
    ]);
    await tray.start();
    assert.equal(menus.length, 1);
    const winA = fakeWindow(111);
    petWindows.state.windows.set('a', winA);

    // 三次真变化挤在同一个同步块里（右键连点 / 渲染端重复上报的极端形态）：
    // 合并刷新只允许把重画次数压下去，**不允许**停在中途那个值上。
    petWindows.setClickThrough(winA, true);
    petWindows.setClickThrough(winA, false);
    petWindows.setClickThrough(winA, true);
    await settle();

    assert.deepEqual(clickThroughChecks(menus), [true, true], '最后一轮必须是最后一次的值（甲 true / 乙按配置 true）');
    assert.ok(menus.length <= 4, `三次触发最多「启动 1 + 三次各一轮」，实际 ${menus.length} 次`);
  });
});

describe('R1 装配守卫 —— main.js 订阅的是广播与合并刷新', () => {
  const main = readFileSync(fileURLToPath(new URL('../../runtime/electron-helper/main.js', import.meta.url)), 'utf8');

  test('main.js 订阅 onClickThroughChange，且回调调的是 tray.scheduleRefresh', () => {
    const call = /petWindows\.onClickThroughChange\(\s*\(\)\s*=>\s*(?:void\s+)?tray\.scheduleRefresh\(\)\s*\)/.exec(
      main,
    );
    assert.ok(call, 'main.js 必须把广播直接接到托盘合并刷新（订阅了却没接 scheduleRefresh，单测全绿而真机仍不同步）');
  });

  test('main.js 不得自己实现一套刷新节流（只允许 scheduleRefresh 那一处）', () => {
    assert.equal(
      (main.match(/refreshAgain|refreshInFlight/g) ?? []).length,
      0,
      '合并逻辑属于托盘模块（tray.js），装配根不能有第二份',
    );
  });
});

/**
 * R1 的「单一出口」在**右键菜单**这条入口上原来没有自动化断言：前面两层只证明了「一旦有人调
 * `windows.setClickThrough`，托盘就会跟上」，但没人证明右键路径真的调的是它。
 *
 * `ipc.js` / `preload.js` 顶层 `require('electron')`，node 里加载不了，所以按 `main.js` 装配守卫
 * 的同样做法读源码断言调用形状。这三条合起来把「右键菜单 → 托盘」从等价替代提升为可判定：
 * 渲染端 IPC 只调唯一出口、写配置走同一端点、托盘与装配根都只经这一个出口。
 */
describe('R1 入口收敛守卫 —— 右键菜单也汇到 windows.setClickThrough 这一个出口', () => {
  const helper = (rel: string): string =>
    readFileSync(fileURLToPath(new URL('../../runtime/electron-helper/' + rel, import.meta.url)), 'utf8');

  test("preload 暴露的 setClickThrough 发的就是 'pet:click-through'（渲染端唯一上报通道）", () => {
    const preload = helper('preload.js');
    const send = /setClickThrough\(value\)\s*\{[\s\S]{0,200}?ipcRenderer\.send\('pet:click-through'/.exec(preload);
    assert.ok(send, 'preload 的 setClickThrough 必须把目标值发给主进程，否则右键菜单翻了窗没人知道');
  });

  test("主进程 'pet:click-through' 处理器只调 petWindows.setClickThrough，不自己刷托盘", () => {
    const ipc = helper('main/ipc.js');
    const handler = /ipcMain\.on\('pet:click-through'[\s\S]{0,400}?\n {2}\}\)/.exec(ipc);
    assert.ok(handler, "ipc.js 必须注册 'pet:click-through'");
    assert.match(
      handler[0],
      /petWindows\.setClickThrough\(win,/,
      '右键入口的落点必须是唯一出口（换成另一个函数就等于又开了一条并行路径）',
    );
    assert.doesNotMatch(
      handler[0],
      /scheduleRefresh|refreshTray|createTray/,
      '托盘刷新只由出口处的广播触发：IPC 自己再刷一次就是第三条路径（R1 的缺陷本体）',
    );
  });

  test('右键菜单写配置走 /pet-click-through 同一端点（不是第二条写盘路径）', () => {
    const actions = readFileSync(
      fileURLToPath(new URL('../../src/shared/pet-config-actions.ts', import.meta.url)),
      'utf8',
    );
    const branch = /case 'click-through':[\s\S]{0,300}?path: '\/pet-click-through'/.exec(actions);
    assert.ok(branch, '两端共用的写入口必须把 click-through 意图映射到 /pet-click-through');
  });
});
