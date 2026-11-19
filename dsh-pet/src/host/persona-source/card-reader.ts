/**
 * SillyTavern v2 人设卡读取与投影（纯逻辑 + 一次文件读）。
 * 支持 JSON 卡（{spec:"chara_card_v2", data:{…}}）与 PNG 卡（tEXt 的 chara 块，base64）。
 * 投影把 {{char}}/{{user}} 替换后拼成一段可直接进 whisperPrompt 的正文；只读一个文件，不监听、不写盘。
 * @module dsh-fish-body/src/host/persona-source/card-reader
 */
import { readFile } from 'node:fs/promises';
import type { PersonaResolution } from './types.ts';

/** SillyTavern v2 卡片的 spec 标记。 */
const CHARA_SPEC = 'chara_card_v2';
/** {{user}} 的替换名：桌宠语境下用户就是「主人」。 */
const USER_ALIAS = '主人';
/** PNG 8 字节签名。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** tEXt 块里放卡片的字段名。 */
const PNG_CHARA_KEYWORD = 'chara';

/** 投影用的人设卡字段（parseCard 已把 unknown 收敛成字符串）。 */
export interface CharaCardData {
  readonly name: string;
  readonly description: string;
  readonly personality: string;
  readonly scenario: string;
  readonly first_mes: string;
  readonly mes_example: string;
  readonly system_prompt: string;
  readonly post_history_instructions: string;
}

/** unknown 收敛成 trim 过的字符串；非字符串一律当空。 */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 把卡里的 {{char}}/{{user}} 占位符替换成角色名与主人。 */
function replacePlaceholders(text: string, name: string): string {
  return text
    .split('{{char}}')
    .join(name || '角色')
    .split('{{user}}')
    .join(USER_ALIAS);
}

/**
 * 把人设卡投影成一段 whisperPrompt 正文。
 *
 * 只保留有内容的段落并按固定顺序拼接。「人设」「性格」这些标签只加在**后续**段上：
 * 第一段就是人设正文本身，再顶一个「人设：」只会在设置页的输入框里看着像系统自动塞进去的前缀
 * （用户第一反应就是「这行不是我写的」），对模型也没有任何信息量。
 *
 * @param data - 已解析的卡字段。
 * @returns 拼好的正文；没有任何可用内容时返回空串。
 */
export function projectCard(data: CharaCardData): string {
  const replace = (text: string): string => replacePlaceholders(text, data.name);
  const sections: string[] = [];
  const push = (label: string, value: string): void => {
    const text = replace(value);
    // 第一段不戴标签：段落顺序是固定的，读到什么都不用靠标签区分「这是人设」。
    if (text) sections.push(sections.length === 0 ? text : `${label}：${text}`);
  };
  push('人设', data.description);
  push('性格', data.personality);
  push('背景', data.scenario);
  push('开场白', data.first_mes);
  push('对话示例', data.mes_example);
  const system = replace(data.system_prompt);
  if (system) sections.push(system);
  const post = replace(data.post_history_instructions);
  if (post) sections.push(post);
  return sections.join('\n');
}

/**
 * 解析 SillyTavern v2 卡片的 JSON 文本。
 *
 * @param text - JSON 文本。
 * @returns 已收敛的字段；spec 不符 / data 缺失 / 不是对象时返回 undefined。
 */
export function parseCard(text: string): CharaCardData | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const card = parsed as Record<string, unknown>;
  if (card.spec !== CHARA_SPEC) return undefined;
  const data = card.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const d = data as Record<string, unknown>;
  return {
    name: textOf(d.name),
    description: textOf(d.description),
    personality: textOf(d.personality),
    scenario: textOf(d.scenario),
    first_mes: textOf(d.first_mes),
    mes_example: textOf(d.mes_example),
    system_prompt: textOf(d.system_prompt),
    post_history_instructions: textOf(d.post_history_instructions),
  };
}

/** 判定是否 PNG（8 字节签名）。 */
function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** 大端读 4 字节无符号整数。 */
function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

/** 从 PNG 的 tEXt chara 块里取卡片 JSON（base64）；找不到返回 undefined。 */
function pngCardJson(bytes: Uint8Array): string | undefined {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) return undefined;
    if (type === 'tEXt') {
      const text = textChunkJson(bytes.subarray(start, end));
      if (text !== undefined) return text;
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4; // 跳过 CRC
  }
  return undefined;
}

/** 解析 tEXt 块：关键字必须是 chara，值是 base64 的 JSON 文本。 */
function textChunkJson(data: Uint8Array): string | undefined {
  const sep = data.indexOf(0);
  if (sep === -1) return undefined;
  const keyword = Buffer.from(data.subarray(0, sep)).toString('latin1');
  if (keyword !== PNG_CHARA_KEYWORD) return undefined;
  const value = Buffer.from(data.subarray(sep + 1)).toString('latin1');
  return Buffer.from(value, 'base64').toString('utf8');
}

/** 把文件字节解出卡片 JSON 文本：PNG 走 chara 块，否则按 UTF-8 文本。 */
function decodeCardText(bytes: Uint8Array): string {
  if (!isPng(bytes)) return new TextDecoder().decode(bytes);
  return pngCardJson(bytes) ?? '';
}

/**
 * 读一个卡片文件并投影。
 *
 * @param path - 卡片文件路径。
 * @returns 投影结果：文件不存在 → not-found；解析失败或无正文 → invalid-card。
 */
export async function readCardFile(path: string): Promise<PersonaResolution> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch {
    return { ok: false, reason: 'not-found', message: path };
  }
  const data = parseCard(decodeCardText(bytes));
  if (!data) return { ok: false, reason: 'invalid-card', message: path };
  const text = projectCard(data);
  if (!text) return { ok: false, reason: 'invalid-card', message: '人设卡没有可用正文' };
  return { ok: true, text, name: data.name };
}
