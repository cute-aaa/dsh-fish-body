/**
 * 资源包磁盘状态的测试：装标记的读写口径、半装状态的跳过、删除与哈希。
 *
 * 重点不是「功能能跑」，而是**坏状态怎么处理**：标记写坏、id 对不上、
 * 目录在但标记缺（上次解压中断）——这些必须稳定落到「未安装」，
 * 否则用户会看到「设置页显示已装、实际没有文件」。
 * @module dsh-fish-body/src/host/packs/state.test
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  countFiles,
  hashFile,
  INSTALLED_MARKER,
  listInstalled,
  packDirOf,
  packsRootOf,
  readInstalled,
  removePack,
  sweepTempDirs,
  TEMP_DIR_PREFIX,
  writeInstalled,
} from './state.ts';

/** 建一个临时数据根，跑完即弃。 */
function withRoot(run: (root: string, packsRoot: string) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-packs-'));
  return Promise.resolve(run(root, packsRootOf(root))).then(() => undefined);
}

const RECORD = {
  id: 'fonts-rouhei',
  sha256: 'c'.repeat(64),
  bytes: 1024,
  files: 3,
  at: '2026-11-24T00:00:00.000Z',
};

test('packsRootOf 落在数据根下的 packs', () => {
  assert.equal(packsRootOf('/data/fish-body'), join('/data/fish-body', 'packs'));
});

test('packDirOf 拒绝非法 id（防止拼出 ../x）', () => {
  assert.throws(() => packDirOf('/packs', '../evil'), /非法的包 id/);
  assert.throws(() => packDirOf('/packs', 'Bad'), /非法的包 id/);
  assert.equal(packDirOf('/packs', 'anims-extra'), join('/packs', 'anims-extra'));
});

test('写标记后能读回来', async () => {
  await withRoot((_root, packsRoot) => {
    const dir = packDirOf(packsRoot, RECORD.id);
    writeInstalled(dir, RECORD);
    assert.deepEqual(readInstalled(packsRoot, RECORD.id), RECORD);
  });
});

test('标记缺失 → 未安装（解压中途断掉的情形）', async () => {
  await withRoot((_root, packsRoot) => {
    mkdirSync(packDirOf(packsRoot, RECORD.id), { recursive: true });
    assert.equal(readInstalled(packsRoot, RECORD.id), undefined);
  });
});

test('标记写坏 / 字段不合法 → 未安装，而不是抛异常', async () => {
  await withRoot((_root, packsRoot) => {
    const dir = packDirOf(packsRoot, RECORD.id);
    mkdirSync(dir, { recursive: true });
    const marker = join(dir, INSTALLED_MARKER);

    writeFileSync(marker, '{ not json');
    assert.equal(readInstalled(packsRoot, RECORD.id), undefined);

    writeFileSync(marker, JSON.stringify({ ...RECORD, sha256: 'short' }));
    assert.equal(readInstalled(packsRoot, RECORD.id), undefined);

    writeFileSync(marker, JSON.stringify({ ...RECORD, id: 'other' }));
    assert.equal(readInstalled(packsRoot, RECORD.id), undefined, '标记里的 id 必须与目录一致');

    writeFileSync(marker, JSON.stringify({ ...RECORD, files: 0 }));
    assert.equal(readInstalled(packsRoot, RECORD.id), undefined);
  });
});

test('listInstalled 只列装好的，半装目录被跳过', async () => {
  await withRoot((_root, packsRoot) => {
    writeInstalled(packDirOf(packsRoot, 'anims-extra'), { ...RECORD, id: 'anims-extra' });
    writeInstalled(packDirOf(packsRoot, 'memes'), { ...RECORD, id: 'memes' });
    mkdirSync(packDirOf(packsRoot, 'fonts-rouhei'), { recursive: true });
    assert.deepEqual(
      listInstalled(packsRoot).map((item) => item.id),
      ['anims-extra', 'memes'],
    );
  });
});

test('资源根不存在时 listInstalled 返回空数组', () => {
  assert.deepEqual(listInstalled(join(tmpdir(), 'dsh-packs-not-exists-' + Date.now())), []);
});

test('removePack 删目录并返回是否真的删了', async () => {
  await withRoot((_root, packsRoot) => {
    writeInstalled(packDirOf(packsRoot, RECORD.id), RECORD);
    assert.equal(removePack(packsRoot, RECORD.id), true);
    assert.equal(readInstalled(packsRoot, RECORD.id), undefined);
    assert.equal(removePack(packsRoot, RECORD.id), false);
    assert.equal(removePack(packsRoot, '../evil'), false);
  });
});

test('hashFile 与已知 sha256 一致（流式实现没写错）', async () => {
  await withRoot((root) => {
    const file = join(root, 'a.bin');
    writeFileSync(file, 'abc');
    return hashFile(file).then((hex) => {
      assert.equal(hex, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
  });
});

test('countFiles 递归数普通文件，目录不存在时为 0', async () => {
  await withRoot((root) => {
    mkdirSync(join(root, 'x', 'y'), { recursive: true });
    writeFileSync(join(root, 'x', 'a.txt'), '1');
    writeFileSync(join(root, 'x', 'y', 'b.txt'), '2');
    assert.equal(countFiles(join(root, 'x')), 2);
    assert.equal(countFiles(join(root, 'nope')), 0);
  });
});

test('sweepTempDirs 删掉上次残留的解压临时目录，已装包与用户文件不受影响', async () => {
  await withRoot((_root, packsRoot) => {
    writeInstalled(packDirOf(packsRoot, RECORD.id), RECORD);
    // 半成品：进程被强杀时留下的那种（目录里有文件也得一起删）
    const leftover = join(packsRoot, `${TEMP_DIR_PREFIX}${RECORD.id}-1b9d6bcd`);
    mkdirSync(join(leftover, 'inner'), { recursive: true });
    writeFileSync(join(leftover, 'inner', 'half.webm'), 'x');
    // 干扰项：不带前缀的目录、带前缀的普通文件，都不该被这条清理波及
    mkdirSync(join(packsRoot, 'keep-me'), { recursive: true });
    writeFileSync(join(packsRoot, `${TEMP_DIR_PREFIX}not-a-dir`), 'x');

    const removed = sweepTempDirs(packsRoot);
    assert.deepEqual(removed, [`${TEMP_DIR_PREFIX}${RECORD.id}-1b9d6bcd`]);
    assert.equal(readInstalled(packsRoot, RECORD.id)?.sha256, RECORD.sha256, '已装包必须留着');
    assert.equal(countFiles(join(packsRoot, 'keep-me')), 0);
    assert.equal(countFiles(packsRoot) > 0, true, '不带前缀的文件应原样保留');

    // 幂等：第二次没有可清的了
    assert.deepEqual(sweepTempDirs(packsRoot), []);
  });
});

test('sweepTempDirs 资源根不存在时静默返回空（首次启动、还没装过任何包）', () => {
  assert.deepEqual(sweepTempDirs(join(tmpdir(), 'dsh-packs-missing-' + String(Date.now()))), []);
});
