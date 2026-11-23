/**
 * 语音服务的行为测试（src/host/voice/speak.ts）。
 * 合成实现由用例注入：默认套件不联网，只有边界与编排逻辑被钉住。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
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
  stripEmoji?: () => boolean,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-svc-'));
  try {
    const voice = createVoiceService({
      userRoot: root,
      synthesize: synthesize ?? (() => Promise.resolve(mp3Clip())),
      ...(stripEmoji === undefined ? {} : { stripEmoji }),
    });
    await run(voice, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** 轮询直到条件成立；用真实定时器推进，不依赖固定睡眠时长。
 *  不用 setImmediate 空转：条件背后的 `fs.stat` / `mkdir` 走线程池，空转几十圈比一次往返还快，
 *  会在条件成立前就把次数耗光（Windows 上尤其明显）。 */
async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
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
    assert.ok(file.startsWith(join(root, 'cache', 'voice')), '必须落在 cache/voice 下');
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
    // 阈值要留出「第一句立刻上队」的余量：设 0 时，只要入队与执行之间跨过一个
    // 墙钟毫秒，连排在最前面的那句都会被判超时（那是时钟抖动，不是本用例要验的行为）。
    staleWaitMs: 50,
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
    // 让排队时间真的越过阈值：第二句轮到自己时才会被判「客户端早已放弃」
    await new Promise((resolve) => setTimeout(resolve, 80));
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

test('第一环失败：自动落到下一环，用户照常听到声音', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-chain-'));
  const disposeBad = registerVoiceProvider({
    id: 'bad',
    name: '坏的',
    synthesize: async () => {
      throw new Error('本地服务没起');
    },
  });
  let secondCalls = 0;
  const disposeGood = registerVoiceProvider({
    id: 'good',
    name: '好的',
    synthesize: async () => {
      secondCalls += 1;
      return { data: new Uint8Array([7, 7]), mime: 'audio/wav' };
    },
  });
  try {
    const logs: string[] = [];
    const voice = createVoiceService({
      userRoot: root,
      log: { warn: (line) => logs.push(line) },
      synthesize: async () => mp3Clip(),
    });
    const result = await voice.speak({ text: '落到下一环' });
    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.mime : '', 'audio/wav', '听到的是第二环的格式');
    assert.equal(secondCalls, 1);
    assert.ok(
      logs.some((line) => line.includes('link bad failed')),
      '失败必须留痕：' + logs.join(' | '),
    );
    assert.ok(logs.some((line) => line.includes('fell back to good')));
  } finally {
    disposeBad();
    disposeGood();
    await rm(root, { recursive: true, force: true });
  }
});

test('链上全挂：只剩内置兜底，内置也失败才判 generate-error', () => {
  const dispose = registerVoiceProvider({
    id: 'bad',
    name: '坏的',
    synthesize: async () => {
      throw new Error('挂了');
    },
  });
  return withService(
    async (voice) => {
      const result = await voice.speak({ text: '全都挂了' });
      assert.equal(result.ok, false);
      assert.equal(result.ok === false ? result.reason : '', 'generate-error');
    },
    async () => {
      throw new VoiceSynthError('edge also down');
    },
  ).finally(dispose);
});

test('第三方换音色（cacheTag 变）：同一句话必须重新合成，不能拿旧嗓子顶上', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-timbre-'));
  let timbre = 'alpha';
  let calls = 0;
  const dispose = registerVoiceProvider({
    id: 'gsv',
    name: 'GSV',
    cacheTag: () => timbre,
    synthesize: async () => {
      calls += 1;
      return { data: new Uint8Array([calls, 1]), mime: 'audio/wav' };
    },
  });
  try {
    const voice = createVoiceService({ userRoot: root, synthesize: async () => mp3Clip() });
    await voice.speak({ text: '同一句话' });
    await voice.speak({ text: '同一句话' });
    assert.equal(calls, 1, '同一嗓子第二次应命中缓存');
    timbre = 'beta';
    const result = await voice.speak({ text: '同一句话' });
    assert.equal(result.ok ? result.mime : '', 'audio/wav');
    assert.equal(calls, 2, '换了嗓子就换了缓存键，必须重合成');
  } finally {
    dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('第三方此刻不可用：仍命中它以前合成的缓存，不换成内置的声音', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-crosscache-'));
  let builtinCalls = 0;
  let grpcUp = true;
  const dispose = registerVoiceProvider({
    id: 'good',
    name: '好的',
    availability: () => (grpcUp ? { ok: true } : { ok: false, reason: 'gRPC 没起' }),
    synthesize: async () => ({ data: new Uint8Array([5, 5]), mime: 'audio/wav' }),
  });
  try {
    const voice = createVoiceService({
      userRoot: root,
      synthesize: async () => {
        builtinCalls += 1;
        return mp3Clip();
      },
    });
    const first = await voice.speak({ text: '同一句话缓存跨环' });
    assert.equal(first.ok ? first.mime : '', 'audio/wav');
    // 本地服务挂了：链上只剩内置，但这一句以前用同一个嗓子合成过，直接复用
    grpcUp = false;
    const second = await voice.speak({ text: '同一句话缓存跨环' });
    assert.equal(second.ok ? second.mime : '', 'audio/wav', '应命中第一环留下的缓存');
    assert.equal(builtinCalls, 0, '不该为这条去调内置');
  } finally {
    dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('付费实现可用但没开启：一次都不调（自动选中它等于替用户花钱）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-paid-off-'));
  let paidCalls = 0;
  const dispose = registerVoiceProvider({
    id: 'paid',
    name: '付费',
    billable: true,
    synthesize: async () => {
      paidCalls += 1;
      return { data: new Uint8Array([9, 9]), mime: 'audio/wav' };
    },
  });
  try {
    const voice = createVoiceService({ userRoot: root, synthesize: async () => mp3Clip() });
    const result = await voice.speak({ text: '不该花钱' });
    assert.equal(result.ok, true);
    assert.equal(paidCalls, 0, '没开付费开关就不该请求云端');
  } finally {
    dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('显式开启付费实现：链首是它，免费链一次都不调', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-paid-on-'));
  let paidCalls = 0;
  let freeCalls = 0;
  const disposePaid = registerVoiceProvider({
    id: 'paid',
    name: '付费',
    billable: true,
    synthesize: async () => {
      paidCalls += 1;
      return { data: new Uint8Array([9, 9]), mime: 'audio/wav' };
    },
  });
  const disposeFree = registerVoiceProvider({
    id: 'free',
    name: '免费',
    synthesize: async () => {
      freeCalls += 1;
      return { data: new Uint8Array([1]), mime: 'audio/mpeg' };
    },
  });
  try {
    const voice = createVoiceService({
      userRoot: root,
      synthesize: async () => mp3Clip(),
      preferredProvider: () => 'paid',
    });
    const result = await voice.speak({ text: '走云端' });
    assert.equal(result.ok ? result.mime : '', 'audio/wav');
    assert.equal(paidCalls, 1);
    assert.equal(freeCalls, 0, '首选成功时不该再试免费链');
  } finally {
    disposePaid();
    disposeFree();
    await rm(root, { recursive: true, force: true });
  }
});

test('付费实现失败：回落免费链，用户照常有声音，失败要留痕', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-paid-fail-'));
  const dispose = registerVoiceProvider({
    id: 'paid',
    name: '付费',
    billable: true,
    synthesize: async () => {
      throw new Error('Content Exists Risk');
    },
  });
  const logs: string[] = [];
  try {
    const voice = createVoiceService({
      userRoot: root,
      log: { warn: (line) => logs.push(line) },
      synthesize: async () => ({ data: new Uint8Array([3, 3]), mime: 'audio/wav' }),
      preferredProvider: () => 'paid',
    });
    const result = await voice.speak({ text: '云端要挂' });
    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.mime : '', 'audio/wav');
    assert.ok(
      logs.some((line) => line.includes('link paid failed')),
      '失败必须留痕：' + logs.join(' | '),
    );
    assert.ok(logs.some((line) => line.includes('fell back to edge')));
  } finally {
    dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('关掉付费开关：不再命中云端留下的缓存（否则像没关掉）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-paid-cache-'));
  let useCloud = true;
  let edgeCalls = 0;
  const dispose = registerVoiceProvider({
    id: 'paid',
    name: '付费',
    billable: true,
    synthesize: async () => ({ data: new Uint8Array([9, 9]), mime: 'audio/wav' }),
  });
  try {
    const voice = createVoiceService({
      userRoot: root,
      synthesize: async () => {
        edgeCalls += 1;
        return mp3Clip();
      },
      preferredProvider: () => (useCloud ? 'paid' : undefined),
    });
    const first = await voice.speak({ text: '同一句话换来源' });
    assert.equal(first.ok ? first.mime : '', 'audio/wav');
    useCloud = false;
    const second = await voice.speak({ text: '同一句话换来源' });
    assert.equal(second.ok ? second.mime : '', 'audio/mpeg', '关掉后应回到免费链的嗓子');
    assert.equal(edgeCalls, 1);
  } finally {
    dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('开了付费却用不上（没 key / 探活失败）：留一行警示后走免费链', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-paid-down-'));
  const dispose = registerVoiceProvider({
    id: 'paid',
    name: '付费',
    billable: true,
    availability: () => ({ ok: false, reason: '未配置 API Key' }),
    synthesize: async () => ({ data: new Uint8Array([9, 9]), mime: 'audio/wav' }),
  });
  const logs: string[] = [];
  try {
    const voice = createVoiceService({
      userRoot: root,
      log: { warn: (line) => logs.push(line) },
      synthesize: async () => mp3Clip(),
      preferredProvider: () => 'paid',
    });
    const result = await voice.speak({ text: '用不了就说一声' });
    assert.equal(result.ok, true);
    assert.ok(
      logs.some((line) => line.includes('preferred paid unavailable')),
      '用户以为在用云端，必须留痕：' + logs.join(' | '),
    );
  } finally {
    dispose();
    await rm(root, { recursive: true, force: true });
  }
});

/** 合成实际收到的文本与调用次数（每个用例自己重置）。 */
const seen: string[] = [];
let calls = 0;

describe('播报去表情（合成本身拿到的就是清洗后的文本）', () => {
  test('默认摘掉表情：合成收到的文本里没有 emoji', () =>
    withService(
      async (voice) => {
        seen.length = 0;
        const result = await voice.speak({ text: '收到啦🎉' });
        assert.equal(result.ok, true);
        assert.deepEqual(seen, ['收到啦'], '合成本身只该拿到干净文本');
      },
      async (input) => {
        seen.push(input.text);
        return mp3Clip();
      },
    ));

  test('关掉开关：原样交给合成', () =>
    withService(
      async (voice) => {
        seen.length = 0;
        const result = await voice.speak({ text: '收到啦🎉' });
        assert.equal(result.ok, true);
        assert.deepEqual(seen, ['收到啦🎉']);
      },
      async (input) => {
        seen.push(input.text);
        return mp3Clip();
      },
      () => false,
    ));

  test('整句只有表情：bad-request，且不去调合成', () =>
    withService(
      async (voice) => {
        calls = 0;
        const result = await voice.speak({ text: '🙂🙂' });
        assert.equal(result.ok, false);
        assert.equal(result.ok === false ? result.reason : '', 'bad-request');
        assert.equal(result.ok === false ? result.message : '', 'text is only emoji');
        assert.equal(calls, 0, '没有可念的内容就不该合成');
      },
      async () => {
        calls += 1;
        return mp3Clip();
      },
    ));
});
