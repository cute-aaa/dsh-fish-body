/**
 * 会话鱼播报队列：串行不叠音、同句去重、优先级与积压裁剪、过期丢弃。
 *
 * 用假端口替掉真实语音链：`speak` 记下被念的句子，`end` 由测试手动发（模拟播完），
 * 时间也由测试推进——所以这些断言都不依赖真实音频与定时器。
 * @module dsh-pet/src/client/session-fish/speech.test
 */
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { configureFishSpeech, enqueueFishLine, pendingFishSpeech, stopFishSpeech } from './speech.ts';
import type { VoiceUtteranceEvent } from '../../shared/voice.ts';

/** 假语音端口：记住被念的句子，让测试控制 end 与时间。 */
function makePort() {
  const spoken: string[] = [];
  let listener: ((event: VoiceUtteranceEvent) => void) | null = null;
  let now = 1_000;
  let seq = 0;
  return {
    spoken,
    port: {
      speak: (text: string): void => {
        spoken.push(text);
      },
      subscribe: (next: (event: VoiceUtteranceEvent) => void): (() => void) => {
        listener = next;
        return () => {
          listener = null;
        };
      },
      now: () => now,
    },
    /** 模拟当前这句开播并播完。 */
    finish(): void {
      seq += 1;
      const text = spoken[spoken.length - 1] ?? '';
      listener?.({ kind: 'start', seq, text });
      listener?.({ kind: 'end', seq, text });
    },
    /** 只发 end（不带 start）：队列应按文本认句收尾。 */
    endOnly(): void {
      listener?.({ kind: 'end', seq: 0, text: spoken[spoken.length - 1] ?? '' });
    },
    /** 别的组件在说话：序号对不上，队列不该被推着走。 */
    foreignEnd(): void {
      listener?.({ kind: 'end', seq: 999, text: '别人那一句' });
    },
    tick(ms: number): void {
      now += ms;
    },
  };
}

/** 一条播报（默认是进度句）。 */
function line(
  text: string,
  over: Partial<{ sessionId: string; kind: 'progress' | 'turnEnd' | 'done'; lineAt: number }> = {},
) {
  return {
    sessionId: over.sessionId ?? 's1',
    text,
    kind: over.kind ?? ('progress' as const),
    lineAt: over.lineAt ?? 1_000,
  };
}

let harness: ReturnType<typeof makePort>;

beforeEach(() => {
  harness = makePort();
  configureFishSpeech(harness.port);
});

afterEach(() => {
  stopFishSpeech();
});

describe('fish speech queue', () => {
  test('串行：一句没念完，下一句等着', () => {
    enqueueFishLine(line('A'));
    enqueueFishLine(line('B', { kind: 'turnEnd' }));
    assert.deepEqual(harness.spoken, ['A'], '同一时刻只有一句在播');
    assert.equal(pendingFishSpeech(), 1);
    harness.finish();
    assert.deepEqual(harness.spoken, ['A', 'B']);
  });

  test('同一条鱼的同一条播报：8s 内不重入', () => {
    enqueueFishLine(line('忙起来了：改 index.ts'));
    harness.finish();
    harness.tick(2_000);
    enqueueFishLine(line('忙起来了：改 index.ts'));
    assert.deepEqual(harness.spoken, ['忙起来了：改 index.ts']);
    harness.tick(7_000);
    enqueueFishLine(line('忙起来了：改 index.ts'));
    harness.finish();
    assert.deepEqual(harness.spoken, ['忙起来了：改 index.ts', '忙起来了：改 index.ts'], '过了窗口才允许再念');
  });

  test('不同会话同一句话：4s 内只出声一次（气泡仍各自显示）', () => {
    enqueueFishLine(line('这轮说完啦。', { sessionId: 'a', kind: 'turnEnd' }));
    harness.finish();
    harness.tick(100);
    enqueueFishLine(line('这轮说完啦。', { sessionId: 'b', kind: 'turnEnd' }));
    assert.deepEqual(harness.spoken, ['这轮说完啦。']);
    harness.tick(4_100);
    enqueueFishLine(line('这轮说完啦。', { sessionId: 'c', kind: 'turnEnd' }));
    harness.finish();
    assert.equal(harness.spoken.length, 2, '过了 4s 才允许再念同一句');
  });

  test('优先级：要事插到进度句前面', () => {
    enqueueFishLine(line('进度一'));
    enqueueFishLine(line('进度二'));
    enqueueFishLine(line('等你确认', { kind: 'turnEnd' }));
    assert.deepEqual(harness.spoken, ['进度一']);
    harness.finish();
    assert.deepEqual(harness.spoken, ['进度一', '等你确认'], '要事先念，进度句往后排');
  });

  test('积压上限：超出先丢最旧的进度句', () => {
    enqueueFishLine(line('进度一'));
    enqueueFishLine(line('进度二'));
    enqueueFishLine(line('进度三'));
    enqueueFishLine(line('进度四'));
    enqueueFishLine(line('进度五'));
    assert.equal(pendingFishSpeech(), 3, '正在念的一条不占队位');
    harness.finish();
    harness.finish();
    harness.finish();
    assert.deepEqual(harness.spoken, ['进度一', '进度三', '进度四', '进度五'], '最旧的进度二被丢掉');
  });

  test('过期句丢弃：排队超过 20s 的不再念', () => {
    enqueueFishLine(line('进度一'));
    enqueueFishLine(line('老掉的一句'));
    harness.tick(25_000);
    harness.finish();
    assert.deepEqual(harness.spoken, ['进度一'], '过期那句被跳过');
    assert.equal(pendingFishSpeech(), 0);
  });

  test('别的组件在说话：序号对不上时不推进队列', () => {
    enqueueFishLine(line('A'));
    enqueueFishLine(line('B', { kind: 'turnEnd' }));
    harness.foreignEnd();
    assert.deepEqual(harness.spoken, ['A'], '没被别人的 end 推着走');
    harness.endOnly();
    assert.deepEqual(harness.spoken, ['A', 'B'], '按文本认出自己那一句也能收尾');
  });

  test('空文本直接忽略；stop 清空队列', () => {
    enqueueFishLine(line('   '));
    assert.equal(pendingFishSpeech(), 0);
    enqueueFishLine(line('A'));
    enqueueFishLine(line('B', { kind: 'turnEnd' }));
    stopFishSpeech();
    assert.equal(pendingFishSpeech(), 0);
    harness.finish();
    assert.deepEqual(harness.spoken, ['A']);
  });

  test('端口给得出序号：别处念同一句不会被当成本句收尾', () => {
    const spoken: string[] = [];
    let listener: ((event: VoiceUtteranceEvent) => void) | null = null;
    let seq = 100; // 基线：此前已经有 100 条播报
    // 包一层而不是直接 `listener?.(...)`：TS 的控制流分析看不到「在 subscribe 回调里被赋值」，
    // 直接调用会被判成 never。
    const emit = (event: VoiceUtteranceEvent): void => listener?.(event);
    configureFishSpeech({
      speak: (text: string) => {
        spoken.push(text);
      },
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = null;
        };
      },
      now: () => 1_000,
      currentSeq: () => seq,
    });
    enqueueFishLine(line('A'));
    enqueueFishLine(line('B', { kind: 'turnEnd' }));
    // 别的组件念到同一句「A」：序号落在基线之内 → 既不是我的 start，也不算我的收尾
    emit({ kind: 'start', seq: 99, text: 'A' });
    emit({ kind: 'end', seq: 99, text: 'A' });
    assert.deepEqual(spoken, ['A'], '别人念的同句不该推进我的队列');
    // 自己这一句：基线之后的那一条
    seq = 100;
    emit({ kind: 'start', seq: 101, text: 'A' });
    emit({ kind: 'end', seq: 101, text: 'A' });
    assert.deepEqual(spoken, ['A', 'B'], '认准自己的序号才收尾');
  });

  test('卸载时把正在响的那句掐掉；没在念时不动别人的自动播报', () => {
    let stops = 0;
    configureFishSpeech({
      speak: () => {},
      subscribe: () => () => {},
      now: () => 1_000,
      stop: () => {
        stops += 1;
      },
    });
    enqueueFishLine(line('A'));
    stopFishSpeech();
    assert.equal(stops, 1, '队列在念 → 卸载时要停掉声音');
    stopFishSpeech();
    assert.equal(stops, 1, '没在念 → 不碰别的组件正在响的播报');
  });
});
