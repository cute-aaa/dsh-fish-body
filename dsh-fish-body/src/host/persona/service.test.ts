/**
 * 人设服务的扫描编排测试：来源 → 角色库 → 账本，以及两条拒绝路径。
 *
 * 用一个假来源（`scan()` 回 2 个角色）走真实 store 写盘，判据是「角色库里几个文件、账本记了什么」。
 * @module dsh-fish-body/src/host/persona/service.test
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPersonaServices } from './service.ts';
import { registerPersonaSource, resetPersonaSources } from '../persona-source/registry.ts';
import type { PersonaSource } from '../persona-source/types.ts';
import type { ConfigPaths } from '../config/constants.ts';

/** 一个最小合法宠物（读配置时 mergePet 要能过）。 */
function pet(id: string): Record<string, unknown> {
  return {
    id,
    name: id,
    size: 300,
    balanceEnabled: false,
    display: 'web',
    renderer: 'webm',
    position: { corner: 'bottom-right', marginX: 40, marginY: 40 },
  };
}

/** 造一套临时配置 + 角色库目录。 */
async function fixture(): Promise<{
  dir: string;
  characterDir: string;
  configPaths: ConfigPaths;
  userConfigPath: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'persona-service-'));
  const configPaths: ConfigPaths = {
    defaultFile: join(dir, 'default.jsonc'),
    userFile: join(dir, 'main-config.jsonc'),
    petDir: join(dir, 'pet'),
  };
  await writeFile(configPaths.defaultFile, JSON.stringify({ pets: [pet('a')], whisperPrompt: '条目人设' }), 'utf8');
  return { dir, characterDir: join(dir, 'persona-characters'), configPaths, userConfigPath: configPaths.userFile };
}

/** 假来源：scan 回两个结构化角色。 */
function fakeScannedSource(): PersonaSource {
  return {
    id: 'fake',
    name: '假来源',
    kind: 'soul-card',
    probe: async () => ({ installed: true, path: '/fake/persona.json' }),
    resolve: async () => ({ ok: false, reason: 'not-found' }),
    scan: async () => ({
      characters: [
        {
          name: '鱼生',
          text: '人设：蓝色大肥鱼',
          path: '/fake/a.json',
          data: {
            name: '鱼生',
            description: '蓝色大肥鱼',
            personality: '',
            scenario: '',
            first_mes: '',
            mes_example: '',
            system_prompt: '',
            post_history_instructions: '',
          },
        },
        {
          name: '阿猫',
          text: '人设：一只猫',
          path: '/fake/b.json',
          data: {
            name: '阿猫',
            description: '一只猫',
            personality: '',
            scenario: '',
            first_mes: '',
            mes_example: '',
            system_prompt: '',
            post_history_instructions: '',
          },
        },
      ],
      skipped: [],
    }),
  };
}

test('scan：导入 2 个角色；第二次运行全部 reused，账本 {scanned:2, imported:0, reused:2}', async () => {
  resetPersonaSources();
  const fx = await fixture();
  try {
    registerPersonaSource(fakeScannedSource());
    const services = createPersonaServices({
      characterDir: fx.characterDir,
      configPaths: fx.configPaths,
      userConfigPath: fx.userConfigPath,
    });

    const first = await services.persona.scan('fake');
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.scanned, 2);
    assert.deepEqual(
      first.imported.map((item) => [item.id, item.reused]),
      [
        ['鱼生', false],
        ['阿猫', false],
      ],
    );
    assert.deepEqual((await readdir(fx.characterDir)).sort(), ['阿猫.json', '鱼生.json'].sort());

    const second = await services.persona.scan('fake');
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.deepEqual(
      second.imported.map((item) => item.reused),
      [true, true],
    );
    const ledger = services.persona.lastScan('fake');
    assert.equal(ledger?.scanned, 2);
    assert.equal(ledger?.imported, 0);
    assert.equal(ledger?.reused, 2);
    assert.equal((await readdir(fx.characterDir)).filter((name) => name.endsWith('.json')).length, 2);
  } finally {
    resetPersonaSources();
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test('scan：未知来源 → unknown-persona-source；无 scan → bad-request；custom 无路径 → bad-request', async () => {
  resetPersonaSources();
  const fx = await fixture();
  try {
    registerPersonaSource({
      id: 'editor',
      name: '内置编辑',
      kind: 'editor',
      resolve: async () => ({ ok: false, reason: 'not-found' }),
    });
    registerPersonaSource({
      id: 'custom',
      name: '自定义路径',
      kind: 'custom',
      probe: async () => ({ installed: false, path: '' }),
      resolve: async () => ({ ok: false, reason: 'not-found' }),
      scan: async () => ({ characters: [], skipped: [] }),
    });
    const services = createPersonaServices({
      characterDir: fx.characterDir,
      configPaths: fx.configPaths,
      userConfigPath: fx.userConfigPath,
    });
    assert.deepEqual(await services.persona.scan('nobody'), {
      ok: false,
      reason: 'unknown-persona-source',
      message: '未注册的人设来源: nobody',
    });
    const noScan = await services.persona.scan('editor');
    assert.equal(noScan.ok, false);
    if (!noScan.ok) assert.equal(noScan.reason, 'bad-request');
    const noPath = await services.persona.scan('custom');
    assert.equal(noPath.ok, false);
    if (!noPath.ok) assert.equal(noPath.reason, 'bad-request');
  } finally {
    resetPersonaSources();
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test('characters.list：带 chars 与 appliedTo（缺引用时为空数组）', async () => {
  resetPersonaSources();
  const fx = await fixture();
  try {
    registerPersonaSource(fakeScannedSource());
    const services = createPersonaServices({
      characterDir: fx.characterDir,
      configPaths: fx.configPaths,
      userConfigPath: fx.userConfigPath,
    });
    await services.persona.scan('fake');
    const listed = await services.characters.list();
    assert.equal(listed.characters.length, 2);
    for (const view of listed.characters) {
      assert.ok(view.chars > 0);
      assert.deepEqual(view.appliedTo, []);
    }
  } finally {
    resetPersonaSources();
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test('跨实例：apply 到 a 只改 a，b 逐字节不变，appliedTo 只指向 a', async () => {
  resetPersonaSources();
  const fx = await fixture();
  try {
    const withText = {
      pets: [
        { ...pet('a'), whisperPrompt: 'A-原始' },
        { ...pet('b'), whisperPrompt: 'B-原始' },
      ],
    };
    await writeFile(fx.configPaths.userFile, JSON.stringify(withText), 'utf8');

    const services = createPersonaServices({
      characterDir: fx.characterDir,
      configPaths: fx.configPaths,
      userConfigPath: fx.userConfigPath,
    });
    const put = await services.characters.put({
      fields: {
        name: '鱼生',
        description: '蓝色大肥鱼',
        personality: '',
        scenario: '',
        first_mes: '',
        mes_example: '',
        system_prompt: '',
        post_history_instructions: '',
      },
    });
    const outcome = await services.characters.apply('a', put.record.id);
    assert.equal(outcome.status, 'applied');

    const saved = JSON.parse(await readFile(fx.userConfigPath, 'utf8')) as { pets: Record<string, unknown>[] };
    const a = saved.pets.find((item) => item.id === 'a') as Record<string, unknown>;
    const b = saved.pets.find((item) => item.id === 'b') as Record<string, unknown>;
    assert.equal(a.personaCharacter, put.record.id);
    assert.match(String(a.whisperPrompt), /蓝色大肥鱼/);
    assert.equal(b.whisperPrompt, 'B-原始');
    assert.equal('personaCharacter' in b, false);

    const listed = await services.characters.list();
    assert.deepEqual(listed.characters[0].appliedTo, ['a']);
  } finally {
    resetPersonaSources();
    await rm(fx.dir, { recursive: true, force: true });
  }
});
