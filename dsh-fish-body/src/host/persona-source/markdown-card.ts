/**
 * Markdown 人格文档的投影：把一份或多份 `.md` 折成与 {@link CharaCardData} 同形的字段。
 *
 * 为什么要有这一层：soul 类项目的主流形态是 Markdown 而不是角色卡
 * （`SOUL.md` / `Soul.md` / `IDENTITY.md` / `AGENTS.md` 五件套那一族），
 * 而角色库、应用、提示词拼装全都只认 8 字段。所以这里做的是**归一到 8 字段**，不新增落库格式。
 *
 * 两件事按「不猜」的原则处理：
 * - 名字：只认显式声明（`名字：X` / `Name: X`）或一级标题，都没有就退回文件名；
 *   不去人名堆里找最像名字的词——猜错名字会直接写进 `pets[].name`。
 * - 语义：只按**文件名**给每份文档定角色（`IDENTITY.md` 是身份、`AGENTS.md` 是规则…），
 *   不读内容做分类。文件名不认识就整份并进正文，不丢内容也不假装懂它。
 * @module dsh-fish-body/src/host/persona-source/markdown-card
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { projectCard, type CharaCardData } from './card-reader.ts';
import type { PersonaResolution } from './types.ts';

/** 一份待合并的 Markdown 文档。 */
export interface MarkdownDoc {
  /** 文件名（含扩展名）；语义靠它判断，不靠内容。 */
  readonly name: string;
  /** 文件正文。 */
  readonly text: string;
  /**
   * 显式指定语义角色（`FILE_ROLES` 的键），压过按文件名推断。
   *
   * 给「文件名不带语义」的来源用：Coopanion 的 `partner/food.md` 靠文件名读不出「这是关于主人」，
   * 硬把文件名改造成 `user-food.md` 只是把猜测藏得更深；调用方知道语义就直接说。
   */
  readonly role?: string;
}

/** 文件名（去扩展名、小写）→ 合并顺序与标签。顺序即拼接顺序，标签进正文。 */
const FILE_ROLES: Readonly<Record<string, { order: number; label: string; note?: string }>> = {
  soul: { order: 0, label: '人设' },
  identity: { order: 1, label: '身份' },
  style: { order: 2, label: '说话风格' },
  personality: { order: 3, label: '性格' },
  agents: { order: 4, label: '规则' },
  // 作息必须带边界：它是**设定**，不是当前时间。少了这句，模型会把「23:00 睡觉」当成现状，
  // 于是按人设里的深夜语境脑补时刻（实测：真实 13:13 被说成「十一点半多」「23:40」）。
  heartbeat: { order: 5, label: '作息与节律', note: '（以下是设定，不是当前时间；当前时刻只看【当下】）' },
  usertemplate: { order: 6, label: '关于主人' },
  user: { order: 6, label: '关于主人' },
  memory: { order: 7, label: '长期记忆' },
};

/** 认不出的文件排在最后（保持内容，不假装懂它的语义）。 */
const UNKNOWN_ROLE = { order: 99, label: '' };

/** 顶层 Markdown 里**不是人格**的常见项目文档：扫到也当没看见，免得把 README 读成人设。 */
const NOT_PERSONA_FILES: ReadonlySet<string> = new Set([
  'readme',
  'license',
  'changelog',
  'contributing',
  'notice',
  'authors',
  'code_of_conduct',
  'security',
]);

/** 文件名去扩展名并小写（`USER_TEMPLATE.md` → `user_template`）。 */
function stemOf(name: string): string {
  const cut = name.lastIndexOf('.');
  return (cut > 0 ? name.slice(0, cut) : name).trim().toLowerCase();
}

/** 这个文件名是否明确不是人格文档（README 那一类）。 */
export function isNotPersonaDoc(name: string): boolean {
  return NOT_PERSONA_FILES.has(stemOf(name));
}

/** 一份文档的语义角色：显式 `role` 优先，其次按文件名（认不出给 {@link UNKNOWN_ROLE}）。 */
function roleOf(doc: MarkdownDoc): { order: number; label: string; note?: string } {
  const explicit = doc.role === undefined ? undefined : FILE_ROLES[doc.role];
  if (explicit !== undefined) return explicit;
  return FILE_ROLES[stemOf(doc.name).replace(/_/g, '')] ?? UNKNOWN_ROLE;
}

/**
 * 取正文：去掉一级标题行（它已经当名字用过，重复一遍只会让正文以 `# 鱼生` 开头）。
 *
 * 只去**首个非空行**如果是 `# X` 的情况；`## 小节` 一律保留（它们是正文结构）。
 */
function bodyOf(text: string): string {
  const lines = text.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && (lines[start] ?? '').trim() === '') start += 1;
  if (/^#\s+\S/.test((lines[start] ?? '').trim())) start += 1;
  return lines.slice(start).join('\n').trim();
}

/** 名字声明行（带冒号）：`名字：鱼生` / `名称: X` / `Name: YU`（中英文冒号都认）。 */
const NAME_COLON = /^\s*(?:名字|名称|name)\s*[:：]\s*(.+)$/im;

/**
 * 名字声明行（不带冒号）：`名字是「鱼生」`。
 *
 * 单独一条正则而不是让冒号那条变成可选：`名字` 后面不带冒号时，正文里到处都能命中
 * （「名字是主人起的」这种句子），必须要求带引号才算声明。
 */
const NAME_IS = /^\s*(?:名字|名称)\s*是\s*[「『"'“]\s*([^」』"'”\s]+)\s*[」』"'”]?\s*$/m;

/** 去掉包裹的引号/括号，只留名字本身。 */
function stripWrap(raw: string): string {
  return raw.replace(/^[「『"'“（(]+|[」』"'”）)]+$/g, '').trim();
}

/** 从一份文档里找显式名字声明。 */
function declaredNameOf(text: string): string | undefined {
  const colon = NAME_COLON.exec(text)?.[1];
  if (colon !== undefined) {
    const cleaned = stripWrap(colon);
    if (cleaned !== '') return cleaned;
  }
  const is = NAME_IS.exec(text)?.[1];
  if (is !== undefined) {
    const cleaned = stripWrap(is);
    if (cleaned !== '') return cleaned;
  }
  return undefined;
}

/** 文档的一级标题（`# 鱼生`）。 */
function titleOf(text: string): string | undefined {
  const hit = /^\s*#\s+(\S[^\r\n]*)$/m.exec(text);
  const title = hit?.[1]?.trim();
  return title === undefined || title === '' ? undefined : title;
}

/**
 * 推断角色名：显式声明（身份文档优先）→ 一级标题（人设文档优先）→ 文件名。
 *
 * 顺序是有意的：**声明 > 标题 > 文件名**。前两者是作者写的，文件名是我们看到的。
 *
 * @param docs - 已按语义排序的文档。
 * @returns 名字；连文件名都取不到时为空串（调用方按 id 兜底）。
 */
export function nameOfDocs(docs: readonly MarkdownDoc[]): string {
  for (const doc of docs) {
    const declared = declaredNameOf(doc.text);
    if (declared !== undefined) return declared;
  }
  for (const doc of docs) {
    const title = titleOf(doc.text);
    if (title !== undefined) return title;
  }
  const first = docs[0];
  if (first === undefined) return '';
  const stem = first.name.replace(/\.[^.]+$/, '').trim();
  return stem === '' ? '' : stem;
}

/**
 * 把一组 Markdown 文档折成 8 字段。
 *
 * 全部正文并进 `description`（其余 7 个字段留空）：角色卡那 8 个字段是 SillyTavern 的分段约定，
 * Markdown 没有等价物，硬把 `AGENTS.md` 塞进 `system_prompt` 只是换个名字的猜。
 * 各段带标签（`规则：…`），第一段不戴标签——与 `projectCard` 的口径一致。
 *
 * @param docs - 文档集合（顺序不重要，这里按文件名语义重排）。
 * @returns 8 字段；没有任何可用正文时 `description` 为空串。
 */
export function markdownCardOf(docs: readonly MarkdownDoc[]): CharaCardData {
  const sorted = [...docs].sort((a, b) => {
    const ra = roleOf(a);
    const rb = roleOf(b);
    return ra.order === rb.order ? a.name.localeCompare(b.name) : ra.order - rb.order;
  });
  const sections: string[] = [];
  // 同内容不同文件名（大小写并存、用户复制了一份、`Soul.md` 与 `SOUL.md` 都在）只留第一份：
  // 同一段正文拼三遍既费 token 又会让模型以为那是重点强调。
  const seenBodies = new Set<string>();
  for (const doc of sorted) {
    const body = bodyOf(doc.text);
    if (body === '') continue;
    if (seenBodies.has(body)) continue;
    seenBodies.add(body);
    const { label, note } = roleOf(doc);
    // 第一段不戴标签：它就是人设正文本身，顶一个「人设：」只会让人以为是系统硬塞的前缀
    sections.push(sections.length === 0 || label === '' ? body : label + (note ?? '') + '：' + body);
  }
  return {
    name: nameOfDocs(sorted),
    description: sections.join('\n'),
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    system_prompt: '',
    post_history_instructions: '',
  };
}

/**
 * 单个 `.md` 文件的投影（自定义路径指向一份文件时的入口）。
 *
 * @param name - 文件名（含扩展名）。
 * @param text - 正文。
 * @returns 8 字段。
 */
export function markdownCardOfOne(name: string, text: string): CharaCardData {
  return markdownCardOf([{ name, text }]);
}

/**
 * 读一份 Markdown 并投影成一次人设解析结果（`resolve()` 的共用实现）。
 *
 * 与卡片路径共用同一套投影：先 `markdownCardOfOne` 归一成 8 字段，再交给 `projectCard` 拼正文——
 * 两处各写一份拼接顺序，迟早会出现「导入时看到的是 A、resolve 拿到的是 B」。
 *
 * @param path - Markdown 文件的绝对路径。
 * @returns 成功给正文与名字；文件不存在 / 没有可用正文时给结构化原因。
 */
export async function readMarkdownPersona(path: string): Promise<PersonaResolution> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { ok: false, reason: 'not-found', message: path };
  }
  const card = markdownCardOfOne(basename(path), text);
  const body = projectCard(card);
  if (body === '') return { ok: false, reason: 'invalid-card', message: '人设文档没有可用正文' };
  return { ok: true, text: body, name: card.name };
}
