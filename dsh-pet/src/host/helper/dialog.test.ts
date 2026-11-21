/**
 * 宿主侧「helper 系统选择框」客户端（src/host/helper/dialog.ts）的契约。
 *
 * 边界：本模块只管协议映射——请求体形状、helper 应答 → 宿主三态、连不上时回落信号。
 * 所以这里起**真的** `node:http` 服务器（真请求、真 JSON），只替换「对端是谁」时为
 * `requestImpl` 注入替身。
 *
 * 三条容易被误判的语义都钉在这里：
 *   - `unavailable` 是内部态（该回落 PowerShell），不是给用户看的结论；
 *   - helper 已经回过话（200）时**绝不**再回 `unavailable`，否则会连弹两个框；
 *   - 等待没有上限：静默对端、以及「等待类超时」错误，都不许产生任何结局。
 *
 * 文件里的观察窗口（`setTimeout` / `Promise.race`）是**测试基建**，生产代码里一个计时器都没有。
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { after, before, describe, test } from 'node:test';

import {
  createHelperDialog,
  normalizeCallbackBase,
  PICK_DIALOG_BUSY_MESSAGE,
  PICK_DIALOG_CHANNEL_LOST_MESSAGE,
  PICK_DIALOG_STALE_HELPER_MESSAGE,
  type HelperRequestImpl,
  type NativePickerRequest,
} from './dialog.ts';

/** 一次假 helper 收到的请求。 */
interface Seen {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** 服务器当前该怎么答：`{status, payload}`。 */
let next: { status: number; payload: unknown } = { status: 200, payload: { ok: true, kind: 'cancelled' } };
const seen: Seen[] = [];
let server: Server;
let base = '';

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = ((): unknown => {
        try {
          return raw === '' ? null : (JSON.parse(raw) as unknown);
        } catch {
          return '<bad json>';
        }
      })();
      seen.push({ method: req.method ?? '', path: req.url ?? '', body });
      res.writeHead(next.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(next.payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** 一次典型请求。 */
const request: NativePickerRequest = {
  kind: 'file',
  title: '选择参考文本',
  start: 'D:/voice',
  extensions: ['.txt', '.list'],
};

/** 一份最小的 file 请求。 */
function pickRequest(): NativePickerRequest {
  return { kind: 'file', title: 't', extensions: ['.txt'] };
}

/**
 * 在窗口内观察 Promise 是否落定（resolve 与 reject 都算落定）。
 *
 * @param pending - 被观察的 Promise。
 * @param ms - 观察窗口（毫秒）。
 * @returns `true` = 窗口内落定；`false` = 窗口内一直没动静。
 */
async function settlesWithin<T>(pending: Promise<T>, ms: number): Promise<boolean> {
  return Promise.race([
    pending.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

/** 形似 undici 的「等待类超时」：外层 `TypeError`，真正原因在 `cause` 上。 */
function waitingTimeoutError(shape: { code?: string; name: string }): TypeError {
  const cause = Object.assign(new Error(shape.name), shape);
  return new TypeError('fetch failed', { cause });
}

describe('normalizeCallbackBase', () => {
  test('origin 原样用；`…/respond` 去掉尾巴；空串保持空串', () => {
    assert.equal(normalizeCallbackBase('http://127.0.0.1:52406'), 'http://127.0.0.1:52406');
    assert.equal(normalizeCallbackBase('http://127.0.0.1:52406/respond'), 'http://127.0.0.1:52406');
    assert.equal(normalizeCallbackBase('  http://127.0.0.1:1/respond/  '), 'http://127.0.0.1:1');
    assert.equal(normalizeCallbackBase(''), '');
    assert.equal(normalizeCallbackBase('   '), '');
  });
});

describe('createHelperDialog：协议映射', () => {
  test('请求体形状与 helper 的 `POST /pick` 契约一致（kind/title/start/extensions，且不含 timeoutMs）', async () => {
    seen.length = 0;
    next = { status: 200, payload: { ok: true, kind: 'picked', path: 'D:/voice/ref.txt' } };
    const pick = createHelperDialog({ endpoint: () => base });

    const outcome = await pick(request);

    assert.deepEqual(outcome, { kind: 'picked', path: 'D:/voice/ref.txt' });
    assert.deepEqual(
      seen,
      [
        {
          method: 'POST',
          path: '/pick',
          body: { kind: 'file', title: '选择参考文本', start: 'D:/voice', extensions: ['.txt', '.list'] },
        },
      ],
      '宿主不再传 timeoutMs：helper 侧已经没有超时这件事了',
    );
  });

  test('helper 回 picked / cancelled：原样映射', async () => {
    const pick = createHelperDialog({ endpoint: () => base });

    next = { status: 200, payload: { ok: true, kind: 'picked', path: 'D:/a.wav' } };
    assert.deepEqual(await pick({ ...request, kind: 'file' }), { kind: 'picked', path: 'D:/a.wav' });

    next = { status: 200, payload: { ok: true, kind: 'cancelled' } };
    assert.deepEqual(await pick({ ...request, kind: 'folder', extensions: undefined }), { kind: 'cancelled' });
  });

  test('helper 回 timeout（只可能是老 helper）/ busy：都变成 unsupported（不回落，避免连弹两个框）', async () => {
    const pick = createHelperDialog({ endpoint: () => base });

    // 新宿主不再传 timeoutMs、新 helper 也没有超时了：`reason:'timeout'` 只剩「升级后没重启的老 helper」这一种来源。
    next = { status: 200, payload: { ok: false, reason: 'timeout', message: '选择框超时' } };
    assert.deepEqual(await pick(request), { kind: 'unsupported', message: PICK_DIALOG_STALE_HELPER_MESSAGE });

    next = { status: 200, payload: { ok: false, reason: 'busy', message: '另一个选择框还开着' } };
    assert.deepEqual(await pick(request), { kind: 'unsupported', message: PICK_DIALOG_BUSY_MESSAGE });
  });

  test('helper 回 unsupported：带上它自己的原因（没给就兜一句可操作的）', async () => {
    const pick = createHelperDialog({ endpoint: () => base });

    next = { status: 200, payload: { ok: false, reason: 'unsupported', message: '没有图形会话' } };
    assert.deepEqual(await pick(request), { kind: 'unsupported', message: '没有图形会话' });

    next = { status: 200, payload: { ok: false, reason: 'unsupported' } };
    const noMessage = await pick(request);
    assert.equal(noMessage.kind, 'unsupported');
    assert.ok(noMessage.kind === 'unsupported' && noMessage.message !== '', '不能把空文案给用户');
  });

  test('老 helper（404）与没注入 dialog（501）：按 unavailable 回落 PowerShell', async () => {
    const pick = createHelperDialog({ endpoint: () => base });

    next = { status: 404, payload: { ok: false } };
    assert.deepEqual(await pick(request), { kind: 'unavailable' }, '老 helper 没有 /pick，功能不能丢');

    next = { status: 501, payload: { ok: false } };
    assert.deepEqual(await pick(request), { kind: 'unavailable' });
  });

  test('helper 回了看不懂的形状：unsupported（它已经回过话，不能再弹第二个框）', async () => {
    const pick = createHelperDialog({ endpoint: () => base });

    next = { status: 200, payload: { ok: true, kind: 'picked' } };
    assert.equal((await pick(request)).kind, 'unsupported', 'picked 但没有 path');

    next = { status: 200, payload: 'not-an-object' };
    assert.equal((await pick(request)).kind, 'unsupported');
  });

  test('endpoint() 为空：直接 unavailable，一次网络往返都不发', async () => {
    seen.length = 0;
    let calls = 0;
    const requestImpl: HelperRequestImpl = () => {
      calls += 1;
      throw new Error('不该被调用');
    };
    const pick = createHelperDialog({ endpoint: () => '', requestImpl });

    assert.deepEqual(await pick(request), { kind: 'unavailable' });
    assert.equal(calls, 0);
    assert.equal(seen.length, 0);
  });

  test('连不上（端口已关）：unavailable（回落 B，功能不丢）', async () => {
    // 先要一个「刚关掉」的端口：起一个临时服务器再关，端口必然拒绝连接。
    const scratch = createServer(() => undefined);
    await new Promise<void>((resolve) => scratch.listen(0, '127.0.0.1', () => resolve()));
    const port = (scratch.address() as AddressInfo).port;
    await new Promise<void>((resolve) => scratch.close(() => resolve()));

    const refused = createHelperDialog({ endpoint: () => `http://127.0.0.1:${port}` });
    assert.deepEqual(await refused(pickRequest()), { kind: 'unavailable' });
  });

  test('注入连接类错误真形 ECONNREFUSED（helper 已死）：unavailable', async () => {
    const requestImpl: HelperRequestImpl = () =>
      Promise.reject(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }));
    const pick = createHelperDialog({ endpoint: () => 'http://127.0.0.1:1', requestImpl });

    assert.deepEqual(await pick(request), { kind: 'unavailable' });
  });

  test('连接中途断了但 helper 还活着：unsupported（通道中断），**不**回落 B', async () => {
    // helper 活着说明框可能还在屏幕上，回落 PowerShell 就会再弹一个。
    let alive = true;
    const requestImpl: HelperRequestImpl = () => {
      const error = new TypeError('fetch failed');
      (error as unknown as { cause?: unknown }).cause = { code: 'ECONNRESET' };
      return Promise.reject(error);
    };
    const broken = createHelperDialog({
      endpoint: () => 'http://127.0.0.1:1',
      isPeerAlive: () => alive,
      requestImpl,
    });
    assert.deepEqual(await broken(request), { kind: 'unsupported', message: PICK_DIALOG_CHANNEL_LOST_MESSAGE });

    // 同一份错误、但 helper 已经死了：框随进程消失，回落 B 是安全的。
    alive = false;
    assert.deepEqual(await broken(request), { kind: 'unavailable' });
  });

  test('非 http: 的回调基址（防御分支）：unavailable，不当成连接中断去叠框', async () => {
    const pick = createHelperDialog({ endpoint: () => 'https://127.0.0.1:1' });
    assert.deepEqual(await pick(pickRequest()), { kind: 'unavailable' });
  });
});

describe('createHelperDialog：等待无上限（时间不判失败）', () => {
  test('静默 helper（收下请求、永不响应）：Promise 保持 pending ≥1s，signal abort 才收尾', async () => {
    // 真 adapter + 真服务器：这条证明「客户端不主动放弃」，不是替身的行为。
    let held: Socket | undefined;
    const silent = createServer((req) => {
      held = req.socket;
      req.resume();
      // 故意不 writeHead / 不 end：一个还在等用户选的 helper。
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', () => resolve()));
    const port = (silent.address() as AddressInfo).port;
    const controller = new AbortController();

    try {
      const pick = createHelperDialog({ endpoint: () => `http://127.0.0.1:${port}` });
      const pending = pick({ ...request, signal: controller.signal });

      assert.equal(await settlesWithin(pending, 1000), false, '1s 内不该有结论：等待不以时间为条件');
      assert.equal(held?.destroyed, false, '连接仍在（适配器没有自行收尾，也没有假超时）');

      controller.abort();
      assert.deepEqual(await pending, { kind: 'aborted' });
    } finally {
      silent.closeAllConnections();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });

  test('注入的传输永不落定：Promise 保持 pending ≥1s（既不 resolve 也不 reject）', async () => {
    let settled = false;
    const requestImpl: HelperRequestImpl = () => new Promise<Response>(() => undefined);
    const pick = createHelperDialog({ endpoint: () => 'http://127.0.0.1:1', requestImpl });

    const pending = pick(request);
    pending.then(
      () => (settled = true),
      () => (settled = true),
    );

    assert.equal(await settlesWithin(pending, 1000), false, '1s 内不该有结论');
    assert.equal(settled, false, '窗口内既没有 resolve 也没有 reject');
  });

  test('注入等待类超时错误：不判失败、仍在等待，只有 signal 能把它变成 aborted', async () => {
    const shapes = [
      { code: 'UND_ERR_HEADERS_TIMEOUT', name: 'HeadersTimeoutError' },
      { code: 'UND_ERR_BODY_TIMEOUT', name: 'BodyTimeoutError' },
      // 只有 name、没有 code 的变体：错误链上的 name 也要认。
      { name: 'BodyTimeoutError' },
    ];

    for (const shape of shapes) {
      for (const alive of [true, false]) {
        const controller = new AbortController();
        let calls = 0;
        const requestImpl: HelperRequestImpl = () => {
          calls += 1;
          return new Promise<Response>((_resolve, reject) => {
            // 50ms 后抛出与 undici 同形的等待类超时（注入替身的计时器，不在生产代码里）。
            setTimeout(() => reject(waitingTimeoutError(shape)), 50);
          });
        };
        const pick = createHelperDialog({
          endpoint: () => 'http://127.0.0.1:1',
          isPeerAlive: () => alive,
          requestImpl,
        });
        const pending = pick({ ...request, signal: controller.signal });

        assert.equal(
          await settlesWithin(pending, 1000),
          false,
          `${shape.code ?? shape.name} / isPeerAlive=${alive}：等待类超时既不是 unsupported 也不是 unavailable`,
        );
        assert.equal(calls, 1, '只发一次请求，没有重试');
        assert.equal(controller.signal.aborted, false, '宿主不会替用户取消');

        controller.abort();
        assert.deepEqual(await pending, { kind: 'aborted' });
      }
    }
  });

  test('注入 TimeoutError 形状（`AbortSignal.timeout` 的产物）：不算 abort，仍在等待，只有 signal 能收尾', async () => {
    // review P2-1：`AbortSignal.timeout(ms)` 到期投的是 `name:'TimeoutError'`。一旦它被算成 abort，
    // 这里会返回 `{kind:'aborted'}` → 路由回 `{kind:'none'}` → 一个字节都不写 → 用户看到「点了没反应」。
    const shapes: readonly (() => unknown)[] = [
      // ① 顶层就是 TimeoutError：时限实现直接把那个 DOMException 抛出来时的形状。
      () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
      // ② 外层 `TypeError` + `cause` 上的 TimeoutError：错误链要照样认出来。
      () => waitingTimeoutError({ name: 'TimeoutError' }),
      // ③ name 与 code 同时出现：code 分支也不能把它带进连接类/abort。
      () => waitingTimeoutError({ code: 'UND_ERR_HEADERS_TIMEOUT', name: 'TimeoutError' }),
    ];

    for (const [index, make] of shapes.entries()) {
      // 两种对端存活状态都要走一遍：等待类时限**与 helper 死活无关**（它只是「客户端自己等累了」），
      // 所以判定顺序上它必须先于 `isConnectionError`，否则 helper 活着时会被误判成「通道中断」。
      for (const alive of [true, false]) {
        const controller = new AbortController();
        const requestImpl: HelperRequestImpl = () =>
          new Promise<Response>((_resolve, reject) => {
            // 注入替身的计时器（测试基建），生产代码里没有计时器。
            setTimeout(() => reject(make()), 50);
          });
        const pick = createHelperDialog({
          endpoint: () => 'http://127.0.0.1:1',
          isPeerAlive: () => alive,
          requestImpl,
        });
        const pending = pick({ ...request, signal: controller.signal });

        assert.equal(
          await settlesWithin(pending, 400),
          false,
          `TimeoutError 形状 #${String(index)} / isPeerAlive=${String(alive)} 被判成了结局：` +
            '时限不是「调用方已经走了」，必须继续等',
        );

        controller.abort();
        assert.deepEqual(
          await pending,
          { kind: 'aborted' },
          `TimeoutError 形状 #${String(index)} / isPeerAlive=${String(alive)}：只有 signal 能收尾`,
        );
      }
    }
  });

  test('没有 signal 时等待类超时也永不落定（等待无上限）', async () => {
    const requestImpl: HelperRequestImpl = () =>
      new Promise<Response>((_resolve, reject) => {
        setTimeout(
          () => reject(waitingTimeoutError({ code: 'UND_ERR_HEADERS_TIMEOUT', name: 'HeadersTimeoutError' })),
          50,
        );
      });
    const pick = createHelperDialog({ endpoint: () => 'http://127.0.0.1:1', requestImpl });

    assert.equal(await settlesWithin(pick(request), 800), false, '没人能取消时，等待类超时也不能变成结局');
  });

  test('虚拟时间 10 分钟：静默 helper 下 setTimeout 到点也给出不了结局（结构上没有计时器能收尾）', async (t) => {
    // 为什么不能用真实窗口：旧缺陷（180s～300s 的量级）在任何「等 1s 看它有没有动」的断言下都是绿的。
    // 这里把 `setTimeout` 整个换成虚拟时钟并直接跳过 10 分钟——任何以 `setTimeout` 形态接回来的时限
    // （`AbortSignal.timeout` 之外最顺手的写法）都会在这一跳里到点，只要它真的存在，`settled` 就会变 true。
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let held: Socket | undefined;
    const silent = createServer((req) => {
      held = req.socket;
      req.resume();
      // 同样故意不应答：一个还在等用户选的 helper。
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', () => resolve()));
    const port = (silent.address() as AddressInfo).port;
    const controller = new AbortController();

    try {
      const pick = createHelperDialog({ endpoint: () => `http://127.0.0.1:${port}` });
      let settled = false;
      const pending = pick({ ...request, signal: controller.signal });
      pending.then(
        () => (settled = true),
        () => (settled = true),
      );
      // `setImmediate` 没被 mock（只 mock 了 setTimeout）：用它把宏任务队列推干净。
      await new Promise((resolve) => setImmediate(resolve));

      t.mock.timers.tick(10 * 60 * 1000);
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(settled, false, '虚拟 10 分钟之后仍然 pending：这条等待链上没有计时器能给出结局');
      assert.equal(held?.destroyed, false, '连接仍在：没有被假超时掐断');

      controller.abort();
      assert.deepEqual(await pending, { kind: 'aborted' }, '唯一的出口仍是调用方中止');
    } finally {
      silent.closeAllConnections();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });

  test('注入的 AbortError 形状（errno ABORT_ERR）：aborted', async () => {
    const requestImpl: HelperRequestImpl = () =>
      Promise.reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' }));
    const pick = createHelperDialog({ endpoint: () => 'http://127.0.0.1:1', requestImpl });

    assert.deepEqual(await pick(request), { kind: 'aborted' });
  });

  test('调用方的 signal 事先已 abort：立即 aborted（不回落、不写响应）', async () => {
    // 已 abort 的 signal 交给真 adapter 的请求，`node:http` 立刻以 AbortError / ABORT_ERR 收尾。
    const controller = new AbortController();
    controller.abort();
    const pick = createHelperDialog({ endpoint: () => 'http://127.0.0.1:1' });

    assert.deepEqual(await pick({ ...request, signal: controller.signal }), { kind: 'aborted' });
  });
});
