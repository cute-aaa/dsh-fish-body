/**
 * 回退链的行为测试（src/host/voice/chain.ts）。
 *
 * 钉三件事：可用的第三方按注册顺序排在前面、内置恒在最后一环、失败会归一成 VoiceSynthError。
 * 真正的「落到下一环」在 speak 里（见 speak.test.ts），本文件只管链本身的形状。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { voiceChain, voiceChainWithPreferred, headVoiceId } from './chain.ts';
import { VoiceSynthError } from './edge.ts';
import { BUILTIN_VOICE_ID, registerVoiceProvider, resetVoiceProviders } from './registry.ts';

const clip = { data: new Uint8Array([1]), mime: 'audio/mpeg' };

afterEach(() => {
  resetVoiceProviders();
});

test('没有第三方：链上只有内置一环', () => {
  const chain = voiceChain();
  assert.equal(chain.length, 1);
  assert.equal(chain[0]?.id, BUILTIN_VOICE_ID);
  assert.equal(chain[0]?.builtin, true);
});

test('多 provider：可用者按注册顺序在前，内置收尾', () => {
  registerVoiceProvider({ id: 'a', name: 'a', synthesize: async () => clip });
  registerVoiceProvider({ id: 'b', name: 'b', synthesize: async () => clip });
  assert.deepEqual(
    voiceChain().map((link) => link.id),
    ['a', 'b', BUILTIN_VOICE_ID],
  );
  assert.equal(headVoiceId(voiceChain()), 'a');
});

test('不可用的 provider 不进链（但仍留在注册表里）', () => {
  registerVoiceProvider({
    id: 'offline',
    name: 'offline',
    availability: () => ({ ok: false, reason: '没起来' }),
    synthesize: async () => clip,
  });
  assert.deepEqual(
    voiceChain().map((link) => link.id),
    [BUILTIN_VOICE_ID],
  );
});

test('第三方抛普通错误：链环把它归一成 VoiceSynthError', async () => {
  registerVoiceProvider({
    id: 'a',
    name: 'a',
    synthesize: async () => {
      throw new Error('gRPC 500');
    },
  });
  const link = voiceChain()[0];
  assert.ok(link !== undefined);
  await assert.rejects(
    () => link.synthesize({ text: 'hi', rate: '+0%', voice: 'v' }),
    (error: unknown) => error instanceof VoiceSynthError && /gRPC 500/.test(error.message),
  );
});

test('内置实现失败会重试一次（上游偶发首连失败）', async () => {
  let calls = 0;
  const chain = voiceChain(async () => {
    calls += 1;
    if (calls === 1) throw new VoiceSynthError('first attempt failed');
    return clip;
  });
  const builtin = chain[chain.length - 1];
  assert.ok(builtin !== undefined);
  const result = await builtin.synthesize({ text: 'hi', rate: '+0%', voice: 'v' });
  assert.deepEqual(result, clip);
  assert.equal(calls, 2, '第一次失败后要再试一次');
});

test('内置两次都失败：抛最后一个错误', async () => {
  let calls = 0;
  const chain = voiceChain(async () => {
    calls += 1;
    throw new VoiceSynthError('edge down ' + String(calls));
  });
  const builtin = chain[chain.length - 1];
  assert.ok(builtin !== undefined);
  await assert.rejects(
    () => builtin.synthesize({ text: 'hi', rate: '+0%', voice: 'v' }),
    (error: unknown) => error instanceof VoiceSynthError && /edge down 2/.test(error.message),
  );
});

test('按量计费的实现可用也不进自动链：自动选中它等于替用户花钱', () => {
  registerVoiceProvider({ id: 'paid', name: 'paid', billable: true, synthesize: async () => clip });
  registerVoiceProvider({ id: 'free', name: 'free', synthesize: async () => clip });
  assert.deepEqual(
    voiceChain().map((link) => link.id),
    ['free', BUILTIN_VOICE_ID],
  );
});

test('显式首选：付费实现排链首，免费链跟在后面兜底', () => {
  registerVoiceProvider({ id: 'paid', name: 'paid', billable: true, synthesize: async () => clip });
  registerVoiceProvider({ id: 'free', name: 'free', synthesize: async () => clip });
  assert.deepEqual(
    voiceChainWithPreferred('paid').map((link) => link.id),
    ['paid', 'free', BUILTIN_VOICE_ID],
  );
  assert.equal(headVoiceId(voiceChainWithPreferred('paid')), 'paid');
});

test('首选失效（未注册 / 非付费 / 不可用）一律当没选，链保持免费形状', () => {
  registerVoiceProvider({ id: 'paid', name: 'paid', billable: true, synthesize: async () => clip });
  registerVoiceProvider({ id: 'free', name: 'free', synthesize: async () => clip });
  registerVoiceProvider({
    id: 'paid-down',
    name: 'paid-down',
    billable: true,
    availability: () => ({ ok: false, reason: '没配 key' }),
    synthesize: async () => clip,
  });
  const free = ['free', BUILTIN_VOICE_ID];
  for (const preferred of [undefined, '', '   ', 'ghost', 'free', 'paid-down']) {
    assert.deepEqual(
      voiceChainWithPreferred(preferred).map((link) => link.id),
      free,
      `preferred=${String(preferred)}`,
    );
  }
});
