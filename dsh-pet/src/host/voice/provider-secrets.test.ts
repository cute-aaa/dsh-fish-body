/**
 * 密钥字段（`voice/provider-secrets.ts`）的契约测试。
 *
 * 三条契约，都是「写错就会把用户的密钥弄丢或明文落盘」的那一类：
 *   1. 只有 `password` + `credentialRef` 齐全的字段算密钥（其余按普通文本走配置文件）；
 *   2. `patch` 里的空串是「不改」，要删必须显式放进 `clear`——值从不回传，界面只能给空框；
 *   3. 宿主凭据服务缺写入能力时（独立模式的替身只有 `resolve`）返回 `null`，由路由报 `unsupported`。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { VoiceField } from './registry.ts';
import {
  providerSecretSeamOf,
  readSecretPresence,
  secretFieldsOf,
  writeSecretFields,
  type ProviderSecretSeam,
} from './provider-secrets.ts';

const FIELDS: readonly VoiceField[] = [
  { key: 'baseURL', label: '地址', kind: 'text' },
  { key: 'apiKey', label: 'API Key', kind: 'password', credentialRef: 'DSH_TEST_KEY' },
  // 没有 credentialRef 的 password 按普通文本处理（不声明就没人保证它进凭据库）
  { key: 'legacy', label: '旧的', kind: 'password' },
];

/** 记录式假凭据面。 */
function fakeSeam(store = new Map<string, string>()): ProviderSecretSeam & { store: Map<string, string> } {
  return {
    store,
    configured: async (ref) => (store.get(ref) ?? '') !== '',
    save: async (ref, value) => {
      store.set(ref, value);
    },
    remove: async (ref) => {
      store.delete(ref);
    },
  };
}

describe('secretFieldsOf —— 哪些字段是密钥', () => {
  test('只认 password + credentialRef', () => {
    assert.deepEqual(
      secretFieldsOf(FIELDS).map((field) => field.key),
      ['apiKey'],
    );
  });
});

describe('providerSecretSeamOf —— 宿主能力探测', () => {
  test('三个方法齐全才算可用', () => {
    const seam = providerSecretSeamOf({
      describe: async () => ({}),
      set: async () => undefined,
      unset: async () => undefined,
    });
    assert.notEqual(seam, null);
  });

  test('只有 resolve（独立模式替身）：返回 null，路由据此报 unsupported', () => {
    assert.equal(providerSecretSeamOf({ resolve: async () => undefined }), null);
    assert.equal(providerSecretSeamOf(undefined), null);
    assert.equal(providerSecretSeamOf('x'), null);
  });

  test('适配器把 describe 的 configured 翻译成布尔', async () => {
    const store = new Map([['DSH_TEST_KEY', 'sk-1']]);
    const seam = providerSecretSeamOf({
      describe: async (ref: string) => ({ configured: store.has(ref) }),
      set: async (ref: string, value: string) => void store.set(ref, value),
      unset: async (ref: string) => void store.delete(ref),
    });
    assert.equal(await seam?.configured('DSH_TEST_KEY'), true);
    assert.equal(await seam?.configured('DSH_OTHER'), false);
  });
});

describe('readSecretPresence —— 在场情况', () => {
  test('按键给出「配没配」，单项读失败只当未配', async () => {
    const seam = fakeSeam(new Map([['DSH_TEST_KEY', 'sk-1']]));
    assert.deepEqual(await readSecretPresence(seam, FIELDS), { apiKey: true });
    const broken: ProviderSecretSeam = {
      configured: async () => {
        throw new Error('凭据库挂了');
      },
      save: async () => undefined,
      remove: async () => undefined,
    };
    assert.deepEqual(await readSecretPresence(broken, FIELDS), { apiKey: false });
  });
});

describe('writeSecretFields —— 写与清除', () => {
  test('非空才写；空串是「不改」而不是删掉', async () => {
    const seam = fakeSeam();
    const result = await writeSecretFields(seam, FIELDS, { apiKey: '' });
    assert.deepEqual(result, { saved: [], cleared: [] });
    assert.equal(seam.store.size, 0, '空串不能把已配的密钥清掉');

    const saved = await writeSecretFields(seam, FIELDS, { apiKey: 'sk-2' });
    assert.deepEqual(saved, { saved: ['apiKey'], cleared: [] });
    assert.equal(seam.store.get('DSH_TEST_KEY'), 'sk-2');
  });

  test('clear 显式删除；非密钥键忽略（路由已经先拒过一次）', async () => {
    const seam = fakeSeam(new Map([['DSH_TEST_KEY', 'sk-1']]));
    const result = await writeSecretFields(seam, FIELDS, { baseURL: 'https://a' }, ['apiKey', 'baseURL']);
    assert.deepEqual(result, { saved: [], cleared: ['apiKey'] });
    assert.equal(seam.store.has('DSH_TEST_KEY'), false, 'clear 之后凭据库里就没有这一项了');
  });
});
