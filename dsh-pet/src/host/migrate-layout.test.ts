/**
 * 内层布局迁移（src/host/migrate-layout.ts）的契约：
 * 旧平铺目录搬进 `config/ data/ cache/ runtime/ pets/ assets/`、目标已存在就跳过源、
 * 幂等（第二次什么都不搬）、回执 `.layout.json` 可被 readReceipt 读回；
 * 另外钉住「数据根之外的 Electron 运行时」那一条搬迁。
 * 用真实临时目录：这份代码的价值就在真实的重命名/复制行为。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { layoutMoves, migrateElectronRuntime, migrateLayout, readReceipt, RECEIPT_FILE } from './migrate-layout.ts';

/** 一个隔离的数据根。 */
function tempRoot(prefix = 'fish-body-migrate-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** 在 root 下造一个带文件的目录。 */
function seedDir(root: string, rel: string, file: string, text: string): void {
  mkdirSync(join(root, rel), { recursive: true });
  writeFileSync(join(root, rel, file), text, 'utf8');
}

describe('migrateLayout —— 两个根并存（旧根已经整理成新布局）', () => {
  test('按同名分组从旧根搬进新根，不再去新根里找源', () => {
    const root = tempRoot('fish-body-both-');
    const legacy = tempRoot('fish-body-both-legacy-');
    try {
      seedDir(legacy, 'config', 'main-config.jsonc', '{"pets":[]}');
      seedDir(legacy, 'data', 'memory.json', '{}');
      seedDir(legacy, 'assets/skin/layered', 'manifest.json', '{}');
      // 新根已经有 logs.txt：整组搬迁不该因为它「源与目标同路径」而刷 occupied，
      // 也不该去新根里找 logs.txt 当源（legacyOnly）。
      writeFileSync(join(root, 'logs.txt'), 'new log', 'utf8');

      const result = migrateLayout({ root, legacyRoot: legacy });

      const froms = result.moved.map((move) => move.from);
      assert.ok(froms.includes('config'), '应当从旧根搬入 config，实际：' + froms.join(','));
      assert.ok(froms.includes('data'));
      assert.ok(froms.includes('assets'));
      assert.equal(readFileSync(join(root, 'config', 'main-config.jsonc'), 'utf8'), '{"pets":[]}');
      // 新根的日志一个字节都没动。
      assert.equal(readFileSync(join(root, 'logs.txt'), 'utf8'), 'new log');
      // 旧根没有 logs.txt → 记 missing，而不是 occupied。
      assert.equal(result.skipped.find((item) => item.move.from === 'logs.txt')?.reason, 'missing');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(legacy, { recursive: true, force: true });
    }
  });
});

describe('migrateLayout', () => {
  test('动画 / 宠物 / 语音缓存 / 主配置各搬到新位置，源目录消失', () => {
    const root = tempRoot();
    try {
      seedDir(root, 'main-animation', 'wave.webm', 'webm');
      seedDir(root, 'pet', 'cat-config.json', '{"pets":[]}');
      seedDir(root, 'voice-cache', 'a.mp3', 'mp3');
      writeFileSync(join(root, 'main-config.jsonc'), '{"pets":[]}', 'utf8');

      const result = migrateLayout({ root });

      const froms = result.moved.map((move) => move.from);
      for (const from of ['main-animation', 'pet', 'voice-cache', 'main-config.jsonc']) {
        assert.ok(froms.includes(from), '应当搬走 ' + from + '，实际：' + froms.join(','));
      }
      assert.deepEqual(result.failed, []);

      assert.equal(readFileSync(join(root, 'assets', 'animation', 'wave.webm'), 'utf8'), 'webm');
      assert.equal(readFileSync(join(root, 'pets', 'cat-config.json'), 'utf8'), '{"pets":[]}');
      assert.equal(readFileSync(join(root, 'cache', 'voice', 'a.mp3'), 'utf8'), 'mp3');
      assert.equal(readFileSync(join(root, 'config', 'main-config.jsonc'), 'utf8'), '{"pets":[]}');

      assert.equal(existsSync(join(root, 'main-animation')), false, '搬完源目录不该还在');
      assert.equal(existsSync(join(root, 'pet')), false);
      assert.equal(existsSync(join(root, 'voice-cache')), false);
      assert.equal(existsSync(join(root, 'main-config.jsonc')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('回执写在数据根下，内容与本次真的搬过的条目一致', () => {
    const root = tempRoot();
    try {
      seedDir(root, 'pet', 'cat-config.json', '{}');
      const result = migrateLayout({ root });

      const receiptFile = join(root, RECEIPT_FILE);
      assert.equal(existsSync(receiptFile), true, '回执是 --revert 的唯一依据，必须落盘');
      const receipt = readReceipt(root);
      assert.ok(receipt, '回执必须能被 readReceipt 读回');
      assert.equal(receipt.schema, 1);
      assert.deepEqual(receipt.moves, result.moved);
      assert.equal(typeof receipt.at, 'string');
      assert.ok(!Number.isNaN(Date.parse(receipt.at)), '时间戳要是可解析的 ISO 串');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('第二次跑幂等：什么都不搬，全是「源不存在」', () => {
    const root = tempRoot();
    try {
      seedDir(root, 'main-animation', 'wave.webm', 'webm');
      seedDir(root, 'pet', 'cat-config.json', '{}');
      migrateLayout({ root });

      const second = migrateLayout({ root });

      assert.deepEqual(second.moved, []);
      assert.deepEqual(second.failed, []);
      assert.ok(second.skipped.every((item) => item.reason === 'missing'));
      // 第二次没有搬过东西，就不该重新写一份回执（写盘是可观测副作用）
      const receipt = readReceipt(root);
      assert.ok(receipt);
      assert.equal(receipt.moves.length > 0, true, '回执仍是从第一次迁移留下的那一份');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('目标已存在：跳过源，两边都不动（不合并、不覆盖）', () => {
    const root = tempRoot();
    try {
      seedDir(root, 'pet', 'keep.txt', 'old');
      seedDir(root, 'pets', 'keep.txt', 'new');

      const result = migrateLayout({ root });

      const occupied = result.skipped.find((item) => item.move.from === 'pet');
      assert.ok(occupied, 'pet → pets 应当出现在 skipped 里');
      assert.equal(occupied.reason, 'occupied');
      assert.equal(readFileSync(join(root, 'pet', 'keep.txt'), 'utf8'), 'old');
      assert.equal(readFileSync(join(root, 'pets', 'keep.txt'), 'utf8'), 'new');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('dryRun：只算清单不动盘，也不写回执', () => {
    const root = tempRoot();
    try {
      seedDir(root, 'main-animation', 'wave.webm', 'webm');
      const result = migrateLayout({ root, dryRun: true });

      assert.ok(result.moved.some((move) => move.from === 'main-animation'));
      assert.equal(existsSync(join(root, 'assets', 'animation')), false);
      assert.equal(existsSync(join(root, 'main-animation', 'wave.webm')), true);
      assert.equal(readReceipt(root), undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('搬迁清单里没有 logs.txt：它留在数据根上（排障第一件事是找它）', () => {
    const froms = layoutMoves().map((move) => move.from);
    assert.equal(froms.includes('logs.txt'), false);
    assert.equal(
      layoutMoves().some((move) => move.to === 'data/logs.txt'),
      false,
    );
  });
});

describe('migrateElectronRuntime', () => {
  test('$DSH_HOME/electron → <数据根>/runtime/electron；搬完再跑是 absent', () => {
    const dshHome = tempRoot('fish-body-electron-');
    try {
      const root = join(dshHome, 'fish-body');
      mkdirSync(root, { recursive: true });
      seedDir(dshHome, 'electron', 'electron.exe', 'binary');

      assert.equal(migrateElectronRuntime({ dshHome, root }), 'moved');
      assert.equal(readFileSync(join(root, 'runtime', 'electron', 'electron.exe'), 'utf8'), 'binary');
      assert.equal(existsSync(join(dshHome, 'electron')), false);
      assert.equal(migrateElectronRuntime({ dshHome, root }), 'absent');
    } finally {
      rmSync(dshHome, { recursive: true, force: true });
    }
  });

  test('目标已存在：occupied，两边都不动', () => {
    const dshHome = tempRoot('fish-body-electron-both-');
    try {
      const root = join(dshHome, 'fish-body');
      seedDir(dshHome, 'electron', 'electron.exe', 'old');
      seedDir(join(root), 'runtime/electron', 'electron.exe', 'new');

      assert.equal(migrateElectronRuntime({ dshHome, root }), 'occupied');
      assert.equal(readFileSync(join(dshHome, 'electron', 'electron.exe'), 'utf8'), 'old');
      assert.equal(readFileSync(join(root, 'runtime', 'electron', 'electron.exe'), 'utf8'), 'new');
    } finally {
      rmSync(dshHome, { recursive: true, force: true });
    }
  });
});
