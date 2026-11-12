/**
 * 点击音效网页端入口（src/client/pet/click-sound.ts）的接线测试：
 * 开关透传到共享播放器、素材地址按挂载前缀拼对。
 * 播放、节流与回退的行为由 shared/click-sfx.test.ts 覆盖，这里只钉 Wiring。
 */
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';

import { ROUTE_PATH } from '../../shared/constants.ts';
import { whenClickSfxReady, resetClickSfx } from '../../shared/click-sfx.ts';
import { playClickSound, setClickSoundEnabled } from './click-sound.ts';

/** 假 AudioContext：够让共享层走 WebAudio 路径即可。 */
class FakeContext {
  static sources = 0;
  state = 'running';
  sampleRate = 8000;
  destination = { connect: () => undefined };
  resume(): Promise<void> {
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }
  createGain(): { gain: { value: number }; connect: () => void } {
    return { gain: { value: 0 }, connect: () => undefined };
  }
  createBufferSource(): {
    buffer: unknown;
    loop: boolean;
    connect: () => void;
    start: () => void;
    stop: () => void;
    disconnect: () => void;
  } {
    const source = {
      buffer: null as unknown,
      loop: false,
      connect: () => undefined,
      start: () => {
        // 常驻保活源循环播放，不算"点击这一声"
        if (!source.loop) FakeContext.sources += 1;
      },
      stop: () => undefined,
      disconnect: () => undefined,
    };
    return source;
  }
  createBuffer(): { getChannelData: () => Float32Array } {
    return { getChannelData: () => new Float32Array(16) };
  }
  decodeAudioData(): Promise<unknown> {
    return Promise.resolve({ duration: 0.35 });
  }
  addEventListener(): void {
    /* 自愈监听在单测里不触发 */
  }
}

const originalFetch = globalThis.fetch;
const originalAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext;
const originalInfo = console.info;
let fetched: string[] = [];

beforeEach(() => {
  FakeContext.sources = 0;
  fetched = [];
  resetClickSfx();
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeContext;
  globalThis.fetch = (async (url: string) => {
    fetched.push(url);
    return new Response(new Uint8Array(64));
  }) as unknown as typeof fetch;
  console.info = () => {
    /* 路径日志不打扰测试输出 */
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as { AudioContext?: unknown }).AudioContext = originalAudioContext;
  console.info = originalInfo;
  resetClickSfx();
});

describe('setClickSoundEnabled —— 接线', () => {
  test('打开开关：按挂载前缀预热点击音效素材', async () => {
    setClickSoundEnabled(true, false);
    await whenClickSfxReady();
    assert.deepEqual(fetched, [ROUTE_PATH + '/sound/click-duck.wav'], '素材地址要带上挂载前缀');
  });

  test('关闭开关：后续点击不出声', async () => {
    setClickSoundEnabled(true, false);
    await whenClickSfxReady();
    setClickSoundEnabled(false, false);
    await setImmediate();
    playClickSound();
    assert.equal(FakeContext.sources, 0, '开关关掉后不该再起播');
  });

  test('打开后点击：这一声交给共享播放器', async () => {
    setClickSoundEnabled(true, false);
    await whenClickSfxReady();
    playClickSound();
    assert.equal(FakeContext.sources, 1);
  });
});
