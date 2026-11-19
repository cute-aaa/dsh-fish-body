/**
 * 云端 TTS 的契约测试：三种协议的请求形状、配置判据、响应嗅探、老配置兼容与缓存指纹。
 *
 * 钉住这几件事，因为它们是「接上任意 TTS 之后不会悄悄多花钱 / 不会静默坏掉 / 不会把密钥发错地方」的全部保证：
 *   1. 探活只看配置与密钥在场，**不发请求**（TTS 没有免费 ping，拿一句话去试就等于付钱）；
 *   2. 三种协议各自的 URL、鉴权头与 body 形状；`deepseek` 必须与改造前逐字节一致（老配置直接换代）；
 *   3. 返回什么类型由魔数决定，不信 `Content-Type`；认不出就把前 16 字节与 Content-Type 一起报出来；
 *   4. 非 2xx 的错误文案截断到 512 字符，带 `protocol` 与脱敏后的 `baseURL`，绝不带 key；
 *   5. 换协议 / 换服务 / 换模型 / 换音色 / 换模板都必须改变缓存指纹。
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
  DEFAULT_CLOUD_PROTOCOL,
  cloudBaseURL,
  cloudCacheTag,
  cloudConfigProblems,
  cloudConfigured,
  cloudFieldsFor,
  cloudKeyRefs,
  cloudProtocolOf,
  cloudSettingsOf,
  cloudSpeechURL,
  cloudVoiceId,
  createCloudKeyReader,
  createCloudProvider,
  hexPreview,
  redactURL,
  sniffAudioMime,
} from './provider.ts';
import { secretFieldsOf, secretRefsOf } from '../provider-secrets.ts';

/** 造一段以 `head` 开头的假音频字节（其余填 0x07，内容不参与判定）。 */
function audioBytes(head: readonly number[], total = 64): Uint8Array {
  const data = new Uint8Array(total).fill(0x07);
  head.forEach((byte, index) => {
    data[index] = byte;
  });
  return data;
}

const WAV = audioBytes([0x52, 0x49, 0x46, 0x46]); // RIFF
const MP3_ID3 = audioBytes([0x49, 0x44, 0x33]); // ID3
const MP3_FRAME = audioBytes([0xff, 0xfb]); // 0xFF Ex
const OGG = audioBytes([0x4f, 0x67, 0x67, 0x53]); // OggS
const M4A = audioBytes([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]); // ....ftyp
const HTML = audioBytes([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]);

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

/** 从 `{ cloud: {...} }` 形状读配置，测试里少写一层。 */
function cloudOf(conf: Record<string, unknown>): ReturnType<typeof cloudSettingsOf> {
  return cloudSettingsOf({ cloud: conf });
}

/** 一次合成的输入（语速对云端无效，但要按链的形状传）。 */
const ask = { text: '你好', rate: '+0%' };

/** 造一个「配置齐全」的 provider 便于各个用例只关心自己那一段。 */
function providerOf(
  conf: Record<string, unknown>,
  options: { key?: string | undefined; response?: () => Response } = {},
) {
  const { calls, fetchImpl } = recorder(options.response ?? (() => new Response(WAV)));
  const provider = createCloudProvider({
    settings: () => cloudOf(conf),
    readKey: async () => ('key' in options ? options.key : 'sk-test'),
    fetch: fetchImpl,
  });
  return { provider, calls };
}

/** 造一个「凭据库」很薄的替身：只有 `resolve`，与宿主 `ctx.credentials` 的那一面同形。 */
function fakeCredentials(store: Record<string, string>): unknown {
  return {
    resolve: async (ref: unknown) => {
      const value = store[String(ref)];
      return value === undefined ? undefined : { value };
    },
  };
}

describe('cloudSettingsOf —— 解析与老配置兼容', () => {
  test('缺段 / 写坏都当全空，协议落回缺省', () => {
    for (const source of [undefined, null, 'x', [], { gsv: {} }]) {
      assert.deepEqual(cloudSettingsOf(source), {
        useCloud: false,
        protocol: DEFAULT_CLOUD_PROTOCOL,
        baseURL: '',
        model: '',
        voice: '',
        path: '',
        bodyTemplate: '',
        headers: '',
        format: '',
      });
    }
  });

  test('只取字符串并 trim；只有 on 才算开启', () => {
    assert.deepEqual(cloudSettingsOf({ cloud: { baseURL: ' https://a/v1 ', voice: ' tide ', useCloud: 'on' } }), {
      useCloud: true,
      protocol: 'openai',
      baseURL: 'https://a/v1',
      model: '',
      voice: 'tide',
      path: '',
      bodyTemplate: '',
      headers: '',
      format: '',
    });
    assert.equal(cloudSettingsOf({ cloud: { useCloud: 'on ' } }).useCloud, true);
    for (const value of ['off', 'true', 'ON', 1, true, '', undefined]) {
      assert.equal(cloudSettingsOf({ cloud: { useCloud: value } }).useCloud, false, `useCloud=${String(value)}`);
    }
  });

  test('没有 protocol：空地址或含 deepseek 判 deepseek，其余判 openai', () => {
    assert.equal(cloudSettingsOf({ cloud: {} }).protocol, 'deepseek');
    assert.equal(cloudSettingsOf({ cloud: { baseURL: 'https://api.deepseek.com' } }).protocol, 'deepseek');
    assert.equal(cloudSettingsOf({ cloud: { baseURL: 'https://my-deepseek-proxy.lan/v1' } }).protocol, 'deepseek');
    assert.equal(cloudSettingsOf({ cloud: { baseURL: 'https://api.openai.com/v1' } }).protocol, 'openai');
    assert.equal(cloudSettingsOf({ cloud: { baseURL: 'http://127.0.0.1:8080' } }).protocol, 'openai');
  });

  test('显式 protocol 优先于地址推断，大小写与空白都被归一', () => {
    assert.equal(cloudProtocolOf('OpenAI ', 'https://api.deepseek.com'), 'openai');
    assert.equal(cloudProtocolOf(' custom', 'https://api.openai.com'), 'custom');
    assert.equal(cloudProtocolOf('deepseek', 'https://anything.example.com'), 'deepseek');
    // 写坏的值不算显式：退回按地址推断，不让一个手滑把配置判成不可用
    assert.equal(cloudProtocolOf('openaii', 'https://api.deepseek.com'), 'deepseek');
    assert.equal(cloudProtocolOf(42, 'https://x.example.com'), 'openai');
  });
});

describe('生效值归一', () => {
  test('地址留空按协议取默认，末尾斜杠去掉', () => {
    assert.equal(cloudBaseURL(cloudOf({})), DEFAULT_CLOUD_BASE_URL);
    assert.equal(cloudBaseURL(cloudOf({ protocol: 'openai' })), 'https://api.openai.com');
    assert.equal(cloudBaseURL(cloudOf({ protocol: 'custom' })), '');
    assert.equal(cloudBaseURL(cloudOf({ baseURL: 'https://a/v1//' })), 'https://a/v1');
    assert.equal(DEFAULT_CLOUD_BASE_URL, 'https://api.deepseek.com');
  });

  test('音色是自由文本：空值只有 deepseek 才补 stella', () => {
    assert.equal(cloudVoiceId(cloudOf({ voice: 'alloy' })), 'alloy');
    assert.equal(cloudVoiceId(cloudOf({ voice: 'tide' })), 'tide');
    assert.equal(cloudVoiceId(cloudOf({})), 'stella');
    assert.equal(cloudVoiceId(cloudOf({ protocol: 'openai', voice: 'nova' })), 'nova');
    assert.equal(cloudVoiceId(cloudOf({ protocol: 'openai' })), '');
  });

  test('合成地址：openai 不重复拼 /v1，custom 支持绝对 path', () => {
    assert.equal(
      cloudSpeechURL(cloudOf({ protocol: 'deepseek', baseURL: 'https://api.deepseek.com' })),
      'https://api.deepseek.com/v1/tools/tts',
    );
    assert.equal(
      cloudSpeechURL(cloudOf({ protocol: 'openai', baseURL: 'https://api.openai.com/v1' })),
      'https://api.openai.com/v1/audio/speech',
    );
    assert.equal(
      cloudSpeechURL(cloudOf({ protocol: 'openai', baseURL: 'https://tts.example.com' })),
      'https://tts.example.com/v1/audio/speech',
    );
    assert.equal(
      cloudSpeechURL(cloudOf({ protocol: 'custom', baseURL: 'https://tts.example.com', path: 'tts' })),
      'https://tts.example.com/tts',
    );
    assert.equal(
      cloudSpeechURL(
        cloudOf({ protocol: 'custom', baseURL: 'https://tts.example.com', path: 'https://other.example.com/say' }),
      ),
      'https://other.example.com/say',
    );
  });

  test('cloudConfigured 只看付费开关', () => {
    assert.equal(cloudConfigured(cloudOf({ useCloud: 'on' })), true);
    assert.equal(cloudConfigured(cloudOf({ baseURL: 'https://a', voice: 'tide' })), false);
  });
});

describe('CLOUD_FIELDS —— 声明与动态必填', () => {
  test('密钥字段带主引用与只读回退引用', () => {
    const secrets = secretFieldsOf(CLOUD_FIELDS);
    assert.deepEqual(
      secrets.map((field) => [field.key, field.credentialRef]),
      [['apiKey', CLOUD_API_KEY_REF]],
    );
    assert.deepEqual(secretRefsOf(secrets[0]!), [CLOUD_API_KEY_REF, CLOUD_API_KEY_FALLBACK]);
  });

  test('音色是自由文本输入框，不再是 stella / tide 下拉', () => {
    const voice = CLOUD_FIELDS.find((field) => field.key === 'voice');
    assert.equal(voice?.kind, 'text');
    assert.equal(voice?.options, undefined);
    assert.match(voice?.description ?? '', /alloy/);
    assert.match(voice?.description ?? '', /stella/);
  });

  test('必填随协议变：openai 要 baseURL+model+voice，custom 要 baseURL+path+bodyTemplate', () => {
    const requiredOf = (conf: Record<string, unknown>): string[] =>
      cloudFieldsFor(cloudOf(conf))
        .filter((field) => field.required === true)
        .map((field) => field.key)
        .sort();
    assert.deepEqual(requiredOf({ protocol: 'deepseek' }), ['apiKey']);
    assert.deepEqual(requiredOf({ protocol: 'openai' }), ['apiKey', 'baseURL', 'model', 'voice']);
    assert.deepEqual(requiredOf({ protocol: 'custom' }), ['apiKey', 'baseURL', 'bodyTemplate', 'path']);
    // 缺 protocol 的老配置按地址推断：推断成 openai 时它那几项就是必填
    assert.deepEqual(requiredOf({ baseURL: 'https://api.openai.com/v1' }), ['apiKey', 'baseURL', 'model', 'voice']);
  });

  test('protocol 下拉把当前生效协议排最前（老配置显示的必须是真的那个）', () => {
    const optionsOf = (conf: Record<string, unknown>): readonly string[] =>
      cloudFieldsFor(cloudOf(conf)).find((field) => field.key === 'protocol')?.options ?? [];
    assert.equal(optionsOf({})[0], 'deepseek');
    assert.equal(optionsOf({ baseURL: 'https://api.openai.com/v1' })[0], 'openai');
    assert.equal(optionsOf({ protocol: 'custom' })[0], 'custom');
    assert.deepEqual([...optionsOf({})].sort(), ['custom', 'deepseek', 'openai']);
  });
});

describe('云端密钥引用 —— 只有 deepseek 复用宿主 DEEPSEEK_API_KEY', () => {
  test('引用策略：deepseek 两把，openai / custom 只认主引用', () => {
    assert.deepEqual(cloudKeyRefs('deepseek'), [CLOUD_API_KEY_REF, CLOUD_API_KEY_FALLBACK]);
    assert.deepEqual(cloudKeyRefs('openai'), [CLOUD_API_KEY_REF]);
    assert.deepEqual(cloudKeyRefs('custom'), [CLOUD_API_KEY_REF]);
  });

  test('openai + 只有宿主 DEEPSEEK_API_KEY：不可用，且一个请求都不发', async () => {
    const { calls, fetchImpl } = recorder(() => new Response(WAV));
    const provider = createCloudProvider({
      settings: () => cloudOf({ protocol: 'openai', baseURL: 'https://tts.example.com', model: 'm', voice: 'v' }),
      readKey: createCloudKeyReader(fakeCredentials({ [CLOUD_API_KEY_FALLBACK]: 'sk-host-deepseek' })),
      fetch: fetchImpl,
    });
    assert.equal(await provider.refresh?.(), false);
    const reason = provider.availability?.();
    assert.match(reason && !reason.ok ? reason.reason : '', /API Key/);
    await assert.rejects(() => provider.synthesize(ask), /API Key/);
    assert.equal(calls.length, 0, '读不到 key 就不该发请求，更不该把宿主的 key 发给第三方地址');
  });

  test('custom + 只有宿主 DEEPSEEK_API_KEY：同样不可用', async () => {
    const provider = createCloudProvider({
      settings: () =>
        cloudOf({
          protocol: 'custom',
          baseURL: 'https://tts.example.com',
          path: '/tts',
          bodyTemplate: '{"text":"{text}"}',
        }),
      readKey: createCloudKeyReader(fakeCredentials({ [CLOUD_API_KEY_FALLBACK]: 'sk-host-deepseek' })),
    });
    assert.equal(await provider.refresh?.(), false);
    const reason = provider.availability?.();
    assert.match(reason && !reason.ok ? reason.reason : '', /API Key/);
  });

  test('deepseek + 只有宿主 DEEPSEEK_API_KEY：仍可用（向后兼容），请求带的就是那把 key', async () => {
    const { calls, fetchImpl } = recorder(() => new Response(WAV));
    const provider = createCloudProvider({
      settings: () => cloudOf({ baseURL: 'https://api.deepseek.com', voice: 'tide' }),
      readKey: createCloudKeyReader(fakeCredentials({ [CLOUD_API_KEY_FALLBACK]: 'sk-host-deepseek' })),
      fetch: fetchImpl,
    });
    assert.equal(await provider.refresh?.(), true);
    await provider.synthesize(ask);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    assert.equal(headers.authorization, 'Bearer sk-host-deepseek');
  });

  test('主引用在场时永远优先用它', async () => {
    const readKey = createCloudKeyReader(
      fakeCredentials({ [CLOUD_API_KEY_REF]: 'sk-mine', [CLOUD_API_KEY_FALLBACK]: 'sk-host' }),
    );
    assert.equal(await readKey('deepseek'), 'sk-mine');
    assert.equal(await readKey('openai'), 'sk-mine');
    assert.equal(await readKey('custom'), 'sk-mine');
  });

  test('凭据服务缺席或读失败：按没配处理，不抛', async () => {
    assert.equal(await createCloudKeyReader(undefined)('deepseek'), undefined);
    assert.equal(await createCloudKeyReader('not a service')('deepseek'), undefined);
    const throwing = {
      resolve: async () => {
        throw new Error('credentials unavailable');
      },
    };
    assert.equal(await createCloudKeyReader(throwing)('deepseek'), undefined);
  });

  test('apiKey 字段的回退引用跟着协议收起（设置页不会对第三方地址显示「已保存」）', () => {
    const fallbacksOf = (conf: Record<string, unknown>): readonly string[] | undefined =>
      cloudFieldsFor(cloudOf(conf)).find((field) => field.key === 'apiKey')?.credentialFallbacks;
    assert.deepEqual(fallbacksOf({ protocol: 'deepseek' }), [CLOUD_API_KEY_FALLBACK]);
    for (const protocol of ['openai', 'custom']) {
      assert.deepEqual(fallbacksOf({ protocol }), [], protocol);
    }
  });
});

describe('createCloudProvider —— 可用性（只判配置，不发请求）', () => {
  test('未探活前不可用，理由给人话', async () => {
    const provider = createCloudProvider({ settings: () => cloudOf({}), readKey: async () => undefined });
    const verdict = provider.availability?.();
    assert.equal(verdict?.ok, false);
    assert.match(verdict && !verdict.ok ? verdict.reason : '', /尚未探活/);
  });

  test('没有 key：不可用，理由点明可复用宿主凭据', async () => {
    const provider = createCloudProvider({ settings: () => cloudOf({}), readKey: async () => undefined });
    assert.equal(await provider.refresh?.(), false);
    const reason = provider.availability?.();
    assert.equal(reason?.ok, false);
    assert.match(reason && !reason.ok ? reason.reason : '', /API Key/);
    assert.match(reason && !reason.ok ? reason.reason : '', new RegExp(CLOUD_API_KEY_FALLBACK));
  });

  test('老配置（只有 baseURL + voice）+ key：可用，且探活一次请求都不发', async () => {
    const { provider, calls } = providerOf({
      useCloud: 'on',
      baseURL: 'https://api.deepseek.com',
      voice: 'tide',
    });
    assert.equal(await provider.refresh?.(), true);
    assert.deepEqual(provider.availability?.(), { ok: true });
    assert.equal(calls.length, 0, '探活不该花一次合成');
  });

  test('openai 缺 model / voice：理由把两个字段都点出来', async () => {
    const provider = createCloudProvider({
      settings: () => cloudOf({ protocol: 'openai', baseURL: 'https://tts.example.com' }),
      readKey: async () => 'sk-test',
    });
    assert.equal(await provider.refresh?.(), false);
    const reason = provider.availability?.();
    assert.match(reason && !reason.ok ? reason.reason : '', /model/);
    assert.match(reason && !reason.ok ? reason.reason : '', /voice/);
  });

  test('custom 缺 bodyTemplate：理由点名字段', async () => {
    const problems = cloudConfigProblems(
      cloudOf({ protocol: 'custom', baseURL: 'https://tts.example.com', path: '/tts' }),
      true,
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /bodyTemplate/);
  });

  test('custom 模板缺 {text} / 不是 JSON / headers 写坏：都是配置错误', async () => {
    const missingText = cloudConfigProblems(
      cloudOf({ protocol: 'custom', baseURL: 'https://a', path: '/t', bodyTemplate: '{"input":"hi"}' }),
      true,
    );
    assert.match(missingText.join('；'), /\{text\}/);

    const brokenJSON = cloudConfigProblems(
      cloudOf({ protocol: 'custom', baseURL: 'https://a', path: '/t', bodyTemplate: '{"text":"{text}"' }),
      true,
    );
    assert.match(brokenJSON.join('；'), /bodyTemplate 不是合法的 JSON 对象/);

    const brokenHeaders = cloudConfigProblems(
      cloudOf({
        protocol: 'custom',
        baseURL: 'https://a',
        path: '/t',
        bodyTemplate: '{"text":"{text}"}',
        headers: 'x',
      }),
      true,
    );
    assert.match(brokenHeaders.join('；'), /headers 不是合法的 JSON 对象/);
  });

  test('地址写坏：不可用，理由说清前缀要求', async () => {
    const provider = createCloudProvider({
      settings: () => cloudOf({ baseURL: 'api.example.com' }),
      readKey: async () => 'sk-test',
    });
    assert.equal(await provider.refresh?.(), false);
    const reason = provider.availability?.();
    assert.match(reason && !reason.ok ? reason.reason : '', /http:\/\//);
  });

  test('配置变了 refresh 会翻牌，并且清掉上次的失败原因', async () => {
    let conf: Record<string, unknown> = { useCloud: 'on' };
    const provider = createCloudProvider({
      settings: () => cloudOf(conf),
      readKey: async () => 'sk-test',
      fetch: (async () => new Response('boom', { status: 500 })) as typeof fetch,
    });
    assert.equal(await provider.refresh?.(), true);
    await assert.rejects(() => provider.synthesize(ask));
    assert.match(provider.lastError?.() ?? '', /500/);
    conf = { useCloud: 'on', protocol: 'openai', baseURL: 'https://tts.example.com' };
    assert.equal(await provider.refresh?.(), false, '缺 model / voice 应当立刻判不可用');
    const reason = provider.availability?.();
    assert.match(reason && !reason.ok ? reason.reason : '', /model/);
  });

  test('标了 billable：自动回退链不得选它', () => {
    const provider = createCloudProvider({ settings: () => cloudOf({}), readKey: async () => undefined });
    assert.equal(provider.billable, true);
  });
});

describe('createCloudProvider —— 三种协议的请求构造', () => {
  test('deepseek：路径、鉴权与 body 与改造前逐字节一致（向后兼容）', async () => {
    const { provider, calls } = providerOf({
      protocol: 'deepseek',
      baseURL: 'https://api.deepseek.com/',
      voice: 'tide',
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

  test('deepseek 音色为空按 stella，地址留空按官方默认', async () => {
    const { provider, calls } = providerOf({});
    await provider.synthesize(ask);
    assert.equal(JSON.parse(String(calls[0]?.init?.body)).voice_id, 'stella');
    assert.equal(calls[0]?.url, DEFAULT_CLOUD_BASE_URL + '/v1/tools/tts');
  });

  test('openai：/v1/audio/speech、四个字段、response_format 默认 mp3', async () => {
    const { provider, calls } = providerOf({
      protocol: 'openai',
      baseURL: 'https://tts.example.com',
      model: 'gpt-4o-mini',
      voice: 'alloy',
    });
    await provider.synthesize(ask);
    const [call] = calls;
    assert.equal(call?.url, 'https://tts.example.com/v1/audio/speech');
    const headers = call?.init?.headers as Record<string, string>;
    assert.equal(headers.authorization, 'Bearer sk-test');
    assert.equal(headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(String(call?.init?.body)), {
      model: 'gpt-4o-mini',
      input: '你好',
      voice: 'alloy',
      response_format: 'mp3',
    });
  });

  test('openai：baseURL 已含 /v1 时不重复，response_format 可配', async () => {
    const { provider, calls } = providerOf({
      protocol: 'openai',
      baseURL: 'https://api.openai.com/v1',
      model: 'tts-1',
      voice: 'nova',
      format: 'wav',
    });
    await provider.synthesize(ask);
    assert.equal(calls[0]?.url, 'https://api.openai.com/v1/audio/speech');
    assert.equal(JSON.parse(String(calls[0]?.init?.body)).response_format, 'wav');
  });

  test('custom：路径拼接、模板占位符替换、额外请求头合并且可覆盖默认', async () => {
    const { provider, calls } = providerOf({
      protocol: 'custom',
      baseURL: 'https://tts.example.com/base/',
      path: 'tts',
      model: 'm1',
      voice: 'v1',
      bodyTemplate: '{"text":"{text}","speaker":"{voice}","model":"{model}"}',
      headers: '{"xi-api-key":"k2","content-type":"application/json; charset=utf-8"}',
    });
    const text = '他说"你好"';
    await provider.synthesize({ text, rate: '+0%' });
    const [call] = calls;
    assert.equal(call?.url, 'https://tts.example.com/base/tts');
    const headers = call?.init?.headers as Record<string, string>;
    assert.equal(headers.authorization, 'Bearer sk-test');
    assert.equal(headers['xi-api-key'], 'k2');
    assert.equal(headers['content-type'], 'application/json; charset=utf-8');
    // 模板替换值做过 JSON 转义：台词里的引号不会拼坏 body
    assert.deepEqual(JSON.parse(String(call?.init?.body)), { text, speaker: 'v1', model: 'm1' });
  });

  test('custom：模板缺 {text} 时不发请求，直接按配置错误失败', async () => {
    const { provider, calls } = providerOf({
      protocol: 'custom',
      baseURL: 'https://tts.example.com',
      path: '/tts',
      bodyTemplate: '{"input":"hi"}',
    });
    await assert.rejects(() => provider.synthesize(ask), /\{text\}/);
    assert.equal(calls.length, 0);
    assert.match(provider.lastError?.() ?? '', /\{text\}/);
  });
});

describe('createCloudProvider —— 响应处理', () => {
  test('魔数嗅探四类容器（不看 Content-Type）', () => {
    assert.equal(sniffAudioMime(WAV), 'audio/wav');
    assert.equal(sniffAudioMime(MP3_ID3), 'audio/mpeg');
    assert.equal(sniffAudioMime(MP3_FRAME), 'audio/mpeg');
    assert.equal(sniffAudioMime(OGG), 'audio/ogg');
    assert.equal(sniffAudioMime(M4A), 'audio/mp4');
    assert.equal(sniffAudioMime(HTML), undefined);
    assert.equal(sniffAudioMime(new Uint8Array(0)), undefined);
  });

  test('合成回来的 mime 跟着魔数走（服务端谎报 Content-Type 也没用）', async () => {
    for (const [bytes, mime] of [
      [WAV, 'audio/wav'],
      [MP3_ID3, 'audio/mpeg'],
      [OGG, 'audio/ogg'],
      [M4A, 'audio/mp4'],
    ] as const) {
      const { provider } = providerOf(
        {},
        { response: () => new Response(bytes, { headers: { 'content-type': 'text/plain' } }) },
      );
      const clip = await provider.synthesize(ask);
      assert.equal(clip.mime, mime);
    }
  });

  test('认不出格式：报前 16 字节 hex 与 Content-Type', async () => {
    const { provider } = providerOf(
      {},
      { response: () => new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }) },
    );
    await assert.rejects(() => provider.synthesize(ask), /返回的不是音频/);
    const reason = provider.lastError?.() ?? '';
    assert.match(reason, /3c 68 74 6d 6c 3e/);
    assert.match(reason, /text\/html/);
    assert.equal(hexPreview(HTML), '3c 68 74 6d 6c 3e 07 07 07 07 07 07 07 07 07 07');
  });

  test('空响应按失败处理，不写半截缓存', async () => {
    const { provider } = providerOf({}, { response: () => new Response(new Uint8Array(0)) });
    await assert.rejects(() => provider.synthesize(ask), /音频为空/);
    assert.match(provider.lastError?.() ?? '', /音频为空/);
  });

  test('内容审核 400：抛错，lastError 带服务端原话', async () => {
    const body = JSON.stringify({ error: { message: 'Content Exists Risk' } });
    const { provider } = providerOf({}, { response: () => new Response(body, { status: 400 }) });
    await assert.rejects(() => provider.synthesize(ask), /400/);
    assert.match(provider.lastError?.() ?? '', /Content Exists Risk/);
  });

  test('非 2xx：文案截断到 512 字符，带 protocol 与 baseURL，且不含 key', async () => {
    const long = 'x'.repeat(600);
    const { provider } = providerOf(
      { protocol: 'openai', baseURL: 'https://tts.example.com', model: 'm', voice: 'v' },
      { key: 'sk-secret-key', response: () => new Response(long, { status: 500 }) },
    );
    let message = '';
    await assert.rejects(
      () => provider.synthesize(ask),
      (error: unknown) => {
        message = error instanceof Error ? error.message : String(error);
        return true;
      },
    );
    assert.match(message, /openai/);
    assert.match(message, /https:\/\/tts\.example\.com/);
    assert.ok(message.includes('x'.repeat(512)), '保留 512 字符');
    assert.ok(!message.includes('x'.repeat(513)), '超过 512 的部分必须截掉');
    assert.ok(!message.includes('sk-secret-key'), 'key 不进错误文案');
    assert.match(provider.lastError?.() ?? '', /^500（openai/);
  });

  test('非 JSON 的错误体也留一句可读的文案', async () => {
    const { provider } = providerOf({}, { response: () => new Response('<html>503</html>', { status: 503 }) });
    await assert.rejects(() => provider.synthesize(ask), /503/);
    assert.match(provider.lastError?.() ?? '', /503/);
  });

  test('没有 key 时不发请求，直接抛', async () => {
    const { provider, calls } = providerOf({}, { key: undefined });
    await assert.rejects(() => provider.synthesize(ask), /API Key/);
    assert.equal(calls.length, 0);
  });

  test('传输层抛错（超时）也留原因，并带上协议与地址', async () => {
    const provider = createCloudProvider({
      settings: () => cloudOf({}),
      readKey: async () => 'sk-test',
      fetch: (async () => {
        throw new Error('The operation was aborted');
      }) as typeof fetch,
    });
    await assert.rejects(() => provider.synthesize(ask), /请求失败/);
    const reason = provider.lastError?.() ?? '';
    assert.match(reason, /deepseek/);
    assert.match(reason, /aborted/);
  });

  test('合成成功后清掉上一次的失败原因', async () => {
    let failNext = true;
    const provider = createCloudProvider({
      settings: () => cloudOf({}),
      readKey: async () => 'sk-test',
      fetch: (async () =>
        failNext ? new Response('boom', { status: 500 }) : new Response(WAV)) as unknown as typeof fetch,
    });
    await assert.rejects(() => provider.synthesize(ask));
    assert.match(provider.lastError?.() ?? '', /500/);
    failNext = false;
    await provider.synthesize(ask);
    assert.equal(provider.lastError?.(), undefined);
  });
});

describe('缓存指纹与老配置', () => {
  const tagOf = (conf: Record<string, unknown>): string => cloudCacheTag(cloudOf(conf));
  const base = { protocol: 'openai', baseURL: 'https://tts.example.com', model: 'm', voice: 'v' };

  test('换协议 / 换地址 / 换模型 / 换音色 / 换格式 / 换模板都必须换键', () => {
    const tags = [
      tagOf(base),
      tagOf({ ...base, protocol: 'custom', path: '/t', bodyTemplate: '{"text":"{text}"}' }),
      tagOf({ ...base, baseURL: 'https://other.example.com' }),
      tagOf({ ...base, model: 'm2' }),
      tagOf({ ...base, voice: 'v2' }),
      tagOf({ ...base, format: 'wav' }),
      tagOf({ ...base, protocol: 'custom', path: '/t', bodyTemplate: '{"text":"{text}","speed":1}' }),
    ];
    assert.equal(new Set(tags).size, tags.length, '任意一项变化都不能命中旧音频');
  });

  test('同一份配置的指纹稳定，且不含密钥（指纹只由配置算出）', () => {
    assert.equal(tagOf(base), tagOf(base));
    assert.ok(!tagOf(base).includes('sk-'));
    assert.ok(tagOf(base).startsWith('openai|'));
  });

  test('老配置（无 protocol、DeepSeek 地址）指纹落在 deepseek 上，与显式写法一致', () => {
    const legacy = tagOf({ baseURL: 'https://api.deepseek.com', voice: 'tide' });
    const explicit = tagOf({ protocol: 'deepseek', baseURL: 'https://api.deepseek.com', voice: 'tide' });
    assert.equal(legacy, explicit);
    assert.match(legacy, /^deepseek\|/);
  });

  test('redactURL：去掉 userinfo、查询串与片段', () => {
    assert.equal(redactURL('https://user:pw@host.example.com/v1?key=abc#x'), 'https://host.example.com/v1');
    assert.equal(redactURL('https://host.example.com/v1/'), 'https://host.example.com/v1');
    assert.equal(redactURL(''), '(未配置)');
    assert.equal(redactURL('not a url?key=abc'), 'not a url');
  });

  test('云端只报「当前这一个」音色，并带上协议；真没配置才是空列表', () => {
    const openai = createCloudProvider({
      settings: () => cloudOf({ protocol: 'openai', voice: 'alloy' }),
      readKey: async () => 'sk-test',
    });
    assert.deepEqual(openai.listVoices?.(), [{ id: 'alloy', name: 'alloy', tag: 'openai' }]);
    assert.equal(openai.activeVoice?.(), 'alloy');

    // deepseek 留空按 stella：服务端会用它，所以仍算「配了」
    const deepseek = createCloudProvider({ settings: () => cloudOf({}), readKey: async () => 'sk-test' });
    assert.deepEqual(deepseek.listVoices?.(), [{ id: 'stella', name: 'stella', tag: 'deepseek' }]);

    // openai 没填 voice：没有可显示的嗓子
    const empty = createCloudProvider({
      settings: () => cloudOf({ protocol: 'openai' }),
      readKey: async () => 'sk-test',
    });
    assert.deepEqual(empty.listVoices?.(), []);
  });
});
