/**
 * POST /pet-click-through（单宠鼠标穿透）的契约测试。
 *
 * 五条契约：
 *   1. `value: true` 写 `pets[].clickThrough = true`，其余宠物与该宠物的其它字段原样保留；
 *   2. `value: false` = 删掉该键（配置里不留 `clickThrough: false`）；
 *   3. 非法 value / 未知宠物一律 200 + 失败实体，一个字节都不落盘；
 *   4. **不重启桌面 Helper**：穿透是运行期可即时翻转的窗口属性，重启会让宠物跳回配置角落；
 *   5. 写盘成功后广播 config 段（网页端/设置页据此重拉 /config）。
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { setPetClickThrough } from './click-through.ts';
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
  display: 'desktop',
  position: { corner: 'top-right', marginX: 10, marginY: 10 },
  ...over,
});

interface Harness {
  readonly deps: PetRouteDeps;
  readonly userFile: string;
  readonly restarts: () => number;
  readonly sections: () => string[];
}

let root = '';
let savedHome: string | undefined;

/** 造一套临时配置目录与最小依赖桩。 */
function makeHarness(): Harness {
  const userFile = join(root, 'main-config.jsonc');
  let restarts = 0;
  const sections: string[] = [];
  const deps = {
    configPaths: { defaultFile: DEFAULT_FILE, userFile, petDir: join(root, 'pet') },
    userConfigPath: userFile,
    userRoot: root,
    petConfigDir: join(root, 'pet'),
    state: {
      writeSection: (name: string) => {
        sections.push(name);
      },
    },
    lock: { release: () => {} },
    requestRestart: async () => {
      restarts += 1;
    },
  } as unknown as PetRouteDeps;
  return { deps, userFile, restarts: () => restarts, sections: () => sections };
}

/** 造一次请求（固定走 /pet-click-through）。 */
const input = (body: unknown, method = 'POST'): RouteInput => ({
  url: new URL('http://localhost/dsh-pet-7340/pet-click-through'),
  rest: 'pet-click-through',
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
  root = mkdtempSync(join(tmpdir(), 'dsh-pet-click-through-'));
  savedHome = process.env.DSH_HOME;
  process.env.DSH_HOME = join(root, 'home');
});

after(() => {
  if (savedHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedHome;
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('setPetClickThrough —— 单宠鼠标穿透', () => {
  test('开：写入 clickThrough，其余字段与其它宠物原样保留，且不重启 Helper', async () => {
    const h = makeHarness();
    writeFileSync(
      h.userFile,
      JSON.stringify({ pets: [pet({ renderer: 'layered' }), pet({ id: 'main2', name: '二号' })] }),
      'utf8',
    );
    const res = jsonOf(await setPetClickThrough(h.deps, input({ id: 'main1', value: true })));
    assert.equal(res.status, 200);
    const saved = savedPet(h.userFile);
    assert.equal(saved.clickThrough, true);
    assert.equal(saved.renderer, 'layered', '其它字段不受影响');
    assert.equal(saved.size, 462, '基准 size 不受影响');
    const conf = JSON.parse(readFileSync(h.userFile, 'utf8')) as { pets: unknown[] };
    assert.equal(conf.pets.length, 2, '其它宠物原样保留');
    const main = (res.obj.main ?? {}) as { pets?: unknown[] };
    assert.equal(main.pets?.length, 2, '成品聚合一并回传');
    assert.equal(h.restarts(), 0, '穿透是运行期属性：不得重启桌面 Helper（否则宠物跳回角落）');
    assert.deepEqual(h.sections(), ['config'], '写盘成功后要广播 config 段');
  });

  test('关：删掉该键，不留 clickThrough: false', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet({ clickThrough: true })] }), 'utf8');
    await setPetClickThrough(h.deps, input({ id: 'main1', value: false }));
    assert.equal('clickThrough' in savedPet(h.userFile), false);
  });

  test('非布尔 value / 未知宠物 / 缺 id：200 + 失败实体，文件不动', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet()] }), 'utf8');
    const before = readFileSync(h.userFile, 'utf8');
    const cases = [
      { id: 'main1' },
      { id: 'main1', value: 'true' },
      { id: 'main1', value: 1 },
      { id: 'main1', value: null },
      { id: 'nope', value: true },
      { value: true },
    ];
    for (const body of cases) {
      const res = jsonOf(await setPetClickThrough(h.deps, input(body)));
      assert.equal(res.status, 200);
      assert.equal(res.obj.ok, false, JSON.stringify(body) + ' 应被拒');
    }
    assert.equal(readFileSync(h.userFile, 'utf8'), before, '失败不写盘');
  });

  test('坏 JSON → 400（协议层面，不是业务结论）', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet()] }), 'utf8');
    assert.equal(jsonOf(await setPetClickThrough(h.deps, input('{ 坏'))).status, 400);
  });

  test('GET → 405', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet()] }), 'utf8');
    assert.equal(jsonOf(await setPetClickThrough(h.deps, input(undefined, 'GET'))).status, 405);
  });
});
