/**
 * 角色库存储：`<用户数据根>/data/persona-characters/<id>.json`，一角色一文件。
 *
 * 只做文件级 CRUD（列表 / 读取 / 原子写入 / 删除），不做引用检查与扫描编排——
 * 引用检查要读成品配置、扫描要走来源注册表，那些归 `../service`。
 * 必须始终成立：同正文重复导入不写盘（回 `reused`）；坏文件只跳过不抛；写盘走「临时文件 + rename」。
 * @module dsh-fish-body/src/host/persona/characters/store
 */
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectCard, type CharaCardData } from '../../persona-source/card-reader.ts';
import { characterIdValid, fallbackId, fingerprintOf, slug, uniqueId } from './ids.ts';
import type { CharacterRecord, CharacterSource } from './types.ts';

/** 列表里被跳过的文件（坏 JSON / 形状不对）。 */
export interface CharacterSkip {
  readonly file: string;
  readonly reason: 'invalid-json' | 'invalid-record';
}

/** 一次列表的结果。 */
export interface CharacterListResult {
  readonly characters: CharacterRecord[];
  readonly skipped: CharacterSkip[];
}

/** 写入输入：8 字段 + 可选来源（缺省 = 只给了正文的导入）。 */
export interface PutCharacterInput {
  readonly fields: CharaCardData;
  readonly source?: CharacterSource;
}

/** 写入结果：`reused` = 同正文已在库里（**没有写盘**）。 */
export interface PutCharacterResult {
  readonly record: CharacterRecord;
  readonly reused: boolean;
}

/**
 * id 后缀用尽（`-2` … `-99` 全被占）：由路由映射成 `bad-request`。
 *
 * 用工厂而不是 class：类型擦除后 class 字段会被打包器塞一个 `_defineProperty` 运行期 helper，
 * 给一个纯逻辑模块添一条无谓的产物依赖，不划算。
 *
 * @param name - 归一化后的 id 基名。
 * @returns 带稳定 `code` 的 Error（路由据此判定）。
 */
export function characterIdExhausted(name: string): Error & { readonly code: 'character-id-exhausted' } {
  return Object.assign(new Error(`角色名「${name}」的 id 后缀已用尽（上限 99）`), {
    name: 'CharacterIdExhaustedError',
    code: 'character-id-exhausted' as const,
  });
}

/**
 * 写操作串行化：模块内一条 Promise 链，避免两个并发导入抢同一个 id。
 *
 * 只串行化写；读不排队（读到的是上一次落盘完成后的状态）。
 */
let writeChain: Promise<unknown> = Promise.resolve();

/**
 * 把一个写任务挂到模块级串行链上。
 *
 * @param task - 真正做写盘的任务。
 * @returns 任务结果；前一个任务失败不影响后一个。
 */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = writeChain.then(task, task);
  writeChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** unknown 收敛成字符串（缺字段按空串）。 */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 把一个已解析的 JSON 收敛成记录；形状不对返回 undefined。
 *
 * @param raw - `JSON.parse` 的结果。
 * @returns 合法记录；非法返回 undefined。
 */
function recordOf(raw: unknown): CharacterRecord | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : '';
  if (!characterIdValid(id)) return undefined;
  if (typeof r.fingerprint !== 'string' || r.fingerprint === '') return undefined;
  const source = r.source && typeof r.source === 'object' && !Array.isArray(r.source) ? r.source : {};
  const s = source as Record<string, unknown>;
  const kind = typeof s.kind === 'string' ? s.kind : 'custom';
  return {
    id,
    name: textOf(r.name),
    description: textOf(r.description),
    personality: textOf(r.personality),
    scenario: textOf(r.scenario),
    first_mes: textOf(r.first_mes),
    mes_example: textOf(r.mes_example),
    system_prompt: textOf(r.system_prompt),
    post_history_instructions: textOf(r.post_history_instructions),
    source: {
      kind: kind as CharacterSource['kind'],
      id: textOf(s.id) || 'import',
      path: textOf(s.path),
    },
    importedAt: textOf(r.importedAt),
    fingerprint: r.fingerprint,
  };
}

/**
 * 列出角色库。
 *
 * 目录不存在视为空库（首次使用不是错误）；单个坏文件只进 `skipped`，不让整页空掉。
 *
 * @param dir - 角色库目录（绝对路径）。
 * @returns 角色列表与被跳过的文件。
 */
export async function listCharacters(dir: string): Promise<CharacterListResult> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { characters: [], skipped: [] };
  }
  const characters: CharacterRecord[] = [];
  const skipped: CharacterSkip[] = [];
  for (const name of names.sort()) {
    if (!name.toLowerCase().endsWith('.json') || name.startsWith('.')) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(dir, name), 'utf8')) as unknown;
    } catch {
      skipped.push({ file: name, reason: 'invalid-json' });
      continue;
    }
    const record = recordOf(raw);
    if (record === undefined) skipped.push({ file: name, reason: 'invalid-record' });
    else characters.push(record);
  }
  return { characters, skipped };
}

/**
 * 读一个角色。
 *
 * @param dir - 角色库目录。
 * @param id - 角色 id（先过校验，非法 id 直接当不存在——不拼路径）。
 * @returns 角色记录；不存在 / 非法 / 坏文件都返回 undefined。
 */
export async function getCharacter(dir: string, id: string): Promise<CharacterRecord | undefined> {
  if (!characterIdValid(id)) return undefined;
  try {
    const raw: unknown = JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8'));
    return recordOf(raw);
  } catch {
    return undefined;
  }
}

/**
 * 写入一个角色。
 *
 * 先按正文指纹查重：命中就不写盘，回既有记录（保留最早的 `source` / `importedAt`）。
 * 否则按 `slug(name)` 生成 id（全符号名兜底 `character-<fp8>`），冲突加 `-2`…`-99`，
 * 走「临时文件 + rename」原子替换。
 *
 * @param dir - 角色库目录。
 * @param input - 8 字段与可选来源。
 * @returns 记录与是否是复用。
 * @throws {Error} id 后缀用尽时（code = 'character-id-exhausted'）。
 */
export function putCharacter(dir: string, input: PutCharacterInput): Promise<PutCharacterResult> {
  return serialize(async () => {
    const text = projectCard(input.fields);
    const fingerprint = fingerprintOf(text);
    const listed = await listCharacters(dir);
    const existing = listed.characters.find((record) => record.fingerprint === fingerprint);
    if (existing !== undefined) return { record: existing, reused: true };

    const base = slug(input.fields.name) || fallbackId(fingerprint);
    const id = uniqueId(base, new Set(listed.characters.map((record) => record.id)));
    if (id === undefined) throw characterIdExhausted(base);

    const record: CharacterRecord = {
      ...input.fields,
      id,
      source: input.source ?? { kind: 'custom-text', id: 'import', path: '' },
      importedAt: new Date().toISOString(),
      fingerprint,
    };
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${id}.json`);
    const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temp, JSON.stringify(record, null, 2), 'utf8');
    await rename(temp, file);
    return { record, reused: false };
  });
}

/**
 * 删一个角色文件。
 *
 * 引用检查不在这里（要读成品配置，归 service）；`ENOENT` 视为已删。
 *
 * @param dir - 角色库目录。
 * @param id - 角色 id。
 * @returns 恒为成功（幂等删除）。
 */
export function deleteCharacter(dir: string, id: string): Promise<{ ok: true }> {
  return serialize(async () => {
    if (characterIdValid(id)) {
      try {
        await unlink(join(dir, `${id}.json`));
      } catch {
        // 不存在 = 已经是想要的状态
      }
    }
    return { ok: true as const };
  });
}
