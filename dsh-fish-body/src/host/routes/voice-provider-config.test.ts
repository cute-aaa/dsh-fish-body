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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { handleProviderConfig } from './voice-provider-config.ts';
import { registerVoiceProvider, resetVoiceProviders } from '../voice/registry.ts';
import {
  CLOUD_API_KEY_FALLBACK,
  CLOUD_API_KEY_REF,
  CLOUD_FIELDS,
  EMPTY_CLOUD_SETTINGS,
  cloudAxesOf,
  cloudSettingsOf,
  createCloudProvider,
} from '../voice/cloud/provider.ts';
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

/** 带下拉字段的假实现：验证候选值校验与「保存后立刻探活」。 */
function registerSelectStub(): { dispose: () => void; refreshes: () => number } {
  let refreshes = 0;
  const dispose = registerVoiceProvider({
    id: 'paid',
    name: '付费语音',
    fields: [
      { key: 'useCloud', label: '使用云端语音', kind: 'select', options: ['off', 'on'] },
      { key: 'baseURL', label: '服务地址', kind: 'text' },
    ],
    refresh: async () => {
      refreshes += 1;
      return true;
    },
    synthesize: async () => ({ data: new Uint8Array([1]), mime: 'audio/mpeg' }),
  });
  return { dispose, refreshes: () => refreshes };
}

describe('下拉字段与保存后探活', () => {
  test('候选值之外的值被拒：写进去只会在界面上显示成空，用户以为没保存', async () => {
    const stub = registerSelectStub();
    try {
      const result = await handleProviderConfig(
        depsOf(tempRoot(), fakeCredentials().seam),
        input('POST', 'paid', { provider: 'paid', patch: { useCloud: 'yes' } }),
      );
      const body = jsonOf(result) as { reason: string; message: string };
      assert.equal(body.reason, 'bad-request');
      assert.match(body.message, /useCloud/);
      assert.equal(stub.refreshes(), 0, '被拒的写入不该触发探活');
    } finally {
      stub.dispose();
    }
  });

  test('合法值写进配置文件，并立刻探活一次（开关打开后马上能用）', async () => {
    const stub = registerSelectStub();
    const root = tempRoot();
    try {
      const result = await handleProviderConfig(
        depsOf(root, fakeCredentials().seam),
        input('POST', 'paid', { provider: 'paid', patch: { useCloud: 'on' } }),
      );
      assert.equal(result.kind, 'json');
      assert.equal((jsonOf(result) as { ok: boolean }).ok, true);
      const file = JSON.parse(readFileSync(userPaths(root).voiceProviders, 'utf8')) as {
        paid: Record<string, string>;
      };
      assert.equal(file.paid.useCloud, 'on');
      assert.equal(stub.refreshes(), 1);
    } finally {
      stub.dispose();
    }
  });

  test('空串仍是「删掉该键」，不算非法值', async () => {
    const stub = registerSelectStub();
    try {
      const result = await handleProviderConfig(
        depsOf(tempRoot(), fakeCredentials().seam),
        input('POST', 'paid', { provider: 'paid', patch: { useCloud: '' } }),
      );
      const body = jsonOf(result) as { reason?: string; values?: Record<string, string> };
      assert.equal(body.reason, undefined, JSON.stringify(body));
      assert.equal(body.values?.useCloud, '');
    } finally {
      stub.dispose();
    }
  });
});

describe('POST：需要鉴权的协议必须有 key（D-07，按生效预设判）', () => {
  /**
   * 与云端四轴同形的假实现：`authStyle` / `protocol` 存空串表示「跟随预设」，
   * 结论由 `needsKey`/`keyRefs` 钩子给出 —— 这正是云端 provider 的做法（`cloudAxesOf` / `cloudKeyRefs`）。
   */
  const registerAxisStub = (): (() => void) =>
    registerVoiceProvider({
      id: 'cloud-axis',
      name: '云端语音（四轴骨架）',
      fields: [
        { key: 'preset', label: '服务预设', kind: 'select', options: ['none', 'openai-speech', 'deepseek'] },
        { key: 'useCloud', label: '使用云端语音', kind: 'select', options: ['on', 'off'] },
        { key: 'protocol', label: '接口协议', kind: 'select', options: ['openai', 'custom'] },
        { key: 'authStyle', label: '鉴权方式', kind: 'select', options: ['bearer', 'none'] },
        { key: 'baseURL', label: '服务地址', kind: 'text' },
        { key: 'bodyTemplate', label: '请求体模板', kind: 'text' },
        {
          key: 'apiKey',
          label: 'API Key',
          kind: 'password',
          credentialRef: 'DSH_TEST_TTS_KEY',
          credentialFallbacks: ['DSH_TEST_TTS_KEY_HOST'],
        },
      ],
      // 直接复用生产实现的两条判据（`cloudAxesOf` / `cloudKeyRefs`）：这样测的就是真实口径，
      // 不是我在测试里另写一份「大致相同」的规则。
      needsKey: (values) => {
        // 与生产同一判据：只有「云端开着」时才要 key（P2-9 的逃生口）
        const settings = cloudSettingsOf({ cloud: values });
        return settings.useCloud && cloudAxesOf(settings).authStyle !== 'none';
      },
      keyRefs: (values) =>
        cloudAxesOf(cloudSettingsOf({ cloud: values })).preset === 'deepseek'
          ? ['DSH_TEST_TTS_KEY', 'DSH_TEST_TTS_KEY_HOST']
          : ['DSH_TEST_TTS_KEY'],
      availability: () => ({ ok: false, reason: '尚未接入' }),
      synthesize: async () => {
        throw new Error('尚未接入');
      },
    });

  test('① preset=openai-speech + authStyle 空 + key 空 + 宿主只有 DEEPSEEK_API_KEY → 400', async () => {
    const dispose = registerAxisStub();
    const root = tempRoot();
    // 宿主 key 挂在「回退引用」上：非 deepseek 预设不得认它
    const { store, seam } = fakeCredentials();
    store.set('DSH_TEST_TTS_KEY_HOST', 'host-key');
    try {
      const result = await handleProviderConfig(
        depsOf(root, seam),
        input('POST', 'cloud-axis', {
          patch: {
            useCloud: 'on',
            preset: 'openai-speech',
            protocol: 'openai',
            authStyle: '',
            baseURL: 'https://a/v1',
          },
        }),
      );
      const obj = jsonOf(result);
      assert.equal(obj.ok, false);
      assert.equal(obj.reason, 'bad-request');
      assert.match(String(obj.message), /API Key 未填/);
      assert.equal(existsSync(userPaths(root).voiceProviders), false, '被拒时不得写普通项');
    } finally {
      dispose();
    }
  });

  test('② preset=deepseek + key 空 + 宿主有回退 key → 200（允许回退）', async () => {
    const dispose = registerAxisStub();
    const root = tempRoot();
    const { store, seam } = fakeCredentials();
    store.set('DSH_TEST_TTS_KEY_HOST', 'host-key');
    try {
      const result = await handleProviderConfig(
        depsOf(root, seam),
        input('POST', 'cloud-axis', {
          patch: {
            useCloud: 'on',
            preset: 'deepseek',
            protocol: 'custom',
            authStyle: '',
            bodyTemplate: '{"text":"{text}"}',
          },
        }),
      );
      const obj = jsonOf(result);
      assert.equal(obj.ok, true);
      assert.deepEqual(obj.secrets, { apiKey: true }, '回退引用在场就算已配');
    } finally {
      dispose();
    }
  });

  test('③ authStyle=none + key 空 → 200（本机服务不要鉴权）', async () => {
    const dispose = registerAxisStub();
    const root = tempRoot();
    const { seam } = fakeCredentials();
    try {
      const result = await handleProviderConfig(
        depsOf(root, seam),
        input('POST', 'cloud-axis', {
          patch: {
            useCloud: 'on',
            preset: 'openai-speech',
            protocol: 'custom',
            authStyle: 'none',
            baseURL: 'http://127.0.0.1:9',
          },
        }),
      );
      const obj = jsonOf(result);
      assert.equal(obj.ok, true);
      assert.deepEqual(obj.secrets, { apiKey: false });
    } finally {
      dispose();
    }
  });

  test('④ preset=custom（none）+ 合法 bodyTemplate + authStyle 空 + 无 key → 400', async () => {
    const dispose = registerAxisStub();
    const root = tempRoot();
    const { seam } = fakeCredentials();
    try {
      const result = await handleProviderConfig(
        depsOf(root, seam),
        input('POST', 'cloud-axis', {
          patch: {
            useCloud: 'on',
            preset: 'none',
            protocol: 'custom',
            authStyle: '',
            baseURL: 'https://c/v1',
            bodyTemplate: '{"text":"{text}"}',
          },
        }),
      );
      const obj = jsonOf(result);
      assert.equal(obj.ok, false);
      assert.match(String(obj.message), /API Key 未填/);
    } finally {
      dispose();
    }
  });

  test('⑦ useCloud:"off" + 无 key → 200（关掉云端是逃生口，不能被 key 校验锁死）', async () => {
    const dispose = registerAxisStub();
    const root = tempRoot();
    const { seam } = fakeCredentials();
    try {
      const result = await handleProviderConfig(
        depsOf(root, seam),
        input('POST', 'cloud-axis', {
          patch: { useCloud: 'off', preset: 'openai-speech', protocol: 'openai', authStyle: 'bearer' },
        }),
      );
      const obj = jsonOf(result);
      assert.equal(obj.ok, true, '关掉云端必须能存');
      assert.equal((obj.values as Record<string, string>).useCloud, 'off');
    } finally {
      dispose();
    }
  });

  test('⑤ authStyle=bearer + clear:["apiKey"]（凭据库已有 key）→ 400，且配置字节不变', async () => {
    const dispose = registerAxisStub();
    const root = tempRoot();
    const { store, seam } = fakeCredentials();
    store.set('DSH_TEST_TTS_KEY', 'user-key');
    try {
      const result = await handleProviderConfig(
        depsOf(root, seam),
        input('POST', 'cloud-axis', {
          patch: {
            useCloud: 'on',
            preset: 'openai-speech',
            protocol: 'openai',
            authStyle: 'bearer',
            baseURL: 'https://a/v1',
          },
          clear: ['apiKey'],
        }),
      );
      const obj = jsonOf(result);
      assert.equal(obj.ok, false, '需要鉴权时清空 key 必须被拒');
      assert.match(String(obj.message), /不能清空/);
      assert.equal(existsSync(userPaths(root).voiceProviders), false, '400 分支不得写普通项');
      assert.equal(store.get('DSH_TEST_TTS_KEY'), 'user-key', '400 分支不得动凭据');
    } finally {
      dispose();
    }
  });

  test('⑥ deepseek + clear:["apiKey"] + 宿主回退 key → 允许，落盘后仍算已配', async () => {
    const dispose = registerAxisStub();
    const root = tempRoot();
    const { store, seam } = fakeCredentials();
    store.set('DSH_TEST_TTS_KEY', 'user-key');
    store.set('DSH_TEST_TTS_KEY_HOST', 'host-key');
    try {
      const result = await handleProviderConfig(
        depsOf(root, seam),
        input('POST', 'cloud-axis', {
          patch: {
            useCloud: 'on',
            preset: 'deepseek',
            protocol: 'custom',
            authStyle: '',
            bodyTemplate: '{"text":"{text}"}',
          },
          clear: ['apiKey'],
        }),
      );
      const obj = jsonOf(result);
      assert.equal(obj.ok, true, 'deepseek 有宿主 key 兜底，清掉用户那把仍然可用');
      assert.equal(store.has('DSH_TEST_TTS_KEY'), false, '用户那把确实被清掉');
      assert.deepEqual(obj.secrets, { apiKey: true }, '回退引用仍算已配');
    } finally {
      dispose();
    }
  });
});

describe('P2-9 / 生产云端口径：needsKey 与 keyRefs 必须由实现给出（不是测试替身）', () => {
  /**
   * 造生产实现（`createCloudProvider`），只注入「现读配置」与「读密钥」两个依赖。
   * 目的不是再测一遍业务，而是把那两条**安全边界**钉在实现上：上面的 ①–⑦ 用的是
   * 复制了同款判据的测试桩，桩与实现一起漂移时那些用例仍会绿——这里直接问实现。
   */
  const productionCloud = (): ReturnType<typeof createCloudProvider> =>
    createCloudProvider({
      settings: () => EMPTY_CLOUD_SETTINGS,
      readKey: async () => undefined,
    });

  test('needsKey 认 useCloud：关掉云端时没有 key 也不要求 key（P2-9 逃生口）', () => {
    const cloud = productionCloud();
    assert.equal(
      cloud.needsKey?.({ useCloud: 'off', preset: 'openai-speech', authStyle: 'bearer' }),
      false,
      '关着云端不该要 key',
    );
    assert.equal(
      cloud.needsKey?.({ useCloud: 'on', preset: 'openai-speech', authStyle: 'bearer' }),
      true,
      '开着云端 + 需鉴权 → 要 key',
    );
    assert.equal(
      cloud.needsKey?.({ useCloud: 'on', preset: 'openai-speech', authStyle: 'none' }),
      false,
      '本机服务不要鉴权',
    );
    // 空串表示「跟随预设」：openai-speech 的预设鉴权是 bearer → 仍要 key（D-07 假修的根因）
    assert.equal(
      cloud.needsKey?.({ useCloud: 'on', preset: 'openai-speech', authStyle: '', protocol: '' }),
      true,
      '空 authStyle 要走预设',
    );
  });

  test('keyRefs 只对 deepseek 放开宿主回退引用（否则把宿主 key 发给第三方）', () => {
    const cloud = productionCloud();
    assert.deepEqual(cloud.keyRefs?.({ useCloud: 'on', preset: 'openai-speech' }), [CLOUD_API_KEY_REF]);
    assert.deepEqual(cloud.keyRefs?.({ useCloud: 'on', preset: 'azure' }), [CLOUD_API_KEY_REF]);
    assert.deepEqual(cloud.keyRefs?.({ useCloud: 'on', preset: 'deepseek' }), [
      CLOUD_API_KEY_REF,
      CLOUD_API_KEY_FALLBACK,
    ]);
  });

  test('路由 + 生产实现：useCloud:"off" + 凭据库无 key → 200 且真的落盘', async () => {
    const dispose = registerVoiceProvider(productionCloud());
    const root = tempRoot();
    const { store, seam } = fakeCredentials(); // 一个密钥都没有
    try {
      const result = await handleProviderConfig(
        depsOf(root, seam),
        input('POST', 'cloud', { patch: { useCloud: 'off' } }),
      );
      const obj = jsonOf(result);
      assert.equal(obj.ok, true, JSON.stringify(obj));
      assert.equal((obj.values as Record<string, string>).useCloud, 'off');
      assert.equal(store.size, 0, '不该因此去写凭据');
      const saved = JSON.parse(readFileSync(userPaths(root).voiceProviders, 'utf8')) as {
        cloud: Record<string, string>;
      };
      assert.equal(saved.cloud.useCloud, 'off', '关云端必须能存下来');
    } finally {
      dispose();
    }
  });

  test('路由 + 生产实现：openai-speech + clear:["apiKey"] → ok:false，且不写文件、不动凭据', async () => {
    const dispose = registerVoiceProvider(productionCloud());
    const root = tempRoot();
    const { store, seam } = fakeCredentials();
    store.set(CLOUD_API_KEY_REF, 'user-key');
    try {
      const result = await handleProviderConfig(
        depsOf(root, seam),
        input('POST', 'cloud', {
          patch: { useCloud: 'on', preset: 'openai-speech', protocol: 'openai', authStyle: 'bearer' },
          clear: ['apiKey'],
        }),
      );
      const obj = jsonOf(result);
      assert.equal(obj.ok, false, JSON.stringify(obj));
      assert.match(String(obj.message), /不能清空/);
      assert.equal(existsSync(userPaths(root).voiceProviders), false, '被拒时不得写普通项');
      assert.equal(store.get(CLOUD_API_KEY_REF), 'user-key', '被拒时不得动凭据');
    } finally {
      dispose();
    }
  });
});

describe('R2 预设展开：patch 带 preset 时宿主把四轴默认值展开进落盘值', () => {
  /** 生产云端的路由用实例（同一个工厂，settings 走空配置：只影响 fields 的候选顺序，不影响判定）。 */
  const productionCloud = (): ReturnType<typeof createCloudProvider> =>
    createCloudProvider({ settings: () => EMPTY_CLOUD_SETTINGS, readKey: async () => undefined });

  /** 落盘的普通项（`{ cloud: {...} }`），没有文件时给空对象。 */
  const savedOf = (root: string): Record<string, string> => {
    const file = userPaths(root).voiceProviders;
    if (!existsSync(file)) return {};
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { cloud?: Record<string, string> };
    return parsed.cloud ?? {};
  };

  test('{preset:"mimo"}：path/鉴权/响应取值/格式/协议 真的写进配置（不是只在合成时兜底）', async () => {
    const dispose = registerVoiceProvider(productionCloud());
    const root = tempRoot();
    try {
      const result = await handleProviderConfig(
        depsOf(root, fakeCredentials().seam),
        input('POST', 'cloud', { patch: { preset: 'mimo' } }),
      );
      const obj = jsonOf(result);
      assert.equal(obj.ok, true, JSON.stringify(obj));
      const values = obj.values as Record<string, string>;
      assert.equal(values.path, '/v1/chat/completions');
      assert.equal(values.authStyle, 'api-key-header');
      assert.equal(values.authHeader, 'api-key');
      assert.equal(values.bodyKind, 'json');
      assert.equal(values.responseKind, 'json-base64');
      assert.equal(values.responsePath, 'choices.0.message.audio.data');
      assert.equal(values.format, 'wav');
      assert.equal(values.protocol, 'openai', 'mimo 属于 openai 协议族（修掉「显示 custom」）');
      assert.equal(values.preset, 'mimo');
      // 落盘的键只能是该实现声明过的（R-6：多写的键读侧白名单看不见，最难排查）
      const declared = new Set(CLOUD_FIELDS.map((field) => field.key));
      assert.ok(declared.size > 10, '云端该声明十来个字段');
      for (const key of Object.keys(savedOf(root))) {
        assert.ok(declared.has(key), `落盘出现了未声明的键 ${key}`);
      }
    } finally {
      dispose();
    }
  });

  test('换到 {preset:"deepseek"}：mimo 的残留被清掉，stella 与官方地址被写上', async () => {
    const dispose = registerVoiceProvider(productionCloud());
    const root = tempRoot();
    try {
      await handleProviderConfig(
        depsOf(root, fakeCredentials().seam),
        input('POST', 'cloud', { patch: { preset: 'mimo' } }),
      );
      const result = await handleProviderConfig(
        depsOf(root, fakeCredentials().seam),
        input('POST', 'cloud', { patch: { preset: 'deepseek' } }),
      );
      const values = jsonOf(result).values as Record<string, string>;
      assert.equal(values.path, '/v1/tools/tts');
      assert.equal(values.voice, 'stella');
      assert.equal(values.protocol, 'custom');
      assert.equal(values.baseURL, 'https://api.deepseek.com');
      assert.equal(values.responsePath, '', 'mimo 的 JSON 路径必须清掉（空串 = 删键）');
      const saved = savedOf(root);
      assert.equal('responsePath' in saved, false, '清空的值不得以空串形式留在 JSON 里');
    } finally {
      dispose();
    }
  });

  test('{preset:"none"}：轴键全清，真的回到手填', async () => {
    const dispose = registerVoiceProvider(productionCloud());
    const root = tempRoot();
    try {
      await handleProviderConfig(
        depsOf(root, fakeCredentials().seam),
        input('POST', 'cloud', { patch: { preset: 'mimo' } }),
      );
      const result = await handleProviderConfig(
        depsOf(root, fakeCredentials().seam),
        input('POST', 'cloud', { patch: { preset: 'none（手动填四轴）' } }),
      );
      const values = jsonOf(result).values as Record<string, string>;
      for (const key of [
        'path',
        'authStyle',
        'authHeader',
        'bodyKind',
        'bodyTemplate',
        'responseKind',
        'responsePath',
        'format',
        'voice',
      ]) {
        assert.equal(values[key], '', `${key} 应被清空`);
      }
      assert.equal(values.protocol, 'custom');
    } finally {
      dispose();
    }
  });

  test('手填保护（路由级）：用户改过的音色在换预设时不被覆盖', async () => {
    const dispose = registerVoiceProvider(productionCloud());
    const root = tempRoot();
    try {
      await handleProviderConfig(
        depsOf(root, fakeCredentials().seam),
        input('POST', 'cloud', { patch: { preset: 'mimo', voice: 'nova' } }),
      );
      const result = await handleProviderConfig(
        depsOf(root, fakeCredentials().seam),
        input('POST', 'cloud', { patch: { preset: 'deepseek' } }),
      );
      const values = jsonOf(result).values as Record<string, string>;
      assert.equal(values.voice, 'nova', '手填的音色必须留着');
      assert.equal(values.path, '/v1/tools/tts', '没手填过的项照旧被新预设接管');
    } finally {
      dispose();
    }
  });

  test('设置页的真实请求形状：整份草稿一起发（旧值也在 patch 里）也要换干净', async () => {
    const dispose = registerVoiceProvider(productionCloud());
    const root = tempRoot();
    try {
      // 先在 deepseek 上躺一会儿（草稿里因此是 deepseek 的整套值）
      await handleProviderConfig(
        depsOf(root, fakeCredentials().seam),
        input('POST', 'cloud', { patch: { preset: 'deepseek' } }),
      );
      const before = jsonOf(await handleProviderConfig(depsOf(root, fakeCredentials().seam), input('GET', 'cloud')))
        .values as Record<string, string>;

      // 用户只把下拉改成 mimo 就点保存：客户端发的是「整份草稿」（voice-tab 的 state.values）
      const draft = { ...before, preset: 'mimo' };
      const result = await handleProviderConfig(
        depsOf(root, fakeCredentials().seam),
        input('POST', 'cloud', { patch: draft }),
      );
      const values = jsonOf(result).values as Record<string, string>;
      assert.equal(values.path, '/v1/chat/completions', '草稿里的旧路径等于旧预设默认值 → 该被新预设接管');
      assert.equal(values.voice, '', 'stella 是 deepseek 的默认值 → 换成 mimo 要清掉');
      assert.equal(values.responsePath, 'choices.0.message.audio.data');
      assert.equal(
        values.baseURL,
        '',
        'deepseek 的官方地址是旧预设的默认（不是用户手填）→ 切走必须清掉，否则 mimo 的 path 会拼到 deepseek 域名上',
      );
    } finally {
      dispose();
    }
  });

  test('展开出来的值要过同一套形状校验：实现不能借展开写入 ftp:// 或候选外的值', async () => {
    const dispose = registerVoiceProvider({
      id: 'expand-evil',
      name: '越权展开探针',
      fields: [
        { key: 'preset', label: '预设', kind: 'select', options: ['none', 'openai-speech'] },
        { key: 'baseURL', label: '服务地址', kind: 'text' },
        { key: 'authStyle', label: '鉴权', kind: 'select', options: ['bearer', 'none'] },
      ],
      // 展开时塞一个协议不对的地址 + 一个候选之外的值
      expandPatch: (patch) => ({ ...patch, baseURL: 'ftp://evil.example', authStyle: 'sneaky' }),
      synthesize: async () => {
        throw new Error('探针不合成');
      },
    });
    const root = tempRoot();
    try {
      const result = await handleProviderConfig(
        depsOf(root, fakeCredentials().seam),
        input('POST', 'expand-evil', { patch: { preset: 'openai-speech' } }),
      );
      const obj = jsonOf(result);
      assert.equal(obj.ok, false, `越权值必须被挡下：${JSON.stringify(obj)}`);
      assert.match(String(obj.message), /baseURL|authStyle/, '错误要指名是哪一项不合规');
      assert.equal(existsSync(userPaths(root).voiceProviders), false, '被拒时不得写盘');
    } finally {
      dispose();
    }
  });
});

describe('R2 展开顺序：展开必须发生在鉴权判定之前', () => {
  test('展开在鉴权判定之前：展开出来的 authStyle 必须影响 needsKey（顺序反了就白展开）', async () => {
    /** 探针实现：只说「展开会把 authStyle 写成 none」，needsKey 看的就是这个值。 */
    const journal = { calls: 0 };
    const dispose = registerVoiceProvider({
      id: 'expand-probe',
      name: '展开顺序探针',
      fields: [
        { key: 'preset', label: '预设', kind: 'select', options: ['none', 'openai-speech'] },
        { key: 'authStyle', label: '鉴权', kind: 'text' },
      ],
      expandPatch: (patch) => {
        journal.calls += 1;
        return { ...patch, authStyle: 'none' };
      },
      needsKey: (values) => values.authStyle !== 'none',
      synthesize: async () => {
        throw new Error('探针不合成');
      },
    });
    const root = tempRoot();
    try {
      const result = await handleProviderConfig(
        depsOf(root, fakeCredentials().seam),
        input('POST', 'expand-probe', { patch: { preset: 'openai-speech' } }),
      );
      const obj = jsonOf(result);
      assert.equal(obj.ok, true, `未展开就被鉴权判定拦下：${JSON.stringify(obj)}`);
      assert.equal(journal.calls, 1, '一次保存只该展开一次');
      assert.equal((obj.values as Record<string, string>).authStyle, 'none');
    } finally {
      dispose();
    }
  });
});
