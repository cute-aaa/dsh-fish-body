/**
 * 位置落盘文件（`runtime/electron-helper/main/position-file.js`）的单测。
 *
 * 它存在的理由只有一条：**切皮肤重启 Helper 时位置不能丢**，而 Windows 上是硬杀进程，
 * 渲染端 localStorage 来不及刷盘。所以这里要钉住的是：
 * 1. 写完立刻在磁盘上（新实例 = 新进程能读到，模拟重启）；
 * 2. 位置配置签名变了就不认旧坐标（改角落要立刻生效）；
 * 3. 文件读坏 / 目录不可写一律降级，不抛异常（位置记忆坏了不能让宠物起不来）。
 *
 * 跑法：node --test scripts/tests/pet-position-file.test.mjs（npm run test:ui 会带上）
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPositionFile, FILE_NAME } = require('../../runtime/electron-helper/main/position-file.js');

/** 每次都新建一个临时目录，跑完即弃。 */
function withDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-posfile-'));
  return run(dir);
}

const SIG = 'top-right|24|100';

describe('落盘：写完就能被「下一个进程」读到', () => {
  test('write 之后用新实例读回来（模拟重启 Helper）', () =>
    withDir((dir) => {
      const before = createPositionFile({ dir });
      assert.equal(before.write('main', { rx: 0.42, ry: 0.61 }, SIG), true);
      assert.equal(existsSync(join(dir, FILE_NAME)), true, '文件要真的落盘，不能只在内存里');

      const after = createPositionFile({ dir });
      assert.deepEqual(after.read('main', SIG), { rx: 0.42, ry: 0.61 });
    }));

  test('每只宠物各记各的', () =>
    withDir((dir) => {
      const file = createPositionFile({ dir });
      file.write('main', { rx: 0.1, ry: 0.2 }, SIG);
      file.write('fish2', { rx: 0.8, ry: 0.9 }, SIG);
      assert.deepEqual(file.read('main', SIG), { rx: 0.1, ry: 0.2 });
      assert.deepEqual(file.read('fish2', SIG), { rx: 0.8, ry: 0.9 });
    }));

  test('坐标越界被夹进 0..1；非法坐标不落盘', () =>
    withDir((dir) => {
      const file = createPositionFile({ dir });
      assert.equal(file.write('main', { rx: -1, ry: 2 }, SIG), true);
      assert.deepEqual(file.read('main', SIG), { rx: 0, ry: 1 });
      assert.equal(file.write('main', { rx: Number.NaN, ry: 0.5 }, SIG), false);
      assert.deepEqual(file.read('main', SIG), { rx: 0, ry: 1 }, '坏写不能覆盖已有的好记录');
    }));
});

describe('签名：位置配置改了就不认旧坐标', () => {
  test('签名不同 → read 回 null', () =>
    withDir((dir) => {
      const file = createPositionFile({ dir });
      file.write('main', { rx: 0.42, ry: 0.61 }, SIG);
      assert.equal(file.read('main', 'bottom-left|24|100'), null);
      assert.equal(file.read('main', ''), null, '空签名（取不到配置）也算不匹配');
    }));
});

describe('清除：回到原位之后重启也不该跳回旧坐标', () => {
  test('clear 之后读不到，文件里也不再有这条', () =>
    withDir((dir) => {
      const file = createPositionFile({ dir });
      file.write('main', { rx: 0.42, ry: 0.61 }, SIG);
      assert.equal(file.clear('main'), true);
      assert.equal(file.read('main', SIG), null);
      assert.deepEqual(JSON.parse(readFileSync(join(dir, FILE_NAME), 'utf8')), {});
    }));

  test('本来就没有这条 → clear 也算成功（幂等）', () =>
    withDir((dir) => {
      const file = createPositionFile({ dir });
      assert.equal(file.clear('main'), true);
    }));
});

describe('坏环境：一律降级，不抛异常', () => {
  test('文件不是 JSON → 当没有记录', () =>
    withDir((dir) => {
      writeFileSync(join(dir, FILE_NAME), '{不是 json', 'utf8');
      const file = createPositionFile({ dir });
      assert.equal(file.read('main', SIG), null);
      // 坏文件之后仍能写（整份覆盖成合法 JSON）
      assert.equal(file.write('main', { rx: 0.3, ry: 0.4 }, SIG), true);
      assert.deepEqual(file.read('main', SIG), { rx: 0.3, ry: 0.4 });
    }));

  test('文件内容是数组 / 字符串 → 当没有记录', () =>
    withDir((dir) => {
      writeFileSync(join(dir, FILE_NAME), '[1,2,3]', 'utf8');
      const file = createPositionFile({ dir });
      assert.equal(file.read('main', SIG), null);
    }));

  test('目录不可写（写盘抛错）→ write 返回 false，不抛异常', () =>
    withDir((dir) => {
      const file = createPositionFile({
        dir,
        fileSystem: {
          readFileSync: () => {
            throw new Error('ENOENT');
          },
          writeFileSync: () => {
            throw new Error('EACCES');
          },
          mkdirSync: () => undefined,
        },
      });
      assert.equal(file.write('main', { rx: 0.5, ry: 0.5 }, SIG), false);
      assert.equal(file.read('main', SIG), null);
    }));

  test('目录不存在会自己建（首次启动时 userData 可能还没建）', () =>
    withDir((dir) => {
      const deep = join(dir, 'nested', 'deeper');
      mkdirSync(deep, { recursive: true });
      const file = createPositionFile({ dir: join(deep, 'x') });
      assert.equal(file.write('main', { rx: 0.2, ry: 0.3 }, SIG), true);
      assert.deepEqual(createPositionFile({ dir: join(deep, 'x') }).read('main', SIG), { rx: 0.2, ry: 0.3 });
    }));
});
