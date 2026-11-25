/**
 * `/rhythm` 路由的契约：两态校验、非法输入一律 bad-request、没配睡觉动画时提前拒绝、
 * 同态同 until 幂等、rhythm 缺失时让位给其它处理器。
 *
 * 这些是外部脚本会直接依赖的行为（「设两小时睡眠」是承诺），所以逐条钉住。
 * @module dsh-fish-body/src/host/routes/rhythm.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { RhythmStore } from '../rhythm.ts';
import { handleRhythmRoutes } from './rhythm.ts';
import type { PetRouteDeps } from './types.ts';
import type { RouteResult } from '../http.ts';

/** 一套可用的睡觉动画配置。 */
const ANIM = { sleep: [{ start: ['睡觉-开始'], loop: ['睡觉-循环'], end: ['睡觉-起来'] }] };

/** 造依赖桩；`animations` 传 undefined 表示这条宠物没配睡觉动画。 */
function depsWith(rhythm: RhythmStore, animations: unknown = ANIM): { deps: PetRouteDeps } {
  const deps = {
    configPaths: {},
    requirePet: () => ({ ok: true, petId: 'main', conf: { animations } }),
    rhythm,
  } as unknown as PetRouteDeps;
  return { deps };
}

/** 调一次路由。 */
function call(deps: PetRouteDeps, method: string, body?: string, rest = 'rhythm'): Promise<RouteResult | undefined> {
  return handleRhythmRoutes(deps, {
    url: new URL('http://localhost/rhythm?pet=main'),
    rest,
    method,
    ...(body === undefined ? {} : { body }),
  });
}

/** 断言是 json 结果并取出对象。 */
function bodyOf(result: RouteResult | undefined): Record<string, unknown> {
  assert.ok(result !== undefined && result.kind === 'json', '应是 json 应答');
  return result.obj as Record<string, unknown>;
}

describe('/rhythm', () => {
  test('GET 没设过 → rhythm: null', async () => {
    const store = new RhythmStore();
    const { deps } = depsWith(store);
    const body = bodyOf(await call(deps, 'GET'));
    assert.equal(body.ok, true);
    assert.equal(body.pet, 'main');
    assert.equal(body.rhythm, null);
  });

  test('POST sleeping → changed:true，GET 能查到状态与 reason', async () => {
    const store = new RhythmStore();
    const { deps } = depsWith(store);
    const post = bodyOf(await call(deps, 'POST', JSON.stringify({ state: 'sleeping', reason: '作息' })));
    assert.equal(post.ok, true);
    assert.equal(post.changed, true);
    assert.equal((post.rhythm as { state: string }).state, 'sleeping');

    const got = bodyOf(await call(deps, 'GET'));
    assert.equal((got.rhythm as { reason: string }).reason, '作息');
    assert.equal((got.rhythm as { source: string }).source, 'external');
  });

  test('同态同 until 重复 POST → changed:false（幂等，不重播动画）', async () => {
    const store = new RhythmStore();
    const { deps } = depsWith(store);
    const until = Date.now() + 3600_000;
    await call(deps, 'POST', JSON.stringify({ state: 'sleeping', until }));
    const again = bodyOf(await call(deps, 'POST', JSON.stringify({ state: 'sleeping', until })));
    assert.equal(again.changed, false);
  });

  test('until 接受 ISO 字符串，也接受毫秒数字', async () => {
    const store = new RhythmStore();
    const { deps } = depsWith(store);
    const iso = new Date(Date.now() + 1000).toISOString();
    const body = bodyOf(await call(deps, 'POST', JSON.stringify({ state: 'sleeping', until: iso })));
    assert.equal(typeof (body.rhythm as { until: number }).until, 'number');
    const ms = bodyOf(await call(deps, 'POST', JSON.stringify({ state: 'sleeping', until: 1_900_000_000_000 })));
    assert.equal((ms.rhythm as { until: number }).until, 1_900_000_000_000);
  });

  test('source 可指定 user', async () => {
    const store = new RhythmStore();
    const { deps } = depsWith(store);
    const body = bodyOf(await call(deps, 'POST', JSON.stringify({ state: 'awake', source: 'user' })));
    assert.equal((body.rhythm as { source: string }).source, 'user');
  });

  test('非法 state / until / source / 非 JSON / 非对象 → bad-request', async () => {
    const store = new RhythmStore();
    const { deps } = depsWith(store);
    const cases: (string | undefined)[] = [
      JSON.stringify({ state: 'hidden' }),
      '{}',
      JSON.stringify({ state: 'sleeping', until: '不是时间' }),
      JSON.stringify({ state: 'sleeping', source: 'robot' }),
      JSON.stringify({ state: 'sleeping', reason: 42 }),
      '{ 坏 json',
      '[]',
    ];
    for (const body of cases) {
      const result = bodyOf(await call(deps, 'POST', body));
      assert.equal(result.ok, false, String(body));
      assert.equal(result.reason, 'bad-request', String(body));
    }
  });

  test('没配 animations.sleep → sleeping 被拒（no-sleep-animations），但 awake 仍可用', async () => {
    const store = new RhythmStore();
    const { deps } = depsWith(store, {});
    const sleep = bodyOf(await call(deps, 'POST', JSON.stringify({ state: 'sleeping' })));
    assert.equal(sleep.ok, false);
    assert.equal(sleep.reason, 'no-sleep-animations');
    const awake = bodyOf(await call(deps, 'POST', JSON.stringify({ state: 'awake' })));
    assert.equal(awake.ok, true);
  });

  test('method 不是 GET / POST → 405', async () => {
    const store = new RhythmStore();
    const { deps } = depsWith(store);
    const result = await call(deps, 'DELETE');
    assert.ok(result !== undefined);
    assert.ok(result.kind === 'json', '405 也走 json 信封');
    assert.equal(result.status, 405);
  });

  test('rhythm 缺失（精简桩）→ undefined，交给后续处理器兜底', async () => {
    const deps = {
      configPaths: {},
      requirePet: () => ({ ok: true, petId: 'main', conf: {} }),
    } as unknown as PetRouteDeps;
    assert.equal(await call(deps, 'GET'), undefined);
  });

  test('rest 不匹配 → undefined（不拦别的前缀）', async () => {
    const store = new RhythmStore();
    const { deps } = depsWith(store);
    assert.equal(await call(deps, 'GET', undefined, 'sleep'), undefined);
  });
});
