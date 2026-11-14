/**
 * `/voice/provider-config` 的密钥写入契约（src/host/routes/voice-provider-config.ts）。
 *
 * 这里是「配置」与「密钥」两条写入路径的分岔口，所以钉住四件事：
 *   1. GET 从不回传密钥值，只回「配没配」；
 *   2. POST 的普通项进 `voice-providers.json`，密钥项进宿主凭据库；
 *   3. `clear` 才删密钥，空串是「不改」；
 *   4. 宿主凭据库不能写时回 `unsupported`，而不是静默丢掉用户填的密钥。
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { handleProviderConfig } from './voice-provider-config.ts';
import { registerVoiceProvider, resetVoiceProviders } from '../voice/registry.ts';
import { userPaths } from '../user-layout.ts';
import type { PetRouteDeps } from './types.ts';

const roots: string[] = [];

/** 临时数据根。 */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-providercfg-'));
  roots.push(root);
  mkdirSync(dirname(userPaths(root).voiceProviders), { recursive: true });
  return root;
}

/** 注册一个带密钥字段的假实现（`apiKey` 走凭据库，`baseURL` 走配置文件）。 */
function registerCloudStub(): () => void {
  return registerVoiceProvider({
    id: 'cloud',
    name: '云端语音（骨架）',
    fields: [
      { key: 'baseURL', label: '服务地址', kind: 'text', required: true },
      { key: 'apiKey', label: 'API Key', kind: 'password', credentialRef: 'DSH_TEST_TTS_KEY' },
    ],
    availability: () => ({ ok: false, reason: '尚未接入' }),
    synthesize: async () => {
      throw new Error('尚未接入');
    },
  });
}

/** 记录式假凭据服务：形状对齐 `ctx.credentials`，只实现这条路由用到的三个方法。 */
function fakeCredentials(): { store: Map<string, string>; seam: unknown } {
  const store = new Map<string, string>();
  return {
    store,
    seam: {
      describe: async (ref: unknown) => ({ configured: store.has(String(ref)) }),
      set: async (ref: unknown, value: string) => {
        store.set(String(ref), value);
      },
      unset: async (ref: unknown) => {
        store.delete(String(ref));
      },
    },
  };
}

/** 只有根的依赖（这条路由不碰别的东西）。 */
const depsOf = (userRoot: string, credentials?: unknown) =>
  ({
    userRoot,
    optionalService: (name: string) => (name === 'credentials' ? credentials : undefined),
  }) as unknown as Pick<PetRouteDeps, 'userRoot' | 'optionalService'>;

/** 造一次路由输入。 */
function input(method: string, provider: string, body?: unknown) {
  const rest = 'voice/provider-config';
  return {
    url: new URL(`http://127.0.0.1:1/dsh-pet-7340/${rest}?provider=${encodeURIComponent(provider)}`),
    rest,
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

/** 取应答里的对象体（断言失败时顺手印出来）。 */
const jsonOf = (result: Awaited<ReturnType<typeof handleProviderConfig>>): Record<string, unknown> => {
  assert.equal(result.kind, 'json');
  return (result as unknown as { obj: Record<string, unknown> }).obj;
};

afterEach(() => {
  resetVoiceProviders();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('GET：密钥只回「配没配」', () => {
  test('配置文件里的值照常回，密钥值一个字节都不回', async () => {
    const dispose = registerCloudStub();
    const root = tempRoot();
    const { seam } = fakeCredentials();
    try {
      const result = await handleProviderConfig(depsOf(root, seam), input('GET', 'cloud'));
      assert.deepEqual(jsonOf(result), {
        ok: true,
        provider: 'cloud',
        values: { baseURL: '' },
        secrets: { apiKey: false },
      });
    } finally {
      dispose();
    }
  });
});

describe('POST：两条写入路径', () => {
  test('普通项进 JSON、密钥进凭据库，响应同时回两份在场情况', async () => {
    const dispose = registerCloudStub();
    const root = tempRoot();
    const { store, seam } = fakeCredentials();
    try {
      const result = await handleProviderConfig(
        depsOf(root, seam),
        input('POST', 'cloud', { provider: 'cloud', patch: { baseURL: 'https://a/v1', apiKey: 'sk-1' } }),
      );
      const obj = jsonOf(result);
      assert.equal(obj.ok, true);
      assert.deepEqual(obj.values, { baseURL: 'https://a/v1' });
      assert.deepEqual(obj.secrets, { apiKey: true });
      assert.equal(store.get('DSH_TEST_TTS_KEY'), 'sk-1', '密钥必须落在凭据里');
      const saved = JSON.parse(readFileSync(userPaths(root).voiceProviders, 'utf8')) as {
        cloud: Record<string, string>;
      };
      assert.equal(saved.cloud.baseURL, 'https://a/v1');
      assert.equal(saved.cloud.apiKey, undefined, '密钥不能写进配置文件');
    } finally {
      dispose();
    }
  });

  test('空串的密钥 = 不改（值不回传，界面只能给空框）', async () => {
    const dispose = registerCloudStub();
    const root = tempRoot();
    const { store, seam } = fakeCredentials();
    store.set('DSH_TEST_TTS_KEY', 'sk-old');
    try {
      await handleProviderConfig(
        depsOf(root, seam),
        input('POST', 'cloud', { provider: 'cloud', patch: { baseURL: 'https://b', apiKey: '' } }),
      );
      assert.equal(store.get('DSH_TEST_TTS_KEY'), 'sk-old');
    } finally {
      dispose();
    }
  });

  test('clear 才删；只给 clear 也能单独发（patch 可省）', async () => {
    const dispose = registerCloudStub();
    const root = tempRoot();
    const { store, seam } = fakeCredentials();
    store.set('DSH_TEST_TTS_KEY', 'sk-old');
    try {
      const result = await handleProviderConfig(
        depsOf(root, seam),
        input('POST', 'cloud', { provider: 'cloud', clear: ['apiKey'] }),
      );
      assert.equal(jsonOf(result).ok, true);
      assert.equal(store.has('DSH_TEST_TTS_KEY'), false);
    } finally {
      dispose();
    }
  });
});

describe('拒绝路径', () => {
  test('凭据库不能写（独立模式）：unsupported', async () => {
    const dispose = registerCloudStub();
    try {
      const result = await handleProviderConfig(
        depsOf(tempRoot(), { resolve: async () => undefined }),
        input('POST', 'cloud', { provider: 'cloud', patch: { apiKey: 'sk-1' } }),
      );
      assert.equal((jsonOf(result) as { reason: string }).reason, 'unsupported');
    } finally {
      dispose();
    }
  });

  test('未知键 / 非字符串 / clear 里放了普通键 / 空 patch：各自 bad-request', async () => {
    const dispose = registerCloudStub();
    const { seam } = fakeCredentials();
    try {
      const cases = [
        { patch: { nope: 'x' } },
        { patch: { baseURL: 42 } },
        { patch: { baseURL: 'a' }, clear: ['baseURL'] },
        { patch: {} },
      ];
      for (const body of cases) {
        const result = await handleProviderConfig(
          depsOf(tempRoot(), seam),
          input('POST', 'cloud', { provider: 'cloud', ...body }),
        );
        assert.equal((jsonOf(result) as { reason: string }).reason, 'bad-request', JSON.stringify(body));
      }
    } finally {
      dispose();
    }
  });

  test('内置实现与未知实现', async () => {
    const builtin = await handleProviderConfig(depsOf(tempRoot()), input('GET', 'edge'));
    assert.equal((jsonOf(builtin) as { reason: string }).reason, 'bad-request');
    const missing = await handleProviderConfig(depsOf(tempRoot()), input('GET', 'ghost'));
    assert.equal((jsonOf(missing) as { reason: string }).reason, 'provider-missing');
  });
});
