/**
 * POST /pet-size（单宠某渲染方式的大小）的契约测试。
 *
 * 四条契约：
 *   1. `sizes[renderer]` 写进层文件，其余宠物与该宠物的其它字段原样保留；
 *   2. `size` 缺省 / null = 删掉该渲染方式的覆盖（空了连 `sizes` 键一起去掉）；
 *   3. 没给 renderer 时按该宠物**当前**渲染方式落键；
 *   4. 非法 size / 未知宠物一律 200 + 失败实体，一个字节都不落盘。
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { setPetSize } from './size.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
import type { RouteResult } from '../../http.ts';

/** 包内内置默认配置：真实文件，`readAllConfig` 的必填基座。 */
const DEFAULT_FILE = fileURLToPath(new URL('../../../../assets/config.jsonc', import.meta.url));

/** 一只合法实例：测试只改需要的那个字段。 */
const pet = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'main1',
  name: '鱼生',
  size: 462,
  balanceEnabled: false,
  whisperEnabled: false,
  workStatusEnabled: false,
  fixedEnabled: false,
  display: 'web',
  position: { corner: 'top-right', marginX: 10, marginY: 10 },
  ...over,
});

interface Harness {
  readonly deps: PetRouteDeps;
  readonly userFile: string;
  readonly restarts: () => number;
}

let root = '';
let savedHome: string | undefined;

/** 造一套临时配置目录与最小依赖桩。 */
function makeHarness(): Harness {
  const userFile = join(root, 'main-config.jsonc');
  let restarts = 0;
  const deps = {
    configPaths: { defaultFile: DEFAULT_FILE, userFile, petDir: join(root, 'pet') },
    userConfigPath: userFile,
    userRoot: root,
    petConfigDir: join(root, 'pet'),
    state: { writeSection: () => {} },
    lock: { release: () => {} },
    requestRestart: async () => {
      restarts += 1;
    },
  } as unknown as PetRouteDeps;
  return { deps, userFile, restarts: () => restarts };
}

/** 造一次请求（固定走 /pet-size）。 */
const input = (body: unknown, method = 'POST'): RouteInput => ({
  url: new URL('http://localhost/dsh-pet-7340/pet-size'),
  rest: 'pet-size',
  method,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

/** 取出 JSON 应答的状态码与实体。 */
function jsonOf(res: RouteResult): { status: number; obj: Record<string, unknown> } {
  if (res.kind !== 'json') throw new Error('期望 JSON 应答，实际是 ' + res.kind);
  return { status: res.status, obj: res.obj as Record<string, unknown> };
}

/** 读回写入的宠物对象。 */
function savedPet(file: string): Record<string, unknown> {
  const conf = JSON.parse(readFileSync(file, 'utf8')) as { pets: Array<Record<string, unknown>> };
  return conf.pets[0] as Record<string, unknown>;
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-pet-size-'));
  savedHome = process.env.DSH_HOME;
  process.env.DSH_HOME = join(root, 'home');
});

after(() => {
  if (savedHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedHome;
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('setPetSize —— 按渲染方式写画框宽度', () => {
  test('写当前渲染方式的尺寸：其余字段与其它宠物原样保留', async () => {
    const h = makeHarness();
    writeFileSync(
      h.userFile,
      JSON.stringify({ pets: [pet({ renderer: 'live2d' }), pet({ id: 'main2', name: '二号' })] }),
      'utf8',
    );
    const res = jsonOf(await setPetSize(h.deps, input({ id: 'main1', size: 620 })));
    assert.equal(res.status, 200);
    const saved = savedPet(h.userFile);
    assert.deepEqual(saved.sizes, { live2d: 620 }, '没给 renderer 时按配置里的渲染方式落键');
    assert.equal(saved.size, 462, '基准 size 不受影响');
    const main = (res.obj.main ?? {}) as { pets?: unknown[] };
    assert.equal(main.pets?.length, 2, '成品聚合一并回传');
    assert.equal(h.restarts(), 1, '改大小要重建窗口');
  });

  test('显式 renderer 覆盖当前值；再传 null 删掉该键，删空后 sizes 整段消失', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet({ renderer: 'webm' })] }), 'utf8');
    await setPetSize(h.deps, input({ id: 'main1', renderer: 'layered', size: 500 }));
    assert.deepEqual(savedPet(h.userFile).sizes, { layered: 500 });
    await setPetSize(h.deps, input({ id: 'main1', renderer: 'layered', size: null }));
    assert.equal(savedPet(h.userFile).sizes, undefined, '没有覆盖就不留空对象');
  });

  test('非法 size / 非法 renderer / 未知宠物：200 + 失败实体，文件不动', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet()] }), 'utf8');
    const before = readFileSync(h.userFile, 'utf8');
    const cases = [
      { id: 'main1', size: 0 },
      { id: 'main1', size: 10 },
      { id: 'main1', size: 99999 },
      { id: 'main1', size: '520' },
      { id: 'main1', renderer: 'gif', size: 520 },
      { id: 'nope', size: 520 },
      { size: 520 },
    ];
    for (const body of cases) {
      const res = jsonOf(await setPetSize(h.deps, input(body)));
      assert.equal(res.status, 200);
      assert.equal(res.obj.ok, false, JSON.stringify(body) + ' 应被拒');
    }
    assert.equal(readFileSync(h.userFile, 'utf8'), before, '失败不写盘');
  });

  test('坏 JSON → 400（协议层面，不是业务结论）', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet()] }), 'utf8');
    assert.equal(jsonOf(await setPetSize(h.deps, input('{ 坏'))).status, 400);
  });

  test('GET → 405', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet()] }), 'utf8');
    assert.equal(jsonOf(await setPetSize(h.deps, input(undefined, 'GET'))).status, 405);
  });
});
