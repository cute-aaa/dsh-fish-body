/**
 * 安装编排的测试：三种来源 + 四类失败面。
 *
 * 全部离线——`fetchImpl` 与 `extractZip` 都是注入的假实现；真实 zip 与网络不进单测。
 * 重点验四件事：sha 不符**立即中止**（不静默换源）、体积不符才换镜像、
 * 失败不留残余（临时目录 + 半装目录）、0 文件不当成装好。
 * @module dsh-fish-body/src/host/packs/install.test
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { PackEntry } from '../../shared/packs.ts';
import { installFromDir, installFromUrls, installFromZip, type PackInstallDeps } from './install.ts';
import { packDirOf, packsRootOf, readInstalled } from './state.ts';

const BYTES = Buffer.from('fake-zip-bytes');
const SHA = createHash('sha256').update(BYTES).digest('hex');

/** 一个形状合法的清单条目。 */
const ENTRY: PackEntry = {
  id: 'fonts-rouhei',
  kind: 'fonts',
  label: '思源柔黑',
  license: 'OFL-1.1',
  bytes: BYTES.byteLength,
  sha256: SHA,
  urls: ['https://example.com/a.zip'],
  files: 2,
};

/** 建临时数据根并给出依赖；`files` 是假解压要写出的文件。 */
function setup(files = ['a.ttf', 'b.ttf']) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-packs-install-'));
  const packsRoot = packsRootOf(root);
  const logs: string[] = [];
  const extractZip = async (_zip: string, dest: string): Promise<void> => {
    for (const name of files) writeFileSync(join(dest, name), 'x');
  };
  const deps: PackInstallDeps = { packsRoot, extractZip, log: (m) => logs.push(m) };
  return { root, packsRoot, deps, logs, extractZip };
}

/** 返回固定字节的 fetch 假实现，并记录被请求过的地址。 */
function fetchReturning(bytes: Buffer, status = 200) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(bytes, { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test('下载安装成功：标记写入、临时目录清理、文件数按实际统计', async () => {
  const { packsRoot, deps, extractZip } = setup();
  const { impl } = fetchReturning(BYTES);
  const result = await installFromUrls(ENTRY, { ...deps, fetchImpl: impl, extractZip });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.installed.files, 2);
  assert.equal(result.installed.sha256, SHA);
  const dir = packDirOf(packsRoot, ENTRY.id);
  assert.equal(existsSync(dir), true);
  assert.deepEqual(readInstalled(packsRoot, ENTRY.id)?.files, 2);
  assert.equal(readdirSync(packsRoot).filter((n) => n.startsWith('.tmp-')).length, 0, '临时目录必须清掉');
});

test('体积不符 → 换下一个镜像（截断是最常见的失败）', async () => {
  const { packsRoot, deps, extractZip } = setup();
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('mirror-broken')) return new Response(Buffer.from('short'), { status: 200 });
    return new Response(BYTES, { status: 200 });
  }) as unknown as typeof fetch;
  const result = await installFromUrls(
    { ...ENTRY, urls: ['https://example.com/mirror-broken.zip', 'https://example.com/mirror-ok.zip'] },
    { ...deps, fetchImpl: impl, extractZip },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(readInstalled(packsRoot, ENTRY.id)?.sha256, SHA);
});

test('sha256 不符 → 立即中止，不尝试其它镜像（防静默换源）', async () => {
  const { packsRoot, deps, extractZip } = setup();
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    // 体积对得上、内容被换过：正是中间人换包的样子
    return new Response(Buffer.from('fake-zip-bytez'), { status: 200 });
  }) as unknown as typeof fetch;
  const result = await installFromUrls(
    { ...ENTRY, urls: ['https://a.example/x.zip', 'https://b.example/x.zip'] },
    { ...deps, fetchImpl: impl, extractZip },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'checksum-mismatch');
  assert.equal(calls.length, 1, '只应请求第一个地址');
  assert.equal(existsSync(packDirOf(packsRoot, ENTRY.id)), false);
});

test('全部镜像都失败 → download-failed，且不留半装目录', async () => {
  const { packsRoot, deps, extractZip } = setup();
  const { impl } = fetchReturning(Buffer.alloc(0), 500);
  const result = await installFromUrls(
    { ...ENTRY, urls: ['https://a.example/x.zip'] },
    { ...deps, fetchImpl: impl, extractZip },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'download-failed');
  assert.equal(existsSync(packDirOf(packsRoot, ENTRY.id)), false);
  // 全部失败时连资源根都不该被建出来；建了就必须没有临时目录残留。
  assert.equal(existsSync(packsRoot) ? readdirSync(packsRoot).filter((n) => n.startsWith('.tmp-')).length : 0, 0);
});

test('解压失败 → extract-failed，半装目录不落盘', async () => {
  const { packsRoot, deps } = setup();
  const { impl } = fetchReturning(BYTES);
  const extractZip = async (): Promise<void> => {
    throw new Error('bad zip');
  };
  const result = await installFromUrls(ENTRY, { ...deps, fetchImpl: impl, extractZip });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'extract-failed');
  assert.equal(existsSync(packDirOf(packsRoot, ENTRY.id)), false);
});

test('包内 0 文件 → empty-pack（不能当成装好）', async () => {
  const { packsRoot, deps, extractZip } = setup([]);
  const { impl } = fetchReturning(BYTES);
  const result = await installFromUrls(ENTRY, { ...deps, fetchImpl: impl, extractZip });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'empty-pack');
  assert.equal(existsSync(packDirOf(packsRoot, ENTRY.id)), false);
});

test('本地 zip 导入：sha 取实际值并记录', async () => {
  const { root, packsRoot, deps, extractZip } = setup(['x.ttf']);
  const zip = join(root, 'local.zip');
  writeFileSync(zip, BYTES);
  const result = await installFromZip('fonts-local', zip, { ...deps, extractZip });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.installed.sha256, SHA);
  assert.equal(result.installed.bytes, BYTES.byteLength);
  assert.equal(readInstalled(packsRoot, 'fonts-local')?.files, 1);
});

test('本地目录导入：整棵复制、文件数正确', async () => {
  const { root, packsRoot, deps } = setup();
  const src = join(root, 'src-pack');
  mkdirSync(join(src, 'sub'), { recursive: true });
  writeFileSync(join(src, 'a.ttf'), '1');
  writeFileSync(join(src, 'sub', 'b.ttf'), '2');
  const result = await installFromDir('fonts-from-dir', src, deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.installed.files, 2);
  assert.equal(existsSync(join(packDirOf(packsRoot, 'fonts-from-dir'), 'sub', 'b.ttf')), true);
});

test('空的源目录 → empty-pack，不产生包目录', async () => {
  const { root, packsRoot, deps } = setup();
  const src = join(root, 'empty');
  mkdirSync(src, { recursive: true });
  const result = await installFromDir('fonts-empty', src, deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'empty-pack');
  assert.equal(existsSync(packDirOf(packsRoot, 'fonts-empty')), false);
});

test('重装覆盖旧内容（同一 id 换了包）', async () => {
  const { packsRoot, deps, extractZip } = setup(['one.ttf']);
  const { impl } = fetchReturning(BYTES);
  const first = await installFromUrls(ENTRY, { ...deps, fetchImpl: impl, extractZip });
  assert.equal(first.ok, true);
  const second = await installFromUrls(ENTRY, {
    ...deps,
    fetchImpl: impl,
    extractZip: async (_z, dest) => writeFileSync(join(dest, 'new.ttf'), 'x'),
  });
  assert.equal(second.ok, true);
  const files = readdirSync(packDirOf(packsRoot, ENTRY.id)).sort();
  assert.deepEqual(files, ['installed.json', 'new.ttf']);
});

test('非法包 id 一律拒绝（不让它变成目录名）', async () => {
  const { deps } = setup();
  const bad = await installFromUrls({ ...ENTRY, id: '../x' }, deps);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, 'bad-source');
  const badDir = await installFromDir('Bad', '.', deps);
  assert.equal(badDir.ok, false);
});
