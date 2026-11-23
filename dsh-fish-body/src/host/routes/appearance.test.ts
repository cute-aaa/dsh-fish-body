/**
 * 外观上报/查询端点（`POST /appearance/report`、`GET /appearance`）：形状校验与快照读写。
 *
 * 只测端点自己的判断与写入结果；渲染端什么时候上报、上报后提示词怎么用不在本文件范围
 * （见 host/chat-action 的 currentStateInstruction 与 host/appearance）。
 * 跑法：node --experimental-strip-types --test src/host/routes/appearance.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { handleAppearanceRoutes } from './appearance.ts';
import { AppearanceStore } from '../appearance.ts';
import type { RouteResult } from '../http.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';

/** 已有宠物（`main`）与一只不存在的。 */
const PETS = new Set(['main']);

function makeDeps(): { deps: PetRouteDeps; appearance: AppearanceStore } {
  const appearance = new AppearanceStore({ now: () => 777 });
  const deps = {
    appearance,
    // requirePet 的真实实现在 plugin/pet-lookup；这里只保留本领域用到的两档失败与新口径。
    requirePet: (params: URLSearchParams) => {
      const petId = String(params.get('pet') ?? '').trim();
      if (petId === '') {
        return { ok: false, res: { kind: 'json', status: 200, obj: { ok: false, reason: 'pet-required' } } };
      }
      if (!PETS.has(petId)) {
        return { ok: false, res: { kind: 'json', status: 200, obj: { ok: false, reason: 'unknown-pet' } } };
      }
      return { ok: true, petId, entry: 'main', conf: {}, pet: {} };
    },
  } as unknown as PetRouteDeps;
  return { deps, appearance };
}

/** 调一次端点。 */
function call(
  deps: PetRouteDeps,
  opts: { rest?: string; method?: string; body?: string; pet?: string } = {},
): Promise<RouteResult | undefined> {
  const { rest = 'appearance', method = 'GET', body, pet } = opts;
  const url = new URL('http://localhost/dsh-pet-7340/' + rest + (pet === undefined ? '' : '?pet=' + pet));
  const input: RouteInput = { url, rest, method, ...(body === undefined ? {} : { body }) };
  return handleAppearanceRoutes(deps, input);
}

/** 断言是 JSON 应答并取出状态码与响应体。 */
function asJson(result: RouteResult | undefined): { status: number; obj: Record<string, unknown> } {
  assert.ok(result !== undefined, '处理器应给出应答');
  assert.equal(result.kind, 'json');
  return { status: result.status, obj: result.obj as Record<string, unknown> };
}

describe('handleAppearanceRoutes —— 路径与方法', () => {
  test('非 appearance 路径 → undefined（交给下一个处理器）', async () => {
    const { deps } = makeDeps();
    assert.equal(await call(deps, { rest: 'other' }), undefined);
  });

  test('方法不对 → 405（查询只认 GET，上报只认 POST）', async () => {
    const { deps } = makeDeps();
    assert.equal(asJson(await call(deps, { rest: 'appearance', method: 'POST', body: '{}' })).status, 405);
    assert.equal(asJson(await call(deps, { rest: 'appearance/report', method: 'GET' })).status, 405);
  });
});

describe('handleAppearanceRoutes —— 上报', () => {
  test('请求体不是 JSON → 400 invalid-json', async () => {
    const { deps } = makeDeps();
    const { status, obj } = asJson(
      await call(deps, { rest: 'appearance/report', method: 'POST', body: '{ 坏', pet: 'main' }),
    );
    assert.equal(status, 400);
    assert.equal(obj.reason, 'invalid-json');
  });

  test('形状不对 → bad-request，且不写 store', async () => {
    const { deps, appearance } = makeDeps();
    const { obj } = asJson(
      await call(deps, { rest: 'appearance/report', method: 'POST', body: '{"expressions":"兔牙"}', pet: 'main' }),
    );
    assert.equal(obj.ok, false);
    assert.equal(obj.reason, 'bad-request');
    assert.equal(appearance.get('main'), undefined, '坏形状不该落进快照');
  });

  test('缺 pet → pet-required；未知宠物 → unknown-pet', async () => {
    const { deps } = makeDeps();
    const missing = asJson(await call(deps, { rest: 'appearance/report', method: 'POST', body: '{"expressions":[]}' }));
    assert.equal(missing.obj.reason, 'pet-required');
    const unknown = asJson(
      await call(deps, { rest: 'appearance/report', method: 'POST', body: '{"expressions":[]}', pet: 'nope' }),
    );
    assert.equal(unknown.obj.reason, 'unknown-pet');
  });

  test('合法上报：写进快照，回的是刚存下的那份', async () => {
    const { deps, appearance } = makeDeps();
    const { obj } = asJson(
      await call(deps, {
        rest: 'appearance/report',
        method: 'POST',
        body: '{"expressions":["兔牙","单片眼镜"],"action":"抚胸手打开"}',
        pet: 'main',
      }),
    );
    assert.equal(obj.ok, true);
    assert.deepEqual(obj.expressions, ['兔牙', '单片眼镜']);
    assert.deepEqual(appearance.get('main')?.expressions, ['兔牙', '单片眼镜']);
    assert.equal(appearance.get('main')?.action, '抚胸手打开');
  });
});

describe('handleAppearanceRoutes —— 查询', () => {
  test('还没上报过：reported=false（与「什么都没戴」区分开）', async () => {
    const { deps } = makeDeps();
    const { obj } = asJson(await call(deps, { pet: 'main' }));
    assert.equal(obj.ok, true);
    assert.equal(obj.reported, false);
    assert.deepEqual(obj.expressions, []);
  });

  test('上报过：reported=true，带回名单、动作与时刻', async () => {
    const { deps, appearance } = makeDeps();
    appearance.set('main', { expressions: ['兔牙'], action: '脱捕' });
    const { obj } = asJson(await call(deps, { pet: 'main' }));
    assert.equal(obj.reported, true);
    assert.deepEqual(obj.expressions, ['兔牙']);
    assert.equal(obj.action, '脱捕');
    assert.equal(obj.updatedAt, 777);
  });

  test('摘光后查：reported=true 且名单为空', async () => {
    const { deps, appearance } = makeDeps();
    appearance.set('main', { expressions: [] });
    const { obj } = asJson(await call(deps, { pet: 'main' }));
    assert.equal(obj.reported, true);
    assert.deepEqual(obj.expressions, []);
  });
});
