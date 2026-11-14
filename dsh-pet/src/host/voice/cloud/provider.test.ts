/**
 * 云端 TTS 骨架（T3.5）的契约测试：配置解析、缺项理由、恒不可用、合成明确抛「尚未接入」。
 *
 * 钉住三件事，因为它们是「骨架期不会悄悄变慢」的全部保证：
 *   1. 缺配置时的理由点到具体缺哪一项（不是一句「不可用」）；
 *   2. 配齐了也**不放行**——放行会让每句话先失败一次再落到下一环；
 *   3. 密钥字段声明了 `credentialRef`，值不进配置文件。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CLOUD_API_KEY_REF,
  CLOUD_FIELDS,
  cloudMissingFields,
  cloudSettingsOf,
  createCloudProvider,
} from './provider.ts';
import { secretFieldsOf } from '../provider-secrets.ts';

describe('cloudSettingsOf —— 配置解析', () => {
  test('缺段 / 写坏都当全空，不炸', () => {
    for (const source of [undefined, null, 'x', [], { gsv: {} }]) {
      assert.deepEqual(cloudSettingsOf(source), { baseURL: '', model: '', voice: '' });
    }
  });

  test('只取三个字符串并 trim', () => {
    assert.deepEqual(cloudSettingsOf({ cloud: { baseURL: ' https://a/v1 ', model: ' tts-1', voice: 42 } }), {
      baseURL: 'https://a/v1',
      model: 'tts-1',
      voice: '',
    });
  });
});

describe('cloudMissingFields —— 缺什么就说什么', () => {
  test('地址与模型必填，音色可选', () => {
    assert.deepEqual(cloudMissingFields(cloudSettingsOf({})), ['服务地址', '模型']);
    assert.deepEqual(cloudMissingFields(cloudSettingsOf({ cloud: { baseURL: 'https://a' } })), ['模型']);
    assert.deepEqual(cloudMissingFields(cloudSettingsOf({ cloud: { baseURL: 'https://a', model: 'tts-1' } })), []);
  });
});

describe('createCloudProvider —— 骨架的可用性与合成', () => {
  test('没配：理由是「还缺什么」', () => {
    const provider = createCloudProvider({ settings: () => cloudSettingsOf({}) });
    const verdict = provider.availability?.();
    assert.equal(verdict?.ok, false);
    assert.match(verdict && !verdict.ok ? verdict.reason : '', /服务地址 \/ 模型/);
  });

  test('配齐了也恒不可用：不让回退链每句先失败一次', () => {
    const provider = createCloudProvider({
      settings: () => cloudSettingsOf({ cloud: { baseURL: 'https://a/v1', model: 'tts-1', voice: 'alloy' } }),
    });
    const verdict = provider.availability?.();
    assert.equal(verdict?.ok, false);
    assert.match(verdict && !verdict.ok ? verdict.reason : '', /尚未接入/);
  });

  test('合成明确抛「尚未接入」，不假装成功', async () => {
    const provider = createCloudProvider({ settings: () => cloudSettingsOf({}) });
    await assert.rejects(() => provider.synthesize({ text: '你好', rate: '+0%' }), /尚未接入/);
  });

  test('密钥字段声明了凭据引用：值不进 voice-providers.json', () => {
    const secrets = secretFieldsOf(CLOUD_FIELDS);
    assert.deepEqual(
      secrets.map((field) => [field.key, field.credentialRef]),
      [['apiKey', CLOUD_API_KEY_REF]],
    );
  });
});
