/**
 * 识屏生成（src/host/vision.ts）。
 *
 * 与 whisper 同族，所以这里钉的是「同一套规则别再各写一遍」：
 * 候选链顺序、调用身份、image 块与文本块的顺序、隐私约束进提示词、
 * 失败时必须带出「模型可能不支持读图」这句话。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { describeScreen } from './vision.ts';
import type { PetImageRef } from './image-attachment.ts';
import type { ModelRef } from './model-selection.ts';

const CURRENT: ModelRef = { provider: 'current', model: 'main-model' };
const PREFERRED: ModelRef = { provider: 'vision', model: 'see-model' };

/** 一帧已落盘的图（形状与附件服务返回的一致）。 */
const IMAGE: PetImageRef = { attachmentId: 'att-1', mediaType: 'image/jpeg', bytes: 2048, width: 1280, height: 720 };

/** 假 ctx：`stream` 按 provider 决定行为，并记下完整参数。 */
function fakeCtx(
  behavior: Record<string, 'ok' | 'throw' | 'empty'>,
  current: ModelRef | 'missing' = CURRENT,
): { ctx: Record<string, unknown>; calls: ModelRef[]; options: Record<string, unknown>[] } {
  const calls: ModelRef[] = [];
  const options: Record<string, unknown>[] = [];
  return {
    calls,
    options,
    ctx: {
      agentDefaultModel:
        current === 'missing'
          ? undefined
          : {
              currentSelection: () => current,
            },
      llm: {
        // 声明「无 reasoning 元数据」→ 不附加 reasoningEffort
        resolveModelInfo: async () => ({}),
        stream: (o: ModelRef) => {
          calls.push({ provider: o.provider, model: o.model });
          options.push(o as unknown as Record<string, unknown>);
          const b = behavior[o.provider] ?? 'throw';
          return (async function* () {
            if (b === 'throw') throw new Error(o.provider + ' 不支持图片输入');
            if (b === 'empty') return;
            yield { type: 'text-delta', index: 0, text: '在看你的终端' };
          })();
        },
      },
    },
  };
}

describe('describeScreen', () => {
  test('成功：文本块在前、image 块在后，system 用人设', async () => {
    const { ctx, options } = fakeCtx({ current: 'ok' });
    const r = await describeScreen(ctx, { system: '你是鱼生', image: IMAGE });
    assert.deepEqual(r, { ok: true, text: '在看你的终端' });
    const sent = options[0] as { system: string; messages: { content: unknown[] }[] };
    assert.equal(sent.system, '你是鱼生');
    const content = sent.messages[0]?.content ?? [];
    assert.equal((content[0] as { type: string }).type, 'text');
    assert.equal((content[1] as { type: string }).type, 'image');
    assert.deepEqual((content[1] as { attachment: PetImageRef }).attachment, IMAGE);
  });

  test('提示词带隐私约束（不许念账号/密钥/聊天内容）', async () => {
    const { ctx, options } = fakeCtx({ current: 'ok' });
    await describeScreen(ctx, { system: '人设', image: IMAGE });
    const content = (options[0] as { messages: { content: { text?: string }[] }[] }).messages[0]?.content ?? [];
    const text = content[0]?.text ?? '';
    assert.match(text, /不要念出/);
    assert.match(text, /30 字以内/);
  });

  test('配的模型失败 → 回落到当前对话的模型重试一次', async () => {
    const { ctx, calls } = fakeCtx({ vision: 'throw', current: 'ok' });
    const r = await describeScreen(ctx, { system: '人设', image: IMAGE, preferred: PREFERRED });
    assert.equal(r.ok, true);
    assert.deepEqual(calls, [PREFERRED, CURRENT]);
  });

  test('空流 → generate-error，且文案点出「可能不支持读图」', async () => {
    const { ctx } = fakeCtx({ current: 'empty' });
    const r = await describeScreen(ctx, { system: '人设', image: IMAGE });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, 'generate-error');
      assert.match(r.message ?? '', /不支持读图/);
    }
  });

  test('抛错同样带上「可能不支持读图」的排错线索', async () => {
    const { ctx } = fakeCtx({ current: 'throw' });
    const r = await describeScreen(ctx, { system: '人设', image: IMAGE });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message ?? '', /不支持读图/);
  });

  test('没有可用模型 → provider-missing', async () => {
    const { ctx } = fakeCtx({}, 'missing');
    const r = await describeScreen(ctx, { system: '人设', image: IMAGE });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'provider-missing');
  });
});
