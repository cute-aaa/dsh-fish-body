/**
 * 插件自重启（src/client/settings/use-plugin-restart.ts）的契约测试。
 *
 * 这条 hook 存在的理由是「重启只有一个实现」，所以测试钉的是它的四件事：
 *   1. 有没有 `save` 决定「先存盘再重启」还是「直接重启」；
 *   2. 保存失败就**不许**重启（否则换掉了代码、丢掉了没落盘的改动）；
 *   3. 宿主回的两种生效方式各自对应一句提示，`null` 走失败提示；
 *   4. `onDone` 只在真的重启成功时调（调用方靠它清「需重启」计数）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { usePluginRestart } from './use-plugin-restart.ts';

/** 只按调用顺序分配状态槽的假 react（多次渲染共享同一批槽）。 */
function createRuntime() {
  const cells: Array<{ value: unknown }> = [];
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
  // useRef 只要一份稳定的盒子：每次渲染都返回同一个对象。
  const boxes = new Map<number, { current: unknown }>();
  let refCursor = 0;
  const useRef = ((initial: unknown) => {
    const slot = refCursor;
    refCursor += 1;
    if (!boxes.has(slot)) boxes.set(slot, { current: initial });
    return boxes.get(slot);
  }) as never;
  const rt = { useState, useRef, useCallback: ((fn: unknown) => fn) as never, t: (key: string) => key };
  return {
    rt,
    render(report: (feedback: { kind: string; text: string }) => void) {
      cursor = 0;
      refCursor = 0;
      // 测试夹具：按顺序调用一遍被测 hook，不是组件也不是自定义 hook。
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return usePluginRestart(rt, report as never);
    },
  };
}

/** 让「请求 + 两三个 await」跑完。 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** 换掉全局 fetch，跑完 restore（每个用例都要还原，否则会串到别的测试文件）。 */
async function withFetch(
  respond: () => { ok: boolean; body: unknown },
  run: (calls: () => number) => Promise<void>,
): Promise<void> {
  const previous = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (() => {
      calls += 1;
      const { ok, body } = respond();
      return Promise.resolve({ ok, json: async () => body } as Response);
    }) as typeof fetch;
    await run(() => calls);
  } finally {
    globalThis.fetch = previous;
  }
}

describe('usePluginRestart —— 重启只有一个实现', () => {
  test('不给 save：直接打 /plugin-restart，helper 模式如实说只重建了桌面窗口', async () => {
    await withFetch(
      () => ({ ok: true, body: { ok: true, mode: 'helper' } }),
      async (calls) => {
        const seen: string[] = [];
        const restart = createRuntime().render((feedback) => seen.push(feedback.kind + ':' + feedback.text));
        restart.restart();
        await settle();
        assert.equal(calls(), 1);
        assert.deepEqual(seen, [':restarting', 'ok:restartHelper']);
      },
    );
  });

  test('给了 save：先存盘再重启（顺序不能反）', async () => {
    await withFetch(
      () => ({ ok: true, body: { ok: true, mode: 'helper' } }),
      async () => {
        const order: string[] = [];
        const restart = createRuntime().render((feedback) => order.push(feedback.text));
        restart.restart({
          save: () => {
            order.push('save');
            return Promise.resolve(true);
          },
        });
        await settle();
        assert.deepEqual(order, ['save', 'restarting', 'restartHelper']);
      },
    );
  });

  test('保存失败：一次请求都不发，也不提示「正在重启」', async () => {
    await withFetch(
      () => ({ ok: true, body: { ok: true, mode: 'helper' } }),
      async (calls) => {
        const seen: string[] = [];
        const restart = createRuntime().render((feedback) => seen.push(feedback.text));
        restart.restart({ save: () => Promise.resolve(false) });
        await settle();
        assert.equal(calls(), 0, '保存失败不该重启');
        assert.deepEqual(seen, []);
      },
    );
  });

  test('hmr 模式：提示刷新页面，并把生效方式回给调用方', async () => {
    await withFetch(
      () => ({ ok: true, body: { ok: true, mode: 'hmr' } }),
      async () => {
        const seen: string[] = [];
        const done: string[] = [];
        const restart = createRuntime().render((feedback) => seen.push(feedback.text));
        restart.restart({ onDone: (mode) => done.push(mode) });
        await settle();
        assert.deepEqual(seen, ['restarting', 'restartHmr']);
        assert.deepEqual(done, ['hmr']);
      },
    );
  });

  test('宿主拒绝：报失败，且不触发 onDone（「需重启」计数要留着）', async () => {
    await withFetch(
      () => ({ ok: false, body: { ok: false } }),
      async () => {
        const seen: string[] = [];
        const done: string[] = [];
        const restart = createRuntime().render((feedback) => seen.push(feedback.kind + ':' + feedback.text));
        restart.restart({ onDone: (mode) => done.push(mode) });
        await settle();
        assert.deepEqual(seen, [':restarting', 'err:restartFailed']);
        assert.deepEqual(done, []);
      },
    );
  });
});
