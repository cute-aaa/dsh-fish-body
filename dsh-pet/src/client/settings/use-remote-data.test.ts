/**
 * 页面级远端数据（src/client/settings/use-remote-data.ts）的契约测试。
 *
 * 只钉新加的那条路：**候选模型清单能就地重拉**。
 * 过去它只在挂载时拉一次，失败文案写着「刷新页面可重试」——整页刷新会把别处没保存的改动一起丢掉。
 * 顺带钉住「卸载后不写状态」这条老约束：重拉是用户点出来的，回到一个已经卸掉的组件上写状态会警告。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { useRemoteData } from './use-remote-data.ts';

/** 一次响应。 */
interface Reply {
  readonly ok: boolean;
  readonly body: unknown;
}

/**
 * 假 react：状态按调用顺序分配槽位，`useEffect` 只在**首次渲染**执行（真实 React 里依赖不变就只跑一次），
 * `useRef` 给稳定的盒子。重渲染靠 `render()` 把游标归零。
 */
function createRuntime() {
  const cells: Array<{ value: unknown }> = [];
  let cursor = 0;
  let firstPass = true;
  const cleanups: Array<() => void> = [];
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
  const boxes = new Map<number, { current: unknown }>();
  let refCursor = 0;
  const useRef = ((initial: unknown) => {
    const slot = refCursor;
    refCursor += 1;
    if (!boxes.has(slot)) boxes.set(slot, { current: initial });
    return boxes.get(slot);
  }) as never;
  const useEffect = ((fn: () => void | (() => void)) => {
    if (!firstPass) return;
    const cleanup = fn();
    if (typeof cleanup === 'function') cleanups.push(cleanup);
  }) as never;
  return {
    rt: { useState, useRef, useCallback: ((fn: unknown) => fn) as never, useEffect },
    render() {
      cursor = 0;
      refCursor = 0;
      // 测试夹具：按顺序调用一遍被测 hook，不是组件也不是自定义 hook。
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const view = useRemoteData(this.rt);
      firstPass = false;
      return view;
    },
    unmount(): void {
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/**
 * 换掉全局 fetch：`/config/meta` 恒成功，`/models` 依次取 `replies` 里的下一个。
 *
 * @param replies - 每次 `/models` 的应答；用完后一直重复最后一个。
 * @param run - 用例主体，拿到请求计数。
 */
async function withFetch(replies: readonly Reply[], run: (calls: { meta: number; models: number }) => Promise<void>) {
  const previous = globalThis.fetch;
  const calls = { meta: 0, models: 0 };
  let index = 0;
  try {
    globalThis.fetch = ((url: string) => {
      if (url.includes('/config/meta')) {
        calls.meta += 1;
        return Promise.resolve({ ok: true, json: async () => ({ root: 'D:/u/fish-body', layout: [] }) } as Response);
      }
      calls.models += 1;
      const next = replies[Math.min(index, replies.length - 1)];
      index += 1;
      return Promise.resolve({ ok: next.ok, json: async () => next.body } as Response);
    }) as unknown as typeof fetch;
    await run(calls);
  } finally {
    globalThis.fetch = previous;
  }
}

describe('useRemoteData —— 候选模型清单可就地重拉', () => {
  test('首次失败 → 重拉成功：失败标志清掉，清单落位', async () => {
    await withFetch(
      [
        { ok: false, body: {} },
        { ok: true, body: { providers: [{ id: 'p', models: [{ id: 'm' }] }] } },
      ],
      async (calls) => {
        const runtime = createRuntime();
        runtime.render();
        await settle();
        const failed = runtime.render();
        assert.equal(calls.models, 1);
        assert.equal(failed.catalogFailed, true);
        assert.equal(failed.catalog, null);

        failed.reloadCatalog();
        await settle();
        const ok = runtime.render();
        assert.equal(calls.models, 2, '重拉要真的再请求一次');
        assert.equal(ok.catalogFailed, false, '重拉成功要清掉失败标志');
        assert.deepEqual(ok.catalog, [{ id: 'p', models: [{ id: 'm' }] }]);
        assert.equal(ok.catalogLoading, false);
      },
    );
  });

  test('重拉中置 loading，供卡头按钮置灰', async () => {
    await withFetch([{ ok: true, body: { providers: [] } }], async () => {
      const runtime = createRuntime();
      runtime.render();
      await settle();
      const view = runtime.render();
      view.reloadCatalog();
      // 请求还没回来：这一次渲染就该看见 loading。
      assert.equal(runtime.render().catalogLoading, true);
      await settle();
      assert.equal(runtime.render().catalogLoading, false);
    });
  });

  test('卸载后再回来的响应不写状态（重拉也照同一条规则）', async () => {
    await withFetch([{ ok: true, body: { providers: [{ id: 'late' }] } }], async () => {
      const runtime = createRuntime();
      const view = runtime.render();
      view.reloadCatalog();
      runtime.unmount();
      await settle();
      // 卸载后组件已不在：迟到的响应不该把清单写进去（真 React 里那会是一条
      // 「setState on unmounted component」警告，而这里连槽位都不该被改动）。
      assert.equal(runtime.render().catalog, null);
      assert.equal(runtime.render().catalogFailed, false);
    });
  });
});
