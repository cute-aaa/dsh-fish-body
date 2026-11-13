/**
 * 设置备份路由（src/host/routes/settings-backup.ts）的协议契约测试。
 *
 * 四条契约：
 *   1. GET 返回一份快照（与 collect 的产物一致），带 no-store；
 *   2. POST 恢复成功时回 `{ ok: true, merged, settings }`；
 *   3. 坏备份仍是 200 + 失败实体（业务结论），方法不对是 405；
 *   4. 不是这个端点时返回 undefined（交给后面的处理器）。
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleSettingsBackupRoutes } from './settings-backup.ts';
import { SessionFishSettingsStore, sessionFishSettingsPath } from '../session-fish/settings.ts';
import { SETTINGS_BACKUP_KIND, SETTINGS_BACKUP_VERSION } from '../../shared/settings-backup.ts';
import type { ConfigPaths } from '../config/constants.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';

let root = '';
let seq = 0;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-pet-backup-routes-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 一套独立目录 + 最小依赖表（只填本领域用到的项）。 */
function makeDeps(): { deps: PetRouteDeps; paths: ConfigPaths; userRoot: string } {
  const dir = join(root, 'case-' + String(++seq));
  const userRoot = join(dir, 'user');
  const petDir = join(userRoot, 'pet');
  mkdirSync(petDir, { recursive: true });
  const paths: ConfigPaths = {
    defaultFile: join(dir, 'assets-config.jsonc'),
    userFile: join(userRoot, 'main-config.jsonc'),
    petDir,
  };
  writeFileSync(paths.defaultFile, JSON.stringify({ pets: [] }, null, 2), 'utf8');
  writeFileSync(paths.userFile, '{ "pets": [] }', 'utf8');
  const deps = {
    configPaths: paths,
    userRoot,
    sessionFishSettings: new SessionFishSettingsStore(sessionFishSettingsPath(userRoot)),
    sessionFish: { clearAll: () => {} },
    publishSessionFish: () => {},
    state: { writeSection: () => {} },
    requestRestart: async () => {},
  } as unknown as PetRouteDeps;
  return { deps, paths, userRoot };
}

/** 造一次请求。 */
function input(method: string, body?: string, rest = 'settings-backup'): RouteInput {
  return { url: new URL('http://localhost/dsh-pet-7340/' + rest), rest, method, body };
}

/** 一份合法备份。 */
const backupBody = (main = '{ "pets": [] }'): string =>
  JSON.stringify({
    kind: SETTINGS_BACKUP_KIND,
    version: SETTINGS_BACKUP_VERSION,
    createdAt: '2026-11-14T03:00:00.000Z',
    pluginVersion: '0.4.7',
    files: { main, sessionFish: '{ "enabled": true }', pets: {} },
  });

describe('handleSettingsBackupRoutes —— 协议', () => {
  test('不是这个端点：交给后面的处理器', async () => {
    const { deps } = makeDeps();
    assert.equal(await handleSettingsBackupRoutes(deps, input('GET', undefined, 'config')), undefined);
  });

  test('GET 返回快照，且禁缓存', async () => {
    const { deps } = makeDeps();
    const result = await handleSettingsBackupRoutes(deps, input('GET'));
    assert.ok(result && result.kind === 'json');
    assert.equal(result.headers?.['cache-control'], 'no-store');
    const body = result.obj as Record<string, unknown>;
    assert.equal(body.kind, SETTINGS_BACKUP_KIND);
    assert.deepEqual((body.files as Record<string, string>).main, '{ "pets": [] }');
  });

  test('POST 恢复：回成品与会话鱼设置，磁盘已更新', async () => {
    const { deps, paths } = makeDeps();
    const result = await handleSettingsBackupRoutes(deps, input('POST', backupBody('// 恢复\n{ "pets": [] }')));
    assert.ok(result && result.kind === 'json');
    const body = result.obj as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(typeof body.merged, 'object');
    assert.equal(typeof body.settings, 'object');
    assert.equal(readFileSync(paths.userFile, 'utf8'), '// 恢复\n{ "pets": [] }');
  });

  test('坏备份：200 + 失败实体（bad-request）', async () => {
    const { deps } = makeDeps();
    const result = await handleSettingsBackupRoutes(deps, input('POST', JSON.stringify({ hello: 1 })));
    assert.ok(result && result.kind === 'json');
    assert.equal(result.status, 200);
    assert.equal((result.obj as Record<string, unknown>).reason, 'bad-request');
  });

  test('请求体不是 JSON：400 invalid-json', async () => {
    const { deps } = makeDeps();
    const result = await handleSettingsBackupRoutes(deps, input('POST', 'not json'));
    assert.ok(result && result.kind === 'json');
    assert.equal(result.status, 400);
    assert.equal((result.obj as Record<string, unknown>).reason, 'invalid-json');
  });

  test('方法不对：405', async () => {
    const { deps } = makeDeps();
    const result = await handleSettingsBackupRoutes(deps, input('PUT'));
    assert.ok(result && result.kind === 'json');
    assert.equal(result.status, 405);
  });
});
