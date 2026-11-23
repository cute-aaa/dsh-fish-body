/**
 * 文档结构化的单元测试：坏 JSON 重试一次、两次都坏、缺字段、v2 卡零 LLM 调用、零写盘。
 * @module dsh-fish-body/src/host/persona-import/characterize.test
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { characterizeDocuments } from './characterize.ts';
import type { ExtractedFile } from './extract.ts';

/** 当前对话的模型。 */
const model = { currentSelection: () => ({ provider: 'p', model: 'm' }) };

/** 按调用序号取输出的桩 LLM（计数用于证明「恰好重试一次」与「零调用」）。 */
function stubLlm(
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

/** 一份合规的 8 字段 JSON。 */
function validJson(name: string): string {
  return JSON.stringify({
    name,
    description: '蓝色大肥鱼',
    personality: '慵懒',
    scenario: '',
    first_mes: '',
    mes_example: '',
    system_prompt: '',
    post_history_instructions: '',
  });
}

/** 一份纯文本抽取结果。 */
function textFile(): ExtractedFile {
  return { name: '鱼生.md', kind: 'md', text: '# 鱼生\n一只蓝色大肥鱼。', chars: 15 };
}

test('坏 JSON 一次 + 合规一次 → 成功且走了重试（调用恰好 2 次）', async () => {
  const counter = { n: 0 };
  const result = await characterizeDocuments(stubLlm(['不是 json', validJson('鱼生')], counter), [textFile()]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.preview.name, '鱼生');
  assert.equal(result.usedLlm, true);
  assert.equal(result.retried, true);
  assert.ok(result.preview.chars > 0);
  assert.equal(counter.n, 2);
});

test('两次都坏 → invalid-json', async () => {
  const counter = { n: 0 };
  const result = await characterizeDocuments(stubLlm(['坏', '还是坏'], counter), [textFile()]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'invalid-json');
  assert.equal(counter.n, 2);
});

test('合规但缺字段 → 缺的按空串补（不再整次失败）', async () => {
  const counter = { n: 0 };
  const result = await characterizeDocuments(stubLlm(['{"name":"只有名字"}'], counter), [textFile()]);
  assert.equal(result.ok, true, '缺字段不该让导入失败');
  if (!result.ok) return;
  assert.equal(result.preview.name, '只有名字');
  assert.equal(result.preview.personality, '');
  assert.equal(result.preview.mes_example, '');
  assert.equal(counter.n, 1, '一次就成，不该因为缺字段重试');
});

test('字段类型不对 → schema（重试一次后仍失败）', async () => {
  const counter = { n: 0 };
  const result = await characterizeDocuments(stubLlm(['{"name":42}', '{"name":43}'], counter), [textFile()]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'schema');
  assert.equal(counter.n, 2);
});

test('v2 卡直接路径：零 LLM 调用', async () => {
  const counter = { n: 0 };
  const card: ExtractedFile = {
    name: 'card.json',
    kind: 'json',
    text: '{}',
    chars: 2,
    card: {
      name: '鱼生',
      description: '蓝色大肥鱼',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      system_prompt: '',
      post_history_instructions: '',
    },
  };
  const result = await characterizeDocuments(stubLlm([validJson('不该被调用')], counter), [card]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.usedLlm, false);
  assert.equal(result.preview.name, '鱼生');
  assert.equal(counter.n, 0, '命中 v2 卡时一次模型都不该调');
});

test('调用前后目标目录内容一致（结构化零写盘）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'import-characterize-'));
  try {
    await writeFile(join(dir, 'main-config.jsonc'), '{"pets":[]}', 'utf8');
    const before = (await readdir(dir)).sort();
    const counter = { n: 0 };
    await characterizeDocuments(stubLlm([validJson('鱼生')], counter), [textFile()]);
    assert.deepEqual((await readdir(dir)).sort(), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
