/**
 * 会话鱼播报文案：模板选择、任务插值与截断、无任务时的泛化回落。
 * @module dsh-fish-body/src/host/session-fish/lines.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { composeSessionFishLine, composeStillBusyLine, shortSessionFishTask, SESSION_FISH_TASK_MAX } from './lines.ts';

describe('shortSessionFishTask', () => {
  test('短任务原样返回', () => {
    assert.equal(shortSessionFishTask('改 index.ts'), '改 index.ts');
  });

  test('长任务按码点截断并加省略号', () => {
    const text = '很'.repeat(SESSION_FISH_TASK_MAX + 5);
    const short = shortSessionFishTask(text);
    assert.equal(Array.from(short).length, SESSION_FISH_TASK_MAX + 1);
    assert.ok(short.endsWith('…'));
  });

  test('空/纯空白 → 空串', () => {
    assert.equal(shortSessionFishTask(null), '');
    assert.equal(shortSessionFishTask('   '), '');
  });
});

describe('composeSessionFishLine', () => {
  test('idle：固定待命句', () => {
    assert.equal(
      composeSessionFishLine('idle', 'idle', null, () => 0),
      '新会话，我先待命～',
    );
  });

  test('progress：任务填进模板；没有任务时退化成泛化句', () => {
    assert.equal(
      composeSessionFishLine('progress', 'working', '改 index.ts', () => 0),
      '改 index.ts',
    );
    assert.equal(
      composeSessionFishLine('progress', 'working', null, () => 0),
      '正在干活～',
    );
    assert.equal(
      composeSessionFishLine('progress', 'thinking', null, () => 0),
      '我在想啦…',
    );
  });

  test('turnEnd：按终局挑句，goal 中间轮不庆祝', () => {
    assert.equal(
      composeSessionFishLine('turnEnd', 'success', null, () => 0),
      '这轮说完啦。',
    );
    assert.equal(
      composeSessionFishLine('turnEnd', 'error', null, () => 0),
      '这轮出错了…',
    );
    assert.match(
      composeSessionFishLine('turnEnd', 'result', null, () => 0),
      /任务还在继续/,
    );
  });

  test('done：任务完成后的一句', () => {
    assert.match(
      composeSessionFishLine('done', 'success', null, () => 0),
      /搞定啦/,
    );
  });

  test('随机源注入：不同 pick 拿到不同候选，且不会越界', () => {
    const first = composeSessionFishLine('progress', 'thinking', null, () => 0);
    const second = composeSessionFishLine('progress', 'thinking', null, () => 0.99);
    assert.notEqual(first, second);
    assert.equal(
      composeSessionFishLine('progress', 'thinking', null, () => 1),
      second,
    );
  });
});

describe('composeStillBusyLine', () => {
  test('活动门判定还有活时的提示', () => {
    assert.match(
      composeStillBusyLine(() => 0),
      /还有活/,
    );
  });
});
