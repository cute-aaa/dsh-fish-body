/**
 * 素材导入契约：目录/文件落位、冲突、覆盖、类型与路径拒绝。
 * @module dsh-fish-body/src/host/assets-import/import.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { importAsset, type AssetImportContext } from './import.ts';

function context(): { root: string; ctx: AssetImportContext } {
  const root = mkdtempSync(join(tmpdir(), 'fish-assets-import-'));
  const ctx: AssetImportContext = {
    userRoot: root,
    skinsDir: join(root, 'skin'),
    sessionFishDir: join(root, 'assets', 'session-fish'),
    sharedSoundDir: join(root, 'assets', 'sound'),
    soundDirsFor: () => ({
      packageSoundDir: join(root, 'package-sound'),
      animationDirs: [],
    }),
  };
  return { root, ctx };
}

function writeSkin(root: string, renderer: 'layered' | 'live2d'): string {
  const dir = join(root, 'source-' + renderer);
  mkdirSync(join(dir, 'art'), { recursive: true });
  writeFileSync(join(dir, 'art', 'body.png'), Buffer.from([1, 2, 3]));
  writeFileSync(
    join(dir, renderer === 'layered' ? 'manifest.json' : 'demo.model3.json'),
    renderer === 'layered' ? '{"layers":[]}' : '{"Version":3}',
    'utf8',
  );
  return dir;
}

describe('asset import', () => {
  test('layered 目录导入到用户皮肤目录，冲突默认不覆盖', () => {
    const { root, ctx } = context();
    try {
      const source = writeSkin(root, 'layered');
      const first = importAsset({ kind: 'skin', renderer: 'layered', sourcePath: source }, ctx);
      assert.equal(first.ok, true);
      if (first.ok) assert.equal(first.imported.files, 2);
      const second = importAsset({ kind: 'skin', renderer: 'layered', sourcePath: source }, ctx);
      assert.equal(second.ok, false);
      if (!second.ok) assert.equal(second.reason, 'import-conflict');
      const overwrite = importAsset({ kind: 'skin', renderer: 'layered', sourcePath: source, overwrite: true }, ctx);
      assert.equal(overwrite.ok, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('live2d 目录缺少 model3 → 拒绝；webm 文件导入成功', () => {
    const { root, ctx } = context();
    try {
      const empty = join(root, 'empty');
      mkdirSync(empty, { recursive: true });
      const rejected = importAsset({ kind: 'skin', renderer: 'live2d', sourcePath: empty }, ctx);
      assert.equal(rejected.ok, false);
      const webm = join(root, 'idle.webm');
      writeFileSync(webm, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      const imported = importAsset({ kind: 'skin', renderer: 'webm', sourcePath: webm }, ctx);
      assert.equal(imported.ok, true);
      if (imported.ok) assert.match(imported.imported.path, /skin[\\/]webm[\\/]idle\.webm$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('音效与会话鱼按固定目录落位；非法扩展名拒绝', () => {
    const { root, ctx } = context();
    try {
      const wav = join(root, 'click.wav');
      writeFileSync(wav, Buffer.from('RIFFxxxxWAVE'));
      assert.equal(importAsset({ kind: 'sfx', sourcePath: wav, target: 'shared' }, ctx).ok, true);
      assert.equal(importAsset({ kind: 'sfx', sourcePath: wav, target: 'hook', hook: 'hello' }, ctx).ok, true);
      const png = join(root, 'fish.png');
      writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      assert.equal(importAsset({ kind: 'session-fish', sourcePath: png }, ctx).ok, true);
      const text = join(root, 'x.txt');
      writeFileSync(text, 'no', 'utf8');
      const rejected = importAsset({ kind: 'sfx', sourcePath: text, target: 'shared' }, ctx);
      assert.equal(rejected.ok, false);
      if (!rejected.ok) assert.equal(rejected.reason, 'import-unsupported');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('相对源路径与不存在的源路径都拒绝', () => {
    const { root, ctx } = context();
    try {
      const relative = importAsset({ kind: 'sfx', sourcePath: 'x.wav', target: 'shared' }, ctx);
      assert.equal(relative.ok ? '' : relative.reason, 'bad-request');
      const missing = importAsset({ kind: 'sfx', sourcePath: join(root, 'nope.wav'), target: 'shared' }, ctx);
      assert.equal(missing.ok ? '' : missing.reason, 'bad-request');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
