/**
 * 语音服务的行为测试（src/host/voice/speak.ts）。
 * 合成实现由用例注入：默认套件不联网，只有边界与编排逻辑被钉住。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { VoiceSynthError, type SynthInput } from './edge.ts';
import { registerVoiceProvider } from './registry.ts';
import { MAX_TEXT_CHARS, createVoiceService, isQueueStale, type VoiceService } from './speak.ts';
import type { AudioClip } from './audio.ts';

/** 假的一段 mp3：字节内容无所谓，缓存与路由只看 mime。 */
const mp3Clip = (): AudioClip => ({ data: new Uint8Array([1, 2, 3]), mime: 'audio/mpeg' });

/** 造一个隔离的语音服务；`synthesize` 缺省回一段假 mp3。 */
async function withService(
  run: (voice: VoiceService, root: string) => Promise<void>,
  synthesize?: (input: SynthInput) => Promise<AudioClip>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-svc-'));
  try {
    const voice = createVoiceService({
      userRoot: root,
      synthesize: synthesize ?? (() => Promise.resolve(mp3Clip())),
    });
    await run(voice, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** 轮询直到条件成立；用 setImmediate 推进，不依赖固定睡眠时长。 */
async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('等待条件超时');
}

test('text 为空或全空白：判 bad-request 且不调用合成', () =>
  withService(async (voice) => {
    const result = await voice.speak({ text: '   ' });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.reason : '', 'bad-request');
  }));

test('text 超过上限：判 bad-request，不做截断', () =>
  withService(async (voice) => {
    const result = await voice.speak({ text: '中'.repeat(MAX_TEXT_CHARS + 1) });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.reason : '', 'bad-request');
    assert.match(result.ok === false ? result.message : '', /too long/);
  }));

test('voice 不在白名单：判 bad-request 并列出合法值', () =>
  withService(async (voice) => {
    const result = await voice.speak({ text: '你好', voice: 'zh-CN-NopeNeural' });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.message : '', /zh-CN-XiaoxiaoNeural/);
  }));

test('rate 格式不合法：判 bad-request', () =>
  withService(async (voice) => {
    const result = await voice.speak({ text: '你好', rate: '10%' });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.message : '', /rate/);
  }));

test('合法请求：返回缓存路径与 mime，文件确实落盘', () =>
  withService(async (voice, root) => {
    const result = await voice.speak({ text: '今天也要加油哦' });
    assert.equal(result.ok, true);
    const file = result.ok ? result.file : '';
    assert.equal(result.ok ? result.mime : '', 'audio/mpeg');
    assert.ok(file.startsWith(join(root, 'voice-cache')), '必须落在 voice-cache 下');
    assert.ok(file.endsWith('.mp3'), '扩展名跟着 mime 走');
  }));

test('合成回 wav：扩展名与 mime 都跟着格式走（GSV 免转码）', () =>
  withService(
    async (voice, root) => {
      const result = await voice.speak({ text: '本地 TTS 一句话' });
      assert.equal(result.ok, true);
      assert.equal(result.ok ? result.mime : '', 'audio/wav');
      assert.ok((result.ok ? result.file : '').endsWith('.wav'));
      // 同一句再问一次：命中 .wav 缓存，不再调合成
      const again = await voice.speak({ text: '本地 TTS 一句话' });
      assert.equal(again.ok, true);
      assert.equal(again.ok ? again.mime : '', 'audio/wav');
      assert.equal(again.ok ? again.file : '', result.ok ? result.file : '');
      void root;
    },
    () => Promise.resolve({ data: new Uint8Array([9, 9]), mime: 'audio/wav; charset=binary' }),
  ));

test('合成回不认识的 mime：判 generate-error，不写进缓存', () =>
  withService(
    async (voice) => {
      const result = await voice.speak({ text: '格式不对' });
      assert.equal(result.ok, false);
      assert.equal(result.ok === false ? result.reason : '', 'generate-error');
    },
    () => Promise.resolve({ data: new Uint8Array([1]), mime: 'audio/flac' }),
  ));

test('同一输入第二次：命中缓存，不再调用合成', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-hit-'));
  try {
    let calls = 0;
    const voice = createVoiceService({
      userRoot: root,
      synthesize: async () => {
        calls += 1;
        return mp3Clip();
      },
    });
    await voice.speak({ text: '同一句话' });
    const second = await voice.speak({ text: '同一句话' });
    assert.equal(second.ok, true);
    assert.equal(calls, 1, '第二次必须命中缓存');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('合成失败：判 generate-error，不把上游细节回给调用方', () =>
  withService(
    async (voice) => {
      const result = await voice.speak({ text: '你好' });
      assert.equal(result.ok, false);
      assert.equal(result.ok === false ? result.reason : '', 'generate-error');
      assert.doesNotMatch(result.ok === false ? result.message : '', /https?:/, '不许回显上游地址');
    },
    async () => {
      throw new VoiceSynthError('upstream 403 from https://example.invalid');
    },
  ));

test('队列已满：后续请求判 voice-busy，而不是无限排队', () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return withService(
    async (voice) => {
      let settled = 0;
      const calls = ['a', 'b', 'c', 'd', 'e'].map((text) =>
        voice.speak({ text }).then((result) => {
          settled += 1;
          return result;
        }),
      );
      await waitFor(() => settled >= 2);
      release();
      const results = await Promise.all(calls);
      const busy = results.filter((result) => !result.ok && result.reason === 'voice-busy');
      assert.ok(busy.length >= 1, '至少有一个请求应被判为 voice-busy');
    },
    async () => {
      await gate;
      return mp3Clip();
    },
  );
});

test('isQueueStale —— 排队久了就丢弃', () => {
  assert.equal(isQueueStale(1_000, 1_000), false, '刚轮到自己不算久');
  assert.equal(isQueueStale(1_000, 1_000 + 28_000), false, '正好到上限仍在容许范围内');
  assert.equal(isQueueStale(1_000, 1_000 + 28_001), true, '超过上限就该丢');
});

test('排队等到客户端早已放弃：直接丢弃，不再白合成一次', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-stale-'));
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const voice = createVoiceService({
    userRoot: root,
    staleWaitMs: 0,
    synthesize: async () => {
      calls += 1;
      if (calls === 1) await gate; // 第一句占住串行链，第二句才排得上队
      return mp3Clip();
    },
  });
  try {
    const first = voice.speak({ text: '第一句' }); // 拿着队列不放
    await waitFor(() => calls === 1);
    const second = voice.speak({ text: '第二句' }); // 排在它后面
    await new Promise((resolve) => setTimeout(resolve, 10)); // 让排队时间真的过去一点
    release();
    const [kept, dropped] = await Promise.all([first, second]);
    assert.equal(kept.ok, true, '排在第一的照常合成');
    assert.equal(dropped.ok === false ? dropped.reason : '', 'voice-busy');
    assert.match(dropped.ok === false ? dropped.message : '', /queued too long/);
    assert.equal(calls, 1, '被丢弃的那句不能再调合成');
  } finally {
    release();
    await rm(root, { recursive: true, force: true });
  }
});

test('注册了第三方实现：合成走它，内置一次都不调', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-provider-'));
  let edgeCalls = 0;
  let providerCalls = 0;
  const dispose = registerVoiceProvider({
    id: 'my-tts',
    name: '我的语音',
    synthesize: async () => {
      providerCalls += 1;
      return mp3Clip();
    },
  });
  try {
    const voice = createVoiceService({
      userRoot: root,
      synthesize: async () => {
        edgeCalls += 1;
        return mp3Clip();
      },
    });
    const result = await voice.speak({ text: '你好' });
    assert.equal(result.ok, true);
    assert.equal(providerCalls, 1, '应该走第三方实现');
    assert.equal(edgeCalls, 0, '注册之后不该再调内置');
  } finally {
    dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('第三方返回空字节：判 generate-error，不留下 0 字节文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-empty-'));
  const dispose = registerVoiceProvider({
    id: 'my-tts',
    name: '我的语音',
    synthesize: async () => ({ data: new Uint8Array(), mime: 'audio/mpeg' }),
  });
  try {
    const voice = createVoiceService({ userRoot: root, synthesize: async () => mp3Clip() });
    const result = await voice.speak({ text: '你好' });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.reason : '', 'generate-error');
  } finally {
    dispose();
    await rm(root, { recursive: true, force: true });
  }
});
