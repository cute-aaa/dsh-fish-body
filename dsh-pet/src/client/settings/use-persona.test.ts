/**
 * 设置页人设/渲染四个数据层的行为测试（`use-persona-*` / `use-render-resources`）。
 *
 * 契约：
 *   1. 读失败降级成「只有内置编辑」并报一条 Feedback，不抛；
 *   2. 切 `petId` 会重发 `?pet=`，旧的迟到响应被丢弃；
 *   3. 应用成功后把宿主写进配置的那一份交给 `onApplied`（只这一只）；
 *   4. 导入预览阶段只有一次 `POST /persona/import`，`cancel()` 之后请求数不变；
 *   5. 润色 `cancel()` 不调用 `onChange`；
 *   6. 超限文件在客户端被拦、`fetch` 未被调用；
 *   7. `reload()` 会重发一次请求；
 *   8. 扫描 / 「无变化」/ 删除被引用的回执文案逐条可断言（验收 4 的可观察性）。
 *
 * 用一个「状态槽 + 依赖比较」的假 react 跑 hook；fetch 用可编程桩，记录每次调用。
 * @module dsh-fish-body/src/client/settings/use-persona.test
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { usePersonaCharacters } from './use-persona-characters.ts';
import { IMPORT_TOTAL_MAX_BYTES, usePersonaImport, type ImportFileLike } from './use-persona-import.ts';
import { usePersonaPolish } from './use-persona-polish.ts';
import { useRenderResources } from './use-render-resources.ts';
import type { Feedback } from './feedback.ts';

/** 一次 fetch 调用的记录。 */
interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** 假 react：状态槽跨渲染共享，effect 按「依赖数组逐项 Object.is」决定是否重跑。 */
function createRuntime() {
  const cells: unknown[] = [];
  const effects = new Map<number, { deps?: readonly unknown[]; cleanup?: (() => void) | undefined }>();
  let cursor = 0;
  let queued: Array<{ index: number; run: () => void }> = [];

  const useState = ((init: unknown) => {
    const index = cursor;
    cursor += 1;
    if (!(index in cells)) cells[index] = init;
    const set = (next: unknown): void => {
      cells[index] = typeof next === 'function' ? (next as (previous: unknown) => unknown)(cells[index]) : next;
    };
    return [cells[index], set];
  }) as never;

  const useEffect = ((effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = cursor;
    cursor += 1;
    queued.push({
      index,
      run: () => {
        const previous = effects.get(index);
        const sameDeps =
          previous?.deps !== undefined &&
          deps !== undefined &&
          deps.length === previous.deps.length &&
          deps.every((item, i) => Object.is(item, previous.deps?.[i]));
        if (sameDeps) return;
        previous?.cleanup?.();
        const cleanup = effect();
        effects.set(index, { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined });
      },
    });
  }) as never;

  return {
    rt: { useState, useEffect, t: (key: string) => key },
    /** 跑一次渲染并执行本轮排队的 effect。 */
    render<T>(run: () => T): T {
      cursor = 0;
      queued = [];
      const value = run();
      for (const item of queued.splice(0)) item.run();
      return value;
    },
    unmount(): void {
      for (const slot of effects.values()) slot.cleanup?.();
      effects.clear();
    },
  };
}

/** 让挂起的 promise 链跑完。 */
async function settle(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** 把一次 fetch 的响应简化成桩要返回的形状。 */
interface Answer {
  status?: number;
  body: unknown;
  /** 延迟多少毫秒才回（测「迟到响应」）。 */
  delayMs?: number;
}

/** 装上可编程 fetch 桩；handler 按 URL 决定回什么（未命中回 404）。 */
function stubFetch(handler: (call: Call) => Answer): { calls: Call[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: String(init?.method ?? 'GET'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const answer = handler(call);
    const respond = (): Response =>
      ({
        ok: (answer.status ?? 200) >= 200 && (answer.status ?? 200) < 300,
        status: answer.status ?? 200,
        json: async () => answer.body,
      }) as Response;
    if (answer.delayMs === undefined) return Promise.resolve(respond());
    return new Promise((resolve) => setTimeout(() => resolve(respond()), answer.delayMs));
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const restores: Array<() => void> = [];
afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
});

/** 记录型反馈出口。 */
function makeReport(): { report: (feedback: Feedback) => void; messages: string[] } {
  const messages: string[] = [];
  return {
    report: (feedback) => {
      if (feedback.text !== '') messages.push(feedback.kind + ':' + feedback.text);
    },
    messages,
  };
}

/** 一个文件形状的假对象（只喂 `arrayBuffer` 与大小）。 */
const fileOf = (name: string, size: number): ImportFileLike => ({
  name,
  size,
  arrayBuffer: async () => new ArrayBuffer(size),
});

describe('usePersonaCharacters —— 降级 / 作用域切换 / 应用回填', () => {
  test('读失败降级成「只有内置编辑」并报一条 Feedback，不抛', async () => {
    const stub = stubFetch(() => ({ status: 500, body: {} }));
    restores.push(stub.restore);
    const { rt, render } = createRuntime();
    const { report, messages } = makeReport();
    render(() => usePersonaCharacters(rt, { petId: 'a', report }));
    await settle();
    const view = render(() => usePersonaCharacters(rt, { petId: 'a', report }));
    assert.deepEqual(
      view.sources.map((item) => item.id),
      ['editor'],
    );
    assert.equal(view.degraded, true);
    assert.equal(view.ready, true);
    assert.deepEqual(messages, ['err:personaLoadFailed']);
  });

  test('切 petId 重发 ?pet=，旧的迟到响应被丢弃', async () => {
    const stub = stubFetch((call) => {
      if (call.url.includes('/persona/sources')) {
        const petId = new URL(call.url, 'http://localhost').searchParams.get('pet');
        return {
          body: {
            ok: true,
            sources: [],
            characters: { total: 0, skipped: [] },
            pet: { id: petId, entry: 'main', writable: true, character: null },
          },
          delayMs: petId === 'a' ? 30 : 0,
        };
      }
      return { body: { ok: true, characters: [], skipped: [] } };
    });
    restores.push(stub.restore);
    const { rt, render } = createRuntime();
    const { report } = makeReport();

    render(() => usePersonaCharacters(rt, { petId: 'a', report }));
    render(() => usePersonaCharacters(rt, { petId: 'b', report }));
    await settle(6);
    const view = render(() => usePersonaCharacters(rt, { petId: 'b', report }));
    assert.equal(view.scope?.id, 'b', '先发的 a 迟到后不得覆盖 b');
    assert.ok(
      stub.calls.some((call) => call.url.includes('?pet=b')),
      '切实例后必须重发 ?pet=b',
    );
    assert.ok(
      stub.calls.some((call) => call.url.includes('?pet=a')),
      'a 那一次也确实发过（随后被丢弃）',
    );
  });

  test('应用成功后把宿主写进配置的那一份交给 onApplied（只这一只）', async () => {
    let applied: { petId: string; fields: Record<string, unknown> } | null = null;
    const stub = stubFetch((call) => {
      if (call.url.endsWith('/persona/characters/apply')) {
        return { body: { ok: true, pet: 'a', characterId: 'X', chars: 5, wroteName: true } };
      }
      if (call.url.endsWith('/config')) {
        return {
          body: {
            ok: true,
            main: { pets: [{ id: 'a', whisperPrompt: '角色正文', personaCharacter: 'X', name: '鱼生' }] },
          },
        };
      }
      if (call.url.includes('/persona/characters')) return { body: { ok: true, characters: [], skipped: [] } };
      return {
        body: {
          ok: true,
          sources: [],
          characters: { total: 0, skipped: [] },
          pet: { id: 'a', entry: 'main', writable: true, character: null },
        },
      };
    });
    restores.push(stub.restore);
    const { rt, render } = createRuntime();
    const { report } = makeReport();
    const view = render(() =>
      usePersonaCharacters(rt, {
        petId: 'a',
        report,
        onApplied: (petId, fields) => {
          applied = { petId, fields: { ...fields } };
        },
      }),
    );
    await settle();
    const outcome = await view.apply('X', true);
    assert.equal(outcome, 'applied');
    assert.deepEqual(applied, {
      petId: 'a',
      fields: { whisperPrompt: '角色正文', name: '鱼生', personaCharacter: 'X' },
    });
  });
});

describe('usePersonaImport —— 预览零写盘 / 取消不发请求 / 超限拦截', () => {
  test('选两个文件只发一次 /persona/import；cancel() 后请求数不变、预览清空', async () => {
    const stub = stubFetch((call) => {
      if (call.url.endsWith('/persona/import')) {
        return {
          body: {
            ok: true,
            files: [
              { name: 'a.md', kind: 'md', chars: 4 },
              { name: 'b.txt', kind: 'txt', chars: 2 },
            ],
            preview: {
              name: '鱼生',
              description: '蓝色大肥鱼',
              personality: '',
              scenario: '',
              first_mes: '',
              mes_example: '',
              system_prompt: '',
              post_history_instructions: '',
              text: '人设：蓝色大肥鱼',
              chars: 9,
            },
          },
        };
      }
      return { body: { ok: true } };
    });
    restores.push(stub.restore);
    const { rt, render } = createRuntime();
    const { report } = makeReport();
    const state = render(() => usePersonaImport(rt, { petId: 'a', report }));

    await state.pick([fileOf('a.md', 8), fileOf('b.txt', 4)]);
    const afterPick = stub.calls.length;
    assert.equal(afterPick, 1, '预览阶段只该有一次请求');
    const withPreview = render(() => usePersonaImport(rt, { petId: 'a', report }));
    assert.equal(withPreview.preview?.name, '鱼生');

    withPreview.cancel();
    assert.equal(stub.calls.length, afterPick, '取消不发任何请求');
    const afterCancel = render(() => usePersonaImport(rt, { petId: 'a', report }));
    assert.equal(afterCancel.preview, null);
  });

  test('预算边界：两份 400 KiB 与单个 768 KiB 在客户端就被拦，恰好 768 KiB−4 KiB 才放行', async () => {
    const stub = stubFetch(() => ({ body: { ok: true, preview: { name: 'x', text: 'x' } } }));
    restores.push(stub.restore);
    const runtime = createRuntime();
    const reported = makeReport();
    const state = runtime.render(() => usePersonaImport(runtime.rt, { petId: 'a', report: reported.report }));

    // 两份 400 KiB = 800 KiB：base64 后请求体 1,092,321 字节，必被 413 —— 必须在客户端拦住。
    await state.pick([fileOf('a.txt', 400 * 1024), fileOf('b.txt', 400 * 1024)]);
    assert.equal(stub.calls.length, 0, '合计超限不发请求');
    assert.deepEqual(reported.messages, ['err:personaImportTooLarge']);

    // 单个 768 KiB：体长 1,048,629（4*ceil(786432/3)）也超 1 MiB —— 同样拦。
    await state.pick([fileOf('big.txt', 768 * 1024)]);
    assert.equal(stub.calls.length, 0, '单个 768 KiB 也不发');
    assert.equal(reported.messages.length, 2);

    // 预算内（恰好 768 KiB − 4 KiB）：体长约 1,043,169，允许发送。
    await state.pick([fileOf('edge.txt', IMPORT_TOTAL_MAX_BYTES)]);
    assert.equal(stub.calls.length, 1, '预算内的边角值要放行');
    assert.equal(reported.messages.length, 2, '放行时不再报超限');
  });

  test('单个 800 KiB 超过单文件上限，同样不发请求', async () => {
    const stub = stubFetch(() => ({ body: { ok: true } }));
    restores.push(stub.restore);
    const runtime = createRuntime();
    const reported = makeReport();
    const state = runtime.render(() => usePersonaImport(runtime.rt, { petId: 'a', report: reported.report }));
    await state.pick([fileOf('big.txt', 800 * 1024)]);
    assert.equal(stub.calls.length, 0);
    assert.deepEqual(reported.messages, ['err:personaImportTooLarge']);
  });
});

describe('usePersonaPolish —— 取消不写草稿', () => {
  test('polish 出预览；cancel 不调用 onChange；apply 才写草稿', async () => {
    const stub = stubFetch(() => ({ body: { ok: true, text: '润色后的正文' } }));
    restores.push(stub.restore);
    const { rt, render } = createRuntime();
    const { report } = makeReport();
    const changes: string[] = [];
    const state = render(() =>
      usePersonaPolish(rt, {
        petId: 'a',
        report,
        onChange: (patch) => changes.push(patch.whisperPrompt),
      }),
    );
    await state.polish('原文');
    let view = render(() =>
      usePersonaPolish(rt, { petId: 'a', report, onChange: (patch) => changes.push(patch.whisperPrompt) }),
    );
    assert.equal(view.preview, '润色后的正文');

    view.cancel();
    view = render(() =>
      usePersonaPolish(rt, { petId: 'a', report, onChange: (patch) => changes.push(patch.whisperPrompt) }),
    );
    assert.equal(view.preview, null);
    assert.deepEqual(changes, [], '取消不得写草稿');

    await view.polish('原文');
    view = render(() =>
      usePersonaPolish(rt, { petId: 'a', report, onChange: (patch) => changes.push(patch.whisperPrompt) }),
    );
    view.apply();
    assert.deepEqual(changes, ['润色后的正文']);
  });
});

describe('useRenderResources —— reload 重发请求', () => {
  test('首次拉一次；reload() 再拉一次', async () => {
    const bucket = { status: 'ok', dir: '/x', count: 0, items: [], expect: [], missingFiles: [] };
    const stub = stubFetch(() => ({
      body: { root: 'main', renderers: { layered: bucket, live2d: bucket, webm: bucket } },
    }));
    restores.push(stub.restore);
    const { rt, render } = createRuntime();
    const deps = { assetRoot: 'main' };
    render(() => useRenderResources(rt, deps));
    await settle();
    const view = render(() => useRenderResources(rt, deps));
    assert.equal(view.resources?.root, 'main');
    assert.equal(stub.calls.length, 1);
    view.reload();
    render(() => useRenderResources(rt, deps));
    await settle();
    assert.equal(stub.calls.length, 2, '重新扫描 = 再发一次 GET');
  });
});

describe('usePersonaCharacters —— 覆盖提示（返工二）', () => {
  /** 装好 apply + 回读 /config 的桩：宿主把正文换成「角色正文」。 */
  const stubApply = (whisperPrompt: string) =>
    stubFetch((call) => {
      if (call.url.includes('/persona/sources')) {
        return {
          body: {
            ok: true,
            sources: [],
            characters: { total: 1, skipped: [] },
            pet: { id: 'a', entry: 'main', writable: true, character: 'X' },
          },
        };
      }
      if (call.url.includes('/persona/characters') && call.method === 'GET') {
        return {
          body: {
            ok: true,
            characters: [
              {
                id: 'X',
                name: '鱼生',
                source: { kind: 'soul-card', id: 'fish-soul', path: 'a.json' },
                importedAt: '',
                chars: 4,
                appliedTo: [],
              },
            ],
            skipped: [],
          },
        };
      }
      if (call.url.endsWith('/persona/characters/apply')) {
        return { body: { ok: true, pet: 'a', characterId: 'X', chars: 4, wroteName: true } };
      }
      if (call.url.endsWith('/config')) {
        return { body: { main: { pets: [{ id: 'a', whisperPrompt, personaCharacter: 'X', name: '鱼生' }] } } };
      }
      return { body: { ok: true } };
    });

  test('草稿非空且与角色正文不同 → 状态行说「已覆盖」', async () => {
    const stub = stubApply('角色正文');
    restores.push(stub.restore);
    const { rt, render } = createRuntime();
    const reported = makeReport();
    const view = render(() => usePersonaCharacters(rt, { petId: 'a', report: reported.report }));
    await settle();
    await view.apply('X', true, '我未保存的草稿');
    assert.ok(reported.messages.includes('ok:personaApplyOverwrote'), '要明说覆盖了未保存的人设');
  });

  test('草稿为空 → 普通成功文案，不误报覆盖', async () => {
    const stub = stubApply('角色正文');
    restores.push(stub.restore);
    const { rt, render } = createRuntime();
    const reported = makeReport();
    const view = render(() => usePersonaCharacters(rt, { petId: 'a', report: reported.report }));
    await settle();
    await view.apply('X', true, '');
    assert.ok(reported.messages.includes('ok:personaApplyDone'));
    assert.equal(reported.messages.includes('ok:personaApplyOverwrote'), false);
  });
});

describe('usePersonaCharacters —— 回执文案（验收 4：扫描 / 无变化 / 删除被引用）', () => {
  /** 一个最小可用桩：来源与角色库都成功，配置里只有当前这一只。 */
  function stubAll(over: { scan?: Answer; apply?: Answer; remove?: Answer } = {}) {
    return stubFetch((call) => {
      if (call.url.endsWith('/persona/scan')) {
        return (
          over.scan ?? {
            body: { ok: true, source: 'fish-soul', installed: true, scanned: 2, imported: [], skipped: [] },
          }
        );
      }
      if (call.url.endsWith('/persona/characters/apply')) {
        return over.apply ?? { body: { ok: true, pet: 'a', characterId: 'X', chars: 5, wroteName: true } };
      }
      if (call.method === 'DELETE') return over.remove ?? { body: { ok: true, deleted: 'X' } };
      if (call.url.endsWith('/config')) {
        return { body: { ok: true, main: { pets: [{ id: 'a', whisperPrompt: '角色正文', personaCharacter: 'X' }] } } };
      }
      if (call.url.includes('/persona/characters')) return { body: { ok: true, characters: [], skipped: [] } };
      return {
        body: {
          ok: true,
          sources: [],
          characters: { total: 0, skipped: [] },
          pet: { id: 'a', entry: 'main', writable: true, character: null },
        },
      };
    });
  }

  test('扫描 2 个 → 「扫描到 N 个」；0 个 → 「什么也没扫到」；失败 → 服务端文案', async () => {
    const two = stubAll();
    restores.push(two.restore);
    const { rt, render } = createRuntime();
    const reported = makeReport();
    let view = render(() => usePersonaCharacters(rt, { petId: 'a', report: reported.report }));
    await settle();
    assert.deepEqual(await view.scan('fish-soul'), { scanned: 2, imported: [], skipped: [] });
    assert.deepEqual(reported.messages, ['ok:personaScanDone']);

    const none = stubAll({
      scan: { body: { ok: true, source: 'fish-soul', installed: true, scanned: 0, imported: [], skipped: [] } },
    });
    restores.push(none.restore);
    const quiet = makeReport();
    const runtime = createRuntime();
    view = runtime.render(() => usePersonaCharacters(runtime.rt, { petId: 'a', report: quiet.report }));
    await settle();
    await view.scan('fish-soul');
    assert.deepEqual(quiet.messages, ['ok:personaScanNothing']);

    const failed = stubAll({
      scan: {
        body: { ok: false, reason: 'persona-source-unavailable', message: '来源「dsh-soul」还没有可扫描的产物' },
      },
    });
    restores.push(failed.restore);
    const bad = makeReport();
    const rt3 = createRuntime();
    view = rt3.render(() => usePersonaCharacters(rt3.rt, { petId: 'a', report: bad.report }));
    await settle();
    assert.equal(await view.scan('dsh-soul'), null);
    assert.deepEqual(bad.messages, ['err:来源「dsh-soul」还没有可扫描的产物']);
  });

  test('应用返回 unchanged → 状态行说「无变化」，返回值是 unchanged', async () => {
    const stub = stubAll({
      apply: { body: { ok: true, pet: 'a', characterId: 'X', chars: 5, wroteName: false, unchanged: true } },
    });
    restores.push(stub.restore);
    const { rt, render } = createRuntime();
    const reported = makeReport();
    const view = render(() => usePersonaCharacters(rt, { petId: 'a', report: reported.report }));
    await settle();
    assert.equal(await view.apply('X', true, ''), 'unchanged');
    assert.deepEqual(reported.messages, ['ok:personaApplyUnchanged']);
  });

  test('删除被引用角色 → 服务端文案原样显示并返回 false；删成功 → 「已删除」', async () => {
    const blocked = stubAll({
      remove: {
        body: { ok: false, reason: 'character-in-use', message: '这个角色正被宠物引用，先换成别的角色再删' },
      },
    });
    restores.push(blocked.restore);
    const { rt, render } = createRuntime();
    const reported = makeReport();
    let view = render(() => usePersonaCharacters(rt, { petId: 'a', report: reported.report }));
    await settle();
    assert.equal(await view.remove('X'), false);
    assert.deepEqual(reported.messages, ['err:这个角色正被宠物引用，先换成别的角色再删']);

    const ok = stubAll();
    restores.push(ok.restore);
    const done = makeReport();
    const runtime = createRuntime();
    view = runtime.render(() => usePersonaCharacters(runtime.rt, { petId: 'a', report: done.report }));
    await settle();
    assert.equal(await view.remove('X'), true);
    assert.deepEqual(done.messages, ['ok:personaRemoveDone']);
  });
});
