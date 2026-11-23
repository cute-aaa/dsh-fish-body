/**
 * 系统选择框（`runtime/electron-helper/main/dialog.js`）与它在 bridge 上的路由
 * （`runtime/electron-helper/main/bridge.js` 的 `POST /pick`）的契约测试。
 *
 * 两条边界分开测：
 *   1. **参数映射与三态**：真 Electron 弹不出来也测不到，所以 `dialog` / `BrowserWindow` 全由调用方注入
 *      （与 `desktop-tray.test.ts` 同一范式：`require` runtime 的 CJS，喂假对象）；
 *   2. **路由**：`/pick` 与 `/respond` 共用同一个本地回调端口，用 `node:http` 起**真**服务器发**真**请求，
 *      只替换 `pick` 这个能力本身——断言的正是「有没有走到它 / 没注入时回什么」。
 *
 * 不承诺的事：Electron 既没有关闭原生对话框的 API，也没有列举原生对话框的 API——所以本模块
 * **没有任何超时**，`inFlight` 的生命周期 = 那个真实存在的对话框（见 dialog.js 文件头）。
 */
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

/** Electron `dialog.showOpenDialog` 的调用形状（只断言用到的字段）。 */
interface ShowCall {
  /** 有没有 owner：有 owner 时是 `(parent, options)` 两参，无 owner 时是 `(options)` 一参。 */
  readonly withOwner: boolean;
  readonly options: {
    readonly properties?: readonly string[];
    readonly filters?: ReadonlyArray<{ readonly name: string; readonly extensions: readonly string[] }>;
    readonly title?: string;
    readonly defaultPath?: string;
  };
}

/** `createPickDialog` 的返回形状。 */
interface PickOutcome {
  readonly ok: boolean;
  readonly kind?: string;
  readonly path?: string;
  readonly reason?: string;
  readonly message?: string;
}

interface DialogModule {
  createPickDialog(deps: {
    dialog: { showOpenDialog: (...args: unknown[]) => Promise<unknown> };
    BrowserWindow: { getAllWindows: () => unknown[] };
  }): (req: unknown) => Promise<PickOutcome>;
}

interface BridgeModule {
  createBridge(deps: Record<string, unknown>): {
    startCallback(): { close(callback?: () => void): void; closeAllConnections?(): void };
    callbackUrl(): string;
  };
}

const requireRuntime = createRequire(import.meta.url);
const { createPickDialog } = requireRuntime('../../runtime/electron-helper/main/dialog.js') as DialogModule;
const { createBridge } = requireRuntime('../../runtime/electron-helper/main/bridge.js') as BridgeModule;

/**
 * 造一次「弹框」：记录调用参数，按 `result` 立即返回；`hang` 时返回**永不自己落地**的 Promise，
 * 由 `release(outcome)` 决定它什么时候落地（≈ 用户终于点了选/取消）——选择框没有超时，只能这么收尾。
 * `hangOnce` 只让第一次调用挂着，之后照常立刻返回（用来测「框关掉之后还能再开一个」）。
 */
function fakeDialog(result: unknown, opts: { hang?: boolean; hangOnce?: boolean } = {}) {
  const calls: ShowCall[] = [];
  let hangLeft = opts.hangOnce === true ? 1 : opts.hang === true ? Number.POSITIVE_INFINITY : 0;
  let release: (value: unknown) => void = () => undefined;
  return {
    calls,
    /** 让「还没落地」的那次调用落地。 */
    release: (value: unknown): void => release(value),
    dialog: {
      showOpenDialog: (...args: unknown[]): Promise<unknown> => {
        calls.push(
          args.length >= 2
            ? { withOwner: true, options: args[1] as ShowCall['options'] }
            : { withOwner: false, options: args[0] as ShowCall['options'] },
        );
        if (hangLeft > 0) {
          hangLeft -= 1;
          return new Promise((resolve) => (release = resolve));
        }
        return Promise.resolve(result);
      },
    },
  };
}

/** 造一组窗口：`windows` 为空即「没有 owner」。 */
function fakeBrowserWindow(windows: unknown[] = []) {
  return { getAllWindows: (): unknown[] => windows };
}

/** 一个还没销毁的窗口。 */
const openWindow = { id: 'win-1', isDestroyed: (): boolean => false };

/**
 * 哨兵：`ms` 毫秒内这个 Promise 有没有落地。
 *
 * 用来断言「这一刻还没结论」——**不是**超时逻辑，只是给「没有计时器」这件事一个可观察的窗口。
 * `false` = 还在挂起（正确）；`true` = 有人按时间把它判死了（错误）。
 *
 * @param promise - 被观察的那次调用。
 * @param ms - 观察窗口（毫秒）。
 * @returns 观察窗口内是否落地。
 */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return await Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

describe('createPickDialog：参数映射与三态', () => {
  test('file：filters 剥掉前导点、properties 含 openFile/dontAddToRecent、title 与 defaultPath 透传', async () => {
    const { calls, dialog } = fakeDialog({ canceled: false, filePaths: ['D:/voice/ref.txt'] });
    const pick = createPickDialog({ dialog, BrowserWindow: fakeBrowserWindow([openWindow]) });

    const outcome = await pick({
      kind: 'file',
      title: '选择参考文本',
      start: 'D:/voice',
      extensions: ['.ckpt', '.pth'],
    });

    assert.deepEqual(outcome, { ok: true, kind: 'picked', path: 'D:/voice/ref.txt' });
    const options = calls[0]?.options ?? {};
    assert.deepEqual(options.properties, ['openFile', 'dontAddToRecent'], 'file 只给单选 + 不写「最近文件」');
    assert.deepEqual(
      options.filters?.[0],
      { name: '文件 (*.ckpt;*.pth)', extensions: ['ckpt', 'pth'] },
      'Electron 的 filters 不接受前导点，必须剥掉',
    );
    assert.deepEqual(options.filters?.[1], { name: '所有文件', extensions: ['*'] });
    assert.equal(options.title, '选择参考文本');
    assert.equal(options.defaultPath, 'D:/voice');
  });

  test('extensions 为空：只给「所有文件」一档', async () => {
    const { calls, dialog } = fakeDialog({ canceled: false, filePaths: ['D:/a.txt'] });
    const pick = createPickDialog({ dialog, BrowserWindow: fakeBrowserWindow([openWindow]) });

    await pick({ kind: 'file', extensions: [] });

    assert.deepEqual(calls[0]?.options.filters, [{ name: '所有文件', extensions: ['*'] }]);
    assert.equal(calls[0]?.options.defaultPath, undefined, '没给 start 就不要传 defaultPath');
    assert.equal(calls[0]?.options.title, undefined, '没给 title 就不要传 title');
  });

  test('folder：properties 含 openDirectory/createDirectory，且不带 filters', async () => {
    const { calls, dialog } = fakeDialog({ canceled: false, filePaths: ['D:/AI/AI-Voice'] });
    const pick = createPickDialog({ dialog, BrowserWindow: fakeBrowserWindow([openWindow]) });

    const outcome = await pick({ kind: 'folder', title: '选择权重目录' });

    assert.deepEqual(outcome, { ok: true, kind: 'picked', path: 'D:/AI/AI-Voice' });
    assert.deepEqual(calls[0]?.options.properties, ['openDirectory', 'createDirectory', 'dontAddToRecent']);
    assert.equal(calls[0]?.options.filters, undefined);
  });

  test('取消的两种形状都归一到 cancelled（canceled:true / filePaths 为空）', async () => {
    const a = fakeDialog({ canceled: true, filePaths: [] });
    const outcomeA = await createPickDialog({ dialog: a.dialog, BrowserWindow: fakeBrowserWindow() })({ kind: 'file' });
    assert.deepEqual(outcomeA, { ok: true, kind: 'cancelled' }, 'canceled:true → 用户取消，不是失败');

    const b = fakeDialog({ canceled: false, filePaths: [] });
    const outcomeB = await createPickDialog({ dialog: b.dialog, BrowserWindow: fakeBrowserWindow() })({ kind: 'file' });
    assert.deepEqual(outcomeB, { ok: true, kind: 'cancelled' }, 'filePaths 为空同样是取消');
  });

  test('owner：有窗口时 showOpenDialog 收到 (parent, options)，没有时只收到 (options)', async () => {
    const withOwner = fakeDialog({ canceled: true, filePaths: [] });
    await createPickDialog({ dialog: withOwner.dialog, BrowserWindow: fakeBrowserWindow([openWindow]) })({
      kind: 'folder',
    });
    assert.equal(withOwner.calls[0]?.withOwner, true, '有窗口就带 owner（对话框才会挂在主窗口上）');

    const noOwner = fakeDialog({ canceled: true, filePaths: [] });
    await createPickDialog({ dialog: noOwner.dialog, BrowserWindow: fakeBrowserWindow([]) })({ kind: 'folder' });
    assert.equal(noOwner.calls[0]?.withOwner, false, '没有窗口不能失败：退化成无 owner 调用');
  });

  test('互斥：框还开着时第二次调用立刻回 busy，且文案指向「先关掉已打开的选择框」', async () => {
    const { calls, dialog, release } = fakeDialog(null, { hang: true });
    const pick = createPickDialog({ dialog, BrowserWindow: fakeBrowserWindow([openWindow]) });

    // 第一次不 await：框一直开着（没有超时），正好占住 inFlight。
    const first = pick({ kind: 'file' });
    const started = Date.now();
    const second = await pick({ kind: 'file' });

    assert.deepEqual(second, {
      ok: false,
      reason: 'busy',
      message: '另一个选择框还开着，请先关掉已打开的选择框再点',
    });
    assert.ok(Date.now() - started < 150, 'busy 必须是立刻返回，不能等任何东西');
    assert.equal(calls.length, 1, 'busy 的那次不该真的弹第二个框');
    assert.equal(await settlesWithin(first, 60), false, '第二次回 busy 的时候第一次仍在飞（互斥真的占着）');

    // 用户终于关掉了框：第一次按真实结论收尾（互斥随之释放）。
    release({ canceled: true, filePaths: [] });
    assert.deepEqual(await first, { ok: true, kind: 'cancelled' });
  });

  test('互斥只跟对话框走：框落地之后第三次能开新框（finally 已清）', async () => {
    const { calls, dialog, release } = fakeDialog({ canceled: false, filePaths: ['D:/a.txt'] }, { hangOnce: true });
    const pick = createPickDialog({ dialog, BrowserWindow: fakeBrowserWindow([openWindow]) });

    const first = pick({ kind: 'file' });
    assert.equal((await pick({ kind: 'file' })).reason, 'busy', '框还开着 → 忙');
    release({ canceled: false, filePaths: ['D:/a.txt'] });
    assert.deepEqual(await first, { ok: true, kind: 'picked', path: 'D:/a.txt' });

    // 框已经关掉：下一次必须能进（互斥释放的唯一条件就是对话框落地）。
    const again = await pick({ kind: 'file' });
    assert.deepEqual(again, { ok: true, kind: 'picked', path: 'D:/a.txt' });
    assert.equal(calls.length, 2, '第二次真的开了新框');
  });

  test('无超时：showOpenDialog 永不落地时 pick() 一直 pending（没有任何「到点就回」的路径）', async () => {
    const fake = fakeDialog(null, { hang: true });
    const pick = createPickDialog({ dialog: fake.dialog, BrowserWindow: fakeBrowserWindow([openWindow]) });

    const pending = pick({ kind: 'file', title: '选择权重目录' });
    assert.equal(await settlesWithin(pending, 150), false, '150ms 内不该有任何结论：这里没有计时器，也就没有超时');
    assert.equal(fake.calls.length, 1, '框已经弹出去了');

    // 唯一的结局来源：对话框自己落地（用户点了取消 / 关掉了框）。
    fake.release({ canceled: true, filePaths: [] });
    assert.deepEqual(await pending, { ok: true, kind: 'cancelled' }, '落地之后才有结论');
  });

  test('老 helper 兼容：请求体带 timeoutMs 时读到也忽略（不因字段存在就判超时）', async () => {
    const { dialog, release } = fakeDialog(null, { hang: true });
    const pick = createPickDialog({ dialog, BrowserWindow: fakeBrowserWindow([openWindow]) });

    // 改造前：timeoutMs:20 会在 20ms 后回 {ok:false,reason:'timeout'}。现在它必须被完全忽略。
    const pending = pick({ kind: 'file', timeoutMs: 20 });
    assert.equal(await settlesWithin(pending, 150), false, 'timeoutMs 已废弃：读到也不许按它收尾');

    release({ canceled: false, filePaths: ['D:/voice/late.ckpt'] });
    assert.deepEqual(await pending, { ok: true, kind: 'picked', path: 'D:/voice/late.ckpt' });
  });

  test('showOpenDialog 抛错 → unsupported 且带原始原因', async () => {
    const dialog = {
      showOpenDialog: (): Promise<unknown> => Promise.reject(new Error('no display server')),
    };
    const outcome = await createPickDialog({ dialog, BrowserWindow: fakeBrowserWindow() })({ kind: 'folder' });

    assert.deepEqual(outcome, { ok: false, reason: 'unsupported', message: 'no display server' });
  });
});

/** 等 `callbackUrl()` 落地（server.listen 是异步的）。 */
async function waitForCallbackUrl(bridge: { callbackUrl(): string }, timeoutMs = 3000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = bridge.callbackUrl();
    if (url !== '') return url;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('bridge callback server 没起来');
}

/** 起一个 bridge 回调服务器，跑完 `body` 后关掉。 */
async function withBridge<T>(
  deps: Record<string, unknown>,
  body: (pickUrl: string, respondUrl: string) => Promise<T>,
): Promise<T> {
  const bridge = createBridge({ isBridge: true, prefix: 'p:', origin: 'http://127.0.0.1:1', token: '', ...deps });
  const server = bridge.startCallback();
  try {
    const respondUrl = await waitForCallbackUrl(bridge);
    return await body(respondUrl.replace(/\/respond$/, '/pick'), respondUrl);
  } finally {
    // 断开用例会留下「服务器还没收完就断掉」的套接字：不等默认 keep-alive 超时（5s），直接收掉。
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('bridge：POST /pick 与既有 /respond 共存', () => {
  test('deps.pick 存在：/pick 走到它并把 JSON 原样回给宿主', async () => {
    const seen: unknown[] = [];
    await withBridge(
      {
        pick: async (req: unknown) => {
          seen.push(req);
          return { ok: true, kind: 'picked', path: 'D:/voice/ref.txt' };
        },
      },
      async (pickUrl) => {
        const response = await fetch(pickUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'file', title: '选择参考文本', extensions: ['.txt'] }),
        });
        assert.equal(response.status, 200);
        assert.match(String(response.headers.get('content-type')), /application\/json/);
        assert.deepEqual(await response.json(), { ok: true, kind: 'picked', path: 'D:/voice/ref.txt' });
      },
    );
    assert.deepEqual(seen, [{ kind: 'file', title: '选择参考文本', extensions: ['.txt'] }]);
  });

  test('deps.pick 缺省：/pick 回 501（老 helper + 新宿主，宿主据此回落 PowerShell）', async () => {
    await withBridge({}, async (pickUrl) => {
      const response = await fetch(pickUrl, { method: 'POST', body: JSON.stringify({ kind: 'file' }) });
      assert.equal(response.status, 501);
      assert.match(await response.text(), /pick not supported/);
    });
  });

  test('/pick 的坏 JSON 回 400，业务失败（pick 返回 ok:false）仍是 200', async () => {
    await withBridge(
      { pick: async () => ({ ok: false, reason: 'busy', message: '另一个选择框还开着' }) },
      async (pickUrl) => {
        const bad = await fetch(pickUrl, { method: 'POST', body: '{not json' });
        assert.equal(bad.status, 400);

        const busy = await fetch(pickUrl, { method: 'POST', body: JSON.stringify({ kind: 'file' }) });
        assert.equal(busy.status, 200, '业务结论一律 200，与 /pick-file 的口径一致');
        assert.deepEqual(await busy.json(), { ok: false, reason: 'busy', message: '另一个选择框还开着' });
      },
    );
  });

  test('/respond 语义不变、未知路径仍是 404、GET /pick 也是 404', async () => {
    await withBridge({ pick: async () => ({ ok: true, kind: 'cancelled' }) }, async (pickUrl, respondUrl) => {
      const respond = await fetch(respondUrl, {
        method: 'POST',
        body: JSON.stringify({ id: 12345, status: 200, body: 'ignored' }),
      });
      assert.equal(respond.status, 200, '没有对应请求也照样回 200 ok（既有语义）');
      assert.equal(await respond.text(), 'ok');

      const unknown = await fetch(respondUrl.replace(/\/respond$/, '/nope'), { method: 'POST', body: '{}' });
      assert.equal(unknown.status, 404);

      const wrongMethod = await fetch(pickUrl, { method: 'GET' });
      assert.equal(wrongMethod.status, 404, '/pick 只收 POST');
    });
  });
});

/**
 * 断开写回守卫：宿主完全可能在框还开着的时候把连接断掉（页面关掉 / 进程被杀 / 宿主重启）。
 * 选择框现在**没有超时**，所以「pick 之后落地，但 socket 已经没了」是常态而不是异常——
 * 写应答前必须看 `writableEnded || destroyed`，否则 `ERR_STREAM_WRITE_AFTER_END` 会变成
 * 未捕获异常把 helper 主进程带走（A 通道随之整个消失）。
 */
describe('bridge /pick：宿主提前断开时的写回守卫', () => {
  /** 等到条件成立（轮询，最多 1s）。 */
  async function untilDone(ok: () => boolean): Promise<void> {
    for (let i = 0; i < 200; i++) {
      if (ok()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('条件没在预期时间内成立');
  }

  /**
   * 发一个真请求，等 `pick` 被调用之后把连接 destroy 掉（≈ 宿主走了）。
   *
   * @param pickUrl - `/pick` 地址。
   * @param body - 请求体原文。
   * @param entered - 已被调用次数的读取口。
   */
  async function dropAfterPick(pickUrl: string, body: string, entered: () => number): Promise<void> {
    const request = httpRequest(pickUrl, { method: 'POST', headers: { 'content-type': 'application/json' } });
    // 断开之后 ECONNRESET / EPIPE 是预期结果，不是失败。
    request.on('error', () => undefined);
    request.end(body);
    await untilDone(() => entered() > 0);
    request.destroy();
    // 给服务器一点时间感知 close（'close' 是下一个 tick 才派发的）。
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  test('成功路径：框在宿主断开之后才落地 → 不写死 socket，服务器仍能服务下一个请求', async () => {
    let entered = 0;
    let release: (value: unknown) => void = () => undefined;
    await withBridge(
      {
        pick: () => {
          entered += 1;
          if (entered === 1) return new Promise((resolve) => (release = resolve));
          return { ok: true, kind: 'cancelled' };
        },
      },
      async (pickUrl) => {
        await dropAfterPick(pickUrl, JSON.stringify({ kind: 'file' }), () => entered);
        // 用户后来才点了取消：这时候宿主早就不在了。
        release({ ok: true, kind: 'cancelled' });
        await new Promise((resolve) => setTimeout(resolve, 40));

        const again = await fetch(pickUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'file' }),
        });
        assert.equal(again.status, 200, '写回守卫必须让 helper 活下来：下一次请求照常 200');
        assert.deepEqual(await again.json(), { ok: true, kind: 'cancelled' });
      },
    );
  });

  test('异常路径：pick 在宿主断开之后抛错 → 那条 error 应答也被守卫挡住，helper 不崩', async () => {
    let entered = 0;
    let release: (value: unknown) => void = () => undefined;
    await withBridge(
      {
        pick: () => {
          entered += 1;
          if (entered === 1)
            return new Promise((_resolve, reject) => {
              release = () => reject(new Error('dialog 没了'));
            });
          return { ok: true, kind: 'cancelled' };
        },
      },
      async (pickUrl) => {
        await dropAfterPick(pickUrl, JSON.stringify({ kind: 'folder' }), () => entered);
        release(undefined);
        await new Promise((resolve) => setTimeout(resolve, 40));

        const again = await fetch(pickUrl, { method: 'POST', body: JSON.stringify({ kind: 'folder' }) });
        assert.equal(again.status, 200, '异常应答的写点同样有守卫');
      },
    );
  });

  test('坏 JSON 400 的写点：请求方在服务器写 400 之前就断开，进程仍能继续服务', async () => {
    let entered = 0;
    await withBridge(
      {
        pick: () => {
          entered += 1;
          return { ok: true, kind: 'cancelled' };
        },
      },
      async (pickUrl) => {
        const request = httpRequest(pickUrl, { method: 'POST', headers: { 'content-type': 'application/json' } });
        request.on('error', () => undefined);
        request.end('{not json');
        request.destroy();
        await new Promise((resolve) => setTimeout(resolve, 60));

        // 坏 JSON 不会走到 pick（根本没解析成功）；这里断言的是「那条 400 的写点没把进程带走」。
        assert.equal(entered, 0, '坏 JSON 不该走到 pick');
        const again = await fetch(pickUrl, { method: 'POST', body: JSON.stringify({ kind: 'file' }) });
        assert.equal(again.status, 200);
      },
    );
  });
});
