/**
 * 池扫描（src/host/pool/scan.ts）的契约：三类资源的识别、结构文件判定、坏 json 与空池的容错。
 * 用临时目录搭出真实布局，不依赖仓库素材。
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createPoolReader, poolStructureBaseOf, readPool, structureBaseOf } from './scan.ts';

let root = '';

/** 在池根下写一个文件（自动建目录）。 */
const put = (rel: string, body = '{}'): string => {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
  return path;
};

before(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-pet-pool-'));
});

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 造一套最小 layered 资源。 */
const layered = (id: string, structure: string, body: string): void => {
  put(join('layered', id, structure), body);
};

describe('readPool —— 空池与不存在的池', () => {
  test('池根不存在：exists=false，三份列表为空，不算错误', () => {
    const scan = readPool(join(root, 'nope'));
    assert.equal(scan.exists, false);
    assert.deepEqual(scan.layered, []);
    assert.deepEqual(scan.live2d, []);
    assert.deepEqual(scan.webm, []);
  });

  test('池根存在但没有资源：exists=true，列表仍为空', () => {
    const scan = readPool(root);
    assert.equal(scan.exists, true);
    assert.equal(scan.webm.length, 0);
  });
});

describe('readPool —— layered 结构文件判定', () => {
  test('manifest.json 优先，基名去掉 .json', () => {
    layered('character1', 'manifest.json', '{"canvas":{"w":1,"h":1},"layers":[]}');
    const scan = readPool(root);
    assert.equal(scan.layered.length, 1);
    assert.equal(scan.layered[0].id, 'character1');
    assert.equal(scan.layered[0].structureBase, 'manifest');
    assert.equal(scan.layered[0].dir, join(root, 'layered', 'character1'));
  });

  test('没有 manifest 时认含 rig 的 json（名字排序第一个）', () => {
    layered('character1', 'a.json', '{"layers":[]}');
    layered('character1', 'b.json', '{"rig":{"parts":[]}}');
    const scan = readPool(root);
    assert.equal(scan.layered[0].structureBase, 'b');
  });

  test('既没有 manifest 也没有 rig/schema 时，唯一的 json 也算结构文件', () => {
    layered('character2', 'xxx.json', '{"anything":1}');
    const scan = readPool(root);
    assert.equal(scan.layered[0].structureBase, 'xxx');
  });

  test('多个 json 且都不像结构文件：跳过该资源（不猜）', () => {
    layered('broken', 'a.json', '{"x":1}');
    layered('broken', 'b.json', '{"y":2}');
    assert.deepEqual(readPool(root).layered, []);
  });

  test('结构文件全坏（坏 json）：跳过且不抛', () => {
    layered('bad', 'a.json', '{ 不是 json');
    assert.deepEqual(readPool(root).layered, []);
  });

  test('model 后缀的 json 基名去掉 .model3', () => {
    assert.equal(structureBaseOf('xx.model3.json'), 'xx');
    assert.equal(structureBaseOf('xxx.json'), 'xxx');
  });

  test('poolStructureBaseOf 与整池扫描同一套判定', () => {
    layered('character1', 'manifest.json', '{}');
    assert.equal(poolStructureBaseOf(join(root, 'layered', 'character1')), 'manifest');
    assert.equal(poolStructureBaseOf(join(root, 'layered', 'nope')), undefined);
  });
});

describe('readPool —— live2d 与 webm', () => {
  test('live2d：id 是 .model3.json 的相对路径，dir 是它所在目录', () => {
    put(join('live2d', 'model1', 'xx.model3.json'), '{"Version":3}');
    put(join('live2d', 'model2', 'deep', 'yy.model3.json'), '{"Version":3}');
    const scan = readPool(root);
    assert.deepEqual(
      scan.live2d.map((entry) => entry.id),
      ['model1/xx.model3.json', 'model2/deep/yy.model3.json'],
    );
    assert.equal(scan.live2d[0].dir, join(root, 'live2d', 'model1'));
    assert.equal(scan.live2d[0].structureBase, 'xx');
  });

  test('live2d 目录里没有 .model3.json：不算资源（静默跳过）', () => {
    mkdirSync(join(root, 'live2d', 'not-a-model'), { recursive: true });
    assert.deepEqual(readPool(root).live2d, []);
  });

  test('webm 平铺：id 是基名，非 webm 文件不参与', () => {
    put(join('webm', 'movie1.webm'), 'x');
    put(join('webm', 'movie2.webm'), 'x');
    put(join('webm', 'notes.txt'), 'x');
    assert.deepEqual(
      readPool(root).webm.map((entry) => entry.id),
      ['movie1', 'movie2'],
    );
  });

  test('点开头的目录/文件不参与', () => {
    put(join('webm', '.hidden.webm'), 'x');
    layered('.hidden', 'manifest.json', '{}');
    const scan = readPool(root);
    assert.deepEqual(scan.webm, []);
    assert.deepEqual(scan.layered, []);
  });
});

describe('createPoolReader —— 一次请求内复用', () => {
  test('同一实例只扫一次（后续新增文件不改变结果）', () => {
    put(join('webm', 'a.webm'), 'x');
    const reader = createPoolReader(root);
    assert.equal(reader.scan().webm.length, 1);
    put(join('webm', 'b.webm'), 'x');
    assert.equal(reader.scan().webm.length, 1, '同实例复用扫描结果');
    assert.equal(readPool(root).webm.length, 2, '新的一次扫描能看到新文件');
  });
});
