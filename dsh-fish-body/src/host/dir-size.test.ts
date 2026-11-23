import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dirSize } from './move-tree.ts';

describe('dirSize', () => {
  test('数出文件数与字节数（与搬迁统计同一套规则）', () => {
    const base = mkdtempSync(join(tmpdir(), 'fish-body-size-'));
    try {
      mkdirSync(join(base, 'config'), { recursive: true });
      writeFileSync(join(base, 'config', 'main-config.jsonc'), 'x'.repeat(64), 'utf8');
      writeFileSync(join(base, 'logs.txt'), 'z', 'utf8');
      assert.deepEqual(dirSize(base), { files: 2, bytes: 65 });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('目录不存在时回 0（还没建是正常状态，不是错误）', () => {
    assert.deepEqual(dirSize(join(tmpdir(), 'fish-body-does-not-exist-xyz')), { files: 0, bytes: 0 });
  });

  test('空目录回 0', () => {
    const base = mkdtempSync(join(tmpdir(), 'fish-body-size-empty-'));
    try {
      assert.deepEqual(dirSize(base), { files: 0, bytes: 0 });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
