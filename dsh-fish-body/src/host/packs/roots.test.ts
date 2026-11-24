/**
 * 扩展根链的测试：优先级、平铺与子目录两种包布局、路径穿越、缺依赖时的退化。
 * @module dsh-fish-body/src/host/packs/roots.test
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { extraAssetRoots, resolveExtraAsset } from './roots.ts';
import { writeInstalled } from './state.ts';

/** 建临时数据根，返回各处路径。 */
function env() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-packs-roots-'));
  const userRoot = join(root, 'fish-body');
  const packsRoot = join(userRoot, 'packs');
  mkdirSync(packsRoot, { recursive: true });
  return { root, userRoot, packsRoot, deps: { userRoot, packsRoot } };
}

/** 装一个「已安装」的包，并在包目录里写一个文件。 */
function installPack(packsRoot: string, id: string, relFile: string): void {
  const dir = join(packsRoot, id);
  mkdirSync(dirname(join(dir, relFile)), { recursive: true });
  writeFileSync(join(dir, relFile), 'x');
  writeInstalled(dir, { id, sha256: 'b'.repeat(64), bytes: 1, files: 1, at: '2026-11-24T00:00:00.000Z' });
}

test('用户目录优先于资源包', () => {
  const e = env();
  mkdirSync(join(e.userRoot, 'fonts'), { recursive: true });
  writeFileSync(join(e.userRoot, 'fonts', 'a.ttf'), 'user');
  installPack(e.packsRoot, 'fonts-x', 'fonts/a.ttf');

  const hit = resolveExtraAsset(e.deps, 'fonts', 'a.ttf');
  assert.equal(hit, join(e.userRoot, 'fonts', 'a.ttf'));
});

test('包内两种布局都能命中（带子目录 / 平铺）', () => {
  const e = env();
  installPack(e.packsRoot, 'fonts-nested', 'fonts/nested.ttf');
  installPack(e.packsRoot, 'fonts-flat', 'flat.ttf');

  assert.equal(
    resolveExtraAsset(e.deps, 'fonts', 'nested.ttf'),
    join(e.packsRoot, 'fonts-nested', 'fonts', 'nested.ttf'),
  );
  assert.equal(resolveExtraAsset(e.deps, 'fonts', 'flat.ttf'), join(e.packsRoot, 'fonts-flat', 'flat.ttf'));
});

test('半装目录（没有 installed.json）不参与链', () => {
  const e = env();
  const dir = join(e.packsRoot, 'fonts-half');
  mkdirSync(join(dir, 'fonts'), { recursive: true });
  writeFileSync(join(dir, 'fonts', 'half.ttf'), 'x');

  assert.equal(
    extraAssetRoots(e.deps, 'fonts').some((p) => p.includes('fonts-half')),
    false,
  );
  assert.equal(resolveExtraAsset(e.deps, 'fonts', 'half.ttf'), undefined);
});

test('路径穿越一律不命中', () => {
  const e = env();
  mkdirSync(join(e.userRoot, 'fonts'), { recursive: true });
  writeFileSync(join(e.userRoot, 'secret.txt'), 'x');
  assert.equal(resolveExtraAsset(e.deps, 'fonts', '../secret.txt'), undefined);
  assert.equal(resolveExtraAsset(e.deps, 'fonts', ''), undefined);
});

test('缺 userRoot / packsRoot 时退化成空链，不抛异常', () => {
  assert.deepEqual(extraAssetRoots({}, 'fonts'), []);
  assert.equal(resolveExtraAsset({ userRoot: '' }, 'fonts', 'a.ttf'), undefined);
  assert.equal(resolveExtraAsset({}, 'cubism', 'live2dcubismcore.min.js'), undefined);
});
