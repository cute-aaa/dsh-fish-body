/**
 * 插件自重启（src/client/plugin-restart.ts）的契约测试。
 *
 * 三条契约：
 *   1. 只发一次 `POST /plugin-restart`，模式按宿主回的 `mode` 收窄（其它值一律当 helper）；
 *   2. 任何失败都归成 `null`，调用方据此只提示、不刷新；
 *   3. 刷新页面只在有 window 时才安排，Node 环境下不抛。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { requestPluginRestart, schedulePageReload, RESTART_RELOAD_MS } from './plugin-restart.ts';

/** 换掉 fetch，记录请求。 */
async function withFetch<T>(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
  run: (calls: string[]) => Promise<T>,
): Promise<T> {
  const previous = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push(String(input));
    return Promise.resolve(handler(String(input), init));
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = previous;
  }
}

const answer = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('requestPluginRestart —— 触发与模式', () => {
  test('POST 一次，hmr 模式如实回传', async () => {
    const mode = await withFetch(
      () => answer(200, { ok: true, mode: 'hmr' }),
      async (calls) => {
        const result = await requestPluginRestart();
        assert.equal(calls.length, 1);
        assert.ok(calls[0].endsWith('/plugin-restart'), '打的是重启端点');
        return result;
      },
    );
    assert.equal(mode, 'hmr');
  });

  test('未知模式当 helper（保守：不刷新页面）', async () => {
    const mode = await withFetch(
      () => answer(200, { ok: true, mode: 'wat' }),
      () => requestPluginRestart(),
    );
    assert.equal(mode, 'helper');
  });

  test('业务失败、非 2xx、网络异常都归成 null', async () => {
    assert.equal(
      await withFetch(
        () => answer(200, { ok: false }),
        () => requestPluginRestart(),
      ),
      null,
    );
    assert.equal(
      await withFetch(
        () => answer(500, {}),
        () => requestPluginRestart(),
      ),
      null,
    );
    assert.equal(
      await withFetch(
        () => {
          throw new Error('offline');
        },
        () => requestPluginRestart(),
      ),
      null,
    );
  });
});

describe('schedulePageReload —— 刷新安排', () => {
  test('没有 window 时是空操作（Node / SSR 不抛）', () => {
    assert.doesNotThrow(() => schedulePageReload());
    assert.equal(RESTART_RELOAD_MS > 0, true);
  });
});
