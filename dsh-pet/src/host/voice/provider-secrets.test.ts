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
  secretRefsOf,
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

/** 带只读回退引用的字段（云端复用 `DEEPSEEK_API_KEY` 就是这一形态）。 */
const WITH_FALLBACK: readonly VoiceField[] = [
  {
    key: 'apiKey',
    label: 'API Key',
    kind: 'password',
    credentialRef: 'DSH_TEST_KEY',
    credentialFallbacks: ['DEEPSEEK_API_KEY', '  '],
  },
];

describe('credentialFallbacks —— 只读回退', () => {
  test('引用表：主引用在前，空串回退被丢掉', () => {
    assert.deepEqual(secretRefsOf(WITH_FALLBACK[0]!), ['DSH_TEST_KEY', 'DEEPSEEK_API_KEY']);
  });

  test('只有回退引用在场：算「已配」（省掉重复粘贴）', async () => {
    const seam = fakeSeam(new Map([['DEEPSEEK_API_KEY', 'sk-host']]));
    assert.deepEqual(await readSecretPresence(seam, WITH_FALLBACK), { apiKey: true });
  });

  test('主引用在场也照旧算「已配」，且优先读它', async () => {
    const seam = fakeSeam(
      new Map([
        ['DSH_TEST_KEY', 'sk-own'],
        ['DEEPSEEK_API_KEY', 'sk-host'],
      ]),
    );
    assert.deepEqual(await readSecretPresence(seam, WITH_FALLBACK), { apiKey: true });
  });

  test('写入与清除只动主引用，绝不改写宿主凭据', async () => {
    const seam = fakeSeam(new Map([['DEEPSEEK_API_KEY', 'sk-host']]));
    await writeSecretFields(seam, WITH_FALLBACK, { apiKey: 'sk-own' });
    assert.equal(seam.store.get('DSH_TEST_KEY'), 'sk-own');
    assert.equal(seam.store.get('DEEPSEEK_API_KEY'), 'sk-host', '宿主的 key 不能被动');

    await writeSecretFields(seam, WITH_FALLBACK, {}, ['apiKey']);
    assert.equal(seam.store.has('DSH_TEST_KEY'), false);
    assert.equal(seam.store.get('DEEPSEEK_API_KEY'), 'sk-host', '清除也不能连带删掉宿主的 key');
  });

  test('主引用与回退都没配：仍是「未配」', async () => {
    assert.deepEqual(await readSecretPresence(fakeSeam(), WITH_FALLBACK), { apiKey: false });
  });
});
