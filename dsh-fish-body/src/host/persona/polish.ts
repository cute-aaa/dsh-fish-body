/**
 * 人设润色：把一段人设正文交给模型做「只改措辞、不改设定」的重写，**只返回预览，不写盘**。
 *
 * 写盘永远发生在用户点「应用」之后（前端把结果写进草稿，随底部栏保存落盘）。
 * 必须始终成立：不改名字、不新增设定、保持原文语言与第一人称、长度不超过原文 1.3 倍；
 * 本模块**不得** import `saveUserConfig` 或任何配置文件读写——润色是纯预览。
 * @module dsh-fish-body/src/host/persona/polish
 */
import { runTextTask, type LlmTaskCtx, type LlmTaskFailure, type LlmUsage } from '../llm-task.ts';

/** 润色请求：角色名（只用于 system 提示，不会被改）与待润色正文。 */
export interface PolishInput {
  readonly name: string;
  readonly text: string;
  /** 覆盖缺省超时（30s）；只为测试与将来的可配置留口，路由侧不传。 */
  readonly timeoutMs?: number;
}

/** 润色结果：成功给预览正文；失败给 `generate-error` 级原因（由路由映射）。 */
export type PolishResult =
  { ok: true; text: string; usage?: LlmUsage } | { ok: false; reason: LlmTaskFailure; message: string };

/** system 提示词：四条硬约束逐条写死，避免模型「顺手加设定」。 */
function systemPrompt(name: string): string {
  const who = name.trim() === '' ? '这个角色' : `「${name.trim()}」`;
  return [
    `你在润色一段桌面宠物的人设正文，角色是${who}。`,
    '硬约束：',
    '1. 不得改变角色名，也不得在正文里引入任何新名字；',
    '2. 不得新增原文没有的设定（身份、经历、关系、喜好、能力都不许编）；',
    '3. 保持原文语言（原文是中文就用中文）与第一人称/原有人称不变；',
    '4. 只做措辞、语序与衔接上的优化，长度不超过原文的 1.3 倍；',
    '5. 只输出润色后的正文本身：不要解释、不要标题、不要 Markdown 代码块。',
  ].join('\n');
}

/**
 * 润色一段人设正文。
 *
 * @param ctx - 宿主上下文（缺 `llm` → `no-llm`）。
 * @param input - 角色名与正文。
 * @returns 预览正文；失败给结构化原因。**零写盘**。
 */
export async function polishText(ctx: LlmTaskCtx, input: PolishInput): Promise<PolishResult> {
  const result = await runTextTask(ctx, {
    system: systemPrompt(input.name),
    user: input.text,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  });
  if (!result.ok) return result;
  return result.usage === undefined
    ? { ok: true, text: result.text }
    : { ok: true, text: result.text, usage: result.usage };
}
