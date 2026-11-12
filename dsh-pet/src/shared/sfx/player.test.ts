/**
 * 音效播放器（src/shared/sfx/player.ts）的契约：预热幂等、按需解码、节流、
 * 上下文挂起时先恢复、解码失败与无 WebAudio 时回退 `<audio>`、时间线的排与撤。
 *
 * 另附素材声学前提：包内默认音的攻击段都贴在 t=0（所以首声必须靠常热上下文保，不能指望前置静音）。
 * 用假 AudioContext / 假 fetch / 假 Audio，不碰真实设备。
 */
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';

import { configureSfx, playSfx, preloadSfx, resetSfx, scheduleSfx, stopScheduledSfx, whenSfxReady } from './player.ts';

/** 假增益节点。 */
class FakeGain {
  gain = { value: 0 };
  connect(): void {
    /* 拓扑不关心 */
  }
}

/** 假 BufferSource：记起播次数与循环标志。 */
class FakeSource {
  static stops = 0;
  buffer: unknown = null;
  loop = false;
  started = 0;
  connect(): void {
    /* 拓扑不关心 */
  }
  start(): void {
    this.started += 1;
  }
  stop(): void {
    FakeSource.stops += 1;
  }
  disconnect(): void {
    /* 拓扑不关心 */
  }
}

/** 假 AudioBuffer。 */
class FakeBuffer {
  private readonly channel = new Float32Array(16);
  getChannelData(): Float32Array {
    return this.channel;
  }
}

/** 假 AudioContext。 */
class FakeContext {
  static instances: FakeContext[] = [];
  static decodeCalls = 0;
  static failDecode = false;
  /** 模拟浏览器在用户手势前不给恢复：构造后是 suspended，resume() 一直不兑现。 */
  static startSuspended = false;
  state = 'running';
  sampleRate = 8000;
  destination = new FakeGain();
  sources: FakeSource[] = [];
  listeners: Array<() => void> = [];
  constructor() {
    if (FakeContext.startSuspended) this.state = 'suspended';
    FakeContext.instances.push(this);
  }
  resume(): Promise<void> {
    if (this.state === 'suspended' && FakeContext.startSuspended) return new Promise<void>(() => {});
    this.state = 'running';
    return Promise.resolve();
  }
  emitStateChange(): void {
    for (const listener of this.listeners) listener();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }
  createGain(): FakeGain {
    return new FakeGain();
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createBuffer(): FakeBuffer {
    return new FakeBuffer();
  }
  decodeAudioData(): Promise<unknown> {
    FakeContext.decodeCalls += 1;
    if (FakeContext.failDecode) return Promise.reject(new Error('decode failed'));
    return Promise.resolve({ duration: 0.2 });
  }
  addEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') this.listeners.push(listener);
  }
}

/** 假 `<audio>`。 */
class FakeAudio {
  static plays = 0;
  src = '';
  volume = 0;
  currentTime = 0;
  play(): Promise<void> {
    FakeAudio.plays += 1;
    return Promise.resolve();
  }
}

/** 真正发声的源（排除常驻保活的循环源）。 */
const attacks = (): FakeSource[] =>
  (FakeContext.instances[FakeContext.instances.length - 1]?.sources ?? []).filter((source) => !source.loop);
/** 保活源。 */
const keepalives = (): FakeSource[] =>
  (FakeContext.instances[FakeContext.instances.length - 1]?.sources ?? []).filter((source) => source.loop);

/** 条件成立就返回；到点放弃。 */
async function until(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await setImmediate();
}

const originalFetch = globalThis.fetch;
const originalAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext;
const originalAudio = (globalThis as { Audio?: unknown }).Audio;
const originalInfo = console.info;
const originalWarn = console.warn;
let fetched: string[] = [];

beforeEach(() => {
  FakeContext.instances = [];
  FakeContext.decodeCalls = 0;
  FakeContext.failDecode = false;
  FakeContext.startSuspended = false;
  FakeAudio.plays = 0;
  FakeSource.stops = 0;
  fetched = [];
  resetSfx();
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeContext;
  (globalThis as { Audio?: unknown }).Audio = FakeAudio;
  globalThis.fetch = (async (url: string) => {
    fetched.push(url);
    return new Response(new Uint8Array(64));
  }) as unknown as typeof fetch;
  console.info = () => {
    /* 路径日志不打扰测试输出 */
  };
  console.warn = () => {
    /* 解码失败的告警自有断言覆盖 */
  };
});

afterEach(() => {
  stopScheduledSfx();
  globalThis.fetch = originalFetch;
  (globalThis as { AudioContext?: unknown }).AudioContext = originalAudioContext;
  (globalThis as { Audio?: unknown }).Audio = originalAudio;
  console.info = originalInfo;
  console.warn = originalWarn;
  resetSfx();
});

describe('configureSfx —— 预热', () => {
  test('反复配置：只建一个上下文，素材只取一次、只解码一次', async () => {
    configureSfx({ enabled: true, keepAlive: false, volume: 1 });
    preloadSfx('a.wav');
    preloadSfx('a.wav');
    configureSfx({ enabled: true, keepAlive: false, volume: 1 });
    await whenSfxReady();
    assert.equal(FakeContext.instances.length, 1, '上下文应该复用');
    assert.deepEqual(fetched, ['a.wav'], '同一素材只取一次');
    assert.equal(FakeContext.decodeCalls, 1);
  });

  test('关掉开关：挂起上下文但不销毁它；保活源也停掉', async () => {
    configureSfx({ enabled: true, keepAlive: true });
    await whenSfxReady();
    configureSfx({ enabled: false });
    await setImmediate();
    assert.equal(FakeContext.instances[0].state, 'suspended');
    assert.equal(FakeContext.instances.length, 1, '挂起不等于销毁');
    assert.equal(FakeSource.stops, 1, '关掉后常驻保活要停');
  });

  test('常驻预热：起一条循环源；关掉预热就不占设备', async () => {
    configureSfx({ enabled: true, keepAlive: true });
    assert.equal(keepalives().length, 1);
    resetSfx();
    configureSfx({ enabled: true, keepAlive: false });
    assert.equal(keepalives().length, 0);
  });
});

describe('playSfx —— 播放路径', () => {
  test('预热完成后：一次调用起一个 BufferSource', async () => {
    configureSfx({ enabled: true, keepAlive: false });
    preloadSfx('a.wav');
    await whenSfxReady();
    assert.equal(playSfx('a.wav'), true);
    assert.equal(attacks().length, 1);
  });

  test('缺省不节流；给了窗口才吃重复调用', async () => {
    configureSfx({ enabled: true, keepAlive: false });
    preloadSfx('a.wav');
    await whenSfxReady();
    playSfx('a.wav');
    playSfx('a.wav');
    assert.equal(attacks().length, 2, '两条时间线点可以连响');
    // 节流按 key 记时：不节流的调用也会刷新同一个 url 的记录，所以这里用独立的键验证窗口。
    assert.equal(playSfx('a.wav', { throttleMs: 100, throttleKey: 'k1' }), true);
    assert.equal(playSfx('a.wav', { throttleMs: 100, throttleKey: 'k1' }), false, '窗口内的同键调用被吃掉');
    assert.equal(playSfx('a.wav', { throttleMs: 100, throttleKey: 'k2' }), true, '不同键各有各的窗口');
  });

  test('总开关关着：不播也不碰上下文', () => {
    configureSfx({ enabled: false });
    assert.equal(playSfx('a.wav'), false);
    assert.equal(FakeContext.instances.length, 0);
    assert.equal(FakeAudio.plays, 0);
  });

  test('上下文被系统挂断：先恢复再起播，这一声不丢', async () => {
    configureSfx({ enabled: true, keepAlive: false });
    preloadSfx('a.wav');
    await whenSfxReady();
    const audio = FakeContext.instances[0];
    audio.state = 'suspended';
    assert.equal(playSfx('a.wav'), true);
    await setImmediate();
    assert.equal(audio.state, 'running');
    assert.equal(attacks().length, 1);
  });

  test('素材还在解码时调用：等解码完再用 WebAudio，不退回会丢音头的 <audio>', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = (async (url: string) => {
      fetched.push(url);
      await gate;
      return new Response(new Uint8Array(64));
    }) as unknown as typeof fetch;
    configureSfx({ enabled: true, keepAlive: false });
    preloadSfx('a.wav');
    assert.equal(playSfx('a.wav'), true);
    assert.equal(FakeAudio.plays, 0);
    release();
    await until(() => attacks().length > 0);
    assert.equal(attacks().length, 1);
  });
});

describe('playSfx —— 回退', () => {
  test('解码失败：退回 <audio>，同一素材不再反复请求', async () => {
    FakeContext.failDecode = true;
    configureSfx({ enabled: true, keepAlive: false });
    preloadSfx('a.wav');
    await whenSfxReady();
    assert.doesNotThrow(() => playSfx('a.wav'));
    assert.equal(FakeAudio.plays, 1);
    assert.equal(attacks().length, 0);
    const before = fetched.length;
    playSfx('a.wav');
    assert.equal(fetched.length, before, '失败过的素材不再重试');
  });

  test('环境没有 WebAudio：整链走 <audio>', () => {
    (globalThis as { AudioContext?: unknown }).AudioContext = undefined;
    configureSfx({ enabled: true, keepAlive: false });
    assert.equal(playSfx('a.wav'), true);
    assert.equal(FakeAudio.plays, 1);
  });
});

describe('scheduleSfx —— 时间线', () => {
  test('at=0 立即起播；stopScheduledSfx 之后不再响', async () => {
    configureSfx({ enabled: true, keepAlive: false });
    preloadSfx('a.wav');
    await whenSfxReady();
    scheduleSfx([{ url: 'a.wav', at: 0 }]);
    await until(() => attacks().length === 1);
    assert.equal(attacks().length, 1);
    stopScheduledSfx();
    scheduleSfx([{ url: 'a.wav', at: 60000 }]);
    stopScheduledSfx();
    await setImmediate();
    assert.equal(attacks().length, 1, '撤掉的点不该再响');
  });
});

describe('包内默认音素材', () => {
  test('每个默认音都存在、单声道 44.1kHz、攻击段贴在 t=0、峰值够大', async () => {
    const dir = new URL('../../../assets/sound/', import.meta.url);
    const names = (await readdir(dir)).filter((name) => name.endsWith('.wav'));
    for (const expected of ['click-duck.wav', 'drag.wav', 'throw.wav', 'bump-soft.wav', 'pet-bump.wav']) {
      assert.ok(names.includes(expected), '缺少默认音：' + expected);
    }
    for (const name of names) {
      const bytes = await readFile(new URL(name, dir));
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', name + ' 应该是 WAV 容器');
      assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
      const sampleRate = bytes.readUInt32LE(24);
      assert.equal(sampleRate, 44100, name + ' 采样率应为 44.1kHz');
      assert.equal(bytes.readUInt16LE(22), 1, name + ' 应为单声道');
      const dataOffset = 44;
      const total = Math.floor((bytes.length - dataOffset) / 2);
      const audible = 0.1 * 32768;
      let onset = -1;
      let peak = 0;
      for (let index = 0; index < total; index += 1) {
        const amplitude = Math.abs(bytes.readInt16LE(dataOffset + index * 2));
        if (amplitude > peak) peak = amplitude;
        if (onset < 0 && amplitude > audible) onset = index;
      }
      assert.ok(onset >= 0, name + ' 不该是静音');
      assert.ok((onset / sampleRate) * 1000 <= 5, name + ' 的首个可闻样本应在 5ms 内（改了素材要重估预热策略）');
      assert.ok(peak / 32768 >= 0.3, name + ' 峰值应在 30% 满幅以上');
      assert.ok((total / sampleRate) * 1000 < 400, name + ' 应是短提示音');
    }
  });
});
