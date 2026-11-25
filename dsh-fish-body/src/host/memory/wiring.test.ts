/**
 * 记忆接线与两个新端点的契约：单槽不抢占、`GET /memory` 区分三种情况、`/coexist` 只报告不擅自改行为。
 *
 * `body-only` 的实效（停周期碎碎念）在 `chat-memory` 侧，这里只钉端点与接线。
 * @module dsh-fish-body/src/host/memory/wiring.test
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NATIVE_MEMORY_ID,
  activeChatMemoryProvider,
  registerChatMemoryProvider,
  resetChatMemoryProviders,
} from '../chat-memory-provider.ts';
import { resetMemoryStatus } from './status.ts';
import { wireExternalMemory } from '../plugin/external-memory.ts';
import { createCoexistStore } from '../plugin/coexist.ts';
import { handleCoexistRoutes } from '../routes/coexist.ts';
import { handleMemoryRoutes } from '../routes/memory.ts';
import type { PetRouteDeps } from '../routes/types.ts';
import type { RouteResult } from '../http.ts';

const ROOT = mkdtempSync(join(tmpdir(), 'mem-wiring-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

let seq = 0;
function dshRoot(): string {
  seq += 1;
  const dir = join(ROOT, 'case' + String(seq));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 记日志的桩。 */
const log = { info: (): void => undefined, warn: (): void => undefined };

beforeEach(() => {
  resetChatMemoryProviders();
  resetMemoryStatus();
});

/** 调一次路由并取出 json 对象。 */
async function jsonOf(promise: Promise<RouteResult | undefined>): Promise<Record<string, unknown>> {
  const result = await promise;
  assert.ok(result !== undefined && result.kind === 'json', '应是 json 应答');
  return result.obj as Record<string, unknown>;
}

const depsWithCoexist = (coexist: ReturnType<typeof createCoexistStore>): PetRouteDeps =>
  ({ coexist }) as unknown as PetRouteDeps;

describe('wireExternalMemory', () => {
  test('装了 rofm（memory/ 有 md）→ 注册进槽，状态可见', async () => {
    const dshHome = dshRoot();
    mkdirSync(join(dshHome, 'dsh-rofm', 'memory'), { recursive: true });
    writeFileSync(join(dshHome, 'dsh-rofm', 'memory', '2026-11-25.md'), '- 旧事\n', 'utf8');

    const wiring = wireExternalMemory({ log, dshHome });
    assert.equal(wiring.providerId, 'dsh-rofm');
    assert.equal(activeChatMemoryProvider()?.id, 'dsh-rofm');

    const view = await jsonOf(
      handleMemoryRoutes({} as PetRouteDeps, {
        url: new URL('http://localhost/memory'),
        rest: 'memory',
        method: 'GET',
      }),
    );
    assert.equal(view.ok, true);
    assert.equal((view.provider as { id: string }).id, 'dsh-rofm');
    const candidates = view.candidates as { id: string; installed: boolean }[];
    assert.equal(candidates.find((item) => item.id === 'dsh-rofm')?.installed, true);
    assert.equal(candidates.find((item) => item.id === 'dsh-suzu-memory')?.installed, false);
    wiring.dispose();
    assert.equal(activeChatMemoryProvider(), null, 'dispose 要撤掉注册');
  });

  test('槽已被别人占着 → 不覆盖，只标 slotTakenByOther', async () => {
    const dshHome = dshRoot();
    mkdirSync(join(dshHome, 'dsh-rofm', 'memory'), { recursive: true });
    writeFileSync(join(dshHome, 'dsh-rofm', 'memory', 'a.md'), '- 旧事\n', 'utf8');
    const foreign = registerChatMemoryProvider({ id: 'third-party', recall: () => undefined });

    const wiring = wireExternalMemory({ log, dshHome });
    assert.equal(wiring.providerId, null, '不抢占');
    assert.equal(activeChatMemoryProvider()?.id, 'third-party');
    const view = await jsonOf(
      handleMemoryRoutes({} as PetRouteDeps, {
        url: new URL('http://localhost/memory'),
        rest: 'memory',
        method: 'GET',
      }),
    );
    assert.equal(view.provider, null);
    assert.equal(view.slotTakenByOther, true);
    wiring.dispose();
    foreign();
  });

  test('一个都没装 → provider null，候选全 false', async () => {
    const wiring = wireExternalMemory({ log, dshHome: dshRoot() });
    assert.equal(wiring.providerId, null);
    const view = await jsonOf(
      handleMemoryRoutes({} as PetRouteDeps, {
        url: new URL('http://localhost/memory'),
        rest: 'memory',
        method: 'GET',
      }),
    );
    assert.equal(view.provider, null);
    assert.equal(
      (view.candidates as { installed: boolean }[]).every((item) => !item.installed),
      true,
    );
    wiring.dispose();
  });

  test('原生标识不被占用（registered provider 一定不是 native）', () => {
    const dshHome = dshRoot();
    mkdirSync(join(dshHome, 'dsh-rofm'), { recursive: true });
    writeFileSync(join(dshHome, 'dsh-rofm', 'x.md'), 'memo', 'utf8');
    const wiring = wireExternalMemory({ log, dshHome });
    assert.notEqual(activeChatMemoryProvider()?.id, NATIVE_MEMORY_ID);
    wiring.dispose();
  });
});

describe('/coexist', () => {
  test('GET：缺省 auto，检测结果可见，不静音', async () => {
    const store = createCoexistStore({
      dshHome: join(ROOT, 'empty'),
      home: join(ROOT, 'empty-home'),
      appData: join(ROOT, 'empty-app'),
    });
    const body = await jsonOf(
      handleCoexistRoutes(depsWithCoexist(store), {
        url: new URL('http://localhost/coexist'),
        rest: 'coexist',
        method: 'GET',
      }),
    );
    assert.equal(body.ok, true);
    assert.equal(body.mode, 'auto');
    assert.equal(body.autoWhisperPaused, false);
    assert.deepEqual(body.partners, []);
  });

  test('POST body-only → changed:true 且 autoWhisperPaused:true', async () => {
    const store = createCoexistStore({ dshHome: dshRoot(), home: dshRoot(), appData: dshRoot() });
    const body = await jsonOf(
      handleCoexistRoutes(depsWithCoexist(store), {
        url: new URL('http://localhost/coexist'),
        rest: 'coexist',
        method: 'POST',
        body: JSON.stringify({ mode: 'body-only' }),
      }),
    );
    assert.equal(body.changed, true);
    assert.equal(body.mode, 'body-only');
    assert.equal(body.autoWhisperPaused, true);
    assert.equal(store.allowAutoWhisper(), false);
  });

  test('POST 非法 mode / 非 JSON → bad-request', async () => {
    const store = createCoexistStore({ dshHome: dshRoot(), home: dshRoot(), appData: dshRoot() });
    for (const raw of [JSON.stringify({ mode: 'quiet' }), '{}', '{ 坏', '[]']) {
      const body = await jsonOf(
        handleCoexistRoutes(depsWithCoexist(store), {
          url: new URL('http://localhost/coexist'),
          rest: 'coexist',
          method: 'POST',
          body: raw,
        }),
      );
      assert.equal(body.reason, 'bad-request', raw);
    }
  });

  test('非 GET/POST → 405；rest 不匹配 → undefined', async () => {
    const store = createCoexistStore({ dshHome: dshRoot(), home: dshRoot(), appData: dshRoot() });
    const m = await handleCoexistRoutes(depsWithCoexist(store), {
      url: new URL('http://localhost/coexist'),
      rest: 'coexist',
      method: 'DELETE',
    });
    assert.ok(m !== undefined && m.kind === 'json');
    assert.equal(m!.status, 405);
    assert.equal(
      await handleCoexistRoutes(depsWithCoexist(store), {
        url: new URL('http://localhost/x'),
        rest: 'x',
        method: 'GET',
      }),
      undefined,
    );
  });

  test('精简桩没有 coexist → undefined（让位给后续处理器）', async () => {
    assert.equal(
      await handleCoexistRoutes({} as PetRouteDeps, {
        url: new URL('http://localhost/coexist'),
        rest: 'coexist',
        method: 'GET',
      }),
      undefined,
    );
  });
});
