/**
 * 外部记忆控制器：自定义目录、自动候选与切换时不把自己误判成占槽者。
 * @module dsh-fish-body/src/host/memory/controller.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryController } from './controller.ts';
import { memoryView } from './status.ts';

const silent = { info: () => undefined, warn: () => undefined };

describe('memory controller', () => {
  test('自定义目录有文件 → 接上；没有文件 → 明确为空且不回落', () => {
    const home = mkdtempSync(join(tmpdir(), 'fish-memory-home-'));
    const dir = mkdtempSync(join(tmpdir(), 'fish-memory-custom-'));
    const controller = createMemoryController({
      log: silent,
      dshHome: home,
      initial: { mode: 'custom', customDir: dir },
    });
    try {
      assert.equal(memoryView().provider, null);
      writeFileSync(join(dir, '2026-11-26.md'), 'remember me', 'utf8');
      assert.equal(controller.apply({ mode: 'custom', customDir: dir }).ok, true);
      assert.equal(memoryView().provider?.id, 'custom-memory');
    } finally {
      controller.dispose();
      rmSync(home, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('custom → auto 时先释放自己的 provider 再注册，不把自己判成占槽', () => {
    const home = mkdtempSync(join(tmpdir(), 'fish-memory-auto-'));
    const custom = mkdtempSync(join(tmpdir(), 'fish-memory-custom2-'));
    try {
      mkdirSync(join(home, 'dsh-rofm', 'memory'), { recursive: true });
      writeFileSync(join(home, 'dsh-rofm', 'memory', '2026-11-26.md'), 'auto memory', 'utf8');
      writeFileSync(join(custom, '2026-11-26.md'), 'custom memory', 'utf8');
      const controller = createMemoryController({
        log: silent,
        dshHome: home,
        initial: { mode: 'custom', customDir: custom },
      });
      try {
        assert.equal(memoryView().provider?.id, 'custom-memory');
        assert.deepEqual(controller.apply({ mode: 'auto', customDir: null }), {
          ok: true,
          providerId: 'dsh-rofm',
        });
        assert.equal(memoryView().slotTakenByOther, false);
        assert.equal(memoryView().provider?.id, 'dsh-rofm');
      } finally {
        controller.dispose();
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(custom, { recursive: true, force: true });
    }
  });

  test('custom 缺目录 → 拒绝，不改变当前接线', () => {
    const home = mkdtempSync(join(tmpdir(), 'fish-memory-invalid-'));
    const controller = createMemoryController({
      log: silent,
      dshHome: home,
      initial: { mode: 'auto', customDir: null },
    });
    try {
      const result = controller.apply({ mode: 'custom', customDir: null });
      assert.equal(result.ok, false);
    } finally {
      controller.dispose();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
