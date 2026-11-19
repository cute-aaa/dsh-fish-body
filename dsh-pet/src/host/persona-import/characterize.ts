/**
 * 文档结构化：把抽取出来的文本交给一次 LLM 调用，收敛成 8 个卡片字段 + 投影正文。
 *
 * 只做「拼提示词 + 校验 + 投影」，**不写盘**：本模块不得 import 任何配置读写，
 * 预览与落库的分离靠这条约束兜住（`POST /persona/import` 零副作用）。
 * 直接命中 `chara_card_v2` 的文件跳过 LLM（零调用），这是最便宜也最可靠的一条路径。
 * @module dsh-fish-body/src/host/persona-import/characterize
 */
import { z } from 'zod';
import { projectCard, type CharaCardData } from '../persona-source/card-reader.ts';
import { runJsonTask, type LlmTaskCtx, type LlmTaskFailure, type LlmUsage } from '../llm-task.ts';
import type { ExtractedFile, ImportFileKind } from './extract.ts';

/** 8 个字段：与 `CharaCardData` 逐一对应；缺失给空串、上限 2 万字。 */
export const charaCardSchema = z.object({
  // 八个字段都可缺：模型偶尔只回三五个，缺的按空串补（与上面的契约一致），
  // 不因为少一个 `mes_example` 就让整次导入失败。
  name: z.string().max(20000).default(''),
  description: z.string().max(20000).default(''),
  personality: z.string().max(20000).default(''),
  scenario: z.string().max(20000).default(''),
  first_mes: z.string().max(20000).default(''),
  mes_example: z.string().max(20000).default(''),
  system_prompt: z.string().max(20000).default(''),
  post_history_instructions: z.string().max(20000).default(''),
});

/** 预览：8 字段 + 投影正文（正文由 `projectCard` 现算，不单独存）。 */
export interface ImportPreview extends CharaCardData {
  readonly text: string;
  readonly chars: number;
}

/** 结构化结果。 */
export type CharacterizeOutcome =
  | {
      ok: true;
      preview: ImportPreview;
      files: { name: string; kind: ImportFileKind; chars: number }[];
      /** 直接命中 v2 卡时为 false（零 LLM 调用）。 */
      usedLlm: boolean;
      /** LLM 是否走过重试（直接命中恒为 false）。 */
      retried: boolean;
      usage?: LlmUsage;
    }
  | { ok: false; reason: LlmTaskFailure | 'extract-failed'; message: string };

/** 拼 system 提示词：8 字段 + 三条硬约束。 */
function systemPrompt(petName: string | undefined): string {
  const where = petName !== undefined && petName.trim() !== '' ? `，这些内容会用于桌面宠物「${petName.trim()}」` : '';
  return [
    '你要把用户提供的文档整理成一份角色人设卡' + where + '。',
    '只输出一个 JSON 对象，字段恰好是：name / description / personality / scenario / first_mes / mes_example / system_prompt / post_history_instructions。',
    '硬约束：',
    '1. 不得编造原文没有的设定（没有的字段给空串，不要用套话填充）；',
    '2. 原文是中文就用中文，保持原文的人称与语气；',
    '3. 不要输出解释、标题或 Markdown 代码围栏，只输出 JSON。',
  ].join('\n');
}

/** 由 8 字段组装预览（正文现算）。 */
function previewOf(fields: CharaCardData): ImportPreview {
  const text = projectCard(fields);
  return { ...fields, text, chars: text.length };
}

/** 一个抽取结果变成「文件名 + 正文」的一段（给提示词用）。 */
function sectionOf(file: ExtractedFile): string {
  return `《${file.name}》\n${file.text}`;
}

/**
 * 把抽取结果结构化成人设预览。
 *
 * @param ctx - 宿主上下文（LLM）。
 * @param files - `extractDocuments` 的产出（非空）。
 * @param options - 可选宠物名（只进提示词）与超时。
 * @returns 预览；失败给 `extract-failed` 或 LLM 任务的失败分类。
 */
export async function characterizeDocuments(
  ctx: LlmTaskCtx,
  files: readonly ExtractedFile[],
  options?: { readonly petName?: string; readonly timeoutMs?: number },
): Promise<CharacterizeOutcome> {
  const echoed = files.map((file) => ({ name: file.name, kind: file.kind, chars: file.chars }));

  // 直接命中 v2 卡：字段已经在了，一次模型都不用调。
  const direct = files.find((file) => file.card !== undefined)?.card;
  if (direct !== undefined) {
    return { ok: true, preview: previewOf(direct), files: echoed, usedLlm: false, retried: false };
  }

  const body = files.map(sectionOf).join('\n\n').trim();
  if (body === '') return { ok: false, reason: 'extract-failed', message: '这些文件里没有可读的文本' };

  const result = await runJsonTask(
    ctx,
    {
      system: systemPrompt(options?.petName),
      user: body,
      ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    },
    charaCardSchema,
  );
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
  return {
    ok: true,
    preview: previewOf(result.value),
    files: echoed,
    usedLlm: true,
    retried: result.retried,
    usage: result.usage,
  };
}
