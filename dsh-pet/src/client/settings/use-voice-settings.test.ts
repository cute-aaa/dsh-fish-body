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

import { localProviderOf, providerFormOf } from './use-voice-settings.ts';
import { readStringRecord } from './voice-api.ts';
import type { VoiceProviderView } from '../../shared/voice-providers.ts';

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
    const chosen = provider('gsv', { voices: [{ id: 'v1', name: 'V1' }], voice: 'v1' });
    assert.equal(localProviderOf([provider('edge', { builtin: true }), provider('silent'), chosen]), chosen);
  });

  test('没有可切音色的实现时返回 undefined', () => {
    assert.equal(localProviderOf([provider('edge', { builtin: true, voices: [{ id: 'v1', name: 'V1' }] })]), undefined);
  });
});

describe('providerFormOf —— 接入表单的数据源', () => {
  test('挑第一个声明了配置项的非内置实现', () => {
    const form = provider('gsv', {
      fields: [{ key: 'baseUrl', label: '服务地址', kind: 'text', required: true }],
    });
    assert.equal(providerFormOf([provider('edge', { builtin: true }), form]), form);
  });

  test('只有内置实现时不出表单', () => {
    assert.equal(providerFormOf([provider('edge', { builtin: true })]), undefined);
  });
});
