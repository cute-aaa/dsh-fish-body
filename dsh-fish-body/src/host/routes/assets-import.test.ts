/**
 * `/assets/import` 路由协议：请求体、固定目录和错误映射。
 * @module dsh-fish-body/src/host/routes/assets-import.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleAssetsImportRoutes } from './assets-import.ts';
import { userPaths } from '../user-layout.ts';

function depsFor(root: string) {
  return {
    userRoot: root,
    paths: userPaths(root),
    soundDirsFor: () => ({ packageSoundDir: join(root, 'package-sound'), animationDirs: [] }),
    requirePet: () => {
      throw new Error('本用例只测不需要宠物的类别');
    },
    log: { info: () => undefined },
  } as never;
}

function input(body?: string) {
  return { url: new URL('http://127.0.0.1/dsh-pet-7340/assets/import'), rest: 'assets/import', method: 'POST', body };
}

describe('/assets/import', () => {
  test('会话鱼导入落到临时数据根', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fish-assets-route-'));
    try {
      const source = join(root, 'fish.png');
      writeFileSync(source, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const result = await handleAssetsImportRoutes(
        depsFor(root),
        input(JSON.stringify({ kind: 'session-fish', sourcePath: source })),
      );
      assert.equal(result?.kind, 'json');
      if (result?.kind === 'json') {
        assert.equal(result.status, 200);
        assert.equal((result.obj as { ok?: boolean }).ok, true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('非法 JSON → 400；未知请求形状 → 200 + ok:false', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fish-assets-route-bad-'));
    try {
      const bad = await handleAssetsImportRoutes(depsFor(root), input('{'));
      assert.equal(bad?.kind, 'json');
      if (bad?.kind === 'json') assert.equal(bad.status, 400);
      const shape = await handleAssetsImportRoutes(depsFor(root), input(JSON.stringify({ kind: 'nope' })));
      assert.equal(shape?.kind, 'json');
      if (shape?.kind === 'json') {
        assert.equal(shape.status, 200);
        assert.equal((shape.obj as { ok?: boolean }).ok, false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
