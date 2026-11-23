/**
 * 角色库存储（store）的单元测试：一角色一文件、指纹去重、id 归一化与冲突后缀、坏文件跳过。
 *
 * 只用临时目录，不依赖宠物配置；判据是「磁盘上到底有几个文件、文件名是什么」。
 * @module dsh-fish-body/src/host/persona/characters/store.test
 */
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getCharacter, listCharacters, putCharacter } from './store.ts';
import type { CharaCardData } from '../../persona-source/card-reader.ts';

/** 8 字段构造器。 */
function fields(name: string, description: string): CharaCardData {
  return {
    name,
    description,
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    system_prompt: '',
    post_history_instructions: '',
  };
}

/** 建一个临时角色库目录（测试结束由调用方删）。 */
async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'persona-store-'));
}

test('一角色一文件，文件名 = id', async () => {
  const dir = await tempDir();
  try {
    const { record, reused } = await putCharacter(dir, { fields: fields('鱼生', '蓝色大肥鱼') });
    assert.equal(reused, false);
    assert.equal(record.id, '鱼生');
    assert.equal(record.name, '鱼生');
    assert.deepEqual(await readdir(dir), ['鱼生.json']);
    const saved = JSON.parse(await readFile(join(dir, '鱼生.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(saved.description, '蓝色大肥鱼');
    assert.equal(typeof saved.fingerprint, 'string');
    assert.equal(typeof saved.importedAt, 'string');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('同正文重复导入 → reused:true，且文件 mtime 不变', async () => {
  const dir = await tempDir();
  try {
    await putCharacter(dir, { fields: fields('鱼生', '蓝色大肥鱼') });
    const before = await stat(join(dir, '鱼生.json'));
    const again = await putCharacter(dir, { fields: fields('鱼生', '蓝色大肥鱼') });
    assert.equal(again.reused, true);
    assert.equal(again.record.id, '鱼生');
    assert.equal((await stat(join(dir, '鱼生.json'))).mtimeMs, before.mtimeMs);
    assert.deepEqual(await readdir(dir), ['鱼生.json']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('同正文不同来源 → reused:true，且保留最早那份 source（后来者不覆盖）', async () => {
  const dir = await tempDir();
  try {
    const first = await putCharacter(dir, {
      fields: fields('鱼生', '蓝色大肥鱼'),
      source: { kind: 'soul-card', id: 'fish-soul', path: 'persona.json' },
    });
    assert.equal(first.reused, false);
    const savedBefore = await readFile(join(dir, '鱼生.json'), 'utf8');

    const again = await putCharacter(dir, {
      fields: fields('鱼生', '蓝色大肥鱼'),
      source: { kind: 'custom', id: 'custom', path: 'D:/elsewhere/persona.json' },
    });
    assert.equal(again.reused, true);
    assert.deepEqual(again.record.source, first.record.source, 'reused 时来源保持第一次那一份');
    assert.equal(again.record.source.id, 'fish-soul');
    assert.equal(await readFile(join(dir, '鱼生.json'), 'utf8'), savedBefore, 'reused 不该写盘');
    assert.deepEqual(await readdir(dir), ['鱼生.json']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('同名不同正文 → -2 后缀', async () => {
  const dir = await tempDir();
  try {
    const first = await putCharacter(dir, { fields: fields('鱼生', '第一版') });
    const second = await putCharacter(dir, { fields: fields('鱼生', '第二版') });
    assert.equal(first.record.id, '鱼生');
    assert.equal(second.record.id, '鱼生-2');
    assert.equal((await readdir(dir)).sort().join(','), '鱼生-2.json,鱼生.json');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('中文名生成中文 id，且能读回', async () => {
  const dir = await tempDir();
  try {
    const { record } = await putCharacter(dir, { fields: fields('鱼生', '中文 id 也要能落盘') });
    assert.equal(record.id, '鱼生');
    const read = await getCharacter(dir, '鱼生');
    assert.equal(read?.description, '中文 id 也要能落盘');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('全符号名兜底 character-<fp8>', async () => {
  const dir = await tempDir();
  try {
    const { record } = await putCharacter(dir, { fields: fields('★☆★', '只有符号的名字') });
    assert.match(record.id, /^character-[0-9a-f]{8}$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('坏 JSON 被跳过、不抛，好文件照常列出', async () => {
  const dir = await tempDir();
  try {
    await putCharacter(dir, { fields: fields('鱼生', '好文件') });
    await writeFile(join(dir, 'broken.json'), '{不是 json', 'utf8');
    await writeFile(join(dir, 'wrong-shape.json'), '{"id":"x"}', 'utf8');
    const listed = await listCharacters(dir);
    assert.equal(listed.characters.length, 1);
    assert.deepEqual(
      listed.skipped.map((item) => [item.file, item.reason]),
      [
        ['broken.json', 'invalid-json'],
        ['wrong-shape.json', 'invalid-record'],
      ],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('目录不存在 → 空库（首次使用不是错误）', async () => {
  const dir = join(tmpdir(), 'persona-store-missing-' + Date.now());
  const listed = await listCharacters(dir);
  assert.deepEqual(listed, { characters: [], skipped: [] });
});

test('非法 id 的读请求不拼路径', async () => {
  const dir = await tempDir();
  try {
    await mkdir(dir, { recursive: true });
    assert.equal(await getCharacter(dir, '../main-config'), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
