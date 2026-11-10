/**
 * 人设同步写回单元测试：钉住「投影正文写进主配置第一只宠物的 whisperPrompt」与「没变化不重写」。
 * @module dsh-pet/src/host/persona-source/sync.test
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ConfigPaths } from '../config/constants.ts';
import { applyPersona } from './sync.ts';

/** 内置默认的最小形态：pets 字段齐全即可，readAllConfig 会填缺省。 */
const DEFAULT = {
  pets: [
    {
      id: 'main',
      name: '主宠',
      size: 462,
      balanceEnabled: false,
      whisperEnabled: false,
      workStatusEnabled: false,
      fixedEnabled: false,
      display: 'web',
      position: { corner: 'bottom-right', marginX: 40, marginY: 40 },
    },
  ],
  whisperPrompt: '默认人设',
};

/** 用临时目录拼一份测试用 ConfigPaths（defaultFile 指向临时最小默认，隔离真实文件）。 */
async function tempConfigPaths(): Promise<{ paths: ConfigPaths; userConfigPath: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'persona-sync-'));
  const userConfigPath = join(dir, 'main-config.jsonc');
  const paths: ConfigPaths = {
    defaultFile: join(dir, 'default.jsonc'),
    userFile: userConfigPath,
    petDir: join(dir, 'pet'),
  };
  await writeFile(paths.defaultFile, JSON.stringify(DEFAULT), 'utf8');
  return { paths, userConfigPath, dir };
}

test('applyPersona：投影正文写进第一只宠物的 whisperPrompt', async () => {
  const { paths, userConfigPath, dir } = await tempConfigPaths();
  try {
    await applyPersona(paths, userConfigPath, '我是鱼生，一只蓝色大肥鱼。', 'fish-soul');
    const saved = JSON.parse(await readFile(userConfigPath, 'utf8'));
    assert.equal(saved.pets[0].whisperPrompt, '我是鱼生，一只蓝色大肥鱼。');
    assert.equal(saved.pets[0].id, 'main');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('applyPersona：正文没变化时不重写用户文件', async () => {
  const { paths, userConfigPath, dir } = await tempConfigPaths();
  try {
    await applyPersona(paths, userConfigPath, '我是鱼生。', 'fish-soul');
    const before = await readFile(userConfigPath, 'utf8');
    await applyPersona(paths, userConfigPath, '我是鱼生。', 'fish-soul');
    const after = await readFile(userConfigPath, 'utf8');
    assert.equal(before, after);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
