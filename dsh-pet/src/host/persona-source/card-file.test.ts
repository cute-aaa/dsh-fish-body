/**
 * 卡片文件来源工厂的单元测试：同内容不同文件只出一个角色（其余进 skipped），显式路径只扫那一个。
 * @module dsh-fish-body/src/host/persona-source/card-file.test
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCardFileSource } from './card-file.ts';

/** 一份可直接投影的 v2 卡。 */
function card(name: string, description: string): string {
  return JSON.stringify({ spec: 'chara_card_v2', data: { name, description } });
}

/** 建一个临时目录，测试结束由调用方删除。 */
function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('scan：persona.json 与 personas/ 同内容 → 只出一个角色，另一个进 skipped', async () => {
  const dir = tempDir('card-file-');
  try {
    writeFileSync(join(dir, 'persona.json'), card('鱼生', '蓝色大肥鱼'), 'utf8');
    mkdirSync(join(dir, 'personas'), { recursive: true });
    writeFileSync(join(dir, 'personas', 'copy.json'), card('鱼生', '蓝色大肥鱼'), 'utf8');

    const source = createCardFileSource({ id: 'fish-soul', name: 'dsh-fish-soul', dir });
    const result = await source.scan?.();
    assert.equal(result?.characters.length, 1);
    assert.equal(result?.characters[0].path, join(dir, 'persona.json'), '先扫到的那个留下');
    assert.equal(result?.skipped.length, 1);
    assert.equal(result?.skipped[0].path, join(dir, 'personas', 'copy.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scan：给了文件路径 → 只读这一个文件，不看约定目录', async () => {
  const dir = tempDir('card-file-');
  try {
    const project = join(dir, 'project');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'persona.json'), card('约定角色', '约定目录里的卡'), 'utf8');
    const explicit = join(dir, 'single.json');
    writeFileSync(explicit, card('指定角色', '显式路径里的卡'), 'utf8');

    const source = createCardFileSource({ id: 'custom', name: '自定义路径', dir: project, kind: 'custom' });
    const result = await source.scan?.({ path: explicit });
    assert.deepEqual(
      result?.characters.map((item) => item.name),
      ['指定角色'],
    );
    assert.equal(result?.characters[0].path, explicit);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scan：单卡超过 1 MiB → 进 skipped(too-large)，不读成角色', async () => {
  const dir = tempDir('card-file-');
  try {
    // 1 MiB 闸门是「读整份 100 MB 的图会拖死扫描」的防线：超限必须只留一条原因，不进角色。
    writeFileSync(join(dir, 'persona.json'), card('大鱼', 'x'.repeat(1024 * 1024)), 'utf8');
    const source = createCardFileSource({ id: 'fish-soul', name: 'dsh-fish-soul', dir });
    const result = await source.scan?.();
    assert.deepEqual(result?.characters, []);
    assert.deepEqual(
      result?.skipped.map((item) => [item.path, item.reason]),
      [[join(dir, 'persona.json'), 'too-large']],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('probe：约定目录既没有 persona.json 也没有 personas/ → 未安装，且给出期望路径', async () => {
  const dir = tempDir('card-file-');
  try {
    const source = createCardFileSource({ id: 'dsh-soul', name: 'dsh-soul', dir });
    const availability = await source.probe?.();
    assert.equal(availability?.installed, false);
    assert.equal(availability?.path, join(dir, 'persona.json'));
    const result = await source.scan?.();
    assert.deepEqual(result, { characters: [], skipped: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
