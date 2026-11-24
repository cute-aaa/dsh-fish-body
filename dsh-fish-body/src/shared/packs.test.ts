/**
 * 资源包清单契约的测试：只验「形状与拒绝口径」，不碰磁盘。
 *
 * 每个用例都对应一条真实故障面——清单写错、哈希写错、地址写成 http、
 * 空包被当成装好——这些如果放过，用户拿到的是「装上了但没效果」。
 * @module dsh-fish-body/src/shared/packs.test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidPackId, isSha256Hex, parsePackManifest } from './packs.ts';

/** 一个形状完全合法的包（各用例在此基础上改坏一处）。 */
const GOOD = {
  id: 'fonts-rouhei',
  kind: 'fonts',
  label: '思源柔黑',
  license: 'OFL-1.1',
  bytes: 1_500_000,
  sha256: 'a'.repeat(64),
  urls: ['https://github.com/cute-aaa/dsh-fish-body/releases/download/assets-v1/fonts-rouhei.zip'],
  files: 2,
};

const manifestOf = (packs: unknown[]) => JSON.stringify({ schema: 1, packs });

test('合法清单：解析通过并保留字段', () => {
  const result = parsePackManifest(manifestOf([GOOD]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.manifest.packs[0].kind, 'fonts');
  assert.equal(result.manifest.packs[0].license, 'OFL-1.1');
});

test('空清单是合法状态（尚未发布素材包）', () => {
  const result = parsePackManifest(manifestOf([]));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.manifest.packs.length, 0);
});

test('坏 JSON：报 invalid-json 而不是抛异常', () => {
  const result = parsePackManifest('{ not json');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'invalid-json');
});

test('schema 版本不对：拒绝，不猜测', () => {
  const result = parsePackManifest(JSON.stringify({ schema: 2, packs: [] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'invalid-shape');
});

test('包 id 非法（大写/斜杠/超长）：拒绝，因为它会变成目录名', () => {
  for (const id of ['Fonts', '../x', 'a'.repeat(33), '']) {
    const result = parsePackManifest(manifestOf([{ ...GOOD, id }]));
    assert.equal(result.ok, false, id);
  }
});

test('sha256 形状不对：拒绝（防止「随便填一个」蒙混过关）', () => {
  for (const sha256 of ['', 'abc', 'Z'.repeat(64), 'A'.repeat(64)]) {
    const result = parsePackManifest(manifestOf([{ ...GOOD, sha256 }]));
    assert.equal(result.ok, false, sha256);
  }
});

test('下载地址必须是 https：http 一律拒绝', () => {
  const result = parsePackManifest(manifestOf([{ ...GOOD, urls: ['http://example.com/a.zip'] }]));
  assert.equal(result.ok, false);
});

test('地址不能为空：没有来源的包不该进清单', () => {
  const result = parsePackManifest(manifestOf([{ ...GOOD, urls: [] }]));
  assert.equal(result.ok, false);
});

test('体积与文件数必须是正整数：0 字节包会被读成「装好但没内容」', () => {
  assert.equal(parsePackManifest(manifestOf([{ ...GOOD, bytes: 0 }])).ok, false);
  assert.equal(parsePackManifest(manifestOf([{ ...GOOD, files: 0 }])).ok, false);
});

test('种类必须是四类之一', () => {
  const result = parsePackManifest(manifestOf([{ ...GOOD, kind: 'videos' }]));
  assert.equal(result.ok, false);
});

test('id / sha 的独立判定函数与 schema 同口径', () => {
  assert.equal(isValidPackId('anims-extra'), true);
  assert.equal(isValidPackId('Anims'), false);
  assert.equal(isSha256Hex('b'.repeat(64)), true);
  assert.equal(isSha256Hex('b'.repeat(63)), false);
});
