/**
 * 第三方语音注册表的行为测试（src/host/voice/registry.ts）。
 *
 * 钉「谁排在前面、谁被跳过、注销是否只删自己、状态怎么报」——合成与缓存不在本模块，另有测试。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  BUILTIN_VOICE_ID,
  activeVoiceProvider,
  listVoiceProviders,
  registerVoiceProvider,
  resetVoiceProviders,
  voiceProviderEntries,
  voiceProviderStatuses,
  type VoiceProvider,
} from './registry.ts';

/** 造一个最小实现；只关心 id 与可用性，synthesize 返回一字节占位。 */
const provider = (id: string, available = true): VoiceProvider => ({
  id,
  name: id,
  ...(available ? {} : { availability: () => ({ ok: false as const, reason: '没起来' }) }),
  synthesize: async () => ({ data: new Uint8Array([1]), mime: 'audio/mpeg' }),
});

afterEach(() => {
  resetVoiceProviders();
});

test('初始状态：没有第三方实现，active 为空，list 的 external 也为空', () => {
  assert.equal(activeVoiceProvider(), null);
  assert.deepEqual(listVoiceProviders(), { builtin: [BUILTIN_VOICE_ID], external: [] });
  assert.deepEqual(voiceProviderEntries(), []);
});

test('多 provider：按注册顺序排在链上，active 取第一个可用的', () => {
  registerVoiceProvider(provider('first'));
  registerVoiceProvider(provider('second'));
  assert.equal(activeVoiceProvider()?.id, 'first', '先注册的先试');
  assert.deepEqual(listVoiceProviders().external, ['first', 'second'], 'list 保留全部与顺序');
});

test('不可用的一环被跳过，但仍在 list 里（排障要看得到）', () => {
  registerVoiceProvider(provider('offline', false));
  registerVoiceProvider(provider('online'));
  assert.equal(activeVoiceProvider()?.id, 'online');
  const entries = voiceProviderEntries();
  assert.deepEqual(
    entries.map((entry) => [entry.provider.id, entry.available]),
    [
      ['offline', false],
      ['online', true],
    ],
  );
  assert.equal(entries[0]?.reason, '没起来');
});

test('availability 自己抛错：当作不可用，不把整条链带走', () => {
  registerVoiceProvider({
    id: 'boom',
    name: 'boom',
    availability: () => {
      throw new Error('探测炸了');
    },
    synthesize: async () => ({ data: new Uint8Array([1]), mime: 'audio/mpeg' }),
  });
  registerVoiceProvider(provider('ok'));
  assert.equal(activeVoiceProvider()?.id, 'ok');
  assert.equal(voiceProviderEntries()[0]?.reason, '探测炸了');
});

test('同 id 重注册就地替换，位置不变（链序不跳）', () => {
  registerVoiceProvider(provider('a'));
  registerVoiceProvider(provider('b'));
  const replacement = { ...provider('a'), name: 'a-v2' };
  registerVoiceProvider(replacement);
  assert.deepEqual(listVoiceProviders().external, ['a', 'b']);
  assert.equal(voiceProviderEntries()[0]?.provider.name, 'a-v2');
});

test('注销只清自己那份：先注册的注销不会顶掉后来者', () => {
  const disposeFirst = registerVoiceProvider(provider('first'));
  registerVoiceProvider(provider('second'));
  disposeFirst();
  assert.deepEqual(listVoiceProviders().external, ['second'], '迟到的注销不该删掉别的实现');
});

test('注销当前生效的那份：回到下一个可用的，没有就回内置', () => {
  const dispose = registerVoiceProvider(provider('my-tts'));
  dispose();
  assert.equal(activeVoiceProvider(), null);
  assert.deepEqual(listVoiceProviders().external, []);
});

test('状态表：第三方在前、内置 edge 收尾，字段带 fields', () => {
  registerVoiceProvider({
    ...provider('gsv'),
    fields: [{ key: 'baseURL', label: '接口地址', kind: 'text', required: true }],
  });
  const statuses = voiceProviderStatuses();
  assert.equal(statuses.length, 2);
  assert.deepEqual(
    statuses.map((s) => [s.id, s.builtin, s.available]),
    [
      ['gsv', false, true],
      [BUILTIN_VOICE_ID, true, true],
    ],
  );
  assert.equal(statuses[0]?.fields[0]?.key, 'baseURL');
  assert.deepEqual(statuses[1]?.fields, []);
});

test('非法定义一律抛 TypeError', () => {
  assert.throws(() => registerVoiceProvider(null as never), TypeError, '非对象');
  assert.throws(() => registerVoiceProvider({ id: '', name: 'x' } as never), TypeError, '空 id');
  assert.throws(
    () =>
      registerVoiceProvider({
        id: BUILTIN_VOICE_ID,
        name: 'x',
        synthesize: async () => ({ data: new Uint8Array(), mime: 'audio/mpeg' }),
      }),
    TypeError,
    '与内置同名',
  );
  assert.throws(
    () => registerVoiceProvider({ id: 'x', name: 'x', synthesize: 1 as never }),
    TypeError,
    'synthesize 不是函数',
  );
  assert.throws(
    () =>
      registerVoiceProvider({
        id: 'x',
        name: 'x',
        synthesize: async () => ({ data: new Uint8Array(), mime: 'audio/mpeg' }),
        availability: 1 as never,
      }),
    TypeError,
    'availability 不是函数',
  );
});
