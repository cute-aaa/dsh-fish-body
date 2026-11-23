/**
 * 人格来源注册表单元测试：注册、按 id 查、注销、重复 id 拒绝，以及可用性描述（describePersonaSources）。
 *
 * 这里钉住契约扩展的兼容性：只有 id/name/resolve 的老实现必须继续工作并被描述成
 * `soul-card / 不可扫描`；`probe(options)` / `scan(options)` 的显式路径必须优先于约定目录。
 * @module dsh-fish-body/src/host/persona-source/registry.test
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  describePersonaSources,
  listPersonaSources,
  personaSource,
  registerPersonaSource,
  resetPersonaSources,
} from './registry.ts';
import { createCardFileSource } from './card-file.ts';
import type { PersonaSource } from './types.ts';

/** 造一个最小合法来源。 */
function fakeSource(id: string): PersonaSource {
  return {
    id,
    name: id,
    resolve: async (): Promise<{ ok: false; reason: 'not-found' }> => ({ ok: false, reason: 'not-found' }),
  };
}

/** 一份可直接投影的 v2 卡。 */
function card(name: string, description: string): string {
  return JSON.stringify({ spec: 'chara_card_v2', data: { name, description } });
}

/** 建一个临时目录，测试结束由调用方删除。 */
function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('registerPersonaSource：注册后可按 id 取到并列出，注销后清空', () => {
  resetPersonaSources();
  const dispose = registerPersonaSource(fakeSource('fish-soul'));
  assert.equal(personaSource('fish-soul')?.id, 'fish-soul');
  assert.deepEqual(listPersonaSources(), [{ id: 'fish-soul', name: 'fish-soul' }]);
  dispose();
  assert.equal(personaSource('fish-soul'), undefined);
  assert.deepEqual(listPersonaSources(), []);
});

test('registerPersonaSource：id 重复抛错，不覆盖先注册的', () => {
  resetPersonaSources();
  registerPersonaSource(fakeSource('a'));
  assert.throws(() => registerPersonaSource(fakeSource('a')), /重复/);
  assert.equal(personaSource('a')?.name, 'a');
});

test('registerPersonaSource：id / name / resolve 非法时抛错', () => {
  resetPersonaSources();
  const valid = fakeSource('x') as unknown as Record<string, unknown>;
  assert.throws(() => registerPersonaSource({ ...valid, id: '' } as never), /id/);
  assert.throws(() => registerPersonaSource({ ...valid, name: '' } as never), /name/);
  assert.throws(() => registerPersonaSource({ ...valid, resolve: 1 } as never), /resolve/);
});

test('describePersonaSources：老实现（无 probe/scan）→ soul-card，installed 由 watchPath 决定', async () => {
  resetPersonaSources();
  const dir = tempDir('persona-registry-');
  try {
    const present = join(dir, 'card.json');
    writeFileSync(present, card('鱼生', '蓝色大肥鱼'), 'utf8');
    registerPersonaSource({ ...fakeSource('old-a'), watchPath: present });
    registerPersonaSource({ ...fakeSource('old-b'), watchPath: join(dir, 'missing.json') });

    const described = await describePersonaSources();
    assert.deepEqual(
      described.map((item) => [item.id, item.kind, item.installed, item.scannable]),
      [
        ['old-a', 'soul-card', true, false],
        ['old-b', 'soul-card', false, false],
      ],
    );
    assert.equal(described[0].path, present, '已安装时 path 是实际路径');
    assert.equal(described[1].path, null, '未安装时 path 为 null，期望位置在 expectedPath');
    assert.equal(described[1].expectedPath, join(dir, 'missing.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('describePersonaSources：老式 resolve() 实现注册后仍能列出（编译期契约不被破坏）', async () => {
  resetPersonaSources();
  const legacy: PersonaSource = {
    id: 'legacy',
    name: '老实现',
    resolve: async () => ({ ok: true, text: '正文', name: '鱼生' }),
  };
  registerPersonaSource(legacy);
  const [described] = await describePersonaSources();
  assert.equal(described.id, 'legacy');
  assert.equal(described.installed, true, '没有 watchPath 的来源视为常驻可用');
  assert.equal(described.expectedPath, null);
  assert.equal(described.scannable, false);
});

test('probe / scan：传 {path} 时命中该路径而不是约定目录', async () => {
  resetPersonaSources();
  const dir = tempDir('persona-path-');
  try {
    const convention = join(dir, 'project');
    const elsewhere = join(dir, 'elsewhere');
    mkdirSync(convention, { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    const cardPath = join(elsewhere, 'other.json');
    writeFileSync(cardPath, card('阿猫', '一只猫'), 'utf8');

    const source = createCardFileSource({ id: 'custom', name: '自定义路径', dir: convention, kind: 'custom' });
    registerPersonaSource(source);

    // 约定目录是空的：不给 path → 未安装。
    const empty = await describePersonaSources();
    assert.equal(empty[0].installed, false);
    assert.equal(empty[0].path, null);

    // 给了存在的文件：命中该文件，不是约定目录。
    const hit = await describePersonaSources({ path: cardPath });
    assert.equal(hit[0].installed, true);
    assert.equal(hit[0].path, cardPath);
    const scanned = await source.scan?.({ path: cardPath });
    assert.equal(scanned?.characters.length, 1);
    assert.equal(scanned?.characters[0].name, '阿猫');

    // 给了不存在的路径：未安装，且不回落到约定目录。
    const miss = await describePersonaSources({ path: join(dir, 'nope.json') });
    assert.equal(miss[0].installed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scan：一个 persona.json + personas/ 目录（含一张坏卡）→ 2 个角色 + 1 条 skipped', async () => {
  resetPersonaSources();
  const dir = tempDir('persona-scan-');
  try {
    writeFileSync(join(dir, 'persona.json'), card('鱼生', '蓝色大肥鱼'), 'utf8');
    mkdirSync(join(dir, 'personas'), { recursive: true });
    writeFileSync(join(dir, 'personas', 'cat.json'), card('阿猫', '一只猫'), 'utf8');
    writeFileSync(join(dir, 'personas', 'broken.json'), '{不是 json', 'utf8');

    const source = createCardFileSource({ id: 'fish-soul', name: 'dsh-fish-soul', dir });
    const result = await source.scan?.();
    assert.equal(result?.characters.length, 2);
    assert.deepEqual(
      result?.characters.map((item) => item.name),
      ['鱼生', '阿猫'],
    );
    assert.deepEqual(
      result?.skipped.map((item) => item.reason),
      ['invalid-card'],
    );
    assert.equal(result?.skipped[0].path, join(dir, 'personas', 'broken.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
