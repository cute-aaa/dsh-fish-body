/**
 * 应用角色（applyCharacter）的多实例矩阵：谁被写、谁一个字节都没动。
 *
 * 判据始终是「读盘后的文件内容」，不是返回值——返回 `applied` 但写错实例是本模块最贵的 bug。
 * @module dsh-fish-body/src/host/persona/characters/apply.test
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyCharacter } from './apply.ts';
import { projectCard } from '../../persona-source/card-reader.ts';
import { saveUserConfig } from '../../config.ts';
import type { ConfigPaths } from '../../config/constants.ts';
import type { CharacterRecord } from './types.ts';

/** 一只字段齐全的实例（saveUserConfig 的白名单要求）。 */
function pet(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: id.toUpperCase(),
    size: 300,
    balanceEnabled: false,
    whisperEnabled: false,
    workStatusEnabled: false,
    fixedEnabled: false,
    display: 'web',
    renderer: 'webm',
    position: { corner: 'bottom-right', marginX: 40, marginY: 40 },
    ...over,
  };
}

/** 一份合法的最小内置默认。 */
function defaultConfig(): Record<string, unknown> {
  return { pets: [pet('a'), pet('b')], whisperPrompt: '条目级人设' };
}

/** 造一个角色记录（8 字段 + 元信息）。 */
function record(id: string, description: string, name = '鱼生'): CharacterRecord {
  return {
    id,
    name,
    description,
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    system_prompt: '',
    post_history_instructions: '',
    source: { kind: 'soul-card', id: 'fish-soul', path: 'card.json' },
    importedAt: '2026-11-19T00:00:00.000Z',
    fingerprint: 'abcdef123456',
  };
}

/** 建临时配置：默认文件 + 用户层（含两只实例的初始正文）。 */
async function fixture(overlay: Record<string, unknown>): Promise<{
  paths: ConfigPaths;
  userConfigPath: string;
  dir: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'persona-apply-'));
  const userConfigPath = join(dir, 'main-config.jsonc');
  const paths: ConfigPaths = {
    defaultFile: join(dir, 'default.jsonc'),
    userFile: userConfigPath,
    petDir: join(dir, 'pet'),
  };
  await writeFile(paths.defaultFile, JSON.stringify(defaultConfig()), 'utf8');
  await writeFile(userConfigPath, JSON.stringify(overlay), 'utf8');
  return { paths, userConfigPath, dir };
}

/** 读盘后的 pets。 */
async function savedPets(userConfigPath: string): Promise<Record<string, unknown>[]> {
  const saved = JSON.parse(await readFile(userConfigPath, 'utf8')) as { pets: Record<string, unknown>[] };
  return saved.pets;
}

test('只改目标实例：a 应用后 b 的 whisperPrompt 逐字节相同、且没有 personaCharacter 键', async () => {
  const { paths, userConfigPath, dir } = await fixture({
    pets: [pet('a', { whisperPrompt: 'A-原始', personaCharacter: 'X' }), pet('b', { whisperPrompt: 'B-原始' })],
  });
  try {
    const next = record('Y', '新的正文');
    const outcome = await applyCharacter(paths, userConfigPath, next, 'a');
    assert.deepEqual(outcome, {
      status: 'applied',
      petId: 'a',
      characterId: 'Y',
      chars: projectCard(next).length,
      wroteName: true,
    });
    const pets = await savedPets(userConfigPath);
    const a = pets.find((item) => item.id === 'a') as Record<string, unknown>;
    const b = pets.find((item) => item.id === 'b') as Record<string, unknown>;
    assert.equal(a.whisperPrompt, projectCard(next));
    assert.equal(a.personaCharacter, 'Y');
    assert.equal(b.whisperPrompt, 'B-原始', '另一只的正文必须逐字节相同');
    assert.equal('personaCharacter' in b, false, '另一只不该凭空长出角色引用');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('再应用给 b：b 变、a 不变', async () => {
  const { paths, userConfigPath, dir } = await fixture({
    pets: [pet('a', { whisperPrompt: 'A-原始', personaCharacter: 'X' }), pet('b', { whisperPrompt: 'B-原始' })],
  });
  try {
    const toB = record('Z', 'B 的新正文');
    await applyCharacter(paths, userConfigPath, toB, 'a');
    const aAfterFirst = (await savedPets(userConfigPath)).find((item) => item.id === 'a') as Record<string, unknown>;

    await applyCharacter(paths, userConfigPath, toB, 'b');
    const pets = await savedPets(userConfigPath);
    const a = pets.find((item) => item.id === 'a') as Record<string, unknown>;
    const b = pets.find((item) => item.id === 'b') as Record<string, unknown>;
    assert.equal(b.whisperPrompt, projectCard(toB));
    assert.equal(b.personaCharacter, 'Z');
    assert.deepEqual(a, aAfterFirst, '第二次应用后 a 必须一个字节都没动');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('三键都已是目标值 → unchanged，且文件内容与 mtime 都不变', async () => {
  const { paths, userConfigPath, dir } = await fixture({
    pets: [pet('a', { whisperPrompt: 'A-原始' }), pet('b', { whisperPrompt: 'B-原始' })],
  });
  try {
    const target = record('Y', '同一段正文');
    await applyCharacter(paths, userConfigPath, target, 'a');
    const before = await readFile(userConfigPath, 'utf8');
    const beforeStat = await stat(userConfigPath);

    const again = await applyCharacter(paths, userConfigPath, target, 'a');
    assert.deepEqual(again, { status: 'unchanged', petId: 'a', characterId: 'Y' });
    assert.equal(await readFile(userConfigPath, 'utf8'), before);
    assert.equal((await stat(userConfigPath)).mtimeMs, beforeStat.mtimeMs, 'unchanged 不该写盘');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeName:false → name 不变，personaCharacter 仍然写入', async () => {
  const { paths, userConfigPath, dir } = await fixture({
    pets: [pet('a', { name: '阿宠', whisperPrompt: 'A-原始' }), pet('b', { whisperPrompt: 'B-原始' })],
  });
  try {
    const outcome = await applyCharacter(paths, userConfigPath, record('Y', '正文', '鱼生'), 'a', {
      writeName: false,
    });
    assert.equal(outcome.status, 'applied');
    if (outcome.status === 'applied') assert.equal(outcome.wroteName, false);
    const a = (await savedPets(userConfigPath)).find((item) => item.id === 'a') as Record<string, unknown>;
    assert.equal(a.name, '阿宠');
    assert.equal(a.personaCharacter, 'Y');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('空正文角色 → failed/write-failed，磁盘一个字节都不写', async () => {
  const { paths, userConfigPath, dir } = await fixture({
    pets: [pet('a', { whisperPrompt: 'A-原始' }), pet('b', { whisperPrompt: 'B-原始' })],
  });
  try {
    const before = await readFile(userConfigPath, 'utf8');
    const beforeStat = await stat(userConfigPath);
    const empty: CharacterRecord = { ...record('Y', ''), name: '' };
    const outcome = await applyCharacter(paths, userConfigPath, empty, 'a');
    assert.deepEqual(outcome, { status: 'failed', reason: 'write-failed' });
    assert.equal(await readFile(userConfigPath, 'utf8'), before);
    assert.equal((await stat(userConfigPath)).mtimeMs, beforeStat.mtimeMs);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('未知宠物 → unknown-pet；非 main 条目 → readonly-entry（都不写盘）', async () => {
  const { paths, userConfigPath, dir } = await fixture({ pets: [pet('a', { whisperPrompt: 'A-原始' })] });
  try {
    const before = await readFile(userConfigPath, 'utf8');
    assert.deepEqual(await applyCharacter(paths, userConfigPath, record('Y', '正文'), 'nobody'), {
      status: 'failed',
      reason: 'unknown-pet',
    });
    assert.deepEqual(await applyCharacter(paths, userConfigPath, record('Y', '正文'), 'a'), {
      status: 'applied',
      petId: 'a',
      characterId: 'Y',
      chars: projectCard(record('Y', '正文')).length,
      wroteName: true,
    });
    // 非 main 的实例在别的条目里（pet/<名>-config.json 是一个独立条目）
    await mkdir(join(dir, 'pet'), { recursive: true });
    await writeFile(join(dir, 'pet', 'glm-config.json'), JSON.stringify({ pets: [pet('g1')] }), 'utf8');
    const afterA = await readFile(userConfigPath, 'utf8');
    assert.deepEqual(await applyCharacter(paths, userConfigPath, record('Y', '正文'), 'g1'), {
      status: 'skipped',
      reason: 'readonly-entry',
    });
    assert.equal(await readFile(userConfigPath, 'utf8'), afterA, '只读条目不该写盘');
    assert.notEqual(before, afterA);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('互不影响：a 写 X、b 写 Y，第三只 c 全程一个字段都没动', async () => {
  const { paths, userConfigPath, dir } = await fixture({
    pets: [
      pet('a', { whisperPrompt: 'A-原始' }),
      pet('b', { whisperPrompt: 'B-原始' }),
      pet('c', { whisperPrompt: 'C-原始', name: '丙' }),
    ],
  });
  try {
    const cBefore = (await savedPets(userConfigPath)).find((item) => item.id === 'c');
    await applyCharacter(paths, userConfigPath, record('X', 'X 的正文'), 'a');
    await applyCharacter(paths, userConfigPath, record('Y', 'Y 的正文'), 'b');
    const pets = await savedPets(userConfigPath);
    assert.equal(pets.find((item) => item.id === 'a')?.personaCharacter, 'X');
    assert.equal(pets.find((item) => item.id === 'b')?.personaCharacter, 'Y');
    assert.notEqual(
      pets.find((item) => item.id === 'a')?.whisperPrompt,
      pets.find((item) => item.id === 'b')?.whisperPrompt,
    );
    assert.deepEqual(
      pets.find((item) => item.id === 'c'),
      cBefore,
      '未引用实例必须逐字段不变',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('一次 apply 只推进一次 mtime：重复调用 unchanged 不再写盘', async () => {
  const { paths, userConfigPath, dir } = await fixture({ pets: [pet('a', { whisperPrompt: 'A-原始' })] });
  try {
    const before = await stat(userConfigPath);
    await applyCharacter(paths, userConfigPath, record('X', '正文'), 'a');
    const afterFirst = await stat(userConfigPath);
    assert.ok(afterFirst.mtimeMs > before.mtimeMs, '第一次应用必须落盘');
    const content = await readFile(userConfigPath, 'utf8');
    const again = await applyCharacter(paths, userConfigPath, record('X', '正文'), 'a');
    assert.deepEqual(again, { status: 'unchanged', petId: 'a', characterId: 'X' });
    assert.equal((await stat(userConfigPath)).mtimeMs, afterFirst.mtimeMs, '第二次不该再写一次');
    assert.equal(await readFile(userConfigPath, 'utf8'), content);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('清除引用：提交空串 personaCharacter → 磁盘上该键消失、正文保持现值', async () => {
  const { paths, userConfigPath, dir } = await fixture({ pets: [pet('a', { whisperPrompt: 'A-原始' })] });
  try {
    await applyCharacter(paths, userConfigPath, record('X', '角色正文'), 'a');
    const applied = await savedPets(userConfigPath);
    const textAfterApply = applied[0].whisperPrompt;

    const cleared = applied.map((item) => ({ ...item, personaCharacter: '' }));
    const clean = saveUserConfig({ pets: cleared }, null);
    assert.ok(clean, '空串不该让整包被拒');
    await writeFile(userConfigPath, JSON.stringify(clean, null, 2), 'utf8');

    const after = await savedPets(userConfigPath);
    assert.equal('personaCharacter' in after[0], false, '空串 = 删键');
    assert.equal(after[0].whisperPrompt, textAfterApply, '只覆盖不清理：正文保持现值');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
