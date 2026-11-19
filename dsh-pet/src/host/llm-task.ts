/**
 * 共用 LLM 文本任务底座：一次调用（`runTextTask`）与「要 JSON 的一次调用 + 恰好重试一次」（`runJsonTask`）。
 *
 * 仿 `host/whisper.ts` 的调用范式：`modelCandidates` 回落链 + `supportsReasoningOff` 守卫 +
 * `PET_CALL_IDENTITY` 调用身份 + `ctx.llm.stream`。不新引入服务商 SDK、不读凭证、不写盘。
 * 必须始终成立：`ctx.llm` 缺失 → `no-llm`；超时 → `timeout`；流结束无正文 → `empty`（带可读原因）；
 * JSON 任务最多重试一次，两次都坏就失败，**绝不把半成品交给调用方**。
 * @module dsh-fish-body/src/host/llm-task
 */
import { BlockAssembler, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { ZodType } from 'zod';
import { PET_CALL_IDENTITY, noTextReason } from './llm-call.ts';
import { supportsReasoningOff } from './llm-reasoning.ts';
import { modelCandidates, type ModelRef } from './model-selection.ts';

/** 缺省超时：与碎碎念同一量级（30s 足够一次短输出）。 */
const DEFAULT_TIMEOUT_MS = 30_000;

/** 一次文本任务的全部输入。 */
export interface LlmTaskOptions {
  readonly system: string;
  readonly user: string;
  /** 缺省 30000；超时用 AbortController 打断 stream。 */
  readonly timeoutMs?: number;
  /** 缺省 = 跟随当前对话（agentDefaultModel）。 */
  readonly preferred?: ModelRef;
}

/** 尽力取到的用量（取不到就不带这个键，不臆造）。 */
export interface LlmUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/** 失败分类（路由层统一映射成 `generate-error`，JSON 的两种另有文案）。 */
export type LlmTaskFailure = 'no-llm' | 'timeout' | 'empty' | 'invalid-json' | 'schema';

/** 一次文本任务的结果。 */
export type LlmTaskResult =
  { ok: true; text: string; usage?: LlmUsage } | { ok: false; reason: LlmTaskFailure; message: string };

/** JSON 任务的结果：`retried` 表示是否走过第二次调用。 */
export type LlmJsonResult<T> =
  { ok: true; value: T; usage?: LlmUsage; retried: boolean } | { ok: false; reason: LlmTaskFailure; message: string };

/** 调用方要提供的最小上下文（与产出侧同一形状）。 */
export interface LlmTaskCtx {
  readonly agentDefaultModel?: { currentSelection(): ModelRef };
  readonly llm?: unknown;
}

/** `ctx.llm` 的最小形状（防御式：不依赖完整类型）。 */
interface LlmStreamCapable {
  stream(options: unknown): AsyncIterable<unknown>;
}

/** 从装配好的块里取正文（只取 text 块）。 */
function textOf(assembler: BlockAssembler): string {
  return assembler
    .blocks()
    .filter((block) => block.type === 'text')
    .map((block) => ('text' in block ? (block as { text: string }).text : ''))
    .join('')
    .trim();
}

/**
 * 选一个模型跑一次流式生成。
 *
 * @param ctx - 宿主上下文。
 * @param llm - `ctx.llm`（已确认有 `stream`）。
 * @param sel - 本次尝试的 provider/model。
 * @param options - system / user / timeoutMs。
 * @returns 文本结果；`timeout` 与 `empty` 各自给可读 message。
 */
async function streamOnce(
  ctx: LlmTaskCtx,
  llm: LlmStreamCapable,
  sel: ModelRef,
  options: LlmTaskOptions,
): Promise<LlmTaskResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const seconds = Math.round(timeoutMs / 1000);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 用「赛跑」而不是只靠 abort：适配器/桩流不一定会响应 signal，只 abort 会让这里一直挂着。
  const deadline = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('deadline');
    }, timeoutMs);
  });
  const supportsOff = await supportsReasoningOff(ctx, sel.provider, sel.model);
  const consume = async (): Promise<LlmTaskResult> => {
    const assembler = new BlockAssembler();
    try {
      for await (const chunk of llm.stream({
        provider: sel.provider,
        model: sel.model,
        sessionId: PET_CALL_IDENTITY,
        messages: [createUserMessage({ content: [{ type: 'text', text: options.user }], source: { kind: 'user' } })],
        system: options.system,
        temperature: 1,
        ...(supportsOff ? { reasoningEffort: ReasoningEffortId('off') } : {}),
        signal: controller.signal,
      })) {
        assembler.push(chunk as Parameters<BlockAssembler['push']>[0]);
      }
    } catch (e) {
      return { ok: false, reason: 'empty', message: e instanceof Error ? e.message : String(e) };
    }
    const text = textOf(assembler);
    if (text === '') return { ok: false, reason: 'empty', message: noTextReason(assembler.finish) };
    const usage = assembler.usage;
    return usage === undefined
      ? { ok: true, text }
      : { ok: true, text, usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } };
  };
  const running = consume();
  const winner = await Promise.race([running, deadline]);
  if (winner === 'deadline') {
    void running.catch(() => undefined);
    return { ok: false, reason: 'timeout', message: `模型 ${seconds} 秒内没有返回` };
  }
  if (timer !== undefined) clearTimeout(timer);
  return winner;
}

/**
 * 跑一次文本生成（候选链依次尝试，第一个成功即返回）。
 *
 * @param ctx - 宿主上下文（缺 `llm` → `no-llm`）。
 * @param options - system / user / 超时 / 可选模型。
 * @returns 文本与用量，或结构化失败。
 */
export async function runTextTask(ctx: LlmTaskCtx, options: LlmTaskOptions): Promise<LlmTaskResult> {
  const llm = (ctx as { llm?: Partial<LlmStreamCapable> }).llm;
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, reason: 'no-llm', message: 'LLM 服务不可用' };
  }
  const candidates = modelCandidates(ctx, options.preferred);
  if (candidates.length === 0) {
    return { ok: false, reason: 'no-llm', message: '当前对话未配置模型' };
  }
  let last: LlmTaskResult = { ok: false, reason: 'empty', message: noTextReason(undefined) };
  for (const sel of candidates) {
    const result = await streamOnce(ctx, llm as LlmStreamCapable, sel, options);
    if (result.ok) return result;
    last = result;
  }
  return last;
}

/**
 * 剥代码围栏与首尾噪声，取第一个 `{` 到最后一个 `}`。
 *
 * @param text - 模型输出。
 * @returns 待解析的 JSON 文本；没有花括号时原样返回（`JSON.parse` 会失败）。
 */
export function extractJsonText(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return text.trim();
  return text.slice(start, end + 1);
}

/** 从 zod 对象 schema 里取字段名（用于重试提示；取不到就给空数组）。 */
function fieldNamesOf(schema: ZodType<unknown>): string[] {
  const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
  return shape === undefined ? [] : Object.keys(shape);
}

/**
 * 跑一次「只接受 JSON」的任务；解析或校验失败时把问题拼进第二次 prompt，**恰好重试 1 次**。
 *
 * @param ctx - 宿主上下文。
 * @param options - system / user / 超时 / 可选模型。
 * @param schema - zod 校验器（结构化字段）。
 * @returns 校验后的值；`retried` 表示走过第二次调用。
 */
export async function runJsonTask<T>(
  ctx: LlmTaskCtx,
  options: LlmTaskOptions,
  schema: ZodType<T>,
): Promise<LlmJsonResult<T>> {
  const fields = fieldNamesOf(schema as ZodType<unknown>);
  let problem = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const user =
      attempt === 0
        ? options.user
        : `${options.user}\n\n上一次输出不合法：${problem}。请只输出一个 JSON 对象，不要解释、不要代码围栏；` +
          `字段恰好是：${fields.length > 0 ? fields.join(' / ') : '题目要求的字段'}。缺失字段给空串。`;
    const result = await runTextTask(ctx, { ...options, user });
    if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonText(result.text)) as unknown;
    } catch (e) {
      problem = `不是合法 JSON（${e instanceof Error ? e.message : String(e)}）`;
      continue;
    }
    const checked = schema.safeParse(parsed);
    if (!checked.success) {
      problem = `字段不合法（${checked.error.issues.map((issue) => issue.path.join('.') || issue.message).join('、')}）`;
      continue;
    }
    return attempt === 0
      ? { ok: true, value: checked.data, usage: result.usage, retried: false }
      : { ok: true, value: checked.data, usage: result.usage, retried: true };
  }
  return {
    ok: false,
    reason: problem.startsWith('不是') ? 'invalid-json' : 'schema',
    message: `模型两次都没有返回可用的 JSON：${problem}`,
  };
}
