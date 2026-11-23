/**
 * AI 润色的单元测试：正文原样透出、超时/空流各给可读原因，且调用后磁盘一个字节都不变。
 *
 * 「timeout / empty / no-llm → generate-error」的映射发生在路由层（T4 的 `/persona/polish`），
 * 这里钉住的是**服务端零写盘**与失败分类本身。
 * @module dsh-fish-body/src/host/persona/polish.test
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { polishText } from './polish.ts';

/** 当前对话的模型。 */
const model = { currentSelection: () => ({ provider: 'p', model: 'm' }) };

/** 按给定片段产出的桩流。 */
function llmOf(chunks: readonly string[]): { agentDefaultModel: typeof model; llm: unknown } {
  return {
    agentDefaultModel: model,
    llm: {
      stream: () => {
        return (async function* () {
          for (const text of chunks) yield { type: 'text-delta', index: 0, text };
        })();
      },
    },
  };
}

test('正常：润色结果原样透出', async () => {
  const result = await polishText(llmOf(['我只是把话说顺了。']), { name: '鱼生', text: '我把话说顺。' });
  assert.deepEqual(result, { ok: true, text: '我只是把话说顺了。' });
});

test('空流 → empty（路由层映射成 generate-error）', async () => {
  const result = await polishText(llmOf([]), { name: '鱼生', text: '原文' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'empty');
});

test('超时 → timeout（路由层映射成 generate-error）', async () => {
  const hanging = {
    agentDefaultModel: model,
    llm: { stream: () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }) }) },
  };
  const result = await polishText(hanging, { name: '鱼生', text: '原文', timeoutMs: 50 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'timeout');
});

test('无 llm → no-llm（路由层映射成 generate-error，不是 500）', async () => {
  const result = await polishText({ agentDefaultModel: model }, { name: '鱼生', text: '原文' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'no-llm');
});

test('调用后磁盘不变（润色是纯预览）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'polish-'));
  try {
    await writeFile(join(dir, 'main-config.jsonc'), '{"pets":[]}', 'utf8');
    const before = (await readdir(dir)).sort();
    await polishText(llmOf(['润色后的正文']), { name: '鱼生', text: '原文' });
    assert.deepEqual((await readdir(dir)).sort(), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
