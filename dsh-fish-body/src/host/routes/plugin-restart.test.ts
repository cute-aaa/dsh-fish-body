/**
 * 插件自重启端点的契约测试：有 HMR 走重新组合、没有 HMR 退化为重载桌面 Helper、方法不对 405。
 *
 * 「先回响应再触发」是这条端点的关键约束：用真实定时器等一小会儿再看副作用。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { handlePluginRestart } from './plugin-restart.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';

/** 造一份只带本端点所需字段的依赖。 */
function depsOf(hmr: unknown): { deps: PetRouteDeps; calls: string[] } {
  const calls: string[] = [];
  const deps = {
    ctx: { get: (name: string) => (name === 'hmr' ? hmr : undefined) },
    log: {
      info: (message: string) => calls.push('log:' + message),
      error: (message: string) => calls.push('error:' + message),
    },
    requestRestart: async () => {
      calls.push('requestRestart');
    },
  } as unknown as PetRouteDeps;
  return { deps, calls };
}

/** 造一个路由输入。 */
function inputOf(method: string): RouteInput {
  return { url: new URL('http://localhost/dsh-pet-7340/plugin-restart'), rest: 'plugin-restart', method };
}

describe('handlePluginRestart —— 插件自重启', () => {
  test('不是本端点：返回 undefined，交给后面的处理器', async () => {
    const { deps } = depsOf(undefined);
    assert.equal(await handlePluginRestart(deps, { ...inputOf('POST'), rest: 'state' }), undefined);
  });

  test('方法不对：405，不触发任何重启', async () => {
    const { deps, calls } = depsOf(undefined);
    const result = await handlePluginRestart(deps, inputOf('GET'));
    assert.equal(result?.kind === 'json' ? result.status : undefined, 405);
    assert.deepEqual(calls, []);
  });

  test('有 HMR：先回 mode=hmr，再异步重新组合（不等回调），并落一行结论日志', async () => {
    let reconciles = 0;
    const { deps, calls } = depsOf({
      reconcileProfile: async () => {
        reconciles += 1;
        return { pending: [{ url: 'file:///x.js' }], restartReason: undefined };
      },
    });
    const result = await handlePluginRestart(deps, inputOf('POST'));
    assert.deepEqual(result?.kind === 'json' ? result.obj : undefined, { ok: true, mode: 'hmr' });
    assert.equal(reconciles, 0, '响应必须早于重新组合：组合会拆掉本插件的路由');
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(reconciles, 1);
    assert.ok(
      calls.some((call) => call.startsWith('log:[fish-body] 插件重启完成 swapped=1')),
      '结论要落盘：' + JSON.stringify(calls),
    );
  });

  test('没有 HMR：退回重载桌面 Helper，并如实回 mode=helper', async () => {
    const { deps, calls } = depsOf(undefined);
    const result = await handlePluginRestart(deps, inputOf('POST'));
    assert.deepEqual(result?.kind === 'json' ? result.obj : undefined, { ok: true, mode: 'helper' });
    assert.deepEqual(calls, ['log:[fish-body] 插件重启请求 mode=helper', 'requestRestart']);
  });
});
