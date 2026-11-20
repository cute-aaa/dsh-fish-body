/**
 * 云端 TTS 的契约测试：四轴 + 预设的请求形状、配置判据、三种 JSON 响应取值、老配置兼容与缓存指纹。
 *
 * 钉住这几件事，因为它们是「接上任意 TTS 之后不会悄悄多花钱 / 不会静默坏掉 / 不会把密钥发错地方」的全部保证：
 *   1. 探活只看配置与密钥在场，**不发请求**（TTS 没有免费 ping，拿一句话去试就等于付钱）；
 *   2. 六个预设各自预填哪四轴；用户仍可逐项覆盖；
 *   3. `{voice}` 进路径、`api-key` 头、`key` 查询串、SSML 包裹、form 编码、JSON 转义；
 *   4. `json-base64` / `json-hex` / `json-url` 的取值（含数组下标路径）；
 *   5. 老 `protocol: 'deepseek'` 与改造前逐字节一致；密钥回退只按最终生效预设判；
 *   6. 换预设 / 换四轴 / 换服务 / 换模型 / 换音色都必须改变缓存指纹。
 *
 * 全部用注入的假 fetch，不打真网。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CLOUD_API_KEY_FALLBACK,
  CLOUD_API_KEY_REF,
  CLOUD_FIELDS,
  CLOUD_PRESETS,
  CLOUD_PRESET_NONE_LABEL,
  CLOUD_PRESET_SPECS,
  DEFAULT_CLOUD_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  EMPTY_CLOUD_SETTINGS,
  cloudAllowsHostKey,
  cloudAxesOf,
  cloudBaseURL,
  cloudCacheTag,
  cloudConfigProblems,
  cloudConfigured,
  cloudFieldsFor,
  cloudKeyRefs,
  cloudPresetOf,
  cloudProtocolOf,
  cloudRequiredKeys,
  cloudRequestOf,
  cloudSettingsOf,
  cloudSpeechURL,
  cloudVoiceId,
  createCloudKeyReader,
  createCloudProvider,
  digPath,
  expandCloudPresetPatch,
  hexPreview,
  redactURL,
  renderTemplate,
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

/** 一次假请求的两项关键形状。 */
interface Call {
  readonly url: string;
  readonly init?: RequestInit;
}

/** 造一个记下每次调用、按调用序号回响应的假传输层。 */
function recorder(respond: (call: Call, index: number) => Response): {
  calls: Call[];
  fetchImpl: typeof fetch;
} {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call: Call = { url: String(input), init };
    calls.push(call);
    return respond(call, calls.length - 1);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

/** 从 `{ cloud: {...} }` 形状读配置，测试里少写一层。 */
function cloudOf(conf: Record<string, unknown>): ReturnType<typeof cloudSettingsOf> {
  return cloudSettingsOf({ cloud: conf });
}

/** 一次合成的输入（语速对云端无效，但要按链的形状传）。 */
const ask = { text: '你好', rate: '+0%' };

/** 取请求头（fetch 的 init.headers 一定是普通对象）。 */
function headersOf(call: Call | undefined): Record<string, string> {
  return (call?.init?.headers ?? {}) as Record<string, string>;
}

/** 造一个「配置齐全」的 provider，便于各个用例只关心自己那一段。 */
function providerOf(
  conf: Record<string, unknown>,
  options: { key?: string | undefined; respond?: (call: Call, index: number) => Response } = {},
) {
  const { calls, fetchImpl } = recorder(options.respond ?? (() => new Response(WAV)));
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

/** 必填项（排好序，断言只管「有没有）。 */
function requiredOf(conf: Record<string, unknown>): string[] {
  return cloudFieldsFor(cloudOf(conf))
    .filter((field) => field.required === true)
    .map((field) => field.key)
    .sort();
}

describe('cloudSettingsOf —— 解析与老配置兼容', () => {
  test('缺段 / 写坏都当全空，预设落回缺省', () => {
    for (const source of [undefined, null, 'x', [], { gsv: {} }]) {
      assert.deepEqual(cloudSettingsOf(source), EMPTY_CLOUD_SETTINGS);
    }
    assert.equal(EMPTY_CLOUD_SETTINGS.preset, 'deepseek');
    assert.equal(EMPTY_CLOUD_SETTINGS.protocol, 'custom');
  });

  test('只取字符串并 trim；只有 on 才算开启', () => {
    const settings = cloudSettingsOf({
      cloud: { baseURL: ' https://a/v1 ', voice: ' tide ', useCloud: 'on', preset: 'DeepSeek' },
    });
    assert.equal(settings.useCloud, true);
    assert.equal(settings.baseURL, 'https://a/v1');
    assert.equal(settings.voice, 'tide');
    assert.equal(settings.preset, 'deepseek');
    assert.equal(settings.protocol, 'custom', '预设与协议不一致时，协议跟着预设归一');
    for (const value of ['off', 'true', 'ON', 1, true, '', undefined]) {
      assert.equal(cloudSettingsOf({ cloud: { useCloud: value } }).useCloud, false, `useCloud=${String(value)}`);
    }
  });

  test('没有 protocol / preset：空地址或含 deepseek 判 deepseek，其余判 openai-speech', () => {
    const legacy = cloudSettingsOf({ cloud: { baseURL: 'https://api.deepseek.com', voice: 'tide' } });
    assert.equal(legacy.preset, 'deepseek');
    assert.equal(legacy.protocol, 'custom');

    assert.equal(cloudSettingsOf({ cloud: {} }).preset, 'deepseek');
    assert.equal(cloudSettingsOf({ cloud: { baseURL: 'https://my-deepseek-proxy.lan/v1' } }).preset, 'deepseek');

    const openai = cloudSettingsOf({ cloud: { baseURL: 'https://api.openai.com/v1' } });
    assert.equal(openai.preset, 'openai-speech');
    assert.equal(openai.protocol, 'openai');
    assert.equal(cloudSettingsOf({ cloud: { baseURL: 'http://127.0.0.1:8080' } }).preset, 'openai-speech');
  });

  test('老 protocol 逐个映射到预设，deepseek 归一成 custom', () => {
    const deepseek = cloudSettingsOf({ cloud: { protocol: 'deepseek', baseURL: 'https://anything.example.com' } });
    assert.equal(deepseek.preset, 'deepseek');
    assert.equal(deepseek.protocol, 'custom');
    assert.equal(cloudSettingsOf({ cloud: { protocol: 'openai' } }).preset, 'openai-speech');
    assert.equal(cloudSettingsOf({ cloud: { protocol: 'custom' } }).preset, 'none');
  });

  test('显式 preset 优先，并且能把协议带过去', () => {
    const mimo = cloudOf({ preset: 'mimo' });
    assert.equal(mimo.preset, 'mimo');
    assert.equal(mimo.protocol, 'openai');
    const azure = cloudOf({ preset: 'azure' });
    assert.equal(azure.protocol, 'custom');
    // 预设写坏不算显式：退回按历史 protocol 推断
    assert.equal(cloudPresetOf('mimoo', 'openai', 'https://x'), 'openai-speech');
    assert.equal(cloudPresetOf(42, 'deepseek', 'https://x'), 'deepseek');
    // 下拉的显示值按 `none` 前缀容忍，其余字段原样读
    const manual = cloudOf({
      preset: CLOUD_PRESET_NONE_LABEL,
      path: '/t',
      bodyTemplate: '{"text":"{text}"}',
    });
    assert.equal(manual.preset, 'none');
    assert.equal(manual.protocol, 'custom');
    assert.equal(manual.path, '/t');
    assert.equal(manual.bodyTemplate, '{"text":"{text}"}');
    assert.equal(cloudPresetOf(CLOUD_PRESET_NONE_LABEL, 'openai', 'https://x'), 'none');
    assert.equal(cloudPresetOf('none', 'custom', ''), 'none');
  });

  test('cloudProtocolOf 归一：大小写/空白都吃，写坏的按地址推断', () => {
    assert.equal(cloudProtocolOf('OpenAI ', 'https://api.deepseek.com'), 'openai');
    assert.equal(cloudProtocolOf(' custom', 'https://api.openai.com'), 'custom');
    assert.equal(cloudProtocolOf('deepseek', 'https://anything.example.com'), 'custom');
    assert.equal(cloudProtocolOf('openaii', 'https://api.deepseek.com'), 'custom');
    assert.equal(cloudProtocolOf(42, 'https://x.example.com'), 'openai');
  });
});

describe('四轴解析 —— 预设默认值 + 用户覆盖', () => {
  test('六个预设各自预填的四轴', () => {
    const cases = [
      ['openai-speech', '/v1/audio/speech', 'bearer', 'json', 'audio', ''],
      ['mimo', '/v1/chat/completions', 'api-key-header', 'json', 'json-base64', 'choices.0.message.audio.data'],
      ['deepseek', '/v1/tools/tts', 'bearer', 'json', 'audio', ''],
      ['azure', '/cognitiveservices/v1', 'api-key-header', 'ssml', 'audio', ''],
      ['elevenlabs', '/v1/text-to-speech/{voice}', 'x-api-key', 'json', 'audio', ''],
      ['google', '/v1/text:synthesize?key={key}', 'query', 'json', 'json-base64', 'audioContent'],
    ] as const;
    for (const [preset, path, authStyle, bodyKind, responseKind, responsePath] of cases) {
      const axes = cloudAxesOf(cloudOf({ preset, baseURL: 'https://example.com', model: 'm', voice: 'v' }));
      assert.equal(axes.path, path, preset);
      assert.equal(axes.authStyle, authStyle, preset);
      assert.equal(axes.bodyKind, bodyKind, preset);
      assert.equal(axes.responseKind, responseKind, preset);
      assert.equal(axes.responsePath, responsePath, preset);
    }
    assert.equal(CLOUD_PRESET_SPECS.mimo.responsePath, 'choices.0.message.audio.data');
    assert.equal(CLOUD_PRESETS.length, 7, '六个预设 + none');
  });

  test('预设只是预填：逐项覆盖都生效', () => {
    const axes = cloudAxesOf(
      cloudOf({
        preset: 'mimo',
        path: '/v2/say/{voice}',
        authStyle: 'bearer',
        authHeader: 'X-Custom-Key',
        bodyKind: 'form',
        bodyTemplate: 'text={text}',
        responseKind: 'json-hex',
        responsePath: 'result.0.audio',
        format: 'mp3',
        headers: '{"x-extra":"1"}',
        model: 'my-model',
        voice: 'my-voice',
        baseURL: 'https://mine.example.com',
      }),
    );
    assert.equal(axes.path, '/v2/say/{voice}');
    assert.equal(axes.authStyle, 'bearer');
    assert.equal(axes.authHeader, 'X-Custom-Key');
    assert.equal(axes.bodyKind, 'form');
    assert.equal(axes.bodyTemplate, 'text={text}');
    assert.equal(axes.responseKind, 'json-hex');
    assert.equal(axes.responsePath, 'result.0.audio');
    assert.equal(axes.format, 'mp3');
    assert.equal(axes.headers, '{"x-extra":"1"}');
    assert.equal(axes.model, 'my-model');
    assert.equal(axes.voice, 'my-voice');
    assert.equal(axes.baseURL, 'https://mine.example.com');
  });

  test('空串 = 没设：清空某一项回到预设默认值', () => {
    const axes = cloudAxesOf(cloudOf({ preset: 'openai-speech', format: '', voice: '', bodyKind: '' }));
    assert.equal(axes.format, 'mp3');
    assert.equal(axes.voice, '');
    assert.equal(axes.bodyKind, 'json');
  });

  test('写坏的 select 值不算显式，回落预设默认', () => {
    const axes = cloudAxesOf(cloudOf({ preset: 'mimo', authStyle: 'basic', bodyKind: 'xml', responseKind: 'blob' }));
    assert.equal(axes.authStyle, 'api-key-header');
    assert.equal(axes.bodyKind, 'json');
    assert.equal(axes.responseKind, 'json-base64');
  });

  test('地址留空按预设/协议取默认，末尾斜杠去掉', () => {
    assert.equal(cloudBaseURL(cloudOf({})), DEFAULT_CLOUD_BASE_URL);
    assert.equal(cloudBaseURL(cloudOf({ protocol: 'openai' })), 'https://api.openai.com');
    assert.equal(cloudBaseURL(cloudOf({ protocol: 'custom' })), '');
    assert.equal(cloudBaseURL(cloudOf({ preset: 'azure' })), '');
    assert.equal(cloudBaseURL(cloudOf({ preset: 'deepseek', baseURL: 'https://a/v1//' })), 'https://a/v1');
    assert.equal(DEFAULT_CLOUD_BASE_URL, 'https://api.deepseek.com');
  });

  test('音色：deepseek 空值补 stella，其余预设原样（空就是空）', () => {
    assert.equal(cloudVoiceId(cloudOf({ voice: 'alloy' })), 'alloy');
    assert.equal(cloudVoiceId(cloudOf({ voice: 'tide' })), 'tide');
    assert.equal(cloudVoiceId(cloudOf({})), 'stella');
    assert.equal(cloudVoiceId(cloudOf({ protocol: 'openai', voice: 'nova' })), 'nova');
    assert.equal(cloudVoiceId(cloudOf({ protocol: 'openai' })), '');
  });

  test('合成地址：{voice} 进路径、{key} 进查询串、openai 不重复 /v1、custom 支持绝对 path', () => {
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
      cloudSpeechURL(cloudOf({ preset: 'elevenlabs', baseURL: 'https://api.elevenlabs.io', voice: 'Alice Smith' })),
      'https://api.elevenlabs.io/v1/text-to-speech/Alice%20Smith',
    );
    assert.equal(
      cloudSpeechURL(cloudOf({ preset: 'google', baseURL: 'https://g.example.com' }), 'gk-test'),
      'https://g.example.com/v1/text:synthesize?key=gk-test',
    );
    assert.equal(
      cloudSpeechURL(cloudOf({ protocol: 'custom', preset: 'none', baseURL: 'https://tts.example.com', path: 'tts' })),
      'https://tts.example.com/tts',
    );
    assert.equal(
      cloudSpeechURL(
        cloudOf({
          protocol: 'custom',
          preset: 'none',
          baseURL: 'https://tts.example.com',
          path: 'https://other.example.com/say',
        }),
      ),
      'https://other.example.com/say',
    );
  });

  test('authStyle=query 且模板没写 {key}：key 追加到查询串', () => {
    const url = cloudSpeechURL(
      cloudOf({
        protocol: 'custom',
        preset: 'none',
        baseURL: 'https://tts.example.com',
        path: '/say?fmt=wav',
        authStyle: 'query',
      }),
      'k 1',
    );
    assert.equal(url, 'https://tts.example.com/say?fmt=wav&key=k%201');
  });

  test('cloudConfigured 只看付费开关', () => {
    assert.equal(cloudConfigured(cloudOf({ useCloud: 'on' })), true);
    assert.equal(cloudConfigured(cloudOf({ baseURL: 'https://a', voice: 'tide' })), false);
  });
});

describe('cloudRequiredKeys / 字段声明', () => {
  test('必填随预设/协议/鉴权方式变', () => {
    assert.deepEqual(requiredOf({ protocol: 'deepseek' }), ['apiKey']);
    assert.deepEqual(requiredOf({ protocol: 'openai' }), ['apiKey', 'baseURL', 'model', 'voice']);
    assert.deepEqual(requiredOf({ protocol: 'custom' }), ['apiKey', 'baseURL', 'bodyTemplate', 'path']);
    assert.deepEqual(requiredOf({ baseURL: 'https://api.openai.com/v1' }), ['apiKey', 'baseURL', 'model', 'voice']);
    assert.deepEqual(requiredOf({ preset: 'mimo' }), ['apiKey', 'baseURL', 'model', 'voice']);
    assert.deepEqual(requiredOf({ preset: 'azure' }), ['apiKey', 'baseURL', 'voice']);
    assert.deepEqual(requiredOf({ preset: 'google' }), ['apiKey', 'baseURL', 'model']);
    assert.deepEqual(requiredOf({ preset: 'elevenlabs' }), ['apiKey', 'baseURL', 'model', 'voice']);
  });

  test('authStyle=none 的本机服务不要密钥', () => {
    const required = cloudRequiredKeys(
      cloudOf({
        protocol: 'custom',
        preset: 'none',
        baseURL: 'http://127.0.0.1:9000',
        path: '/tts',
        authStyle: 'none',
      }),
    );
    assert.ok(!required.includes('apiKey'));
    assert.deepEqual(
      cloudConfigProblems(
        cloudOf({
          protocol: 'custom',
          preset: 'none',
          baseURL: 'http://127.0.0.1:9000',
          path: '/tts',
          bodyTemplate: '{"text":"{text}"}',
          authStyle: 'none',
        }),
        true,
      ),
      [],
    );
  });

  test('字段清单：16 项，四轴字段齐全，密钥仍走凭据库', () => {
    assert.deepEqual(
      CLOUD_FIELDS.map((field) => field.key),
      [
        'useCloud',
        'preset',
        'protocol',
        'baseURL',
        'path',
        'authStyle',
        'authHeader',
        'model',
        'voice',
        'format',
        'bodyKind',
        'bodyTemplate',
        'responseKind',
        'responsePath',
        'headers',
        'apiKey',
      ],
    );
    const secrets = secretFieldsOf(CLOUD_FIELDS);
    assert.deepEqual(
      secrets.map((field) => [field.key, field.credentialRef]),
      [['apiKey', CLOUD_API_KEY_REF]],
    );
    assert.deepEqual(secretRefsOf(secrets[0]!), [CLOUD_API_KEY_REF, CLOUD_API_KEY_FALLBACK]);
  });

  test('下拉把当前生效值排最前（老配置显示的必须是真的那个）', () => {
    const optionsOf = (conf: Record<string, unknown>, key: string): readonly string[] =>
      cloudFieldsFor(cloudOf(conf)).find((field) => field.key === key)?.options ?? [];
    assert.equal(optionsOf({}, 'preset')[0], 'deepseek');
    assert.equal(optionsOf({ baseURL: 'https://api.openai.com/v1' }, 'preset')[0], 'openai-speech');
    assert.equal(optionsOf({ preset: 'azure' }, 'preset')[0], 'azure');
    assert.equal(optionsOf({ preset: 'mimo' }, 'authStyle')[0], 'api-key-header');
    assert.equal(optionsOf({ preset: 'azure' }, 'bodyKind')[0], 'ssml');
    assert.equal(optionsOf({ preset: 'mimo' }, 'responseKind')[0], 'json-base64');
    assert.equal(optionsOf({ preset: 'google' }, 'responseKind')[0], 'json-base64');
    assert.equal(optionsOf({ preset: 'mimo' }, 'protocol')[0], 'openai');
    assert.equal(optionsOf({ preset: 'azure' }, 'protocol')[0], 'custom');
    // 下拉直接把字符串当显示文本，所以 `none` 用带中文说明的显示值承载（不新增 UI 组件）
    assert.ok(optionsOf({}, 'preset').includes(CLOUD_PRESET_NONE_LABEL));
    assert.ok(!optionsOf({}, 'preset').includes('none'), '不再用裸 none 当显示值');
    assert.equal(optionsOf({ preset: CLOUD_PRESET_NONE_LABEL }, 'preset')[0], CLOUD_PRESET_NONE_LABEL);
    assert.deepEqual(
      [...optionsOf({}, 'preset')].sort(),
      [...CLOUD_PRESETS.map((preset) => (preset === 'none' ? CLOUD_PRESET_NONE_LABEL : preset))].sort(),
    );
  });
});

describe('云端密钥引用 —— 只按最终生效预设判', () => {
  test('引用策略：deepseek 两把，其余只认主引用', () => {
    assert.equal(cloudAllowsHostKey(cloudOf({ protocol: 'deepseek' })), true, '老配置映射来的也算');
    assert.deepEqual(cloudKeyRefs(cloudOf({ protocol: 'deepseek' })), [CLOUD_API_KEY_REF, CLOUD_API_KEY_FALLBACK]);
    assert.deepEqual(cloudKeyRefs(cloudOf({ preset: 'deepseek' })), [CLOUD_API_KEY_REF, CLOUD_API_KEY_FALLBACK]);
    for (const preset of ['openai-speech', 'mimo', 'azure', 'elevenlabs', 'google', 'none'] as const) {
      const settings = cloudOf({ preset, protocol: 'custom' });
      assert.equal(cloudAllowsHostKey(settings), false, preset);
      assert.deepEqual(cloudKeyRefs(settings), [CLOUD_API_KEY_REF], preset);
    }
  });

  test('openai-speech / mimo + 只有宿主 DEEPSEEK_API_KEY：不可用，且一个请求都不发', async () => {
    for (const preset of ['openai-speech', 'mimo'] as const) {
      const { calls, fetchImpl } = recorder(() => new Response(WAV));
      const provider = createCloudProvider({
        settings: () => cloudOf({ preset, baseURL: 'https://tts.example.com', model: 'm', voice: 'v' }),
        readKey: createCloudKeyReader(fakeCredentials({ [CLOUD_API_KEY_FALLBACK]: 'sk-host-deepseek' })),
        fetch: fetchImpl,
      });
      assert.equal(await provider.refresh?.(), false, preset);
      const reason = provider.availability?.();
      assert.match(reason && !reason.ok ? reason.reason : '', /API Key/);
      await assert.rejects(() => provider.synthesize(ask), /API Key/);
      assert.equal(calls.length, 0, '读不到 key 就不该发请求，更不该把宿主的 key 发给第三方地址');
    }
  });

  test('custom 四轴 + 只有宿主 DEEPSEEK_API_KEY：同样不可用', async () => {
    const provider = createCloudProvider({
      settings: () =>
        cloudOf({
          protocol: 'custom',
          preset: 'none',
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

  test('deepseek 预设（含老配置）+ 只有宿主凭据：仍可用，请求带的就是那把 key', async () => {
    for (const conf of [{ baseURL: 'https://api.deepseek.com', voice: 'tide' }, { protocol: 'deepseek' }]) {
      const { calls, fetchImpl } = recorder(() => new Response(WAV));
      const provider = createCloudProvider({
        settings: () => cloudOf(conf),
        readKey: createCloudKeyReader(fakeCredentials({ [CLOUD_API_KEY_FALLBACK]: 'sk-host-deepseek' })),
        fetch: fetchImpl,
      });
      assert.equal(await provider.refresh?.(), true);
      await provider.synthesize(ask);
      assert.equal(headersOf(calls[0]).authorization, 'Bearer sk-host-deepseek');
    }
  });

  test('主引用在场时永远优先用它', async () => {
    const readKey = createCloudKeyReader(
      fakeCredentials({ [CLOUD_API_KEY_REF]: 'sk-mine', [CLOUD_API_KEY_FALLBACK]: 'sk-host' }),
    );
    for (const preset of ['deepseek', 'openai-speech', 'mimo', 'google'] as const) {
      assert.equal(await readKey(cloudOf({ preset })), 'sk-mine', preset);
    }
  });

  test('凭据服务缺席或读失败：按没配处理，不抛', async () => {
    assert.equal(await createCloudKeyReader(undefined)(cloudOf({})), undefined);
    assert.equal(await createCloudKeyReader('not a service')(cloudOf({})), undefined);
    const throwing = {
      resolve: async () => {
        throw new Error('credentials unavailable');
      },
    };
    assert.equal(await createCloudKeyReader(throwing)(cloudOf({})), undefined);
  });

  test('apiKey 字段的回退引用跟着生效预设收起', () => {
    const fallbacksOf = (conf: Record<string, unknown>): readonly string[] | undefined =>
      cloudFieldsFor(cloudOf(conf)).find((field) => field.key === 'apiKey')?.credentialFallbacks;
    assert.deepEqual(fallbacksOf({ protocol: 'deepseek' }), [CLOUD_API_KEY_FALLBACK]);
    for (const preset of ['openai-speech', 'mimo', 'azure', 'elevenlabs', 'google', 'none'] as const) {
      assert.deepEqual(fallbacksOf({ preset, protocol: 'custom' }), [], preset);
    }
  });
});

describe('createCloudProvider —— 请求构造（每个预设）', () => {
  test('openai-speech：/v1/audio/speech、bearer、四字段 body、默认 mp3', async () => {
    const { provider, calls } = providerOf({
      preset: 'openai-speech',
      baseURL: 'https://tts.example.com',
      model: 'gpt-4o-mini',
      voice: 'alloy',
    });
    const clip = await provider.synthesize(ask);
    assert.equal(clip.mime, 'audio/wav');
    const [call] = calls;
    assert.equal(call?.url, 'https://tts.example.com/v1/audio/speech');
    assert.equal(call?.init?.method, 'POST');
    const headers = headersOf(call);
    assert.equal(headers.authorization, 'Bearer sk-test');
    assert.equal(headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(String(call?.init?.body)), {
      model: 'gpt-4o-mini',
      input: '你好',
      voice: 'alloy',
      response_format: 'mp3',
    });
  });

  test('openai-speech：baseURL 已含 /v1 不重复，response_format 可配', async () => {
    const { provider, calls } = providerOf({
      preset: 'openai-speech',
      baseURL: 'https://api.openai.com/v1',
      model: 'tts-1',
      voice: 'nova',
      format: 'wav',
    });
    await provider.synthesize(ask);
    assert.equal(calls[0]?.url, 'https://api.openai.com/v1/audio/speech');
    assert.equal(JSON.parse(String(calls[0]?.init?.body)).response_format, 'wav');
  });

  test('mimo：chat/completions + api-key 头 + choices 里的 base64 响应', async () => {
    const payload = Buffer.from(WAV).toString('base64');
    const { provider, calls } = providerOf(
      {
        preset: 'mimo',
        baseURL: 'https://api.mimo.example.com',
        model: 'mimo-v2-tts',
        voice: 'mimo_default',
      },
      {
        respond: () =>
          new Response(JSON.stringify({ choices: [{ message: { audio: { data: payload } } }] }), {
            headers: { 'content-type': 'application/json' },
          }),
      },
    );
    const clip = await provider.synthesize(ask);
    assert.equal(clip.mime, 'audio/wav');
    assert.deepEqual(new Uint8Array(clip.data), WAV);
    const [call] = calls;
    assert.equal(call?.url, 'https://api.mimo.example.com/v1/chat/completions');
    const headers = headersOf(call);
    assert.equal(headers['api-key'], 'sk-test');
    assert.equal(headers.authorization, undefined, 'MiMo 走 api-key 头，不该再发 bearer');
    assert.equal(headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(String(call?.init?.body)), {
      model: 'mimo-v2-tts',
      messages: [{ role: 'assistant', content: '你好' }],
      audio: { format: 'wav', voice: 'mimo_default' },
    });
  });

  test('deepseek：老配置（protocol=deepseek）路径、鉴权与 body 与改造前逐字节一致', async () => {
    const { provider, calls } = providerOf({
      protocol: 'deepseek',
      baseURL: 'https://api.deepseek.com/',
      voice: 'tide',
    });
    await provider.synthesize(ask);
    const [call] = calls;
    assert.equal(call?.url, 'https://api.deepseek.com/v1/tools/tts');
    assert.equal(call?.init?.method, 'POST');
    const headers = headersOf(call);
    assert.equal(headers.authorization, 'Bearer sk-test');
    assert.equal(headers['content-type'], 'application/json');
    assert.equal(
      String(call?.init?.body),
      '{"text":"你好","voice_id":"tide","format":"wav","filter_markdown":true}',
      '字节级兼容：字段名与顺序都不能变',
    );
  });

  test('deepseek：音色为空按 stella，地址留空按官方默认', async () => {
    const { provider, calls } = providerOf({});
    await provider.synthesize(ask);
    assert.equal(JSON.parse(String(calls[0]?.init?.body)).voice_id, 'stella');
    assert.equal(calls[0]?.url, DEFAULT_CLOUD_BASE_URL + '/v1/tools/tts');
  });

  test('azure：Ocp-Apim-Subscription-Key + ssml 包裹 + X-Microsoft-OutputFormat', async () => {
    const { provider, calls } = providerOf({
      preset: 'azure',
      baseURL: 'https://eastasia.tts.speech.microsoft.com',
      voice: 'zh-CN-XiaoxiaoNeural',
    });
    await provider.synthesize({ text: '你好 & <世界>', rate: '+0%' });
    const [call] = calls;
    assert.equal(call?.url, 'https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1');
    const headers = headersOf(call);
    assert.equal(headers['Ocp-Apim-Subscription-Key'], 'sk-test');
    assert.equal(headers.authorization, undefined);
    assert.equal(headers['content-type'], 'application/ssml+xml');
    assert.equal(headers['X-Microsoft-OutputFormat'], 'audio-24khz-48kbitrate-mono-mp3');
    assert.equal(
      String(call?.init?.body),
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">' +
        '<voice name="zh-CN-XiaoxiaoNeural">你好 &amp; &lt;世界&gt;</voice></speak>',
    );
  });

  test('elevenlabs：{voice} 进路径、xi-api-key 头、text + model_id', async () => {
    const { provider, calls } = providerOf({
      preset: 'elevenlabs',
      baseURL: 'https://api.elevenlabs.io',
      model: 'eleven_multilingual_v2',
      voice: '21m00Tcm4TlvDq8ikWAM',
    });
    await provider.synthesize(ask);
    const [call] = calls;
    assert.equal(call?.url, 'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM');
    const headers = headersOf(call);
    assert.equal(headers['xi-api-key'], 'sk-test');
    assert.equal(headers.authorization, undefined);
    assert.deepEqual(JSON.parse(String(call?.init?.body)), {
      text: '你好',
      model_id: 'eleven_multilingual_v2',
    });
  });

  test('google：key 进查询串、无鉴权头、audioContent 解 base64', async () => {
    const payload = Buffer.from(MP3_ID3).toString('base64');
    const { provider, calls } = providerOf(
      { preset: 'google', baseURL: 'https://texttospeech.googleapis.com', model: 'cmn-CN' },
      { respond: () => new Response(JSON.stringify({ audioContent: payload })) },
    );
    const clip = await provider.synthesize(ask);
    assert.equal(clip.mime, 'audio/mpeg');
    const [call] = calls;
    assert.equal(call?.url, 'https://texttospeech.googleapis.com/v1/text:synthesize?key=sk-test');
    const headers = headersOf(call);
    assert.equal(headers.authorization, undefined, 'key 在查询串里，不该再发头');
    assert.equal(headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(String(call?.init?.body)), {
      input: { text: '你好' },
      voice: { languageCode: 'cmn-CN' },
      audioConfig: { audioEncoding: 'MP3' },
    });
  });

  test('custom + form：application/x-www-form-urlencoded，占位符做 URL 编码', async () => {
    const { provider, calls } = providerOf({
      protocol: 'custom',
      preset: 'none',
      baseURL: 'https://tts.example.com',
      path: '/tts',
      bodyKind: 'form',
      bodyTemplate: 'text={text}&voice={voice}&model={model}',
      model: 'm 1',
      voice: 'v&1',
    });
    const text = '你好 世界';
    await provider.synthesize({ text, rate: '+0%' });
    const [call] = calls;
    assert.equal(headersOf(call)['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(String(call?.init?.body), 'text=%E4%BD%A0%E5%A5%BD%20%E4%B8%96%E7%95%8C&voice=v%261&model=m%201');
  });

  test('custom + ssml：<speak> 包裹后放进模板的 {text} 位置', async () => {
    const { provider, calls } = providerOf({
      protocol: 'custom',
      preset: 'none',
      baseURL: 'https://tts.example.com',
      path: '/say',
      bodyKind: 'ssml',
      bodyTemplate: '{text}',
      voice: 'zh-CN-YunxiNeural',
    });
    await provider.synthesize({ text: '<hi>', rate: '+0%' });
    const [call] = calls;
    assert.equal(headersOf(call)['content-type'], 'application/ssml+xml');
    assert.equal(
      String(call?.init?.body),
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">' +
        '<voice name="zh-CN-YunxiNeural">&lt;hi&gt;</voice></speak>',
    );
  });

  test('custom + json：路径拼接、占位符 JSON 转义、额外请求头合并且可覆盖默认', async () => {
    const { provider, calls } = providerOf({
      protocol: 'custom',
      preset: 'none',
      baseURL: 'https://tts.example.com/base/',
      path: 'tts',
      model: 'm1',
      voice: 'v1',
      bodyTemplate: '{"text":"{text}","speaker":"{voice}","model":"{model}"}',
      headers: '{"xi-api-key":"k2","content-type":"application/json; charset=utf-8"}',
    });
    const text = '他说"你好"\n第二行';
    await provider.synthesize({ text, rate: '+0%' });
    const [call] = calls;
    assert.equal(call?.url, 'https://tts.example.com/base/tts');
    const headers = headersOf(call);
    assert.equal(headers.authorization, 'Bearer sk-test');
    assert.equal(headers['xi-api-key'], 'k2');
    assert.equal(headers['content-type'], 'application/json; charset=utf-8');
    // 模板替换值做过 JSON 转义：台词里的引号与换行不会拼坏 body
    assert.deepEqual(JSON.parse(String(call?.init?.body)), { text, speaker: 'v1', model: 'm1' });
  });

  test('custom + json：台词里写着 {model} 也不会被二次替换', async () => {
    const { provider, calls } = providerOf({
      protocol: 'custom',
      preset: 'none',
      baseURL: 'https://a',
      path: '/t',
      bodyTemplate: '{"text":"{text}","model":"{model}"}',
      model: 'm1',
    });
    await provider.synthesize({ text: '保持 {model} 原样', rate: '+0%' });
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { text: '保持 {model} 原样', model: 'm1' });
  });

  test('authStyle=none：不发任何鉴权头（本机服务）', async () => {
    const { provider, calls } = providerOf(
      {
        protocol: 'custom',
        preset: 'none',
        baseURL: 'http://127.0.0.1:9000',
        path: '/tts',
        authStyle: 'none',
        bodyTemplate: '{"text":"{text}"}',
      },
      { key: undefined },
    );
    await provider.synthesize(ask);
    const headers = headersOf(calls[0]);
    assert.equal(headers.authorization, undefined);
    assert.equal(headers['api-key'], undefined);
    assert.equal(headers['content-type'], 'application/json');
  });

  test('authHeader 自定义头名（api-key-header）', async () => {
    const request = cloudRequestOf(
      cloudOf({
        protocol: 'custom',
        preset: 'none',
        baseURL: 'https://a',
        path: '/t',
        authStyle: 'api-key-header',
        authHeader: 'X-Subscription-Key',
        bodyTemplate: '{"text":"{text}"}',
      }),
      '你好',
      'sk-1',
    );
    assert.equal(headersOf({ url: request.url, init: request.init })['X-Subscription-Key'], 'sk-1');
  });

  test('custom：模板缺 {text} 时不发请求，直接按配置错误失败', async () => {
    const { provider, calls } = providerOf({
      protocol: 'custom',
      preset: 'none',
      baseURL: 'https://tts.example.com',
      path: '/tts',
      bodyTemplate: '{"input":"hi"}',
    });
    await assert.rejects(() => provider.synthesize(ask), /\{text\}/);
    assert.equal(calls.length, 0);
    assert.match(provider.lastError?.() ?? '', /\{text\}/);
  });

  test('custom：模板不是合法 JSON 时也不发请求', async () => {
    const { provider, calls } = providerOf({
      protocol: 'custom',
      preset: 'none',
      baseURL: 'https://tts.example.com',
      path: '/tts',
      bodyTemplate: '{"text":"{text}"',
    });
    await assert.rejects(() => provider.synthesize(ask), /bodyTemplate 不是合法的 JSON 对象/);
    assert.equal(calls.length, 0);
  });
});

describe('renderTemplate / digPath —— 纯函数契约', () => {
  test('json 转义引号与换行，form 做 URL 编码，ssml 做 XML 转义', () => {
    assert.equal(
      renderTemplate('{"text":"{text}"}', 'json', { text: 'a"b\nc', model: '', voice: '', format: '', key: '' }),
      '{"text":"a\\"b\\nc"}',
    );
    assert.equal(
      renderTemplate('text={text}', 'form', { text: 'a&b c', model: '', voice: '', format: '', key: '' }),
      'text=a%26b%20c',
    );
    assert.equal(
      renderTemplate('{text}', 'ssml', { text: 'a&b', model: '', voice: 'v', format: '', key: '' }),
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">' +
        '<voice name="v">a&amp;b</voice></speak>',
    );
  });

  test('缺 {text} 抛配置错误', () => {
    assert.throws(
      () => renderTemplate('{"a":1}', 'json', { text: 'x', model: '', voice: '', format: '', key: '' }),
      /\{text\}/,
    );
  });

  test('digPath 支持数组下标与缺省', () => {
    const parsed = { choices: [{ message: { audio: { data: 'abc' } } }], list: [1, 2] };
    assert.equal(digPath(parsed, 'choices.0.message.audio.data'), 'abc');
    assert.equal(digPath(parsed, 'list.1'), 2);
    assert.equal(digPath(parsed, 'choices.x'), undefined);
    assert.equal(digPath(parsed, ''), undefined);
    assert.equal(digPath(null, 'a'), undefined);
  });
});

describe('createCloudProvider —— JSON 响应取值', () => {
  test('json-base64：数组下标路径 + 解码', async () => {
    const payload = Buffer.from(WAV).toString('base64');
    const { provider } = providerOf(
      { preset: 'mimo', baseURL: 'https://a', model: 'm', voice: 'v' },
      { respond: () => new Response(JSON.stringify({ choices: [{ message: { audio: { data: payload } } }] })) },
    );
    const clip = await provider.synthesize(ask);
    assert.deepEqual(new Uint8Array(clip.data), WAV);
  });

  test('json-hex：十六进制串解码（容忍空白）', async () => {
    const hex = Buffer.from(WAV).toString('hex').replace(/(..)/g, '$1 ').trim();
    const { provider } = providerOf(
      {
        protocol: 'custom',
        preset: 'none',
        baseURL: 'https://a',
        path: '/t',
        bodyTemplate: '{"text":"{text}"}',
        responseKind: 'json-hex',
        responsePath: 'result.0.audio',
      },
      { respond: () => new Response(JSON.stringify({ result: [{ audio: hex }] })) },
    );
    const clip = await provider.synthesize(ask);
    assert.deepEqual(new Uint8Array(clip.data), WAV);
  });

  test('json-url：再 GET 一次拿字节；跨域不带鉴权头（不破坏签名 URL）', async () => {
    const { provider, calls } = providerOf(
      {
        protocol: 'custom',
        preset: 'none',
        baseURL: 'https://api.example.com',
        path: '/t',
        bodyTemplate: '{"text":"{text}"}',
        responseKind: 'json-url',
        responsePath: 'audio_url',
      },
      {
        respond: (call) =>
          call.url.startsWith('https://api.example.com')
            ? new Response(JSON.stringify({ audio_url: 'https://cdn.example.com/a.wav' }))
            : new Response(WAV),
      },
    );
    const clip = await provider.synthesize(ask);
    assert.equal(clip.mime, 'audio/wav');
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.url, 'https://cdn.example.com/a.wav');
    assert.equal(calls[1]?.init?.method, 'GET');
    assert.deepEqual(headersOf(calls[1]), {}, '跨域地址不带 Authorization');
  });

  test('json-url：同源时带上本次鉴权头', async () => {
    const { provider, calls } = providerOf(
      {
        protocol: 'custom',
        preset: 'none',
        baseURL: 'https://cdn.example.com',
        path: '/t',
        bodyTemplate: '{"text":"{text}"}',
        responseKind: 'json-url',
        responsePath: 'data.0.url',
      },
      {
        respond: (call) =>
          call.url === 'https://cdn.example.com/t'
            ? new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/a.wav' }] }))
            : new Response(WAV),
      },
    );
    await provider.synthesize(ask);
    assert.equal(headersOf(calls[1]).authorization, 'Bearer sk-test');
  });

  test('json 响应路径取不到 / 编码不合法 / 地址不合法：都按失败处理', async () => {
    const cases = [
      [{}, /JSON 里找不到 audioContent/],
      [{ audio: { data: 'x' } }, /实际顶层键：audio/],
      [{ audioContent: '' }, /不是非空字符串/],
      [{ audioContent: '%%%' }, /base64 不合法/],
    ] as const;
    for (const [body, pattern] of cases) {
      const { provider } = providerOf(
        { preset: 'google', baseURL: 'https://a', model: 'm' },
        { respond: () => new Response(JSON.stringify(body)) },
      );
      await assert.rejects(() => provider.synthesize(ask), pattern);
    }
    const hexProvider = providerOf(
      {
        protocol: 'custom',
        preset: 'none',
        baseURL: 'https://a',
        path: '/t',
        bodyTemplate: '{"text":"{text}"}',
        responseKind: 'json-hex',
        responsePath: 'data',
      },
      { respond: () => new Response(JSON.stringify({ data: 'zz' })) },
    );
    await assert.rejects(() => hexProvider.provider.synthesize(ask), /十六进制不合法/);

    const urlProvider = providerOf(
      {
        protocol: 'custom',
        preset: 'none',
        baseURL: 'https://a',
        path: '/t',
        bodyTemplate: '{"text":"{text}"}',
        responseKind: 'json-url',
        responsePath: 'data',
      },
      { respond: () => new Response(JSON.stringify({ data: 'file:///etc/passwd' })) },
    );
    await assert.rejects(() => urlProvider.provider.synthesize(ask), /不是 http\(s\) 地址/);
  });

  test('responsePath 写错：错误列出实际顶层键，不让用户对着 500 猜', async () => {
    const { provider } = providerOf(
      { preset: 'mimo', baseURL: 'https://a', model: 'm', voice: 'v' },
      { respond: () => new Response(JSON.stringify({ id: 'x', output: { audio: '...' } })) },
    );
    await assert.rejects(() => provider.synthesize(ask), /JSON 里找不到 choices\.0\.message\.audio\.data/);
    const reason = provider.lastError?.() ?? '';
    assert.match(reason, /实际顶层键：id、output/);
  });

  test('声明 JSON 响应但返回非 JSON：报错', async () => {
    const { provider } = providerOf(
      { preset: 'google', baseURL: 'https://a', model: 'm' },
      { respond: () => new Response('not json') },
    );
    await assert.rejects(() => provider.synthesize(ask), /不是合法 JSON/);
  });
});

describe('createCloudProvider —— 响应处理与错误', () => {
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
        { respond: () => new Response(bytes, { headers: { 'content-type': 'text/plain' } }) },
      );
      const clip = await provider.synthesize(ask);
      assert.equal(clip.mime, mime);
    }
  });

  test('认不出格式：报前 16 字节 hex 与 Content-Type', async () => {
    const { provider } = providerOf(
      {},
      { respond: () => new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }) },
    );
    await assert.rejects(() => provider.synthesize(ask), /返回的不是音频/);
    const reason = provider.lastError?.() ?? '';
    assert.match(reason, /3c 68 74 6d 6c 3e/);
    assert.match(reason, /text\/html/);
    assert.equal(hexPreview(HTML), '3c 68 74 6d 6c 3e 07 07 07 07 07 07 07 07 07 07');
  });

  test('空响应按失败处理，不写半截缓存', async () => {
    const { provider } = providerOf({}, { respond: () => new Response(new Uint8Array(0)) });
    await assert.rejects(() => provider.synthesize(ask), /音频为空/);
    assert.match(provider.lastError?.() ?? '', /音频为空/);
  });

  test('内容审核 400：抛错，lastError 带服务端原话', async () => {
    const body = JSON.stringify({ error: { message: 'Content Exists Risk' } });
    const { provider } = providerOf({}, { respond: () => new Response(body, { status: 400 }) });
    await assert.rejects(() => provider.synthesize(ask), /400/);
    assert.match(provider.lastError?.() ?? '', /Content Exists Risk/);
  });

  test('非 2xx：文案截断到 512 字符，带协议+预设+baseURL，且不含 key', async () => {
    const long = 'x'.repeat(600);
    const { provider } = providerOf(
      { preset: 'mimo', baseURL: 'https://tts.example.com', model: 'm', voice: 'v' },
      { key: 'sk-secret-key', respond: () => new Response(long, { status: 500 }) },
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
    assert.match(message, /mimo/);
    assert.match(message, /https:\/\/tts\.example\.com/);
    assert.ok(message.includes('x'.repeat(512)), '保留 512 字符');
    assert.ok(!message.includes('x'.repeat(513)), '超过 512 的部分必须截掉');
    assert.ok(!message.includes('sk-secret-key'), 'key 不进错误文案');
    assert.match(provider.lastError?.() ?? '', /^500（openai mimo/);
  });

  test('错误文案里的查询串被脱敏（google 的 key 不进日志）', async () => {
    const { provider } = providerOf(
      { preset: 'google', baseURL: 'https://g.example.com', model: 'm' },
      { key: 'top-secret', respond: () => new Response('boom', { status: 500 }) },
    );
    await assert.rejects(() => provider.synthesize(ask));
    const reason = provider.lastError?.() ?? '';
    assert.ok(!reason.includes('top-secret'), reason);
    assert.match(reason, /https:\/\/g\.example\.com/);
  });

  test('非 JSON 的错误体也留一句可读的文案', async () => {
    const { provider } = providerOf({}, { respond: () => new Response('<html>503</html>', { status: 503 }) });
    await assert.rejects(() => provider.synthesize(ask), /503/);
    assert.match(provider.lastError?.() ?? '', /503/);
  });

  test('没有 key 时不发请求，直接抛', async () => {
    const { provider, calls } = providerOf({}, { key: undefined });
    await assert.rejects(() => provider.synthesize(ask), /API Key/);
    assert.equal(calls.length, 0);
  });

  test('传输层抛错（超时）也留原因，并带上协议与预设', async () => {
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

  test('标了 billable：自动回退链不得选它', () => {
    const provider = createCloudProvider({ settings: () => cloudOf({}), readKey: async () => undefined });
    assert.equal(provider.billable, true);
  });
});

describe('配置判据（探活只判配置，不发请求）', () => {
  test('未探活前不可用，理由给人话', async () => {
    const provider = createCloudProvider({ settings: () => cloudOf({}), readKey: async () => undefined });
    const verdict = provider.availability?.();
    assert.equal(verdict?.ok, false);
    assert.match(verdict && !verdict.ok ? verdict.reason : '', /尚未探活/);
  });

  test('没有 key：不可用，deepseek 下点明可复用宿主凭据', async () => {
    const provider = createCloudProvider({ settings: () => cloudOf({}), readKey: async () => undefined });
    assert.equal(await provider.refresh?.(), false);
    const reason = provider.availability?.();
    assert.equal(reason?.ok, false);
    assert.match(reason && !reason.ok ? reason.reason : '', /API Key/);
    assert.match(reason && !reason.ok ? reason.reason : '', new RegExp(CLOUD_API_KEY_FALLBACK));

    const mimo = createCloudProvider({
      settings: () => cloudOf({ preset: 'mimo', baseURL: 'https://a', model: 'm', voice: 'v' }),
      readKey: async () => undefined,
    });
    assert.equal(await mimo.refresh?.(), false);
    const mimoReason = mimo.availability?.();
    assert.match(mimoReason && !mimoReason.ok ? mimoReason.reason : '', /API Key/);
    assert.ok(
      !(mimoReason && !mimoReason.ok && mimoReason.reason.includes(CLOUD_API_KEY_FALLBACK)),
      '第三方预设不该提示复用宿主凭据',
    );
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

  test('custom 缺 bodyTemplate / path：理由点名字段', () => {
    const problems = cloudConfigProblems(cloudOf({ protocol: 'custom', baseURL: 'https://tts.example.com' }), true);
    assert.deepEqual(problems, ['缺少必填项：path、bodyTemplate']);
  });

  test('custom 模板缺 {text} / 不是 JSON / headers 写坏：都是配置错误', () => {
    const missingText = cloudConfigProblems(
      cloudOf({ protocol: 'custom', preset: 'none', baseURL: 'https://a', path: '/t', bodyTemplate: '{"input":"hi"}' }),
      true,
    );
    assert.match(missingText.join('；'), /\{text\}/);

    const brokenJSON = cloudConfigProblems(
      cloudOf({
        protocol: 'custom',
        preset: 'none',
        baseURL: 'https://a',
        path: '/t',
        bodyTemplate: '{"text":"{text}"',
      }),
      true,
    );
    assert.match(brokenJSON.join('；'), /bodyTemplate 不是合法的 JSON 对象/);

    const brokenHeaders = cloudConfigProblems(
      cloudOf({
        protocol: 'custom',
        preset: 'none',
        baseURL: 'https://a',
        path: '/t',
        bodyTemplate: '{"text":"{text}"}',
        headers: 'x',
      }),
      true,
    );
    assert.match(brokenHeaders.join('；'), /headers 不是合法的 JSON 对象/);
  });

  test('responseKind 是 JSON 但 responsePath 为空：必填项点出来', () => {
    const problems = cloudConfigProblems(
      cloudOf({
        protocol: 'custom',
        preset: 'none',
        baseURL: 'https://a',
        path: '/t',
        bodyTemplate: '{"text":"{text}"}',
        responseKind: 'json-base64',
      }),
      true,
    );
    assert.match(problems.join('；'), /responsePath/);
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
    let failNext = true;
    const provider = createCloudProvider({
      settings: () => cloudOf(conf),
      readKey: async () => 'sk-test',
      fetch: (async () =>
        failNext ? new Response('boom', { status: 500 }) : new Response(WAV)) as unknown as typeof fetch,
    });
    assert.equal(await provider.refresh?.(), true);
    await assert.rejects(() => provider.synthesize(ask));
    assert.match(provider.lastError?.() ?? '', /500/);
    failNext = false;
    conf = { useCloud: 'on', preset: 'mimo', baseURL: 'https://tts.example.com' };
    assert.equal(await provider.refresh?.(), false, '缺 model / voice 应当立刻判不可用');
    const reason = provider.availability?.();
    assert.match(reason && !reason.ok ? reason.reason : '', /model/);
  });
});

describe('缓存指纹与音色展示', () => {
  const tagOf = (conf: Record<string, unknown>): string => cloudCacheTag(cloudOf(conf));
  const base = {
    preset: 'openai-speech',
    protocol: 'openai',
    baseURL: 'https://tts.example.com',
    model: 'm',
    voice: 'v',
  };

  test('换预设 / 协议 / 地址 / 路径 / 鉴权 / 模型 / 音色 / 格式 / 请求体 / 响应取值都换键', () => {
    const tags = [
      tagOf(base),
      tagOf({ ...base, preset: 'mimo' }),
      tagOf({ ...base, protocol: 'custom', preset: 'none', path: '/t', bodyTemplate: '{"text":"{text}"}' }),
      tagOf({ ...base, baseURL: 'https://other.example.com' }),
      tagOf({ ...base, path: '/v2/speech' }),
      tagOf({ ...base, authStyle: 'api-key-header' }),
      tagOf({ ...base, authHeader: 'X-Key' }),
      tagOf({ ...base, model: 'm2' }),
      tagOf({ ...base, voice: 'v2' }),
      tagOf({ ...base, format: 'wav' }),
      tagOf({ ...base, bodyKind: 'form', bodyTemplate: 'text={text}' }),
      tagOf({ ...base, bodyTemplate: '{"model":"{model}","input":"{text}","voice":"{voice}","response_format":"x"}' }),
      tagOf({ ...base, responseKind: 'json-base64', responsePath: 'audio' }),
      tagOf({ ...base, responsePath: 'other.0.audio' }),
      tagOf({ ...base, headers: '{"X-Out":"wav"}' }),
    ];
    assert.equal(new Set(tags).size, tags.length, '任意一项变化都不能命中旧音频');
  });

  test('同一份配置的指纹稳定，且不含密钥（指纹只由配置算出）', () => {
    assert.equal(tagOf(base), tagOf(base));
    assert.ok(!tagOf(base).includes('sk-'));
    assert.ok(tagOf(base).startsWith('openai|'));
    assert.match(cloudCacheTag(cloudOf({})), /^custom\|deepseek\|/);
  });

  test('老配置与显式预设写法指纹一致', () => {
    const legacy = tagOf({ baseURL: 'https://api.deepseek.com', voice: 'tide' });
    const explicit = tagOf({ preset: 'deepseek', baseURL: 'https://api.deepseek.com', voice: 'tide' });
    assert.equal(legacy, explicit);
  });

  test('redactURL：去掉 userinfo、查询串与片段', () => {
    assert.equal(redactURL('https://user:pw@host.example.com/v1?key=abc#x'), 'https://host.example.com/v1');
    assert.equal(redactURL('https://host.example.com/v1/'), 'https://host.example.com/v1');
    assert.equal(redactURL(''), '(未配置)');
    assert.equal(redactURL('not a url?key=abc'), 'not a url');
  });

  test('云端只报「当前这一个」音色，tag 是生效预设；真没配置才是空列表', () => {
    const openai = createCloudProvider({
      settings: () => cloudOf({ preset: 'openai-speech', voice: 'alloy' }),
      readKey: async () => 'sk-test',
    });
    assert.deepEqual(openai.listVoices?.(), [{ id: 'alloy', name: 'alloy', tag: 'openai-speech' }]);
    assert.equal(openai.activeVoice?.(), 'alloy');

    // deepseek 留空按 stella：服务端会用它，所以仍算「配了」
    const deepseek = createCloudProvider({ settings: () => cloudOf({}), readKey: async () => 'sk-test' });
    assert.deepEqual(deepseek.listVoices?.(), [{ id: 'stella', name: 'stella', tag: 'deepseek' }]);

    const empty = createCloudProvider({
      settings: () => cloudOf({ preset: 'openai-speech' }),
      readKey: async () => 'sk-test',
    });
    assert.deepEqual(empty.listVoices?.(), []);
  });
});

describe('expandCloudPresetPatch —— 预设展开与手填保护（R2）', () => {
  /** 一次「盘上已展开成 preset」的等价状态：直接喂 axisDefaultsOf 的结果太绕，用真实展开生成。 */
  const expanded = (preset: string, patch: Record<string, string> = {}): Record<string, string> =>
    expandCloudPresetPatch({ preset, ...patch }, {});

  /**
   * 模拟路由的落盘效果：盘上值 + 本次要写的 patch。
   *
   * 被跳过的键**不进入** patch（不写 = 盘上原样保留），所以断言「手填值保住了」必须看合并后的
   * 生效值，而不是看返回值里有没有这个键——空串在这里等价于「删键」。
   */
  const effectiveAfter = (
    current: Readonly<Record<string, string>>,
    next: Readonly<Record<string, string>>,
  ): Record<string, string> => {
    const merged: Record<string, string> = { ...current };
    for (const [key, value] of Object.entries(next)) {
      if (value === '') delete merged[key];
      else merged[key] = value;
    }
    return merged;
  };

  test('不带 preset 键：原样返回，一个键都不加', () => {
    const patch = { path: '/v1/audio/speech', voice: 'alloy' };
    assert.deepEqual(expandCloudPresetPatch(patch, {}), patch);
    assert.deepEqual(expandCloudPresetPatch({}, { voice: 'alloy' }), {}, '空 patch 也不该被补');
  });

  test('空配置 + preset=mimo：四轴与协议真的写进去了（这才是「真预填」）', () => {
    const next = expanded('mimo');
    assert.equal(next.path, '/v1/chat/completions');
    assert.equal(next.authStyle, 'api-key-header');
    assert.equal(next.authHeader, 'api-key');
    assert.equal(next.bodyKind, 'json');
    assert.equal(next.responseKind, 'json-base64');
    assert.equal(next.responsePath, 'choices.0.message.audio.data');
    assert.equal(next.format, 'wav');
    assert.equal(next.protocol, 'openai', 'mimo 属于 openai 协议族（修掉「显示 custom」）');
    assert.equal(next.voice, '');
    assert.equal('baseURL' in next, false, 'mimo 不自带地址：写死会绑死用户配置');
  });

  test('换预设：旧预设的残留被清掉，新预设的默认值补上（mimo → deepseek）', () => {
    const current = expanded('mimo');
    const next = expandCloudPresetPatch({ preset: 'deepseek' }, current);
    assert.equal(next.path, '/v1/tools/tts');
    assert.equal(next.voice, 'stella');
    assert.equal(next.protocol, 'custom');
    assert.equal(next.baseURL, DEFAULT_CLOUD_BASE_URL, 'deepseek 自带地址，要写进字段');
    assert.equal(next.responsePath, '', 'mimo 的 JSON 路径必须被清掉，否则 deepseek 会去 JSON 里找音频');
    assert.equal(next.authStyle, 'bearer');
    assert.equal(next.authHeader, '', 'mimo 的 api-key 头名不能留给 deepseek');
  });

  test('手填保护：非空且不等于旧预设默认的项保持不动', () => {
    const current = expanded('mimo', { voice: 'nova' }); // 用户手改过音色
    const next = expandCloudPresetPatch({ preset: 'deepseek' }, current);
    const after = effectiveAfter(current, next);
    assert.equal(after.voice, 'nova', '手填的音色不该被新预设覆盖');
    assert.equal(next.voice, undefined, '被跳过的键不进 patch → 不写，盘上原样保留');
    assert.equal(after.path, '/v1/tools/tts', '没手填过的项照旧被新预设接管');
  });

  test('手填保护：同一屏里刚改的值也算手填（patch 里的值优先于盘上）', () => {
    const next = expandCloudPresetPatch({ preset: 'mimo', voice: 'nova' }, {});
    assert.equal(next.voice, 'nova', '用户在表单里填了 nova 又选了预设，不能把 nova 冲掉');
  });

  test('等于旧预设默认的项仍要覆盖（否则换预设换不干净）', () => {
    const current = expanded('deepseek'); // voice='stella'、path='/v1/tools/tts' 都是 deepseek 的默认
    const next = expandCloudPresetPatch({ preset: 'mimo' }, current);
    assert.equal(next.voice, '', 'stella 是旧预设默认值 → 该被 mimo 的空默认接管');
    assert.equal(next.path, '/v1/chat/completions');
  });

  test('切 none（手动填四轴）：轴键全清成空串 = 删键，不残留上一个预设', () => {
    const current = expanded('mimo');
    const next = expandCloudPresetPatch({ preset: CLOUD_PRESET_NONE_LABEL }, current);
    for (const key of [
      'path',
      'authStyle',
      'authHeader',
      'bodyKind',
      'bodyTemplate',
      'responseKind',
      'responsePath',
      'headers',
      'format',
      'voice',
    ]) {
      assert.equal(next[key], '', `${key} 应被清空（回到纯手填）`);
    }
    assert.equal(next.protocol, 'custom');
  });

  test('不写 fields 之外的键：落盘键全是该实现声明过的', () => {
    const declared = new Set(CLOUD_FIELDS.map((field) => field.key));
    for (const preset of CLOUD_PRESETS) {
      for (const key of Object.keys(expandCloudPresetPatch({ preset }, {}))) {
        assert.ok(declared.has(key), `preset=${preset} 展开了未声明的键 ${key}`);
      }
    }
  });

  test('不改入参（纯函数）：patch 与 current 都保持原样', () => {
    const patch = { preset: 'mimo' };
    const current = { voice: 'stella' };
    expandCloudPresetPatch(patch, current);
    assert.deepEqual(patch, { preset: 'mimo' });
    assert.deepEqual(current, { voice: 'stella' });
  });

  test('baseURL：手填过的地址保留，空地址才由「自带地址」的预设填上', () => {
    // 手填地址优先级最高：新预设自带地址也不能盖掉用户自己的网关
    const current = { ...expanded('deepseek'), baseURL: 'https://my-gateway.example.com' };
    const next = expandCloudPresetPatch({ preset: 'deepseek' }, current);
    assert.equal('baseURL' in next, false, '手填的地址不进 patch → 盘上原样保留');
    assert.equal(effectiveAfter(current, next).baseURL, 'https://my-gateway.example.com');
    // 空的地址会被预填写上（deepseek 自带地址）
    assert.equal(expanded('deepseek').baseURL, DEFAULT_CLOUD_BASE_URL);
  });

  test('幂等：把展开结果再喂一次同一个预设，结果不变', () => {
    const once = expanded('mimo');
    const twice = expandCloudPresetPatch({ preset: 'mimo' }, once);
    assert.deepEqual(twice, once);
  });

  test('老配置没有 preset 键（只有 protocol/baseURL）：按历史映射推断旧预设，不误伤手填值', () => {
    // 老配置：protocol=deepseek + 手填 path（≠ deepseek 默认）→ 换到 mimo 时 path 保留
    const current = { protocol: 'deepseek', baseURL: DEFAULT_CLOUD_BASE_URL, path: '/my/proxy', voice: '' };
    const next = expandCloudPresetPatch({ preset: 'mimo' }, current);
    assert.equal('path' in next, false, '手填路径不是旧预设默认值 → 不动它');
    assert.equal(effectiveAfter(current, next).path, '/my/proxy');
    assert.equal(next.protocol, 'openai', '旧预设按历史映射认出是 deepseek → 协议族变了要写');
  });

  test('切走不带地址的预设：旧预设的官方地址必须清掉（否则 B 的 path 拼到 A 的域名上）', () => {
    // P1：deepseek → mimo。旧地址是 deepseek 的官方默认（不是用户手填），切走要清成空串，
    // 这样 cloudBaseURL() 才会回落 mimo 的 openai 兜底，而不是继续指着 api.deepseek.com。
    const onDeepseek = expanded('deepseek');
    assert.equal(onDeepseek.baseURL, DEFAULT_CLOUD_BASE_URL, '前提：deepseek 落盘了官方地址');

    const toMimo = expandCloudPresetPatch({ preset: 'mimo' }, onDeepseek);
    const savedBase = 'baseURL' in toMimo ? String(toMimo.baseURL) : String(onDeepseek.baseURL);
    assert.equal(savedBase, '', '切到 mimo 时旧官方地址必须被清空');

    // 清空之后生效地址是 OpenAI 兜底，问题清单里也不该再报「地址是别人的」
    const settings = cloudSettingsOf({ cloud: { ...onDeepseek, ...toMimo, preset: 'mimo' } });
    assert.equal(cloudBaseURL(settings), DEFAULT_OPENAI_BASE_URL);
    assert.deepEqual(
      cloudConfigProblems(settings, true).filter((item) => item.includes('服务地址') || item.includes('预设')),
      [],
      '地址回落正确时不该报一致性错误',
    );
  });

  test('切到 openai-speech 同理：deepseek 的官方地址不得留下', () => {
    const onDeepseek = expanded('deepseek');
    const next = expandCloudPresetPatch({ preset: 'openai-speech' }, onDeepseek);
    assert.equal('baseURL' in next ? next.baseURL : onDeepseek.baseURL, '');
    assert.equal(cloudBaseURL(cloudSettingsOf({ cloud: { ...onDeepseek, ...next } })), DEFAULT_OPENAI_BASE_URL);
  });

  test('用户手填的地址不被清：切预设也保留自己的网关', () => {
    const onDeepseek = { ...expanded('deepseek'), baseURL: 'https://my.proxy' };
    const toMimo = expandCloudPresetPatch({ preset: 'mimo' }, onDeepseek);
    assert.equal('baseURL' in toMimo ? toMimo.baseURL : onDeepseek.baseURL, 'https://my.proxy');
    // 手填地址也不该被一致性检查误判
    const settings = cloudSettingsOf({ cloud: { ...onDeepseek, ...toMimo, preset: 'mimo' } });
    assert.deepEqual(
      cloudConfigProblems(settings, true).filter((item) => item.includes('服务地址')),
      [],
    );
  });

  test('手填地址经两次切换仍保留：deepseek → mimo → openai-speech', () => {
    // 单次切换已有用例；两次连着切才是真机上的形态（用户换预设不会只换一次），
    // 而每次切都会经过「旧预设官方地址 → 清空」这段逻辑，漏一个分支就会把手填地址吃掉。
    const handwritten = 'https://my.proxy.example';
    let current: Record<string, string> = { ...expanded('deepseek'), baseURL: handwritten };
    for (const preset of ['mimo', 'openai-speech']) {
      const next = expandCloudPresetPatch({ preset }, current);
      const saved = effectiveAfter(current, next);
      assert.equal(saved.baseURL, handwritten, `切到 ${preset} 后手填地址必须原样保留`);
      assert.equal(
        cloudBaseURL(cloudSettingsOf({ cloud: saved })),
        handwritten,
        `切到 ${preset} 后生效地址仍是用户自己的网关`,
      );
      current = saved;
    }
    assert.equal(current.preset, 'openai-speech', '前提：确实切了两次');
    assert.deepEqual(
      cloudConfigProblems(cloudSettingsOf({ cloud: current }), true).filter(
        (item) => item.includes('服务地址') || item.includes('官方地址'),
      ),
      [],
      '两次切换后手填地址也不该被一致性检查误判',
    );
  });

  test('一致性检查只在预设模式生效：手填（none）+ deepseek 官方地址是合法配置，不得误伤', () => {
    // 用户完全手填四轴、地址恰好用 deepseek 官方域名、path/template 都是自己的：
    // 这是合法配置（none 模式下清空地址没有兜底），不该被「地址是别的预设的」拦下。
    const handwritten = cloudSettingsOf({
      cloud: {
        preset: 'none（手动填四轴）',
        protocol: 'openai',
        baseURL: DEFAULT_CLOUD_BASE_URL,
        path: '/v1/chat/completions',
        bodyTemplate: '{"model":"{model}","messages":[{"role":"user","content":"{text}"}]}',
        model: 'my-model',
        voice: 'my-voice',
      },
    });
    assert.deepEqual(
      cloudConfigProblems(handwritten, true).filter((item) => item.includes('官方地址')),
      [],
      '手填模式不该报「地址和预设对不上」',
    );
  });

  test('一致性检查：预设模式下地址仍是别的预设官方地址时报错（真正要拦的没漏）', () => {
    // 模拟「旧版本留下的残留」：preset 已是 mimo，地址却还是 deepseek 的官方地址
    const broken = cloudSettingsOf({
      cloud: { preset: 'mimo', protocol: 'openai', baseURL: DEFAULT_CLOUD_BASE_URL, model: 'x', voice: 'x' },
    });
    const problems = cloudConfigProblems(broken, true);
    assert.ok(
      problems.some((item) => item.includes('官方地址') && item.includes('mimo')),
      `预设模式下应报出这对不上：${problems.join('；')}`,
    );
    // 自家预设的官方地址不算错
    const fine = cloudSettingsOf({
      cloud: { preset: 'deepseek', protocol: 'custom', baseURL: DEFAULT_CLOUD_BASE_URL },
    });
    assert.deepEqual(
      cloudConfigProblems(fine, true).filter((item) => item.includes('官方地址')),
      [],
    );
  });

  test('preset 的字段说明与实现同源：承诺「保存时写进默认值」，并写明 none 会清空', () => {
    const field = cloudFieldsFor(EMPTY_CLOUD_SETTINGS).find((item) => item.key === 'preset');
    assert.ok(field?.description, 'preset 必须有说明');
    // 这两句是「文案与行为一致」的机器可验锚点：浏览器端只证渲染，真正的措辞归这里管
    assert.ok(field.description.includes('会把该预设的四轴默认值写进'), field.description);
    assert.ok(field.description.includes('会清掉这些预填值'), field.description);
    assert.equal(
      field.description.includes('预设只是默认值，下面的字段可以逐项覆盖'),
      false,
      '旧文案（只说「可以覆盖」而不说「保存时写进去」）必须被替换掉',
    );
  });
});
