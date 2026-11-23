/**
 * 设置备份的形状校验（src/shared/settings-backup.ts）的契约测试。
 *
 * 四条契约：
 *   1. 只认自己的类型标记与版本；版本更高的备份整体拒绝（旧插件读不懂新字段）；
 *   2. 条目名要能当文件名片段用：路径分隔符、保留符、`.`/`..`、资源池保留字 `pool` 全部拒绝；
 *   3. 体积有上限：三份原文的字符数合计超过阈值就拒绝，避免把 1 MiB 的请求体撑爆；
 *   4. 不解析原文内容（那是宿主的事）：形状对就算通过。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSettingsBackup,
  SETTINGS_BACKUP_KIND,
  SETTINGS_BACKUP_MAX_CHARS,
  SETTINGS_BACKUP_VERSION,
} from './settings-backup.ts';

/** 一份最小的合法备份。 */
const backup = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: SETTINGS_BACKUP_KIND,
  version: SETTINGS_BACKUP_VERSION,
  createdAt: '2026-11-14T03:00:00.000Z',
  pluginVersion: '0.4.7',
  files: { main: '{ "pets": [] }', sessionFish: '{}', pets: { cat: '{ "pets": [] }' } },
  ...over,
});

describe('parseSettingsBackup —— 类型与版本', () => {
  test('合法备份原样收下，缺省的可选字段补空串', () => {
    const parsed = parseSettingsBackup({
      kind: SETTINGS_BACKUP_KIND,
      version: 1,
      files: { main: '', sessionFish: '', pets: {} },
    });
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.ok ? parsed.backup.files : null, { main: '', sessionFish: '', pets: {} });
    assert.equal(parsed.ok ? parsed.backup.createdAt : 'x', '');
  });

  test('不是本插件的备份：类型标记或版本缺失都拒绝', () => {
    for (const raw of [
      null,
      {},
      { kind: 'other' },
      backup({ kind: 'other' }),
      backup({ version: 0 }),
      backup({ version: '1' }),
    ]) {
      const parsed = parseSettingsBackup(raw);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.ok ? '' : parsed.failure.reason, 'not-backup');
    }
  });

  test('更新的版本：拒绝并带出版本号（提示先升级插件）', () => {
    const parsed = parseSettingsBackup(backup({ version: SETTINGS_BACKUP_VERSION + 1 }));
    assert.equal(parsed.ok, false);
    assert.deepEqual(parsed.ok ? null : parsed.failure, { reason: 'unsupported-version', version: 2 });
  });

  test('files 缺项或类型不对：当作不是备份', () => {
    for (const files of [
      undefined,
      {},
      { main: 1, sessionFish: '', pets: {} },
      { main: '', sessionFish: '', pets: [] },
    ]) {
      assert.equal(parseSettingsBackup(backup({ files })).ok, false);
    }
  });
});

describe('parseSettingsBackup —— 条目名与体积', () => {
  test('危险条目名一律拒绝：路径分隔符、点目录、资源池保留字', () => {
    for (const entry of ['../etc', 'a/b', 'a\\b', '.', '..', 'pool', '', 'x'.repeat(65)]) {
      const parsed = parseSettingsBackup(backup({ files: { main: '', sessionFish: '', pets: { [entry]: '{}' } } }));
      assert.equal(parsed.ok, false, `条目名 ${JSON.stringify(entry)} 不该通过`);
      assert.equal(parsed.ok ? '' : parsed.failure.reason, 'invalid-entry');
    }
  });

  test('条目过多或原文太长：拒绝', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 65; i += 1) many['pet' + String(i)] = '{}';
    assert.equal(parseSettingsBackup(backup({ files: { main: '', sessionFish: '', pets: many } })).ok, false);

    const huge = 'x'.repeat(SETTINGS_BACKUP_MAX_CHARS + 1);
    const parsed = parseSettingsBackup(backup({ files: { main: huge, sessionFish: '', pets: {} } }));
    assert.deepEqual(parsed.ok ? null : parsed.failure, { reason: 'too-large' });
  });

  test('原文内容不在这里校验：形状对就通过', () => {
    const parsed = parseSettingsBackup(
      backup({ files: { main: 'not json at all', sessionFish: '???', pets: { cat: 'nope' } } }),
    );
    assert.equal(parsed.ok, true, '内容合法性由宿主判定');
  });
});
