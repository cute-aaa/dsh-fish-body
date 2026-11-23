/**
 * 插件回滚（src/host/rollback.ts）的契约测试。
 *
 * 这个脚本要动的是一份**当前能用**的安装：拍错、恢复错都会让人回不去。所以测试钉的是它的边界：
 *   1. 只收白名单（用户数据一个字节都不进快照）；
 *   2. 缺项跳过、不报错（新克隆还没有 `lib/` 时也该能拍一份「只有配置」的快照）；
 *   3. 超上限直接拒绝（截断的快照比没有更糟）；
 *   4. 恢复前必先自拍 `pre-restore`，且只覆盖不删除；
 *   5. 清单里的非法路径（`..` / 绝对路径 / 不在白名单）在恢复前就被挡掉。
 *
 * 用内存 fs 替身（同 `migrate-layout.test.ts` 的口径），不落真的磁盘。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FILES_DIR,
  MANIFEST_FILE,
  MAX_FILE_BYTES,
  createSnapshot,
  listSnapshots,
  normalizeLabel,
  planRestore,
  planSnapshot,
  restorableRel,
  restoreSnapshot,
  snapshotIdOf,
  validateManifest,
  type RollbackFs,
  type SnapshotInput,
} from './rollback.ts';

/** 内存文件系统：路径 → 内容（`null` 表示目录）。 */
function memoryFs(files: Record<string, string | null>): RollbackFs & { files: Record<string, string | null> } {
  const norm = (path: string): string => path.replace(/\\/g, '/').replace(/\/+/g, '/');
  const store: Record<string, string | null> = {};
  for (const [path, content] of Object.entries(files)) store[norm(path)] = content;
  const isDir = (path: string): boolean => {
    const key = norm(path);
    if (store[key] === null) return true;
    return Object.keys(store).some((item) => item.startsWith(key + '/'));
  };
  const api: RollbackFs & { files: Record<string, string | null> } = {
    files: store,
    existsSync: (path) => norm(path) in store,
    mkdirSync: (path) => {
      const parts = norm(path).split('/');
      for (let i = 1; i <= parts.length; i += 1) {
        const key = parts.slice(0, i).join('/');
        if (key !== '' && !(key in store)) store[key] = null;
      }
    },
    readdirSync: (path) => {
      const key = norm(path);
      const out = new Set<string>();
      for (const item of Object.keys(store)) {
        if (!item.startsWith(key + '/')) continue;
        out.add(item.slice(key.length + 1).split('/')[0]);
      }
      return [...out];
    },
    isDirectory: isDir,
    sizeOf: (path) => Buffer.byteLength(store[norm(path)] ?? '', 'utf8'),
    readFileSync: (path) => store[norm(path)] ?? '',
    writeFileSync: (path, data) => {
      store[norm(path)] = data;
    },
    copyTree: (from, to) => {
      const source = norm(from);
      const target = norm(to);
      if (isDir(source)) {
        store[target] = null;
        for (const item of Object.keys(store)) {
          if (!item.startsWith(source + '/')) continue;
          store[target + item.slice(source.length)] = store[item];
        }
      } else store[target] = store[source];
    },
    removeSync: (path) => {
      const key = norm(path);
      if (store[key] !== null) delete store[key];
      for (const item of Object.keys(store)) if (item.startsWith(key + '/')) delete store[item];
    },
  };
  return api;
}

const REPO = 'D:/repo/dsh-pet';
const DIR = 'D:/repo/dsh-pet/artifacts/rollback';
const DATA = 'D:/dsh/fish-body';
const NOW = new Date('2026-11-15T05:30:00');

/** 一份「装好了」的插件目录：lib/ 两个文件 + package.json + patch。 */
const installed = (): Record<string, string | null> => ({
  [REPO + '/lib']: null,
  [REPO + '/lib/index.js']: 'INDEX',
  [REPO + '/lib/client.js']: 'CLIENT',
  [REPO + '/package.json']: '{"version":"0.5.0"}',
  [REPO + '/cordis.patch.yml']: 'patch',
  [DATA + '/config']: null,
  [DATA + '/config/main-config.jsonc']: '{}',
  [DATA + '/data']: null,
  [DATA + '/data/memory.json']: '{"turns":[]}',
});

const silentLog = { infos: [] as string[], warns: [] as string[] };

/** 一份拍快照的输入；各用例只覆盖自己关心的字段。 */
function input(fs: ReturnType<typeof memoryFs>, patch: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    repo: REPO,
    dir: DIR,
    label: 'before-upgrade',
    commit: 'abc1234',
    version: '0.5.0',
    dataRoot: DATA,
    includeConfig: false,
    now: NOW,
    fs,
    log: {
      info: (message) => silentLog.infos.push(message),
      warn: (message) => silentLog.warns.push(message),
    },
    ...patch,
  };
}

describe('normalizeLabel / snapshotIdOf —— 目录名', () => {
  test('标签规整成 [a-z0-9-]；全空回落 snap', () => {
    assert.equal(normalizeLabel('Before Upgrade!'), 'before-upgrade');
    assert.equal(normalizeLabel('  '), 'snap');
    assert.equal(normalizeLabel('../etc'), 'etc');
  });

  test('id 用本地时刻 + 标签', () => {
    assert.equal(snapshotIdOf(NOW, 'before-upgrade'), '20261115-053000-before-upgrade');
  });
});

describe('createSnapshot —— 只收白名单', () => {
  test('收 lib/、package.json、cordis.patch.yml；用户数据一个字节都不进', () => {
    const fs = memoryFs(installed());
    const manifest = createSnapshot(input(fs));

    assert.equal(manifest.id, '20261115-053000-before-upgrade');
    assert.deepEqual(manifest.entries.map((entry) => entry.rel).sort(), [
      'cordis.patch.yml',
      'lib/client.js',
      'lib/index.js',
      'package.json',
    ]);
    assert.equal(manifest.includeConfig, false);
    assert.equal(
      manifest.totalBytes,
      Buffer.byteLength('INDEX') +
        Buffer.byteLength('CLIENT') +
        Buffer.byteLength('patch') +
        Buffer.byteLength('{"version":"0.5.0"}'),
      '字节数按实际文件算',
    );
    // 落盘位置：<dir>/<id>/files/... + manifest.json
    const root = DIR + '/' + manifest.id;
    assert.equal(fs.files[root + '/' + FILES_DIR + '/lib/index.js'], 'INDEX');
    assert.ok(fs.files[root + '/' + MANIFEST_FILE], '要有清单');
    // data/ 与 skin/ 不在白名单：连条目都不该出现。
    assert.equal(
      manifest.entries.some((entry) => entry.rel.startsWith('data/')),
      false,
    );
  });

  test('--with-config：连数据根的 config/ 一起收（仍然不碰 data/）', () => {
    const fs = memoryFs(installed());
    const manifest = createSnapshot(input(fs, { includeConfig: true }));
    assert.equal(manifest.includeConfig, true);
    assert.ok(manifest.entries.some((entry) => entry.rel === 'config/main-config.jsonc'));
    assert.equal(
      manifest.entries.some((entry) => entry.rel.startsWith('data/')),
      false,
    );
  });

  test('缺项跳过：没有 lib/ 时只拍 package.json，不报错', () => {
    const fs = memoryFs({ [REPO + '/package.json']: '{"version":"0.5.0"}' });
    const manifest = createSnapshot(input(fs));
    assert.deepEqual(
      manifest.entries.map((entry) => entry.rel),
      ['package.json'],
    );
  });

  test('什么都没有：明确失败（拍一份空快照没有意义）', () => {
    const fs = memoryFs({ [REPO + '/node_modules']: null });
    assert.throws(() => createSnapshot(input(fs)), /没有可收的东西/);
  });

  test('同 id 撞车：拒绝覆盖（快照永不覆盖）', () => {
    const fs = memoryFs(installed());
    createSnapshot(input(fs));
    assert.throws(() => createSnapshot(input(fs)), /已存在/);
  });

  test('超上限：拒绝而不是截断', () => {
    const fs = memoryFs(installed());
    fs.files[REPO + '/lib/huge.js'] = 'x'.repeat(MAX_FILE_BYTES + 1);
    assert.throws(() => createSnapshot(input(fs)), /文件太大/);

    // 总量上限：14 个「40 MiB」的文件（单文件都不超限，合计 560 MiB）。
    // 不真的分配 512 MiB —— 只让 sizeOf 报这个数，验的是判定而不是拷贝。
    const source: Record<string, string | null> = { ...installed() };
    for (let i = 0; i < 14; i += 1) source[REPO + '/lib/part-' + i + '.bin'] = 'x';
    const volume = memoryFs(source);
    const sizeOf = volume.sizeOf;
    const fortyMiB = 40 * 1024 * 1024;
    volume.sizeOf = ((path: string) => (path.endsWith('.bin') ? fortyMiB : sizeOf(path))) as never;
    assert.throws(() => planSnapshot(input(volume)), /超过 512 MiB/);
  });
});

describe('listSnapshots / validateManifest —— 清单', () => {
  test('按 id 倒序列出；坏清单不静默丢掉', () => {
    const fs = memoryFs(installed());
    createSnapshot(input(fs, { now: new Date('2026-11-14T10:00:00'), label: 'old' }));
    createSnapshot(input(fs, { now: new Date('2026-11-15T05:30:00'), label: 'new' }));
    fs.files[DIR + '/20261113-000000-broken/' + MANIFEST_FILE] = '{"id":"x"}';

    const items = listSnapshots(DIR, fs);
    assert.deepEqual(
      items.map((item) => item.id),
      ['20261115-053000-new', '20261114-100000-old', '20261113-000000-broken'],
    );
    assert.ok(items[0].manifest);
    assert.match(String(items[2].error), /清单缺字段/);
  });

  test('清单校验：缺字段 / 空条目 / 非数字字节数都要拒绝', () => {
    assert.throws(() => validateManifest({ id: 'a' }), /清单缺字段/);
    assert.throws(
      () => validateManifest({ id: 'a', label: 'b', createdAt: 'c', version: 'd', includeConfig: false, entries: [] }),
      /没有条目/,
    );
    assert.throws(
      () =>
        validateManifest({
          id: 'a',
          label: 'b',
          createdAt: 'c',
          version: 'd',
          includeConfig: false,
          entries: [{ rel: 'lib' }],
          totalBytes: 1,
        }),
      /缺 bytes/,
    );
  });

  test('没有快照目录：空列表，不抛', () => {
    assert.deepEqual(listSnapshots('D:/nope', memoryFs({})), []);
  });
});

describe('restoreSnapshot —— 先自拍，再覆盖', () => {
  test('恢复代码产物；config/ 不在 --with-config 时不动', () => {
    const fs = memoryFs(installed());
    const manifest = createSnapshot(input(fs, { includeConfig: true }));
    // 升级后 lib 变了、配置也变了。
    fs.files[REPO + '/lib/index.js'] = 'NEW-INDEX';
    fs.files[DATA + '/config/main-config.jsonc'] = '{"new":true}';

    const result = restoreSnapshot({
      repo: REPO,
      dir: DIR,
      id: manifest.id,
      dataRoot: DATA,
      includeConfig: false,
      now: new Date('2026-11-15T06:00:00'),
      fs,
      log: { info: () => {}, warn: () => {} },
    });

    assert.equal(fs.files[REPO + '/lib/index.js'], 'INDEX', '代码产物要退回去');
    assert.equal(fs.files[DATA + '/config/main-config.jsonc'], '{"new":true}', '没带 --with-config 就不碰配置');
    assert.deepEqual([...result.restored].sort(), [
      'cordis.patch.yml',
      'lib/client.js',
      'lib/index.js',
      'package.json',
    ]);
    // 自拍：回滚前的状态自己成了一份快照。
    assert.equal(result.preRestore, '20261115-060000-pre-restore');
    assert.equal(fs.files[DIR + '/' + result.preRestore + '/' + FILES_DIR + '/lib/index.js'], 'NEW-INDEX');
  });

  test('带 --with-config 且快照含配置：config/ 也退回去，data/ 依然不动', () => {
    const fs = memoryFs(installed());
    const manifest = createSnapshot(input(fs, { includeConfig: true }));
    fs.files[DATA + '/config/main-config.jsonc'] = '{"new":true}';
    fs.files[DATA + '/data/memory.json'] = '{"turns":[1]}';

    restoreSnapshot({
      repo: REPO,
      dir: DIR,
      id: manifest.id,
      dataRoot: DATA,
      includeConfig: true,
      now: new Date('2026-11-15T06:10:00'),
      fs,
      log: { info: () => {}, warn: () => {} },
    });

    assert.equal(fs.files[DATA + '/config/main-config.jsonc'], '{}', '配置要退回去');
    assert.equal(fs.files[DATA + '/data/memory.json'], '{"turns":[1]}', '记忆永不进快照、也永不覆盖');
  });

  test('清单里的非法路径在恢复前挡掉（`..` / 绝对路径 / 白名单外）', () => {
    const base = {
      id: 'bad',
      label: 'bad',
      createdAt: '2026-11-15T00:00:00.000Z',
      commit: '',
      version: '0.5.0',
      includeConfig: false,
    };
    assert.equal(restorableRel('../etc/passwd'), false);
    assert.equal(restorableRel('D:/Windows/System32'), false);
    assert.equal(restorableRel('data/memory.json'), false);
    assert.equal(restorableRel('lib/index.js'), true);
    assert.equal(restorableRel('config/x.json'), true);

    const manifest = validateManifest({
      ...base,
      entries: [{ rel: 'data/memory.json', bytes: 10 }],
      totalBytes: 10,
    });
    assert.throws(() => planRestore(manifest, DIR, REPO, DATA, false), /不该恢复的路径/);
  });

  test('恢复只覆盖不删除：目标目录里多出来的文件留着', () => {
    const fs = memoryFs(installed());
    const manifest = createSnapshot(input(fs));
    fs.files[REPO + '/lib/extra.js'] = 'EXTRA';
    restoreSnapshot({
      repo: REPO,
      dir: DIR,
      id: manifest.id,
      dataRoot: DATA,
      includeConfig: false,
      now: new Date('2026-11-15T06:20:00'),
      fs,
      log: { info: () => {}, warn: () => {} },
    });
    assert.equal(fs.files[REPO + '/lib/extra.js'], 'EXTRA');
  });
});
