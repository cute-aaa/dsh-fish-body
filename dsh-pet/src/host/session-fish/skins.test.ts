/**
 * 会话鱼皮肤池：用户目录优先、扩展名过滤、越界拒绝、空目录不报错。
 * @module dsh-pet/src/host/session-fish/skins.test
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fishSkinDirs, fishSkinUserDir, listFishSkins, resolveFishSkin, SESSION_FISH_SKIN_DIR } from './skins.ts';

let root = '';
let user = '';
let pack = '';

before(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-pet-fish-skins-'));
  user = fishSkinUserDir(root);
  pack = join(root, 'pack');
  mkdirSync(user, { recursive: true });
  mkdirSync(pack, { recursive: true });
  // 用户目录：一个动图、一段 webm、一个不认识的扩展名、一个子目录
  writeFileSync(join(user, '我的鱼.gif'), 'gif', 'utf8');
  writeFileSync(join(user, '共享.webm'), 'user', 'utf8');
  writeFileSync(join(user, 'note.txt'), 'nope', 'utf8');
  mkdirSync(join(user, 'sub'), { recursive: true });
  // 包内目录：同名 webm（应被用户那份盖掉）、一段自己的动画、一张图
  writeFileSync(join(pack, '共享.webm'), 'pack', 'utf8');
  writeFileSync(join(pack, '写代码.webm'), 'pack', 'utf8');
  writeFileSync(join(pack, '封面.png'), 'png', 'utf8');
  writeFileSync(join(pack, 'readme.md'), 'nope', 'utf8');
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('fishSkinDirs', () => {
  test('用户目录在数据根下，包内目录指向 assets/webm', () => {
    const dirs = fishSkinDirs(root);
    assert.equal(dirs.user, join(root, SESSION_FISH_SKIN_DIR));
    assert.match(dirs.pack.replace(/\\/g, '/'), /assets\/webm$/);
  });
});

describe('listFishSkins', () => {
  test('用户在前、包内在后；同名以用户为准；不认识的扩展名不列', () => {
    const items = listFishSkins({ user, pack });
    assert.deepEqual(
      items.map((item) => [item.id, item.source, item.kind]),
      [
        ['共享.webm', 'user', 'video'],
        ['我的鱼.gif', 'user', 'image'],
        ['封面.png', 'pack', 'image'],
        ['写代码.webm', 'pack', 'video'],
      ],
    );
  });

  test('标签去掉扩展名；中文名原样保留', () => {
    const items = listFishSkins({ user, pack });
    assert.equal(items.find((item) => item.id === '我的鱼.gif')?.label, '我的鱼');
    assert.equal(items.find((item) => item.id === '写代码.webm')?.label, '写代码');
  });

  test('目录不存在：空清单，不抛错', () => {
    assert.deepEqual(listFishSkins({ user: join(root, 'nope'), pack: join(root, 'nope2') }), []);
  });
});

describe('resolveFishSkin', () => {
  test('用户目录优先', () => {
    const file = resolveFishSkin({ user, pack }, '共享.webm');
    assert.equal(file, join(user, '共享.webm'));
  });

  test('用户没有时回落包内', () => {
    assert.equal(resolveFishSkin({ user, pack }, '写代码.webm'), join(pack, '写代码.webm'));
  });

  test('路径穿越 / 未知扩展名 / 不存在：一律 undefined', () => {
    assert.equal(resolveFishSkin({ user, pack }, '../package.json'), undefined);
    assert.equal(resolveFishSkin({ user, pack }, 'sub/我的鱼.gif'), undefined);
    assert.equal(resolveFishSkin({ user, pack }, 'note.txt'), undefined);
    assert.equal(resolveFishSkin({ user, pack }, 'readme.md'), undefined);
    assert.equal(resolveFishSkin({ user, pack }, '没有这个.png'), undefined);
    assert.equal(resolveFishSkin({ user, pack }, ''), undefined);
  });
});
