/**
 * 位置变更路由（src/host/routes/layout.ts）的契约：
 * POST 只起步、GET 报进度；搬完写落点（数据根指针 / `locations.json`）并置 `needsRestart`；
 * 目标非法时当场拒绝；`pick-folder` 在没有图形环境时回 `unsupported`（界面据此展开手输框）。
 * 用真实临时目录：搬迁就是文件复制，替身反而测不到真相。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleLayoutRoutes, resetMoveState, viaLabel } from './layout.ts';
import { readLocations } from '../locations.ts';
import { userPaths } from '../user-layout.ts';
import type { PetRouteDeps } from './types.ts';

/** 一个隔离的数据根 + `$DSH_HOME`。 */
function tempHome(): { home: string; root: string } {
  const home = mkdtempSync(join(tmpdir(), 'fish-body-layout-route-'));
  const root = join(home, 'fish-body');
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'config', 'main-config.jsonc'), '{"pets":[]}', 'utf8');
  mkdirSync(join(root, 'skin', 'cat-animation'), { recursive: true });
  writeFileSync(join(root, 'skin', 'cat-config.json'), '{"pets":[]}', 'utf8');
  return { home, root };
}

/** 最小依赖：路由只用到 paths / dshHome / log / requestRestart。 */
function deps(root: string, home: string, extra: Partial<PetRouteDeps> = {}): PetRouteDeps {
  return {
    paths: userPaths(root),
    userRoot: root,
    dshHome: home,
    log: { info: () => undefined, warn: () => undefined, file: join(home, 'logs.txt') },
    requestRestart: async () => undefined,
    ...extra,
  } as unknown as PetRouteDeps;
}

/** 造一次调用：`rest` 可以带查询串，路由拿到的 `rest` 只有路径（与真实分派一致）。 */
function call(d: PetRouteDeps, rest: string, method: string, body?: unknown) {
  const url = new URL('http://localhost/' + rest);
  return handleLayoutRoutes(d, {
    url,
    rest: url.pathname.replace(/^\//, ''),
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** 取 JSON 应答的实体（非 json 应答在用例里就是失败，直接断言掉）。 */
async function json(d: PetRouteDeps, rest: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const result = await call(d, rest, method, body);
  assert.ok(result, '路由必须给出应答（' + method + ' ' + rest + '）');
  assert.equal(result.kind, 'json', '期望 JSON 应答，实际：' + String(result.kind));
  return (result as { obj: Record<string, unknown> }).obj;
}

/** 等后台搬迁收尾（setImmediate 起跑 + 文件复制）：轮询到 busy=false。 */
async function settle(d: PetRouteDeps, timeoutMs = 5000): Promise<Record<string, unknown>> {
  const started = Date.now();
  for (;;) {
    const body = await json(d, 'layout/location', 'GET');
    if (body.busy === false) return body;
    if (Date.now() - started > timeoutMs) throw new Error('搬迁没有在预期时间内收尾');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('POST /layout/location', () => {
  test('搬皮肤目录：内容到位、locations.json 写目标、needsRestart', async () => {
    resetMoveState();
    const { home, root } = tempHome();
    try {
      const d = deps(root, home);
      const target = join(home, 'skins-elsewhere');
      const started = await json(d, 'layout/location', 'POST', { which: 'skin', path: target });
      assert.equal(started.started, true);

      const state = await settle(d);
      assert.equal(state.error, undefined);
      assert.equal(state.needsRestart, true);
      assert.equal(readFileSync(join(target, 'cat-config.json'), 'utf8'), '{"pets":[]}');
      assert.equal(existsSync(join(root, 'skin')), false);
      // 落点：locations.json 记住新位置（重启后即生效）。
      assert.equal(readLocations(root).skin, target);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('搬数据根：写 $DSH_HOME 下的指针文件', async () => {
    resetMoveState();
    const { home, root } = tempHome();
    try {
      const d = deps(root, home);
      const target = join(home, 'moved-root');
      await call(d, 'layout/location', 'POST', { which: 'root', path: target });
      const state = await settle(d);
      assert.equal(state.needsRestart, true);
      const pointer = JSON.parse(readFileSync(join(home, 'fish-body-root.json'), 'utf8')) as { root: string };
      assert.equal(pointer.root, target);
      assert.equal(existsSync(join(target, 'config', 'main-config.jsonc')), true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('which 非法 / 缺路径 / 相对路径：当场拒绝', async () => {
    resetMoveState();
    const { home, root } = tempHome();
    try {
      const d = deps(root, home);
      for (const body of [{ which: 'cache', path: 'D:/x' }, { which: 'skin' }, { which: 'skin', path: 'rel/path' }]) {
        const obj = await json(d, 'layout/location', 'POST', body);
        assert.equal(obj.ok, false, JSON.stringify(body) + ' 应当被拒');
        assert.equal(obj.reason, 'bad-request');
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('GET /layout/size', () => {
  test('数出皮肤目录的文件数与字节数', async () => {
    resetMoveState();
    const { home, root } = tempHome();
    try {
      const d = deps(root, home);
      const body = await json(d, 'layout/size?which=skin', 'GET');
      assert.equal(body.ok, true);
      assert.equal(body.which, 'skin');
      // tempHome 放了一个 cat-config.json（11 字节）+ 一个空目录。
      assert.equal(body.files, 1);
      assert.equal(body.bytes, 11);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('目录还不存在时回 0，而不是失败', async () => {
    resetMoveState();
    const { home, root } = tempHome();
    try {
      const d = deps(root, home);
      rmSync(join(root, 'skin'), { recursive: true, force: true });
      const body = await json(d, 'layout/size?which=skin', 'GET');
      assert.equal(body.ok, true);
      assert.equal(body.files, 0);
      assert.equal(body.bytes, 0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('which 非法：拒绝且不扫盘', async () => {
    resetMoveState();
    const { home, root } = tempHome();
    try {
      const body = await json(deps(root, home), 'layout/size?which=cache', 'GET');
      assert.equal(body.ok, false);
      assert.equal(body.reason, 'bad-request');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('POST /pick-folder', () => {
  test('Linux 无图形环境时回 unsupported（界面据此展开手输框）', async (t) => {
    // 只在 Linux 上跑：其它平台会真的弹出系统对话框，把测试挂住（WinForms / osascript 都要人点）。
    if (process.platform !== 'linux') {
      t.skip('这个断言只对 Linux 的无显示环境成立');
      return;
    }
    const { home, root } = tempHome();
    try {
      const savedDisplay = process.env.DISPLAY;
      const savedWayland = process.env.WAYLAND_DISPLAY;
      delete process.env.DISPLAY;
      delete process.env.WAYLAND_DISPLAY;
      try {
        const obj = await json(deps(root, home), 'pick-folder', 'POST', { title: 'pick' });
        assert.equal(obj.ok, false);
        assert.equal(obj.reason, 'unsupported');
      } finally {
        if (savedDisplay !== undefined) process.env.DISPLAY = savedDisplay;
        if (savedWayland !== undefined) process.env.WAYLAND_DISPLAY = savedWayland;
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('POST /pick-*：A 通道（helper 系统框）的接线与三态', () => {
  test('deps.nativePicker 存在：/pick-folder 走它，picked 仍是 {ok:true,path}', async () => {
    const { home, root } = tempHome();
    try {
      const asks: string[] = [];
      const nativePicker = async (req: { kind: string; title: string; start?: string }) => {
        asks.push(`${req.kind}:${req.title}:${req.start ?? ''}`);
        return { kind: 'picked' as const, path: 'D:/AI/AI-Voice' };
      };
      const obj = await json(deps(root, home, { nativePicker }), 'pick-folder', 'POST', {
        title: '选择权重目录',
        start: 'D:/AI',
      });

      assert.deepEqual(obj, { ok: true, path: 'D:/AI/AI-Voice' }, '响应形状与走 PowerShell 时一字不差');
      assert.deepEqual(asks, ['folder:选择权重目录:D:/AI'], 'A 通道拿到的就是界面传来的标题与初始目录');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('/pick-file 走 A 通道：扩展名透传、cancelled 仍是 {ok:false,reason:cancelled}', async () => {
    const { home, root } = tempHome();
    try {
      const seen: unknown[] = [];
      const nativePicker = async (req: unknown) => {
        seen.push(req);
        return { kind: 'cancelled' as const };
      };
      const obj = await json(deps(root, home, { nativePicker }), 'pick-file', 'POST', {
        title: '选择参考文本',
        extensions: ['.txt', '.list'],
      });

      assert.equal(obj.ok, false);
      assert.equal(obj.reason, 'cancelled', '取消的口径不变（界面据此不动输入框）');
      assert.deepEqual(
        seen,
        [{ kind: 'file', title: '选择参考文本', extensions: ['.txt', '.list'] }],
        '不再带 timeoutMs：选择框没有超时了',
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('A 通道回 unsupported：仍回 {ok:false,reason:unsupported,message} 并写一行 warn', async () => {
    const { home, root } = tempHome();
    try {
      const warns: string[] = [];
      const nativePicker = async () => ({ kind: 'unsupported' as const, message: '另一个选择框还开着' });
      const d = deps(root, home, {
        nativePicker,
        log: {
          info: () => undefined,
          warn: (message: string) => warns.push(message),
          file: join(home, 'logs.txt'),
        } as unknown as PetRouteDeps['log'],
      });

      const obj = await json(d, 'pick-folder', 'POST', { title: 'pick' });

      assert.deepEqual(obj, { ok: false, reason: 'unsupported', message: '另一个选择框还开着' });
      assert.equal(warns.length, 1, '弹不出来要留一行日志（排障唯一线索）');
      assert.match(warns[0] ?? '', /由 helper 提供/, '日志要写明是哪个通道给的结论');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('/pick-* 的三态形状未变：picked / cancelled / unsupported（aborted 不在响应体里）', async () => {
    const { home, root } = tempHome();
    try {
      const outcomes = [
        { kind: 'picked' as const, path: 'D:/AI/AI-Voice' },
        { kind: 'cancelled' as const },
        { kind: 'unsupported' as const, message: '弹不出来' },
      ];
      const shapes: unknown[] = [];
      for (const outcome of outcomes) {
        const d = deps(root, home, { nativePicker: async () => outcome });
        shapes.push(await json(d, 'pick-file', 'POST', { title: 't' }));
      }
      assert.deepEqual(shapes, [
        { ok: true, path: 'D:/AI/AI-Voice' },
        { ok: false, reason: 'cancelled' },
        { ok: false, reason: 'unsupported', message: '弹不出来' },
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('/pick-file 的调用方 signal 已 abort：路由把它透传给选择器，并回 {kind:"none"}', async () => {
    const { home, root } = tempHome();
    try {
      const controller = new AbortController();
      controller.abort();
      let seen: AbortSignal | undefined;
      const nativePicker = async (req: { signal?: AbortSignal }) => {
        seen = req.signal;
        return { kind: 'aborted' as const };
      };
      const d = deps(root, home, { nativePicker });

      const result = await handleLayoutRoutes(d, {
        url: new URL('http://localhost/pick-file'),
        rest: 'pick-file',
        method: 'POST',
        body: JSON.stringify({ title: '选择参考文本' }),
        signal: controller.signal,
      });

      assert.deepEqual(result, { kind: 'none' }, '调用方已走：不写响应，也不当失败');
      assert.equal(seen?.aborted, true, 'input.signal 必须真的进到选择器（否则 B 路径没有唯一的提前退出机制）');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('A 通道回 aborted（调用方断开）：回 {kind:"none"}——不写响应，也不当失败', async () => {
    const { home, root } = tempHome();
    try {
      const warns: string[] = [];
      const nativePicker = async () => ({ kind: 'aborted' as const });
      const d = deps(root, home, {
        nativePicker,
        log: {
          info: () => undefined,
          warn: (message: string) => warns.push(message),
          file: join(home, 'logs.txt'),
        } as unknown as PetRouteDeps['log'],
      });

      const result = await call(d, 'pick-file', 'POST', { title: '选择参考文本' });

      assert.deepEqual(result, { kind: 'none' }, '与 /playback、/state 的取消先例一致：没有人在等应答');
      assert.equal(warns.length, 0, 'aborted 不是失败，不该写 warn');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

/**
 * 那一行日志说「由谁提供」：它不能一律写 PowerShell。
 *
 * macOS / Linux 上的兜底分别是 `osascript` 与 `zenity/kdialog`；把 Windows 的名字写到别的平台上，
 * 排障时会被这句话带偏（这是本轮要修的「日志谎报平台」）。
 */
describe('viaLabel：按平台说人话', () => {
  test('shell 分支三平台各不相同，且非 win32 的两条不含 PowerShell', () => {
    assert.equal(viaLabel('shell', 'win32'), '由 PowerShell 提供');
    assert.equal(viaLabel('shell', 'darwin'), '由 osascript 提供');
    assert.equal(viaLabel('shell', 'linux'), '由 zenity/kdialog 提供');
    assert.equal(viaLabel('shell', 'darwin').includes('PowerShell'), false, 'macOS 上没有 PowerShell 兜底');
    assert.equal(viaLabel('shell', 'linux').includes('PowerShell'), false, 'Linux 上没有 PowerShell 兜底');
  });

  test('未列平台仍说人话（不谎报平台）：freebsd / android 落到「系统命令」', () => {
    assert.equal(viaLabel('shell', 'freebsd'), '由系统命令提供');
    assert.equal(viaLabel('shell', 'android'), '由系统命令提供');
  });

  test('native / undefined 两支一字未改（既有 /由 helper 提供/ 断言不受影响）', () => {
    assert.equal(viaLabel('native'), '由 helper 提供');
    assert.equal(viaLabel('native', 'darwin'), '由 helper 提供', 'native 与平台无关');
    assert.equal(viaLabel(undefined), '来源未知');
  });

  test('默认参数走 process.platform：不传平台也能给出当前平台的短语', () => {
    const expected =
      process.platform === 'win32'
        ? '由 PowerShell 提供'
        : process.platform === 'darwin'
          ? '由 osascript 提供'
          : process.platform === 'linux'
            ? '由 zenity/kdialog 提供'
            : '由系统命令提供';
    assert.equal(viaLabel('shell'), expected);
  });
});
