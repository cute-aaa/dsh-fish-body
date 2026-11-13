/**
 * 会话鱼草稿（src/client/settings/use-session-fish.ts）的契约测试。
 *
 * 四条契约：
 *   1. 读到设置就进草稿，并把「服务端权威值」告诉外壳（基线要靠它）；
 *   2. 读失败仍给默认草稿（表单可用），同时如实报错——保存会覆盖文件；
 *   3. 保存只提交草稿本身，成功后再用宿主回的值覆盖草稿；
 *   4. 重置写的是 `DEFAULT_SESSION_FISH_SETTINGS` 整份。
 *
 * 用一个「按调用顺序分配状态槽」的假 react：同一组槽在多次渲染之间共享，模拟 setState 后的重渲染。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SESSION_FISH_SETTINGS, type SessionFishSettings } from '../../shared/session-fish.ts';
import type { Feedback } from './feedback.ts';
import { useSessionFish, type SessionFishDeps, type SessionFishState } from './use-session-fish.ts';

interface Cell {
  value: unknown;
}

/** 假 react：状态槽跨渲染共享，effect 只在第一次渲染后跑一次（模拟空依赖）。 */
function createRuntime() {
  const cells: Cell[] = [];
  const effects: Array<() => void> = [];
  let cursor = 0;
  const useState = ((init: unknown) => {
    const slot = cursor;
    cursor += 1;
    if (cells[slot] === undefined) cells[slot] = { value: init };
    const cell = cells[slot];
    const set = (next: unknown): void => {
      cell.value = typeof next === 'function' ? (next as (previous: unknown) => unknown)(cell.value) : next;
    };
    return [cell.value, set];
  }) as never;
  const useEffect = ((effect: () => void) => {
    effects.push(effect);
  }) as never;
  return {
    cells,
    useState,
    useEffect,
    useCallback: ((fn: unknown) => fn) as never,
    /** 跑一遍 hook（模拟一次渲染）。 */
    render(deps: SessionFishDeps): SessionFishState {
      cursor = 0;
      // 测试夹具：这里不是组件也不是自定义 hook，只是按顺序调用一遍被测 hook。
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useSessionFish(
        { useState, useEffect, useCallback: ((fn: unknown) => fn) as never, t: (key: string) => key },
        deps,
      );
    },
    /** 跑掉排队的 effect（只跑一次，模拟依赖没变时不会重跑）。 */
    flushEffects(): void {
      for (const effect of effects.splice(0)) effect();
    },
  };
}

/** 让挂起的 promise 链跑完。 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** 换掉 fetch，记录请求体。 */
async function withFetch<T>(
  handler: (url: string, init?: RequestInit) => { status: number; body: unknown },
  run: (bodies: string[]) => Promise<T>,
): Promise<T> {
  const previous = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (typeof init?.body === 'string') bodies.push(init.body);
    const answer = handler(String(input), init);
    return Promise.resolve({
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body,
    } as Response);
  }) as typeof fetch;
  try {
    return await run(bodies);
  } finally {
    globalThis.fetch = previous;
  }
}

const stored: SessionFishSettings = {
  ...DEFAULT_SESSION_FISH_SETTINGS,
  enabled: false,
  sizePx: 120,
  skin: 'mine.webm',
};

/** 记录型依赖。 */
function makeDeps() {
  const messages: string[] = [];
  const authoritative: SessionFishSettings[] = [];
  const deps: SessionFishDeps = {
    report: (feedback: Feedback) => {
      if (feedback.text !== '') messages.push(feedback.kind + ':' + feedback.text);
    },
    onAuthoritative: (settings) => authoritative.push(settings),
  };
  return { deps, messages, authoritative };
}

describe('useSessionFish —— 加载', () => {
  test('读到设置：进草稿并告知外壳权威值', async () => {
    const runtime = createRuntime();
    const { deps, authoritative } = makeDeps();
    await withFetch(
      (url) => ({ status: 200, body: url.endsWith('/skins') ? { items: [] } : { settings: stored } }),
      async () => {
        runtime.render(deps);
        runtime.flushEffects();
        await settle();
      },
    );
    const state = runtime.render(deps);
    assert.equal(state.draft?.sizePx, 120);
    assert.equal(state.draft?.skin, 'mine.webm');
    assert.equal(state.loadFailed, false);
    assert.deepEqual(authoritative, [stored]);
  });

  test('读失败：草稿回默认值并报错（保存会覆盖文件）', async () => {
    const runtime = createRuntime();
    const { deps, messages } = makeDeps();
    await withFetch(
      () => ({ status: 500, body: { ok: false } }),
      async () => {
        runtime.render(deps);
        runtime.flushEffects();
        await settle();
      },
    );
    const state = runtime.render(deps);
    assert.deepEqual(state.draft, DEFAULT_SESSION_FISH_SETTINGS);
    assert.equal(state.loadFailed, true);
    assert.deepEqual(messages, ['err:fish.loadFailed']);
  });
});

describe('useSessionFish —— 保存与重置', () => {
  test('保存只提交草稿本身，成功后再用宿主回的值覆盖', async () => {
    const runtime = createRuntime();
    const { deps } = makeDeps();
    const echo = { ...stored, sizePx: 128 };
    const bodies: string[] = [];
    await withFetch(
      (url, init) => {
        if (url.endsWith('/skins')) return { status: 200, body: { items: [] } };
        if (init?.method === 'PUT') return { status: 200, body: { settings: echo } };
        return { status: 200, body: { settings: stored } };
      },
      async (recorded) => {
        runtime.render(deps);
        runtime.flushEffects();
        await settle();
        const state = runtime.render(deps);
        state.update('sizePx', 128);
        const next = runtime.render(deps);
        assert.equal(await next.save(), true);
        bodies.push(...recorded);
      },
    );
    const [body] = bodies;
    assert.ok(body, '应当发过一次 PUT');
    assert.equal(JSON.parse(body).sizePx, 128);
    assert.equal(runtime.render(deps).draft?.sizePx, 128, '成功后草稿换成宿主回的权威值');
  });

  test('保存失败：返回 false 并报出宿主原因', async () => {
    const runtime = createRuntime();
    const { deps, messages } = makeDeps();
    let puts = 0;
    await withFetch(
      (url) => {
        if (url.endsWith('/skins')) return { status: 200, body: { items: [] } };
        if (url.endsWith('/session-fish')) {
          puts += 1;
          return puts === 1
            ? { status: 200, body: { settings: stored } }
            : { status: 400, body: { ok: false, message: 'bad-request' } };
        }
        return { status: 200, body: {} };
      },
      async () => {
        runtime.render(deps);
        runtime.flushEffects();
        await settle();
        const state = runtime.render(deps);
        assert.equal(await state.save(), false);
      },
    );
    assert.equal(messages[messages.length - 1], 'err:fish.saveFailed：bad-request');
  });

  test('重置：整份写默认值并回填', async () => {
    const runtime = createRuntime();
    const { deps } = makeDeps();
    const bodies: string[] = [];
    await withFetch(
      (url) => ({
        status: 200,
        body: url.endsWith('/skins')
          ? { items: [] }
          : { settings: url.endsWith('/skins') ? stored : DEFAULT_SESSION_FISH_SETTINGS },
      }),
      async (recorded) => {
        runtime.render(deps);
        runtime.flushEffects();
        await settle();
        const state = runtime.render(deps);
        assert.equal(await state.reset(), true);
        bodies.push(...recorded);
      },
    );
    assert.equal(JSON.parse(bodies[0]).sizePx, DEFAULT_SESSION_FISH_SETTINGS.sizePx);
    assert.equal(runtime.render(deps).draft?.sizePx, DEFAULT_SESSION_FISH_SETTINGS.sizePx);
  });
});
