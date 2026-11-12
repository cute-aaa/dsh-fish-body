/**
 * 点击音效播放器（src/shared/click-sfx.ts）的契约测试：预热幂等（一个上下文、一次解码）、
 * 连点节流、上下文挂起时先恢复再起播、解码失败与无 WebAudio 时回退 `<audio>`。
 * 另附素材声学前提：click-duck.wav 的攻击段贴在 t=0，这正是必须预热的理由。
 * 用假 AudioContext / 假 fetch / 假 Audio，不碰真实设备。
 */
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';

import { playClickSfx, resetClickSfx, setClickSfxEnabled, whenClickSfxReady } from './click-sfx.ts';

/** 假增益节点：只记音量。 */
class FakeGain {
  gain = { value: 0 };
  connect(): void {
    /* 拓扑不关心 */
  }
}

/** 假 BufferSource：记起动次数。 */
class FakeSource {
  buffer: unknown = null;
  started = 0;
  connect(): void {
    /* 拓扑不关心 */
  }
  start(): void {
    this.started += 1;
  }
}

/** 假 AudioContext：状态可手改，解码次数与起播次数都记下来。 */
class FakeContext {
  static instances: FakeContext[] = [];
  static decodeCalls = 0;
  static failDecode = false;
  state = 'running';
  destination = new FakeGain();
  sources: FakeSource[] = [];
  constructor() {
    FakeContext.instances.push(this);
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
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
  decodeAudioData(): Promise<unknown> {
    FakeContext.decodeCalls += 1;
    if (FakeContext.failDecode) return Promise.reject(new Error('decode failed'));
    return Promise.resolve({ duration: 0.35 });
  }
  addEventListener(): void {
    /* 自愈监听在单测里不触发 */
  }
}

/** 假 `<audio>`：记播放次数。 */
class FakeAudio {
  static plays = 0;
  volume = 0;
  currentTime = 0;
  play(): Promise<void> {
    FakeAudio.plays += 1;
    return Promise.resolve();
  }
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
  FakeAudio.plays = 0;
  fetched = [];
  resetClickSfx();
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
  globalThis.fetch = originalFetch;
  (globalThis as { AudioContext?: unknown }).AudioContext = originalAudioContext;
  (globalThis as { Audio?: unknown }).Audio = originalAudio;
  console.info = originalInfo;
  console.warn = originalWarn;
  resetClickSfx();
});

describe('setClickSfxEnabled —— 预热', () => {
  test('配置反复刷新：只建一个上下文、只取一次素材、只解码一次', async () => {
    setClickSfxEnabled(true, { url: '/dsh-pet-7340/sound/click-duck.wav' });
    setClickSfxEnabled(true, { url: '/dsh-pet-7340/sound/click-duck.wav' });
    setClickSfxEnabled(true, { url: '/dsh-pet-7340/sound/click-duck.wav' });
    await whenClickSfxReady();
    assert.equal(FakeContext.instances.length, 1, '上下文应该复用，不是每次开关都新建');
    assert.deepEqual(fetched, ['/dsh-pet-7340/sound/click-duck.wav'], '素材只该取一次');
    assert.equal(FakeContext.decodeCalls, 1, '素材只该解码一次');
  });

  test('关闭开关：挂起上下文，但不销毁它', async () => {
    setClickSfxEnabled(true, { url: 'sfx.wav' });
    await whenClickSfxReady();
    setClickSfxEnabled(false);
    await setImmediate();
    assert.equal(FakeContext.instances[0].state, 'suspended', '关掉后应挂起以让出音频设备');
    assert.equal(FakeContext.instances.length, 1, '挂起不等于销毁，下次打开要能立刻用');
  });
});

describe('playClickSfx —— 播放', () => {
  test('预热完成后：一次点击起一个 BufferSource', async () => {
    setClickSfxEnabled(true, { url: 'sfx.wav' });
    await whenClickSfxReady();
    assert.equal(playClickSfx(), true, '开关打开且素材就绪时应发起播放');
    assert.equal(FakeContext.instances[0].sources.length, 1);
    assert.equal(FakeContext.instances[0].sources[0].started, 1);
  });

  test('默认节流：100ms 内的第二次点击不再起播', async () => {
    setClickSfxEnabled(true, { url: 'sfx.wav' });
    await whenClickSfxReady();
    playClickSfx();
    assert.equal(playClickSfx(), false, '节流窗口内的连点应被吃掉');
    assert.equal(FakeContext.instances[0].sources.length, 1);
  });

  test('节流窗口配成 0：每次都起播（连点不丢声）', async () => {
    setClickSfxEnabled(true, { url: 'sfx.wav', throttleMs: 0 });
    await whenClickSfxReady();
    playClickSfx();
    playClickSfx();
    assert.equal(FakeContext.instances[0].sources.length, 2);
  });

  test('上下文被系统挂断：先恢复再起播，这一声不丢', async () => {
    setClickSfxEnabled(true, { url: 'sfx.wav' });
    await whenClickSfxReady();
    const audio = FakeContext.instances[0];
    audio.state = 'suspended';
    assert.equal(playClickSfx(), true);
    await setImmediate();
    assert.equal(audio.state, 'running', '应该顺手把上下文恢复起来');
    assert.equal(audio.sources.length, 1, '恢复后要把这一声补上');
  });

  test('开关关闭：不播，也不碰上下文', () => {
    setClickSfxEnabled(false);
    assert.equal(playClickSfx(), false);
    assert.equal(FakeContext.instances.length, 0);
    assert.equal(FakeAudio.plays, 0);
  });
});

describe('playClickSfx —— 回退', () => {
  test('解码失败：退回 <audio>，不外抛', async () => {
    FakeContext.failDecode = true;
    setClickSfxEnabled(true, { url: 'sfx.wav' });
    await whenClickSfxReady();
    assert.doesNotThrow(() => playClickSfx());
    assert.equal(FakeAudio.plays, 1, '解码不成也要能出声');
    assert.equal(FakeContext.instances[0].sources.length, 0);
  });

  test('环境没有 WebAudio：整链走 <audio>', () => {
    (globalThis as { AudioContext?: unknown }).AudioContext = undefined;
    setClickSfxEnabled(true, { url: 'sfx.wav' });
    assert.equal(playClickSfx(), true);
    assert.equal(FakeAudio.plays, 1);
  });
});

describe('素材 click-duck.wav', () => {
  test('攻击段贴在文件开头：所以首声必须靠预热保，不能指望前置静音', async () => {
    const bytes = await readFile(new URL('../../assets/sound/click-duck.wav', import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', '应该是 WAV 容器');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    const dataOffset = 44;
    const total = Math.floor((bytes.length - dataOffset) / 2);
    const sampleRate = bytes.readUInt32LE(24);
    const audible = 0.1 * 32768;
    let onset = -1;
    let peak = 0;
    for (let index = 0; index < total; index += 1) {
      const amplitude = Math.abs(bytes.readInt16LE(dataOffset + index * 2));
      if (amplitude > peak) peak = amplitude;
      if (onset < 0 && amplitude > audible) onset = index;
    }
    assert.ok(onset >= 0, '素材不该是静音');
    assert.ok(
      (onset / sampleRate) * 1000 <= 5,
      '超过 10% 满幅的首个样本应在前 5ms 内（素材换了要重估预热策略，不是改这条断言）',
    );
    assert.ok((total / sampleRate) * 1000 > 340, '时长应在 340ms 以上');
    assert.ok(peak / 32768 >= 0.3, '峰值应在 30% 满幅以上');
  });
});
