/**
 * 设置备份的采集与恢复（src/host/settings-backup/*）的契约测试。
 *
 * 五条契约：
 *   1. 采集只收原文：主配置、会话鱼设置、每个种类配置，一个字段都不加工；
 *   2. 没有的文件是空串（含义：拍摄时没有这一层）；
 *   3. 恢复先预检后动盘：任一份解析不了就一个文件都不写；
 *   4. 覆盖前留 `.bak`；空串表示删掉那一层（主配置 / 会话鱼），种类文件不会被删；
 *   5. 写成功后会话鱼 store 重读、广播一次并返回成品。
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectSettingsBackup } from './collect.ts';
import { applySettingsBackup, type BackupTarget } from './apply.ts';
import { SessionFishSettingsStore, sessionFishSettingsPath } from '../session-fish/settings.ts';
import type { ConfigPaths } from '../config/constants.ts';
import { SETTINGS_BACKUP_KIND, SETTINGS_BACKUP_VERSION } from '../../shared/settings-backup.ts';

/** 一份合法的内置默认配置（恢复后 readAllConfig 要读它）。 */
const DEFAULT_CONFIG = JSON.stringify({ pets: [] }, null, 2);

let root = '';
let seq = 0;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-pet-backup-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 每个用例一套独立目录（内置默认 + 用户层 + pet/ + 用户根）。 */
function makeCase(): { paths: ConfigPaths; userRoot: string; target: () => BackupTarget; publishes: () => number } {
  const dir = join(root, 'case-' + String(++seq));
  const userRoot = join(dir, 'user');
  const petDir = join(userRoot, 'pet');
  mkdirSync(petDir, { recursive: true });
  const paths: ConfigPaths = {
    defaultFile: join(dir, 'assets-config.jsonc'),
    userFile: join(userRoot, 'main-config.jsonc'),
    petDir,
  };
  writeFileSync(paths.defaultFile, DEFAULT_CONFIG, 'utf8');
  let publishes = 0;
  const target = (): BackupTarget => {
    const store = new SessionFishSettingsStore(sessionFishSettingsPath(userRoot));
    return {
      configPaths: paths,
      userRoot,
      sessionFishSettings: store,
      sessionFish: { clearAll: () => {} },
      publishSessionFish: () => {
        publishes += 1;
      },
      state: { writeSection: () => {} },
      requestRestart: async () => {},
    };
  };
  return { paths, userRoot, target, publishes: () => publishes };
}

/** 一份快照（可覆盖三份原文）。 */
const backup = (files: { main?: string; sessionFish?: string; pets?: Record<string, string> } = {}): unknown => ({
  kind: SETTINGS_BACKUP_KIND,
  version: SETTINGS_BACKUP_VERSION,
  createdAt: '2026-11-14T03:00:00.000Z',
  pluginVersion: '0.4.7',
  files: { main: '', sessionFish: '', pets: {}, ...files },
});

describe('collectSettingsBackup —— 只收原文', () => {
  test('三处文件都读进快照；没有的层是空串', () => {
    const { paths, userRoot } = makeCase();
    writeFileSync(paths.userFile, '// 注释保留\n{ "pets": [] }\n', 'utf8');
    writeFileSync(join(paths.petDir, 'cat-config.json'), '{ "pets": [] }', 'utf8');
    writeFileSync(join(userRoot, 'session-fish.json'), '{ "enabled": false }', 'utf8');

    const snapshot = collectSettingsBackup({ configPaths: paths, userRoot }, new Date('2026-11-14T03:00:00.000Z'));
    assert.equal(snapshot.kind, SETTINGS_BACKUP_KIND);
    assert.equal(snapshot.version, SETTINGS_BACKUP_VERSION);
    assert.equal(snapshot.createdAt, '2026-11-14T03:00:00.000Z');
    assert.equal(snapshot.files.main, '// 注释保留\n{ "pets": [] }\n');
    assert.deepEqual(snapshot.files.pets, { cat: '{ "pets": [] }' });
    assert.equal(snapshot.files.sessionFish, '{ "enabled": false }');

    const empty = collectSettingsBackup({ configPaths: makeCase().paths, userRoot: join(root, 'nowhere') });
    assert.equal(empty.files.main, '');
    assert.equal(empty.files.sessionFish, '');
    assert.deepEqual(empty.files.pets, {});
  });
});

describe('applySettingsBackup —— 预检与写回', () => {
  test('写回三份原文，覆盖前留 .bak，并返回成品', () => {
    const { paths, userRoot, target, publishes } = makeCase();
    writeFileSync(paths.userFile, '{ "pets": [] }', 'utf8');
    writeFileSync(join(userRoot, 'session-fish.json'), '{ "enabled": true }', 'utf8');
    writeFileSync(join(paths.petDir, 'cat-config.json'), '{ "pets": [] }', 'utf8');

    const result = applySettingsBackup(
      target(),
      backup({
        main: '// 新注释\n{ "pets": [] }',
        sessionFish: '{ "enabled": false }',
        pets: { cat: '{ "pets": [] }', dog: '{ "pets": [] }' },
      }),
      new Date('2026-11-14T03:00:00.000Z'),
    );
    assert.equal(result.ok, true, result.ok ? '' : result.message);
    assert.equal(readFileSync(paths.userFile, 'utf8'), '// 新注释\n{ "pets": [] }');
    assert.equal(readFileSync(join(userRoot, 'session-fish.json'), 'utf8'), '{ "enabled": false }');
    assert.equal(readFileSync(join(paths.petDir, 'dog-config.json'), 'utf8'), '{ "pets": [] }');
    // 留底：被覆盖的两个文件各有一份 .bak
    // 主配置与会话鱼设置都住在用户根下：两份都会被覆盖，各留一份底。
    const baks = readdirSync(userRoot).filter((name) => name.includes('.bak-'));
    assert.equal(baks.length, 2, '用户根下应有主配置与会话鱼两份留底');
    assert.deepEqual(
      readdirSync(paths.petDir).filter((name) => name.includes('.bak-')).length,
      1,
      'pet/ 下只该有 cat 的留底',
    );
    assert.equal(result.ok ? result.settings.enabled : true, false, '会话鱼 store 已重读');
    assert.equal(publishes(), 1, '恢复后广播一次会话鱼快照');
  });

  test('任一份解析不了：整体拒绝，一个文件都不动', () => {
    const { paths, userRoot, target } = makeCase();
    writeFileSync(paths.userFile, '{ "pets": [] }', 'utf8');
    const result = applySettingsBackup(target(), backup({ main: '{ 坏掉的', sessionFish: '{ "enabled": true }' }));
    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.reason, 'bad-request');
    assert.equal(readFileSync(paths.userFile, 'utf8'), '{ "pets": [] }');
    assert.equal(existsSync(join(userRoot, 'session-fish.json')), false);
    assert.deepEqual(
      readdirSync(userRoot).filter((name) => name.includes('.bak-')),
      [],
    );
  });

  test('会话鱼原文不是 JSON 对象：同样整体拒绝', () => {
    const { target } = makeCase();
    const result = applySettingsBackup(target(), backup({ sessionFish: '[1, 2]' }));
    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.reason, 'bad-request');
  });

  test('版本更高：拒绝', () => {
    const { target } = makeCase();
    const result = applySettingsBackup(target(), { ...(backup() as Record<string, unknown>), version: 2 });
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.message, /version 2/);
  });

  test('空串 = 删掉那一层（回落到内置默认），种类文件不删', () => {
    const { paths, userRoot, target } = makeCase();
    writeFileSync(paths.userFile, '{ "pets": [] }', 'utf8');
    writeFileSync(join(userRoot, 'session-fish.json'), '{ "enabled": true }', 'utf8');
    writeFileSync(join(paths.petDir, 'cat-config.json'), '{ "pets": [] }', 'utf8');

    const result = applySettingsBackup(target(), backup({ main: '', sessionFish: '' }));
    assert.equal(result.ok, true, result.ok ? '' : result.message);
    assert.equal(existsSync(paths.userFile), false, '主配置被删掉（回落内置默认）');
    assert.equal(existsSync(join(userRoot, 'session-fish.json')), false);
    assert.equal(existsSync(join(paths.petDir, 'cat-config.json')), true, '备份里没有的种类不删');
    assert.equal(readdirSync(userRoot).filter((name) => name.includes('.bak-')).length, 2, '删掉之前也留底');
  });

  test('条目名越出 pet/ 目录：拒绝', () => {
    const { target } = makeCase();
    const result = applySettingsBackup(target(), backup({ pets: { '../evil': '{ "pets": [] }' } }));
    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.reason, 'bad-request');
  });
});
