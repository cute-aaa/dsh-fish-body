/**
 * 应用角色到一只宠物：一次读盘、一次写盘，只改目标实例。
 *
 * 不写空人设、不动别的实例、三键都已等于目标值时一个字节都不写。
 * 写盘走与设置页同一条白名单重建链路（`saveUserConfig`），因此名字与正文要么都成、要么都不成。
 * @module dsh-fish-body/src/host/persona/characters/apply
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readAllConfig, readUserConfig, saveUserConfig } from '../../config.ts';
import { findPetInstance } from '../../config/read.ts';
import { projectCard } from '../../persona-source/card-reader.ts';
import type { ConfigPaths } from '../../config/constants.ts';
import type { ApplyOutcome, CharacterRecord } from './types.ts';

/**
 * 把角色正文写进指定实例的 `whisperPrompt`（可选 `name`）与 `personaCharacter`。
 *
 * @param configPaths - 配置路径集（读成品、写用户层用）。
 * @param userConfigPath - 用户主配置路径（唯一写盘落点）。
 * @param record - 角色记录（正文由 `projectCard` 现算）。
 * @param petId - 目标实例 id。
 * @param options - `writeName:false` = 不改名字（角色名为空时本来也不改）。
 * @returns 结构化结果；`unchanged` 表示三个键都已经是目标值（没写盘）。
 */
export async function applyCharacter(
  configPaths: ConfigPaths,
  userConfigPath: string,
  record: CharacterRecord,
  petId: string,
  options?: { readonly writeName?: boolean },
): Promise<ApplyOutcome> {
  const merged = readAllConfig(configPaths);
  const located = findPetInstance(merged, petId);
  if (located === undefined) return { status: 'failed', reason: 'unknown-pet' };
  // 只有主条目能写：文件宠物（pet pack）的实例属于别的条目、存在别的层文件里，
  // 这里假装写成只会让用户「勾了却不生效」。
  if (located.entry !== 'main') return { status: 'skipped', reason: 'readonly-entry' };

  const nextText = projectCard(record);
  if (nextText === '') return { status: 'failed', reason: 'write-failed' };

  const rawPets: unknown = merged.main.pets;
  const mainPets = Array.isArray(rawPets) ? (rawPets as Record<string, unknown>[]) : [];
  const target = mainPets.find((pet) => String(pet.id) === petId);
  if (target === undefined) return { status: 'failed', reason: 'unknown-pet' };

  const currentText = typeof target.whisperPrompt === 'string' ? target.whisperPrompt : '';
  const currentName = typeof target.name === 'string' ? target.name : '';
  const currentCharacter = typeof target.personaCharacter === 'string' ? target.personaCharacter : '';
  const wroteName = options?.writeName !== false && record.name !== '';
  const nextName = wroteName ? record.name : currentName;

  if (currentText === nextText && currentCharacter === record.id && currentName === nextName) {
    return { status: 'unchanged', petId, characterId: record.id };
  }

  // 只有 id 相同的实例被替换，其余实例原样带回（**不再**有「取第一只」的旧语义）。
  const pets = mainPets.map((pet) =>
    String(pet.id) === petId
      ? { ...pet, whisperPrompt: nextText, personaCharacter: record.id, ...(wroteName ? { name: nextName } : {}) }
      : pet,
  );
  const existing = readUserConfig(configPaths);
  const clean = saveUserConfig({ pets }, existing);
  if (!clean) return { status: 'failed', reason: 'write-failed' };
  await mkdir(dirname(userConfigPath), { recursive: true });
  await writeFile(userConfigPath, JSON.stringify(clean, null, 2), 'utf8');
  return { status: 'applied', petId, characterId: record.id, chars: nextText.length, wroteName };
}
