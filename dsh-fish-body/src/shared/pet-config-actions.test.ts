/**
 * 共享写配置出口的契约测试（src/shared/pet-config-actions.ts）。
 *
 * 钉四件事：五个意图各自打对端点与请求体（`size` 缺省要显式 `null`、音色不带宠物 id）、
 * 成品聚合原样交回、`200 + { ok:false }` 算失败、网络异常收敛成一句 message 不抛。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { postPetConfig, type PetConfigIntent } from './pet-config-actions.ts';

/** 一次被拦下的请求。 */
interface Captured {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

const captured: Captured[] = [];
const realFetch = globalThis.fetch;

/** 用桩替换 fetch：按脚本回一个响应（`status` + JSON 体），并记录请求。 */
function stubFetch(status: number, payload: unknown): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(input),
      method: String(init?.method ?? 'GET'),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

afterEach(() => {
  captured.length = 0;
  globalThis.fetch = realFetch;
});

test('display / renderer / model：端点与请求体照契约走，成品聚合原样交回', async () => {
  stubFetch(200, { pets: [{ id: 'main' }] });
  const merged = await postPetConfig('/dsh-pet-7340', 'main', { kind: 'display', display: 'web' });
  assert.deepEqual(captured[0], {
    url: '/dsh-pet-7340/pet-display',
    method: 'POST',
    body: { id: 'main', display: 'web' },
  });
  assert.deepEqual(merged, { ok: true, merged: { pets: [{ id: 'main' }] } });
});

test('size 缺省：请求体里显式 null（= 删掉该渲染方式的覆盖）', async () => {
  stubFetch(200, { pets: [] });
  await postPetConfig('/base/', 'main', { kind: 'size' });
  assert.equal(captured[0]?.url, '/base/pet-size', '尾斜杠要归一，别拼出 //pet-size');
  assert.deepEqual(captured[0]?.body, { id: 'main', size: null });
});

test('provider-voice：不打宠物 id，只回 providers', async () => {
  stubFetch(200, { ok: true, providers: [{ id: 'gsv', voice: 'klee' }] });
  const intent: PetConfigIntent = { kind: 'provider-voice', provider: 'gsv', voice: 'klee' };
  const result = await postPetConfig('/base', 'main', intent);
  assert.deepEqual(captured[0]?.body, { provider: 'gsv', voice: 'klee' });
  assert.deepEqual(result, { ok: true, providers: [{ id: 'gsv', voice: 'klee' }] });
});

test('业务失败：200 + { ok:false, reason } 算失败（不能当成品聚合用）', async () => {
  stubFetch(200, { ok: false, reason: 'bad-request', message: '未知音色：nope' });
  const result = await postPetConfig('/base', 'main', { kind: 'provider-voice', provider: 'gsv', voice: 'nope' });
  assert.deepEqual(result, { ok: false, message: '未知音色：nope' });
});

test('HTTP 500 / 网络异常 / 非 JSON：都收敛成 ok:false，不抛', async () => {
  stubFetch(500, {});
  assert.deepEqual(await postPetConfig('/b', 'p', { kind: 'model', model: 'x' }), { ok: false, message: 'HTTP 500' });

  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as typeof fetch;
  assert.deepEqual(await postPetConfig('/b', 'p', { kind: 'model', model: 'x' }), {
    ok: false,
    message: 'ECONNREFUSED',
  });

  globalThis.fetch = (async () => new Response('not json', { status: 200 })) as typeof fetch;
  assert.deepEqual(await postPetConfig('/b', 'p', { kind: 'model', model: 'x' }), {
    ok: false,
    message: '响应不是 JSON',
  });
});
