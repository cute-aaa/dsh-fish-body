/**
 * LLM 任务底座的单元测试：无 llm / 超时 / 空流 / 围栏 JSON / 坏 JSON 重试一次 / 两次都坏。
 *
 * 全部用桩流，不联网；`retried` 与调用次数是「恰好重试一次」的唯一判据。
 * @module dsh-fish-body/src/host/llm-task.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { extractJsonText, runJsonTask, runTextTask } from './llm-task.ts';

/** 当前对话的模型（候选链只有它）。 */
const model = { currentSelection: () => ({ provider: 'p', model: 'm' }) };

/** 一个按给定片段产出的桩流（每次 stream 调用计一次数）。 */
function llmOf(chunks: readonly string[], counter?: { n: number }): { agentDefaultModel: typeof model; llm: unknown } {
  return {
    agentDefaultModel: model,
    llm: {
      stream: () => {
        if (counter) counter.n += 1;
        return (async function* () {
          for (const text of chunks) yield { type: 'text-delta', index: 0, text };
        })();
      },
    },
  };
}

/** 一个永不结束的桩流（只用来验超时，不看内容）。 */
function hangingLlm(): { agentDefaultModel: typeof model; llm: unknown } {
  return {
    agentDefaultModel: model,
    llm: {
      stream: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
      }),
    },
  };
}

/** 只输出一段文本的桩（按调用次序取不同输出）。 */
function sequenceLlm(
  outputs: readonly string[],
  counter: { n: number },
): { agentDefaultModel: typeof model; llm: unknown } {
  return {
    agentDefaultModel: model,
    llm: {
      stream: () => {
        const text = outputs[Math.min(counter.n, outputs.length - 1)];
        counter.n += 1;
        return (async function* () {
          yield { type: 'text-delta', index: 0, text };
        })();
      },
    },
  };
}

test('ctx.llm 缺失 → no-llm（不抛）', async () => {
  const result = await runTextTask({ agentDefaultModel: model }, { system: 's', user: 'u' });
  assert.deepEqual(result, { ok: false, reason: 'no-llm', message: 'LLM 服务不可用' });
});

test('超时 → timeout（桩流永不结束，timeoutMs:50）', async () => {
  const result = await runTextTask(hangingLlm(), { system: 's', user: 'u', timeoutMs: 50 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'timeout');
    assert.match(result.message, /没有返回/);
  }
});

test('空流 → empty，message 非空', async () => {
  const result = await runTextTask(llmOf([]), { system: 's', user: 'u' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'empty');
    assert.ok(result.message.length > 0);
  }
});

test('正常文本 → 原样透出，usage 取得到就带', async () => {
  const result = await runTextTask(llmOf(['你', '好']), { system: 's', user: 'u' });
  assert.deepEqual(result, { ok: true, text: '你好' });
});

test('runJsonTask：带 ```json 围栏的输出被正确解析', async () => {
  const schema = z.object({ name: z.string() });
  const result = await runJsonTask(llmOf(['```json\n{"name":"鱼生"}\n```']), { system: 's', user: 'u' }, schema);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, { name: '鱼生' });
    assert.equal(result.retried, false);
  }
});

test('runJsonTask：坏 JSON 一次 + 合规一次 → 成功且 retried:true，调用次数恰好 2', async () => {
  const counter = { n: 0 };
  const schema = z.object({ name: z.string() });
  const result = await runJsonTask(
    sequenceLlm(['不是 json', '{"name":"鱼生"}'], counter),
    { system: 's', user: 'u' },
    schema,
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.retried, true);
  assert.equal(counter.n, 2, '只允许重试一次（不是两次）');
});

test('runJsonTask：两次都坏 → invalid-json', async () => {
  const counter = { n: 0 };
  const schema = z.object({ name: z.string() });
  const result = await runJsonTask(sequenceLlm(['坏', '还是坏'], counter), { system: 's', user: 'u' }, schema);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'invalid-json');
  assert.equal(counter.n, 2);
});

test('runJsonTask：合法 JSON 但缺字段 → schema', async () => {
  const counter = { n: 0 };
  const schema = z.object({ name: z.string(), description: z.string() });
  const result = await runJsonTask(
    sequenceLlm(['{"name":"只有名字"}', '{"name":"还是只有名字"}'], counter),
    {
      system: 's',
      user: 'u',
    },
    schema,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'schema');
});

test('extractJsonText：取第一个 { 到最后一个 }，没有花括号时原样返回', () => {
  assert.equal(extractJsonText('说明\n{"a":1}\n尾巴'), '{"a":1}');
  assert.equal(extractJsonText('没有 json'), '没有 json');
});
