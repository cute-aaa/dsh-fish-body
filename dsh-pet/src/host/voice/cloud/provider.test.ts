/**
 * 云端 TTS（DeepSeek `/v1/tools/tts`）的契约测试：配置解析、探活口径、请求形状、失败留痕。
 *
 * 钉住四件事，因为它们是「接上云端之后不会悄悄多花钱 / 不会静默坏掉」的全部保证：
 *   1. 探活只看配置，**不发请求**（TTS 没有免费 ping，拿一句话去试就等于付钱）；
 *   2. 请求体只发三个字段（`text` / `voice_id` / `format` + `filter_markdown`），没有 model、没有语速；
 *   3. 非 2xx 与空音频都要抛错，并把原因留在 `lastError()` 里（回退链会静默换嗓子，这是唯一能看见的地方）；
 *   4. 实现标了 `billable`：自动回退链不得选它。
 *
 * 全部用注入的假 fetch，不打真网。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CLOUD_API_KEY_FALLBACK,
  CLOUD_API_KEY_REF,
  CLOUD_FIELDS,
  DEFAULT_CLOUD_BASE_URL,
  cloudBaseURL,
  cloudConfigured,
  cloudSettingsOf,
  cloudVoiceId,
  createCloudProvider,
} from './provider.ts';
import { secretFieldsOf, secretRefsOf } from '../provider-secrets.ts';

/** 一段「像样」的 wav 字节（长度过最小校验即可，内容不参与判定）。 */
const WAV = new Uint8Array(64).fill(7);

/** 造一个记下每次调用的假传输层。 */
function recorder(makeResponse: () => Response): {
  calls: { url: string; init?: RequestInit }[];
  fetchImpl: typeof fetch;
} {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return makeResponse();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

/** 一次合成的输入（语速对云端无效，但要按链的形状传）。 */
const ask = { text: '你好', rate: '+0%' };

describe('cloudSettingsOf —— 配置解析', () => {
  test('缺段 / 写坏都当全空，不炸', () => {
    for (const source of [undefined, null, 'x', [], { gsv: {} }]) {
      assert.deepEqual(cloudSettingsOf(source), { baseURL: '', voice: '', useCloud: false });
    }
  });

  test('只取字符串并 trim；只有 on 才算开启', () => {
    assert.deepEqual(cloudSettingsOf({ cloud: { baseURL: ' https://a/v1 ', voice: ' tide ', useCloud: 'on' } }), {
      baseURL: 'https://a/v1',
      voice: 'tide',
      useCloud: true,
    });
    assert.equal(cloudSettingsOf({ cloud: { useCloud: 'on ' } }).useCloud, true);
    for (const value of ['off', 'true', 'ON', 1, true, '', undefined]) {
      assert.equal(cloudSettingsOf({ cloud: { useCloud: value } }).useCloud, false, `useCloud=${String(value)}`);
    }
  });
});

describe('生效值归一', () => {
  test('地址留空用官方默认，末尾斜杠去掉（否则拼出 //v1/tools/tts）', () => {
    assert.equal(cloudBaseURL(cloudSettingsOf({})), DEFAULT_CLOUD_BASE_URL);
    assert.equal(cloudBaseURL(cloudSettingsOf({ cloud: { baseURL: 'https://a/v1//' } })), 'https://a/v1');
    assert.equal(DEFAULT_CLOUD_BASE_URL, 'https://api.deepseek.com');
  });

  test('音色只认 stella / tide，其它按默认', () => {
    assert.equal(cloudVoiceId(cloudSettingsOf({ cloud: { voice: 'tide' } })), 'tide');
    assert.equal(cloudVoiceId(cloudSettingsOf({ cloud: { voice: 'stella' } })), 'stella');
    for (const voice of ['', 'alloy', 'TIDE', 'stella ']) {
      assert.equal(cloudVoiceId(cloudSettingsOf({ cloud: { voice } })), 'stella', `voice=${voice}`);
    }
  });

  test('cloudConfigured 只看付费开关', () => {
    assert.equal(cloudConfigured(cloudSettingsOf({ cloud: { useCloud: 'on' } })), true);
    assert.equal(cloudConfigured(cloudSettingsOf({ cloud: { baseURL: 'https://a', voice: 'tide' } })), false);
  });
});

describe('CLOUD_FIELDS —— 声明', () => {
  test('密钥字段带主引用与只读回退引用', () => {
    const secrets = secretFieldsOf(CLOUD_FIELDS);
    assert.deepEqual(
      secrets.map((field) => [field.key, field.credentialRef]),
      [['apiKey', CLOUD_API_KEY_REF]],
    );
    assert.deepEqual(secretRefsOf(secrets[0]!), [CLOUD_API_KEY_REF, CLOUD_API_KEY_FALLBACK]);
  });

  test('下拉字段声明了候选值；没有 model 字段（接口没有这个概念）', () => {
    const byKey = new Map(CLOUD_FIELDS.map((field) => [field.key, field]));
    assert.deepEqual(byKey.get('useCloud')?.options, ['off', 'on']);
    assert.deepEqual(byKey.get('voice')?.options, ['stella', 'tide']);
    assert.equal(byKey.get('voice')?.kind, 'select');
    assert.equal(byKey.has('model'), false);
  });
});

describe('createCloudProvider —— 可用性', () => {
  test('未探活前不可用，理由给人话', async () => {
    const provider = createCloudProvider({ settings: () => cloudSettingsOf({}), readKey: async () => undefined });
    const verdict = provider.availability?.();
    assert.equal(verdict?.ok, false);
    assert.match(verdict && !verdict.ok ? verdict.reason : '', /尚未探活/);
  });

  test('没有 key：不可用，理由点明可复用宿主凭据', async () => {
    const provider = createCloudProvider({ settings: () => cloudSettingsOf({}), readKey: async () => undefined });
    assert.equal(await provider.refresh?.(), false);
    const verdict = provider.availability?.();
    assert.equal(verdict?.ok, false);
    assert.match(verdict && !verdict.ok ? verdict.reason : '', /API Key/);
    assert.match(verdict && !verdict.ok ? verdict.reason : '', new RegExp(CLOUD_API_KEY_FALLBACK));
  });

  test('有 key：可用，且探活一次请求都不发', async () => {
    const { calls, fetchImpl } = recorder(() => new Response(WAV));
    const provider = createCloudProvider({
      settings: () => cloudSettingsOf({ cloud: { useCloud: 'on' } }),
      readKey: async () => 'sk-test',
      fetch: fetchImpl,
    });
    assert.equal(await provider.refresh?.(), true);
    assert.deepEqual(provider.availability?.(), { ok: true });
    assert.equal(calls.length, 0, '探活不该花一次合成');
  });

  test('地址写坏：不可用，理由说清前缀要求', async () => {
    const provider = createCloudProvider({
      settings: () => cloudSettingsOf({ cloud: { baseURL: 'api.example.com' } }),
      readKey: async () => 'sk-test',
    });
    assert.equal(await provider.refresh?.(), false);
    const verdict = provider.availability?.();
    assert.match(verdict && !verdict.ok ? verdict.reason : '', /http:\/\//);
  });

  test('标了 billable：自动回退链不得选它', () => {
    const provider = createCloudProvider({ settings: () => cloudSettingsOf({}), readKey: async () => undefined });
    assert.equal(provider.billable, true);
  });
});

describe('createCloudProvider —— 合成', () => {
  test('请求形状：路径、鉴权、三个字段，没有 model 与语速', async () => {
    const { calls, fetchImpl } = recorder(
      () => new Response(WAV, { status: 200, headers: { 'content-type': 'audio/wav' } }),
    );
    const provider = createCloudProvider({
      settings: () => cloudSettingsOf({ cloud: { baseURL: 'https://api.deepseek.com/', voice: 'tide' } }),
      readKey: async () => 'sk-test',
      fetch: fetchImpl,
    });
    const clip = await provider.synthesize(ask);
    assert.equal(clip.mime, 'audio/wav');
    assert.deepEqual(new Uint8Array(clip.data), WAV);

    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call?.url, 'https://api.deepseek.com/v1/tools/tts');
    assert.equal(call?.init?.method, 'POST');
    const headers = call?.init?.headers as Record<string, string>;
    assert.equal(headers.authorization, 'Bearer sk-test');
    assert.equal(headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(String(call?.init?.body)), {
      text: '你好',
      voice_id: 'tide',
      format: 'wav',
      filter_markdown: true,
    });
  });

  test('音色为空时按默认 stella（服务端认不出空值）', async () => {
    const { calls, fetchImpl } = recorder(() => new Response(WAV));
    const provider = createCloudProvider({
      settings: () => cloudSettingsOf({}),
      readKey: async () => 'sk-test',
      fetch: fetchImpl,
    });
    await provider.synthesize(ask);
    assert.equal(JSON.parse(String(calls[0]?.init?.body)).voice_id, 'stella');
    assert.equal(calls[0]?.url, DEFAULT_CLOUD_BASE_URL + '/v1/tools/tts');
  });

  test('内容审核 400：抛错，lastError 带服务端原话', async () => {
    const body = JSON.stringify({ error: { message: 'Content Exists Risk' } });
    const provider = createCloudProvider({
      settings: () => cloudSettingsOf({}),
      readKey: async () => 'sk-test',
      fetch: recorder(() => new Response(body, { status: 400 })).fetchImpl,
    });
    await assert.rejects(() => provider.synthesize(ask), /400/);
    assert.match(provider.lastError?.() ?? '', /Content Exists Risk/);
  });

  test('非 JSON 的错误体也留一句可读的文案', async () => {
    const provider = createCloudProvider({
      settings: () => cloudSettingsOf({}),
      readKey: async () => 'sk-test',
      fetch: recorder(() => new Response('<html>503</html>', { status: 503 })).fetchImpl,
    });
    await assert.rejects(() => provider.synthesize(ask), /503/);
    assert.match(provider.lastError?.() ?? '', /503/);
  });

  test('空音频按失败处理，不写半截缓存', async () => {
    const provider = createCloudProvider({
      settings: () => cloudSettingsOf({}),
      readKey: async () => 'sk-test',
      fetch: recorder(() => new Response(new Uint8Array(0))).fetchImpl,
    });
    await assert.rejects(() => provider.synthesize(ask), /音频为空/);
    assert.match(provider.lastError?.() ?? '', /音频为空/);
  });

  test('没有 key 时不发请求，直接抛', async () => {
    const { calls, fetchImpl } = recorder(() => new Response(WAV));
    const provider = createCloudProvider({
      settings: () => cloudSettingsOf({}),
      readKey: async () => undefined,
      fetch: fetchImpl,
    });
    await assert.rejects(() => provider.synthesize(ask), /API Key/);
    assert.equal(calls.length, 0);
  });

  test('传输层抛错（超时）也留原因', async () => {
    const provider = createCloudProvider({
      settings: () => cloudSettingsOf({}),
      readKey: async () => 'sk-test',
      fetch: (async () => {
        throw new Error('The operation was aborted');
      }) as typeof fetch,
    });
    await assert.rejects(() => provider.synthesize(ask), /请求失败/);
    assert.match(provider.lastError?.() ?? '', /aborted/);
  });

  test('合成成功后清掉上一次的失败原因', async () => {
    let fail = true;
    const provider = createCloudProvider({
      settings: () => cloudSettingsOf({}),
      readKey: async () => 'sk-test',
      fetch: (async () => (fail ? new Response('boom', { status: 500 }) : new Response(WAV))) as typeof fetch,
    });
    await assert.rejects(() => provider.synthesize(ask));
    assert.match(provider.lastError?.() ?? '', /500/);
    fail = false;
    await provider.synthesize(ask);
    assert.equal(provider.lastError?.(), undefined);
  });

  test('缓存指纹随音色变：换嗓子不能命中旧音频', () => {
    const tide = createCloudProvider({
      settings: () => cloudSettingsOf({ cloud: { voice: 'tide' } }),
      readKey: async () => 'sk-test',
    });
    const stella = createCloudProvider({ settings: () => cloudSettingsOf({}), readKey: async () => 'sk-test' });
    assert.equal(tide.cacheTag?.(), 'tide');
    assert.equal(stella.cacheTag?.(), 'stella');
    assert.equal(tide.activeVoice?.(), 'tide');
  });

  test('列得出的音色与下拉候选一致', () => {
    const provider = createCloudProvider({ settings: () => cloudSettingsOf({}), readKey: async () => 'sk-test' });
    const ids = (provider.listVoices?.() ?? []).map((voice) => voice.id);
    const options = CLOUD_FIELDS.find((field) => field.key === 'voice')?.options ?? [];
    assert.deepEqual(ids, [...options]);
  });
});
