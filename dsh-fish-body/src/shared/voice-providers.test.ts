/**
 * `/voice/voices` 的客户端解析测试（src/shared/voice-providers.ts）。
 *
 * 钉两件事：坏条目一律丢弃（一条脏数据不能让菜单崩掉）、
 * `reason` 与 `lastError` 是两件事（前者「现在能不能用」，后者「刚才念失败了」），缺省时不留空字段。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readVoiceProviders, switchableProviders } from './voice-providers.ts';

test('providers：reason 与 lastError 各自解析，缺/空/非串都不留字段', () => {
  const [full, bare, dirty] = readVoiceProviders([
    {
      id: 'gsv',
      name: 'GSV',
      available: true,
      reason: '  ',
      lastError: ' /tts 返回 400：tts failed ',
      voices: [],
      fields: [],
      voice: 'klee',
    },
    { id: 'quiet', available: false, reason: '连不上', voices: [] },
    { id: 'weird', lastError: 42, reason: { toString: () => 'x' } },
  ]);
  assert.ok(full && bare && dirty);
  assert.equal(full.available, true);
  assert.equal('reason' in full, false, '空白 reason 不写进视图');
  assert.equal(full.lastError, '/tts 返回 400：tts failed', '两端空白被裁掉');
  assert.equal(bare.available, false);
  assert.equal(bare.reason, '连不上');
  assert.equal('lastError' in bare, false, '没这个字段就不编一个出来');
  assert.equal('reason' in dirty, false, '非字符串当没有');
  assert.equal('lastError' in dirty, false, '非字符串当没有');
  assert.equal(dirty.available, true, 'available 缺席按可用处理（老宿主）');
});

test('providers：不是数组 / 缺 id 都退化成空，不抛错', () => {
  assert.deepEqual(readVoiceProviders(undefined), []);
  assert.deepEqual(readVoiceProviders({ providers: [] }), []);
  assert.deepEqual(readVoiceProviders([null, 3, { name: 'no-id' }]), []);
});

test('switchableProviders：只看有音色的第三方实现', () => {
  const providers = readVoiceProviders([
    { id: 'gsv', builtin: false, voices: [{ id: 'klee' }] },
    { id: 'edge', builtin: true, voices: [{ id: 'zh-CN-XiaoxiaoNeural' }] },
    { id: 'empty', builtin: false, voices: [] },
  ]);
  assert.deepEqual(
    switchableProviders(providers).map((item) => item.id),
    ['gsv'],
  );
});

test('fields：select 的候选值要带出来，脏值丢掉', () => {
  const [provider] = readVoiceProviders([
    {
      id: 'cloud',
      fields: [
        { key: 'voice', label: '音色', kind: 'select', options: [' stella ', 'tide', '', 42, null] },
        { key: 'baseURL', label: '地址', kind: 'text', options: 'not-an-array' },
        { key: 'empty', label: '空下拉', kind: 'select', options: [] },
      ],
    },
  ]);
  assert.ok(provider);
  const [voice, baseURL, empty] = provider.fields;
  assert.deepEqual(voice?.options, ['stella', 'tide'], '空白与非法项都要丢掉');
  assert.equal('options' in (baseURL ?? {}), false, '非数组当没有（渲染回输入框）');
  assert.equal('options' in (empty ?? {}), false, '空数组不留下，等于退回输入框');
});
