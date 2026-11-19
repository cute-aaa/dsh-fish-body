/**
 * 识屏说一句（host 半侧）：把一帧屏幕交给当前模型，换回一句第一人称的短话。
 *
 * 与 `host/whisper.ts` 是同一族的「生成一次短句」：候选模型链、调用身份、整块参数的装配规则
 * 全部照抄那一份（差一处就会在与 whisper 相同的坑里再踩一遍）。差别只有两条：
 *   1. 请求里带一个 image 块；
 *   2. 指令要求「只描述你看到的 / 不念屏幕上的敏感内容」。
 *
 * 不负责截屏（归 runtime/electron-helper/main/capture.js）、不负责写气泡（归 broadcast-send）。
 * 必须始终成立：读图失败要显式回 `generate-error` 并带一句「模型可能不支持读图」，
 * 别让用户对着「没反应」猜。
 * @module dsh-fish-body/src/host/vision
 */
import { BlockAssembler, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { PET_CALL_IDENTITY, noTextReason } from './llm-call.ts';
import { supportsReasoningOff } from './llm-reasoning.ts';
import { defaultLog } from './log-file.ts';
import { modelCandidates, modelLabel, type ModelRef } from './model-selection.ts';
import type { PetImageRef } from './image-attachment.ts';

/** 生成结论（与 whisper 的联合体同构，便于共用调用方的失败分支）。 */
export type VisionResult =
  { ok: true; text: string } | { ok: false; reason: 'provider-missing' | 'generate-error'; message?: string };

/** 单次读图超时（ms）：图比文本贵，给 45s；超过就当这次没看成。 */
const TIMEOUT_MS = 45_000;

/** 识屏指令：一句、第一人称、只说看得见的。 */
const SCREEN_TEXT = '看一眼主人现在的屏幕，用一句话说你看到了什么、或者你此刻的感觉，一句就好，30 字以内，第一人称。';

/**
 * 隐私约束：模型能读到整块屏幕，所以显式禁止复述账号、密钥、聊天内容与文件路径。
 *
 * 光说「别提敏感信息」不够——不点名时模型会照着 OCR 结果念身份证号。
 */
const SCREEN_PRIVACY = '不要念出屏幕上的账号、密码、密钥、验证码、聊天内容和文件路径；看不清细节就说个大概。';

/** 一次读图请求。 */
export interface ScreenVisionRequest {
  /** 人设 system（`whisperPrompt`，由调用方取条目级那份）。 */
  readonly system: string;
  /** 已落盘的一帧（附件服务给出的引用）。 */
  readonly image: PetImageRef;
  /** 条目级模型偏好（whisperModel）；缺省 = 只用当前对话的模型。 */
  readonly preferred?: ModelRef;
}

/**
 * 用候选模型链跑一次读图。
 *
 * @param ctx - 宿主上下文（注入 agentDefaultModel / llm）。
 * @param request - 人设、这一帧、可选模型偏好。
 * @returns 生成的文本，或结构化失败原因。
 */
export async function describeScreen(
  ctx: { agentDefaultModel?: { currentSelection(): { provider: string; model: string } }; llm?: unknown },
  request: ScreenVisionRequest,
): Promise<VisionResult> {
  const candidates = modelCandidates(ctx, request.preferred);
  if (candidates.length === 0) return { ok: false, reason: 'provider-missing', message: '当前对话未配置模型' };
  const llm = (ctx as { llm?: { stream(o: unknown): AsyncIterable<unknown> } }).llm;
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, reason: 'generate-error', message: 'LLM 服务不可用' };
  }
  let last: VisionResult = { ok: false, reason: 'generate-error', message: noTextReason(undefined) };
  for (const [i, sel] of candidates.entries()) {
    const result = await generateOnce(ctx, llm, sel, request);
    if (result.ok) return result;
    last = result;
    // 回落要留痕：配了 A 却用了 B 的时候，日志是唯一的现场
    if (i + 1 < candidates.length) {
      defaultLog(
        'warn',
        `fish-body: 识屏用 ${modelLabel(sel)} 生成失败（${result.message ?? result.reason}），回落到 ${modelLabel(candidates[i + 1])}`,
      );
    }
  }
  return last;
}

/**
 * 用一个确定的 provider/model 跑一次读图。
 *
 * @param ctx - 宿主上下文（问模型能力用）。
 * @param llm - 宿主 llm 服务。
 * @param sel - 本次用的模型。
 * @param request - 请求内容。
 * @returns 结构化结论。
 */
async function generateOnce(
  ctx: { llm?: unknown },
  llm: { stream(o: unknown): AsyncIterable<unknown> },
  sel: ModelRef,
  request: ScreenVisionRequest,
): Promise<VisionResult> {
  // 只在模型确实声明支持时传 reasoningEffort（同 whisper：无元数据的模型传了会被折叠成空流）
  const supportsOff = await supportsReasoningOff(ctx, sel.provider, sel.model);
  // 文本块在前、图片块在后：提示词先到，模型更容易按提示去「看」而不是先描述像素
  const content = [
    { type: 'text', text: SCREEN_TEXT + SCREEN_PRIVACY },
    { type: 'image', attachment: request.image },
  ];
  const options = {
    provider: sel.provider,
    model: sel.model,
    sessionId: PET_CALL_IDENTITY,
    messages: [
      createUserMessage({
        content: content as unknown as Parameters<typeof createUserMessage>[0]['content'],
        source: { kind: 'user' },
      }),
    ],
    system: request.system,
    temperature: 1,
    ...(supportsOff ? { reasoningEffort: ReasoningEffortId('off') } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
  const assembler = new BlockAssembler();
  try {
    for await (const chunk of llm.stream(options)) {
      assembler.push(chunk as Parameters<BlockAssembler['push']>[0]);
    }
  } catch (e) {
    return {
      ok: false,
      reason: 'generate-error',
      // 读图失败最常见的成因就是「这个模型不看图」：把它写进文案，省一轮排查
      message: (e instanceof Error ? e.message : String(e)) + '（模型可能不支持读图）',
    };
  }
  const text = assembler
    .blocks()
    .filter((b) => b.type === 'text')
    .map((b) => ('text' in b ? b.text : ''))
    .join('')
    .trim();
  if (!text)
    return { ok: false, reason: 'generate-error', message: noTextReason(undefined) + '（模型可能不支持读图）' };
  return { ok: true, text };
}
