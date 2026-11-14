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

import { handleLayoutRoutes, resetMoveState } from './layout.ts';
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
function deps(root: string, home: string): PetRouteDeps {
  return {
    paths: userPaths(root),
    userRoot: root,
    dshHome: home,
    log: { info: () => undefined, warn: () => undefined, file: join(home, 'logs.txt') },
    requestRestart: async () => undefined,
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
