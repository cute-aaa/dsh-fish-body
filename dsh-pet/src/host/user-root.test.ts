/**
 * 数据根选定与一次性换名（src/host/user-root.ts）的契约：
 * 只有旧根 → 换名成功；新旧都在 → 用新根且旧根不动；都没有 → 直接用新路径；
 * rename 失败 → 走复制分支（注入替身断言调用序列），复制也失败 → 继续用旧根工作。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LEGACY_ROOT_DIR_NAME, ROOT_DIR_NAME, resolveUserRoot, type RootFs } from './user-root.ts';

/** 每个用例一个独立的 `$DSH_HOME`，结束后清理。 */
function withDshHome(run: (dshHome: string) => void): void {
  const dshHome = mkdtempSync(join(tmpdir(), 'fish-body-root-'));
  try {
    run(dshHome);
  } finally {
    rmSync(dshHome, { recursive: true, force: true });
  }
}

/** 收集日志的替身。 */
function recorder(): { info: string[]; warn: string[]; log: { info(m: string): void; warn(m: string): void } } {
  const info: string[] = [];
  const warn: string[] = [];
  return { info, warn, log: { info: (m) => info.push(m), warn: (m) => warn.push(m) } };
}

describe('resolveUserRoot', () => {
  test('只有旧根：rename 成功，旧根不再存在', () => {
    withDshHome((dshHome) => {
      const legacy = join(dshHome, LEGACY_ROOT_DIR_NAME);
      mkdirSync(join(legacy, 'pet'), { recursive: true });
      writeFileSync(join(legacy, 'main-config.jsonc'), '{"pets":[]}', 'utf8');

      const result = resolveUserRoot({ dshHome });

      assert.equal(result.root, join(dshHome, ROOT_DIR_NAME));
      assert.equal(result.legacyRoot, legacy);
      assert.equal(result.renamed, true);
      assert.equal(result.copied, false);
      assert.equal(result.legacyLeftBehind, false);
      assert.equal(existsSync(legacy), false, '同盘 rename 之后旧根应当消失');
      // 内容一字不动地到了新根下
      assert.equal(readFileSync(join(result.root, 'main-config.jsonc'), 'utf8'), '{"pets":[]}');
    });
  });

  test('新旧都在：用新根，旧根一个字节都不动（不猜谁是权威、也不合并）', () => {
    withDshHome((dshHome) => {
      const legacy = join(dshHome, LEGACY_ROOT_DIR_NAME);
      const next = join(dshHome, ROOT_DIR_NAME);
      mkdirSync(legacy, { recursive: true });
      mkdirSync(next, { recursive: true });
      writeFileSync(join(legacy, 'main-config.jsonc'), '{"from":"legacy"}', 'utf8');
      writeFileSync(join(next, 'main-config.jsonc'), '{"from":"new"}', 'utf8');
      const r = recorder();

      const result = resolveUserRoot({ dshHome, log: r.log });

      assert.equal(result.root, next);
      assert.equal(result.renamed, false);
      assert.equal(result.copied, false);
      assert.equal(result.legacyLeftBehind, true);
      assert.equal(readFileSync(join(legacy, 'main-config.jsonc'), 'utf8'), '{"from":"legacy"}');
      assert.equal(readFileSync(join(next, 'main-config.jsonc'), 'utf8'), '{"from":"new"}');
      assert.ok(
        r.warn.some((m) => m.includes('同时存在')),
        '两个根都在时必须留一条告警，否则用户永远不知道旧根还在',
      );
    });
  });

  test('两个根都没有：直接用新路径，不做任何迁移', () => {
    withDshHome((dshHome) => {
      const result = resolveUserRoot({ dshHome });
      assert.equal(result.root, join(dshHome, ROOT_DIR_NAME));
      assert.equal(result.renamed, false);
      assert.equal(result.copied, false);
      assert.equal(result.legacyLeftBehind, false);
      assert.equal(result.error, undefined);
    });
  });

  test('rename 抛错 → 改走复制，旧根保留（注入替身断言调用序列）', () => {
    const dshHome = join('C:', 'dsh');
    const root = join(dshHome, ROOT_DIR_NAME);
    const legacyRoot = join(dshHome, LEGACY_ROOT_DIR_NAME);
    const calls: string[] = [];
    const fs: RootFs = {
      existsSync: (path) => {
        calls.push('exists:' + path);
        return path === legacyRoot;
      },
      renameSync: (from, to) => {
        calls.push('rename:' + from + '->' + to);
        throw new Error('EXDEV: cross-device link not permitted');
      },
      cpSync: (from, to, options) =>
        calls.push(
          'cp:' +
            from +
            '->' +
            to +
            ':recursive=' +
            String(options.recursive) +
            ':force=' +
            String(options.force) +
            ':errorOnExist=' +
            String(options.errorOnExist),
        ),
    };
    const r = recorder();

    const result = resolveUserRoot({ dshHome, fs, log: r.log });

    assert.deepEqual(calls, [
      'exists:' + root,
      'exists:' + legacyRoot,
      // 换名重试一次（Windows 上刚退出的进程常把目录句柄占一拍），两次都失败才复制
      'rename:' + legacyRoot + '->' + root,
      'rename:' + legacyRoot + '->' + root,
      'cp:' + legacyRoot + '->' + root + ':recursive=true:force=true:errorOnExist=false',
    ]);
    assert.equal(result.root, root);
    assert.equal(result.renamed, false);
    assert.equal(result.copied, true);
    assert.equal(result.legacyLeftBehind, true);
    assert.ok(r.warn.some((m) => m.includes('换名失败')));
    assert.ok(r.warn.some((m) => m.includes('旧根') && m.includes('保留')));
  });

  test('复制也失败 → 继续在旧根上工作，错误原因原样带回', () => {
    const dshHome = join('C:', 'dsh');
    const legacyRoot = join(dshHome, LEGACY_ROOT_DIR_NAME);
    const fs: RootFs = {
      existsSync: (path) => path === legacyRoot,
      renameSync: () => {
        throw new Error('EPERM');
      },
      cpSync: () => {
        throw new Error('ENOSPC');
      },
    };
    const r = recorder();

    const result = resolveUserRoot({ dshHome, fs, log: r.log });

    assert.equal(result.root, legacyRoot, '退无可退时继续用旧根：配置与记忆一个字节都没动');
    assert.equal(result.renamed, false);
    assert.equal(result.copied, false);
    assert.equal(result.legacyLeftBehind, false);
    assert.equal(result.error, 'ENOSPC');
    assert.ok(r.warn.some((m) => m.includes('复制也失败')));
  });
});
