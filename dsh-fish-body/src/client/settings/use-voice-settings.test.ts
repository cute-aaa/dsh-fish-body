/**
 * 语音分区三个纯函数的契约测试（src/client/settings/use-voice-settings.ts）。
 *
 * 三条契约：
 *   1. `readStringRecord` 只留字符串值，坏响应（数组 / null / 标量）不回空对象而是回 `null`——
 *      调用方据此保留手里的草稿，避免一次失败把用户填的地址清空；
 *   2. `localProviderOf` 只挑「能切音色」的实现：内置实现与没有音色的实现都不该占这一格；
 *   3. `providerFormOf` 只挑声明了配置项的实现：内置 edge 没有 fields，不生成接入表单。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { useVoiceSettings } from './use-voice-settings.ts';
import { localProviderOf, providerFormsOf } from './use-provider-forms.ts';
import { readBooleanRecord, readStringRecord } from './voice-api.ts';
import type { VoiceProviderView } from '../../shared/voice-providers.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 造一个最小实现视图；默认非内置、无音色、无配置项。 */
const provider = (id: string, patch: Partial<VoiceProviderView> = {}): VoiceProviderView => ({
  id,
  name: id,
  builtin: false,
  available: true,
  voices: [],
  voice: '',
  fields: [],
  ...patch,
});

describe('readStringRecord —— 接入配置值的解析', () => {
  test('只留字符串值', () => {
    assert.deepEqual(readStringRecord({ baseUrl: 'http://127.0.0.1:9880', port: 9880, empty: null }), {
      baseUrl: 'http://127.0.0.1:9880',
    });
  });

  test('坏响应回 null：调用方保留手里的草稿', () => {
    for (const raw of [null, undefined, 'x', 1, ['a']]) {
      assert.equal(readStringRecord(raw), null, '非对象必须是 null，而不是空对象');
    }
  });

  test('空对象是合法草稿', () => {
    assert.deepEqual(readStringRecord({}), {});
  });
});

describe('localProviderOf —— 本地音色格的数据源', () => {
  test('跳过内置实现与没有音色的实现', () => {
    const chosen = provider('gsv', { voices: [{ id: 'v1', name: 'V1', available: true }], voice: 'v1' });
    assert.equal(localProviderOf([provider('edge', { builtin: true }), provider('silent'), chosen]), chosen);
  });

  test('没有可切音色的实现时返回 undefined', () => {
    assert.equal(
      localProviderOf([provider('edge', { builtin: true, voices: [{ id: 'v1', name: 'V1', available: true }] })]),
      undefined,
    );
  });
});

describe('providerFormsOf —— 接入表单的数据源', () => {
  test('挑出全部声明了配置项的非内置实现（本地 GSV 与云端骨架各一张卡）', () => {
    const gsv = provider('gsv', { fields: [{ key: 'baseUrl', label: '服务地址', kind: 'text', required: true }] });
    const cloud = provider('cloud', {
      fields: [{ key: 'apiKey', label: 'API Key', kind: 'password', required: true }],
    });
    assert.deepEqual(providerFormsOf([provider('edge', { builtin: true }), gsv, cloud]), [gsv, cloud]);
  });

  test('只有内置实现时不出表单', () => {
    assert.deepEqual(providerFormsOf([provider('edge', { builtin: true })]), []);
  });
});

describe('readBooleanRecord —— 密钥在场情况的解析', () => {
  test('只留布尔值，坏响应当「都没配」', () => {
    assert.deepEqual(readBooleanRecord({ apiKey: true, token: 'yes' }), { apiKey: true });
    for (const raw of [null, undefined, 'x', 1, ['a']]) {
      assert.deepEqual(readBooleanRecord(raw), {}, '不是对象时退回空表，而不是 null');
    }
  });
});

describe('useVoiceSettings —— 试听', () => {
  /** 最小运行时：`useState` 独立一格并记录写入，`useEffect` 不跑（副作用另有专测），`useCallback` 直通。 */
  function fakeRuntime(): { rt: SettingsRuntime; writes: unknown[] } {
    const writes: unknown[] = [];
    const rt = {
      h: (() => null) as unknown as SettingsRuntime['h'],
      useState: ((init: unknown) => [
        init,
        (value: unknown) => {
          writes.push(value);
        },
      ]) as SettingsRuntime['useState'],
      useEffect: (() => undefined) as unknown as SettingsRuntime['useEffect'],
      useRef: ((init: unknown) => ({ current: init })) as unknown as SettingsRuntime['useRef'],
      useCallback: ((callback: unknown) => callback) as SettingsRuntime['useCallback'],
      t: (key: string) => key,
    } as SettingsRuntime;
    return { rt, writes };
  }

  /** 合成端点 + /config：记录请求体，`/voice/speak` 回一段「音频」。 */
  function stubVoiceFetch(): { bodies: Array<Record<string, unknown>>; restore: () => void } {
    const previous = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = ((url: string, init?: { body?: string }) => {
      if (url.includes('/voice/speak')) {
        bodies.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'audio/mpeg' },
          // 必须是真 Blob：URL.createObjectURL 不吃形状相同的替身。
          blob: async () => new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ main: {} }) });
    }) as typeof fetch;
    return {
      bodies,
      restore: () => {
        globalThis.fetch = previous;
      },
    };
  }

  /** 假音频：开播即成功，收尾由测试自己决定（这里不需要）。 */
  function stubAudio(): () => void {
    const previous = (globalThis as { Audio?: unknown }).Audio;
    (globalThis as { Audio?: unknown }).Audio = class {
      volume = 1;
      loop = false;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onpause: (() => void) | null = null;
      play(): Promise<void> {
        return Promise.resolve();
      }
      pause(): void {
        this.onpause?.();
      }
    };
    return () => {
      (globalThis as { Audio?: unknown }).Audio = previous;
    };
  }

  /** 等异步旁路跑完。 */
  async function flush(): Promise<void> {
    for (let round = 0; round < 20; round++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  test('用当前选中的音色与音量合成一句示例并播放', async () => {
    const { rt, writes } = fakeRuntime();
    const fetchStub = stubVoiceFetch();
    const restoreAudio = stubAudio();
    try {
      const voice = useVoiceSettings(rt);
      voice.preview.test();
      await flush();
      assert.equal(fetchStub.bodies.length, 1, '试听要发一次合成请求');
      assert.equal(fetchStub.bodies[0].voice, 'zh-CN-XiaoyiNeural', '用当前音色（默认晓伊）');
      assert.equal(typeof fetchStub.bodies[0].text, 'string', '示例台词随请求送出去');
      assert.ok(String(fetchStub.bodies[0].text).length > 0);
      assert.ok(writes.includes('loading'), '合成期间按钮要能显示「合成中…」');
      assert.ok(writes.includes('playing'), '开播后要能显示「正在播放」');
    } finally {
      restoreAudio();
      fetchStub.restore();
    }
  });
});
