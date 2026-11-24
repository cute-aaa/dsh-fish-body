/**
 * 资源包路由的测试：清单读取容错、安装三入口、删除、方法/请求体校验。
 *
 * 用临时目录当数据根与清单路径（`packManifestPath` 由 deps 注入，路由不自己拼路径），
 * 因此不依赖包内真实清单，也不会碰用户的 `<数据根>/packs`。
 * @module dsh-fish-body/src/host/routes/packs.test
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { handlePacksRoutes } from './packs.ts';
import type { PetRouteDeps } from './types.ts';
import type { RouteResult } from '../http.ts';

const SHA = 'a'.repeat(64);

/** 造一个临时环境：数据根、资源根、清单文件路径。 */
function env() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-packs-route-'));
  return { root, packsRoot: join(root, 'packs'), manifest: join(root, 'packs.json') };
}

/** 路由依赖桩：只提供本路由真正用到的三个字段。 */
function depsOf(e: ReturnType<typeof env>): PetRouteDeps {
  const noop = (): void => undefined;
  return {
    packsRoot: e.packsRoot,
    packManifestPath: e.manifest,
    log: { info: noop, warn: noop, error: noop, debug: noop },
  } as unknown as PetRouteDeps;
}

/** 调一次路由，返回 JSON 实体。 */
async function call(
  e: ReturnType<typeof env>,
  rest: string,
  method = 'GET',
  body?: string,
): Promise<RouteResult | undefined> {
  return handlePacksRoutes(depsOf(e), { url: new URL(`http://127.0.0.1/dsh-pet-7340/${rest}`), rest, method, body });
}

/** 断言是 JSON 应答并取出实体。 */
function entity(result: RouteResult | undefined): Record<string, unknown> {
  return asJson(result).obj;
}

/** 断言是 JSON 应答，返回带状态码的视图（RouteResult 是联合类型，状态码只在 json 分支上）。 */
function asJson(result: RouteResult | undefined): { status?: number; obj: Record<string, unknown> } {
  assert.ok(result, '路由必须给出应答');
  assert.equal(result.kind, 'json');
  return result as unknown as { status?: number; obj: Record<string, unknown> };
}

/** 写一份只含一个包的清单。 */
function writeManifest(e: ReturnType<typeof env>, sha = SHA): void {
  writeFileSync(
    e.manifest,
    JSON.stringify({
      schema: 1,
      packs: [
        {
          id: 'fonts-rouhei',
          kind: 'fonts',
          label: '思源柔黑',
          license: 'OFL-1.1',
          bytes: 10,
          sha256: sha,
          urls: ['https://example.com/fonts.zip'],
          files: 1,
        },
      ],
    }),
  );
}

test('清单文件缺失 → 空清单（首次发布还没素材包是正常状态）', async () => {
  const e = env();
  const body = entity(await call(e, 'packs'));
  assert.equal(body.ok, true);
  assert.deepEqual(body.packs, []);
});

test('清单写坏 → internal-error 且带原因（不假装没有）', async () => {
  const e = env();
  writeFileSync(e.manifest, '{ broken');
  const body = entity(await call(e, 'packs'));
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'internal-error');
  assert.match(String(body.message), /invalid-json/);
});

test('未安装时 installed 为 null；目录导入后 installed 有值且 upToDate 为 false（sha 对不上）', async () => {
  const e = env();
  writeManifest(e);
  const before = entity(await call(e, 'packs'));
  const first = (before.packs as Array<Record<string, unknown>>)[0];
  assert.equal(first.installed, null);
  assert.equal(first.upToDate, false);

  const src = join(e.root, 'src-pack');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'a.ttf'), 'x');
  const installed = entity(await call(e, 'packs/install', 'POST', JSON.stringify({ id: 'fonts-rouhei', dir: src })));
  assert.equal(installed.ok, true);

  const after = entity(await call(e, 'packs'));
  const entry = (after.packs as Array<Record<string, unknown>>)[0];
  const record = entry.installed as Record<string, unknown>;
  assert.equal(record.files, 1);
  assert.equal(entry.upToDate, false, '目录导入的指纹与清单 sha 不同，应报「已装但不是这一版」');
});

test('清单里没有该 id 且没给 zipPath/dir → pack-install-failed', async () => {
  const e = env();
  const body = entity(await call(e, 'packs/install', 'POST', JSON.stringify({ id: 'nope' })));
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'pack-install-failed');
  assert.match(String(body.message), /清单里没有/);
});

test('包 id 非法 → bad-request（它会被当成目录名）', async () => {
  const e = env();
  for (const id of ['../x', 'Bad', '']) {
    const body = entity(await call(e, 'packs/install', 'POST', JSON.stringify({ id })));
    assert.equal(body.ok, false, id);
    assert.equal(body.reason, 'bad-request');
  }
});

test('请求体不是 JSON 对象 → 400 且 reason 为 invalid-json', async () => {
  const e = env();
  for (const raw of ['', 'not json', '[]', '"x"']) {
    const view = asJson(await call(e, 'packs/install', 'POST', raw));
    assert.equal(view.status, 400, raw);
    assert.equal(view.obj.reason, 'invalid-json');
  }
});

test('删除：装过 → ok；再删 → not-found', async () => {
  const e = env();
  const src = join(e.root, 'src2');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'a.ttf'), 'x');
  assert.equal(entity(await call(e, 'packs/install', 'POST', JSON.stringify({ id: 'memes-tmp', dir: src }))).ok, true);

  const removed = entity(await call(e, 'packs/remove', 'POST', JSON.stringify({ id: 'memes-tmp' })));
  assert.equal(removed.ok, true);

  const again = entity(await call(e, 'packs/remove', 'POST', JSON.stringify({ id: 'memes-tmp' })));
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'not-found');
});

test('方法不对 → 405', async () => {
  const e = env();
  for (const [rest, method] of [
    ['packs', 'POST'],
    ['packs/install', 'GET'],
    ['packs/remove', 'GET'],
  ] as const) {
    const view = asJson(await call(e, rest, method));
    assert.equal(view.status, 405, `${method} ${rest}`);
  }
});

test('packs/* 未知子路径 → not-found（不落到素材兜底）', async () => {
  const e = env();
  const body = entity(await call(e, 'packs/whatever'));
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'not-found');
});

test('非 packs 路径一律不处理（返回 undefined，交给下一个处理器）', async () => {
  const e = env();
  assert.equal(await call(e, 'state'), undefined);
  assert.equal(await call(e, 'packsx'), undefined);
});
