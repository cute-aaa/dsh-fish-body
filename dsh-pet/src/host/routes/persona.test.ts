/**
 * `/persona/*` 路由的契约测试：成功形状 + 六条失败路径（都是 200 + 失败实体，不抛 500）。
 *
 * 走真实的 `createPersonaServices`（临时角色库 + 临时配置），只把来源换成测试注册的假实现。
 * @module dsh-fish-body/src/host/routes/persona.test
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';

import { handlePersonaRoutes } from './persona.ts';
import { createPersonaServices } from '../persona/service.ts';
import { registerPersonaSource, resetPersonaSources } from '../persona-source/registry.ts';
import { createCardFileSource } from '../persona-source/card-file.ts';
import type { PersonaSource } from '../persona-source/types.ts';
import type { PetRouteDeps } from './types.ts';
import type { RouteResult } from '../http.ts';

/** 一只字段齐全的实例。 */
function pet(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: id,
    size: 300,
    balanceEnabled: false,
    display: 'web',
    renderer: 'webm',
    position: { corner: 'bottom-right', marginX: 40, marginY: 40 },
    ...over,
  };
}

let dir = '';
let deps: PetRouteDeps;
/** 应用成功后的广播（section 名）。 */
const broadcasts: string[] = [];

/** 调一次 persona 路由。 */
async function call(rest: string, method = 'GET', body?: string): Promise<RouteResult | undefined> {
  const [path, query] = rest.split('?');
  const url = new URL('http://localhost/' + path + (query === undefined ? '' : '?' + query));
  return handlePersonaRoutes(deps, { url, rest: path, method, body });
}

/** 从成功响应里取对象。 */
function objOf(result: RouteResult | undefined): Record<string, unknown> {
  assert.ok(result !== undefined && result.kind === 'json', '应为 json 应答');
  return result.obj as Record<string, unknown>;
}

/** 一个只给正文的假来源。 */
function fakeSource(): PersonaSource {
  return {
    id: 'fake',
    name: '假来源',
    kind: 'soul-card',
    probe: async () => ({ installed: true, path: '/fake/persona.json' }),
    scan: async () => ({
      characters: [{ name: '鱼生', text: '人设：蓝色大肥鱼', path: '/fake/a.json' }],
      skipped: [],
    }),
    resolve: async () => ({ ok: false, reason: 'not-found' }),
  };
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'persona-routes-'));
  const configPaths = {
    defaultFile: join(dir, 'default.jsonc'),
    userFile: join(dir, 'main-config.jsonc'),
    petDir: join(dir, 'pet'),
  };
  await writeFile(
    configPaths.defaultFile,
    JSON.stringify({ pets: [pet('a'), pet('b')], whisperPrompt: '条目人设' }),
    'utf8',
  );
  await writeFile(configPaths.userFile, JSON.stringify({ pets: [pet('a'), pet('b')] }), 'utf8');
  await mkdir(configPaths.petDir, { recursive: true });
  await writeFile(join(configPaths.petDir, 'glm-config.json'), JSON.stringify({ pets: [pet('g1')] }), 'utf8');

  resetPersonaSources();
  registerPersonaSource(fakeSource());
  registerPersonaSource({
    id: 'editor',
    name: '内置编辑',
    kind: 'editor',
    syncable: false,
    probe: async () => ({ installed: true, path: '' }),
    resolve: async () => ({ ok: false, reason: 'not-found' }),
  });
  registerPersonaSource({
    id: 'offline',
    name: '没装好的来源',
    kind: 'soul-card',
    probe: async () => ({ installed: false, path: '/nowhere/persona.json' }),
    scan: async () => ({ characters: [], skipped: [] }),
    resolve: async () => ({ ok: false, reason: 'not-found' }),
  });
  registerPersonaSource({
    id: 'custom',
    name: '自定义路径',
    kind: 'custom',
    probe: async () => ({ installed: false, path: '' }),
    scan: async () => ({ characters: [], skipped: [] }),
    resolve: async () => ({ ok: false, reason: 'not-found' }),
  });

  // 真实卡片来源：给路径闸门的「根内存在 → 扫 1 个」用例提供可读文件。
  registerPersonaSource(
    createCardFileSource({ id: 'cards', name: '路径来源', dir: join(dir, 'cards-default'), kind: 'custom' }) as never,
  );
  const services = createPersonaServices({
    characterDir: join(dir, 'persona-characters'),
    configPaths,
    userConfigPath: configPaths.userFile,
    // 闸门只放行数据根内：测试的数据根就是这个临时目录。
    allowedRoots: [dir],
  });
  deps = {
    configPaths,
    petConfigDir: configPaths.petDir,
    persona: services.persona,
    characters: services.characters,
    ctx: {},
    // 应用成功会广播 config；这里只记调用，断言写盘结果不靠它。
    state: { writeSection: (name: string) => broadcasts.push(name) },
  } as unknown as PetRouteDeps;
});

after(async () => {
  resetPersonaSources();
  await rm(dir, { recursive: true, force: true });
});

test('GET sources：不带 pet 也成功（无 pet 字段）；带未知 pet 回 unknown-pet', async () => {
  const body = objOf(await call('persona/sources'));
  assert.equal(body.ok, true);
  assert.equal('pet' in body, false);
  assert.ok(Array.isArray(body.sources));
  const ids = (body.sources as Array<{ id: string }>).map((item) => item.id);
  assert.ok(ids.includes('editor'));
  assert.equal((body.sources as Array<{ id: string; lastScan: unknown }>)[0].lastScan, null);

  const withPet = objOf(await call('persona/sources?pet=a'));
  assert.deepEqual(withPet.pet, { id: 'a', entry: 'main', writable: true, character: null });

  const unknown = objOf(await call('persona/sources?pet=nobody'));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, 'unknown-pet');
});

test('POST scan：缺 source / editor（无 scan）/ custom（无 path）都回 bad-request', async () => {
  const missing = objOf(await call('persona/scan', 'POST', '{}'));
  assert.equal(missing.reason, 'bad-request');

  const noScan = objOf(await call('persona/scan', 'POST', JSON.stringify({ source: 'editor' })));
  assert.equal(noScan.reason, 'bad-request');

  const custom = objOf(await call('persona/scan', 'POST', JSON.stringify({ source: 'custom' })));
  assert.equal(custom.reason, 'bad-request');

  const unknown = objOf(await call('persona/scan', 'POST', JSON.stringify({ source: 'nobody' })));
  assert.equal(unknown.reason, 'unknown-persona-source');

  const ok = objOf(await call('persona/scan', 'POST', JSON.stringify({ source: 'fake' })));
  assert.equal(ok.ok, true);
  assert.equal(ok.scanned, 1);
});

test('POST characters/apply：未知角色 → unknown-character；非 main 实例 → persona-readonly-entry', async () => {
  const unknown = objOf(
    await call('persona/characters/apply', 'POST', JSON.stringify({ pet: 'a', characterId: '没有这个' })),
  );
  assert.equal(unknown.reason, 'unknown-character');

  // 先落一个角色再往 pet pack 实例上应用
  const imported = objOf(
    await call(
      'persona/characters/import',
      'POST',
      JSON.stringify({
        character: {
          name: '鱼生',
          description: '蓝色大肥鱼',
          personality: '',
          scenario: '',
          first_mes: '',
          mes_example: '',
          system_prompt: '',
          post_history_instructions: '',
        },
      }),
    ),
  );
  const id = (imported.character as { id: string }).id;
  const readonly = objOf(
    await call('persona/characters/apply', 'POST', JSON.stringify({ pet: 'g1', characterId: id })),
  );
  assert.equal(readonly.reason, 'persona-readonly-entry');
});

test('DELETE：被引用角色 → character-in-use 且 extra.referrers 有元素', async () => {
  const listed = objOf(await call('persona/characters'));
  const id = (listed.characters as Array<{ id: string }>)[0].id;
  const applied = objOf(
    await call('persona/characters/apply', 'POST', JSON.stringify({ pet: 'a', characterId: id, writeName: false })),
  );
  assert.equal(applied.ok, true);

  const blocked = objOf(await call('persona/characters/' + id, 'DELETE'));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'character-in-use');
  const extra = blocked.extra as { referrers: Array<{ pet: string; entry: string }> };
  assert.deepEqual(extra.referrers, [{ pet: 'a', entry: 'main' }]);
});

test('POST import：6 个文件 → too-many-items；体超 1 MiB → 413 payload-too-large', async () => {
  const files = Array.from({ length: 6 }, (_, i) => ({
    name: `f${i}.txt`,
    base64: Buffer.from('文字').toString('base64'),
  }));
  const tooMany = objOf(await call('persona/import', 'POST', JSON.stringify({ pet: 'a', files })));
  assert.equal(tooMany.reason, 'too-many-items');

  const huge = await call('persona/import', 'POST', 'x'.repeat(1024 * 1024 + 10));
  assert.ok(huge !== undefined && huge.kind === 'json');
  if (huge?.kind === 'json') assert.equal(huge.status, 413);
});

test('POST polish：空文本 → bad-request；llm 缺失 → generate-error（不是 500）', async () => {
  const empty = objOf(await call('persona/polish', 'POST', JSON.stringify({ pet: 'a', text: '   ' })));
  assert.equal(empty.reason, 'bad-request');

  const noLlm = objOf(await call('persona/polish', 'POST', JSON.stringify({ pet: 'a', text: '把这句话写顺一点' })));
  assert.equal(noLlm.ok, false);
  assert.equal(noLlm.reason, 'generate-error');
});

test('跨实例：应用到 a 只改 a；未知角色不改盘', async () => {
  const userFile = deps.configPaths.userFile;
  const readPets = async (): Promise<Record<string, unknown>[]> =>
    (JSON.parse(await readFile(userFile, 'utf8')) as { pets: Record<string, unknown>[] }).pets;

  // 先把两只实例的初始正文写死，保证「b 不变」是可比的
  await writeFile(
    userFile,
    JSON.stringify({ pets: [pet('a', { whisperPrompt: 'A-原始' }), pet('b', { whisperPrompt: 'B-原始' })] }),
    'utf8',
  );
  const before = await readPets();

  const imported = objOf(
    await call(
      'persona/characters/import',
      'POST',
      JSON.stringify({
        character: {
          name: '阿猫',
          description: '一只猫',
          personality: '',
          scenario: '',
          first_mes: '',
          mes_example: '',
          system_prompt: '',
          post_history_instructions: '',
        },
        source: { kind: 'document', id: 'import', path: 'a.md' },
      }),
    ),
  );
  const id = (imported.character as { id: string }).id;

  const unknown = objOf(
    await call('persona/characters/apply', 'POST', JSON.stringify({ pet: 'a', characterId: '不存在' })),
  );
  assert.equal(unknown.reason, 'unknown-character');
  assert.deepEqual(await readPets(), before, '未知角色不该改盘');

  broadcasts.length = 0;
  const applied = objOf(await call('persona/characters/apply', 'POST', JSON.stringify({ pet: 'a', characterId: id })));
  assert.equal(applied.ok, true);
  // 写盘后广播：其它窗口据此重读 /config，不然它们手里还是旧正文。
  assert.deepEqual(broadcasts, ['config'], '应用成功要广播 config');
  const after = await readPets();
  const a = after.find((item) => item.id === 'a') as Record<string, unknown>;
  const b = after.find((item) => item.id === 'b') as Record<string, unknown>;
  assert.equal(a.personaCharacter, id);
  assert.match(String(a.whisperPrompt), /一只猫/);
  assert.equal(b.whisperPrompt, 'B-原始');
  assert.equal('personaCharacter' in b, false);
});

test('pet-required：apply / import / polish 缺 pet 都是 failResult（不是 500）', async () => {
  for (const [rest, body] of [
    ['persona/characters/apply', { characterId: 'x' }],
    ['persona/import', { files: [{ name: 'a.txt', base64: 'x' }] }],
    ['persona/polish', { text: '一段话' }],
  ] as const) {
    const result = objOf(await call(rest, 'POST', JSON.stringify(body)));
    assert.equal(result.ok, false, rest + ' 缺 pet 要失败');
    assert.equal(result.reason, 'pet-required', rest);
  }
});

test('scan：未安装来源 → persona-source-unavailable（带 expectedPath）；显式路径不存在 → not-found', async () => {
  const offline = objOf(await call('persona/scan', 'POST', JSON.stringify({ source: 'offline' })));
  assert.equal(offline.reason, 'persona-source-unavailable');
  assert.deepEqual(offline.extra, { expectedPath: '/nowhere/persona.json' });

  const missing = objOf(
    await call('persona/scan', 'POST', JSON.stringify({ source: 'custom', path: join(dir, 'nope.json') })),
  );
  assert.equal(missing.reason, 'not-found');
});

test('import：空文本 → extract-failed；.doc → unsupported；两者都不写盘', async () => {
  const userBefore = await readFile(deps.configPaths.userFile, 'utf8');
  const charsBefore = await readdir(join(dir, 'persona-characters')).catch(() => [] as string[]);

  const empty = objOf(
    await call(
      'persona/import',
      'POST',
      JSON.stringify({ pet: 'a', files: [{ name: 'blank.txt', base64: Buffer.from('   ').toString('base64') }] }),
    ),
  );
  assert.equal(empty.reason, 'extract-failed');

  const doc = objOf(
    await call(
      'persona/import',
      'POST',
      JSON.stringify({ pet: 'a', files: [{ name: 'old.doc', base64: Buffer.from('x').toString('base64') }] }),
    ),
  );
  assert.equal(doc.reason, 'unsupported');

  assert.equal(await readFile(deps.configPaths.userFile, 'utf8'), userBefore, '预览失败不该改配置');
  const charsAfter = await readdir(join(dir, 'persona-characters')).catch(() => [] as string[]);
  assert.deepEqual(charsAfter, charsBefore, '预览失败不该动角色库');
});

test('两个 AI 动作零写盘：调用前后配置文件 mtime 与角色库条目数不变', async () => {
  const userFile = deps.configPaths.userFile;
  const { stat } = await import('node:fs/promises');
  const beforeMtime = (await stat(userFile)).mtimeMs;
  const beforeChars = (await readdir(join(dir, 'persona-characters')).catch(() => [] as string[])).sort();

  await call('persona/polish', 'POST', JSON.stringify({ pet: 'a', text: '把这句话写顺一点' }));
  await call(
    'persona/import',
    'POST',
    JSON.stringify({ pet: 'a', files: [{ name: 'a.txt', base64: Buffer.from('一些文本').toString('base64') }] }),
  );

  assert.equal((await stat(userFile)).mtimeMs, beforeMtime, '润色 / 导入预览都不该写配置');
  assert.deepEqual((await readdir(join(dir, 'persona-characters')).catch(() => [] as string[])).sort(), beforeChars);
});

test('解码后超上限但请求体 < 1 MiB → 200 + payload-too-large（不是 413）', async () => {
  // 783,360 字节原文 → base64 1,044,480 字节；加上 JSON 包装仍小于 1 MiB，但已超 768 KiB − 4 KiB 的解码预算。
  const decoded = Buffer.alloc(783360, 0x41);
  const base64 = decoded.toString('base64');
  const body = JSON.stringify({ pet: 'a', files: [{ name: 'edge.txt', base64 }] });
  assert.ok(body.length < 1024 * 1024, '这个体的长度必须小于 1 MiB，才能证明走的是解码后判定');
  const result = await call('persona/import', 'POST', body);
  assert.ok(result !== undefined && result.kind === 'json');
  const obj = objOf(result);
  assert.equal(obj.ok, false);
  assert.equal(obj.reason, 'payload-too-large');
  assert.equal((result as { status: number }).status, 200, '业务失败仍是 200，413 只留给协议层');
});

test('custom 路径闸门：相对路径 / 穿越 / 根外绝对路径都是 bad-request，根内才允许', async () => {
  const charsDir = join(dir, 'persona-characters');
  const countBefore = (await readdir(charsDir).catch(() => [] as string[])).length;
  const card = JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '根内鱼',
      description: '允许',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      system_prompt: '',
      post_history_instructions: '',
    },
  });
  await mkdir(join(dir, 'cards'), { recursive: true });
  await writeFile(join(dir, 'cards', 'persona.json'), card, 'utf8');
  await writeFile(join(dir, 'rel-probe.json'), card, 'utf8');

  // ① 相对路径：绝不能按进程 cwd 去读。
  const relative = objOf(
    await call('persona/scan', 'POST', JSON.stringify({ source: 'custom', path: 'rel-probe.json' })),
  );
  assert.equal(relative.ok, false);
  assert.equal(relative.reason, 'bad-request');
  assert.match(String(relative.message), /绝对路径/);
  assert.equal((await readdir(charsDir).catch(() => [] as string[])).length, countBefore, '相对路径不该改角色库');

  // ② `..` 穿越到数据根外。
  const escaped = objOf(
    await call('persona/scan', 'POST', JSON.stringify({ source: 'custom', path: join(dir, '..', 'outside.json') })),
  );
  assert.equal(escaped.reason, 'bad-request');
  assert.match(String(escaped.message), /允许的目录/);

  // ③ 绝对路径但不在允许根内。
  const outside = objOf(
    await call('persona/scan', 'POST', JSON.stringify({ source: 'custom', path: join(tmpdir(), 'not-allowed.json') })),
  );
  assert.equal(outside.reason, 'bad-request');
  assert.match(String(outside.message), /允许的目录/);

  // ④ 绝对路径、在根内、且存在 → 允许扫描，导入 1 个。
  const inside = objOf(
    await call('persona/scan', 'POST', JSON.stringify({ source: 'cards', path: join(dir, 'cards', 'persona.json') })),
  );
  assert.equal(inside.ok, true);
  assert.equal(inside.scanned, 1);
  assert.equal((inside.imported as unknown[]).length, 1);
  assert.equal((await readdir(charsDir)).length, countBefore + 1, '根内合法路径才写角色库');
});
