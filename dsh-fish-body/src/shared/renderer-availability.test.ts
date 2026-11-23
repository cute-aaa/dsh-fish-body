/**
 * 「渲染方式」可用性判据的契约测试。
 *
 * 钉住的是**症状级**的结论：有分层资源就必须点得动（哪怕当前 `pets[].model` 还是 live2d 的模型路径），
 * 什么都没有就必须置灰（点下去空画布比灰一项更糟）。两端都读这一份，所以这里一条断言等于两端的门禁。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { availableRenderers } from './renderer-availability.ts';

/** 读仓库里的一个源文件（相对本测试文件）。 */
function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('availableRenderers —— 右键「渲染方式」哪些能吃', () => {
  test('webm 恒可用：什么素材都没有时只剩它', () => {
    assert.deepEqual(availableRenderers({ manifestHit: false, models: [], skins: [] }), ['webm']);
  });

  test('当前模型的清单取得到：layered 可用', () => {
    assert.deepEqual(availableRenderers({ manifestHit: true, models: [], skins: [] }), ['webm', 'layered']);
  });

  test('清单里有一套分层皮肤也算可用（挂载会回落到它）', () => {
    assert.deepEqual(availableRenderers({ manifestHit: false, models: [], skins: ['feiyu-05'] }), ['webm', 'layered']);
  });

  test('有 .model3.json：live2d 可用', () => {
    assert.deepEqual(availableRenderers({ manifestHit: false, models: ['x/大肥鱼.model3.json'], skins: [] }), [
      'webm',
      'live2d',
    ]);
  });

  test('三种都有：顺序与菜单一致（webm → layered → live2d）', () => {
    assert.deepEqual(availableRenderers({ manifestHit: true, models: ['a.model3.json'], skins: ['feiyu-05'] }), [
      'webm',
      'layered',
      'live2d',
    ]);
  });

  test('回归：切到 live2d 之后 model 是模型路径，layered 仍须可用（曾经在这里被置灰）', () => {
    // 真实故障状态：pets[].model 被 live2d 写成 `deepseek-live2d-skin/大肥鱼.model3.json`，
    // 于是 `<model>/manifest.json` 必然 404 —— 只看 manifestHit 就会把 layered 判成不可用，
    // 而池里其实有 7 套分层皮肤。
    const probe = {
      manifestHit: false,
      models: ['deepseek-live2d-skin/大肥鱼.model3.json'],
      skins: ['feiyu-01-skin', 'feiyu-05', 'feiyu-muyu'],
    };
    assert.deepEqual(availableRenderers(probe), ['webm', 'layered', 'live2d']);
  });
});

describe('源码守卫：判据与候选顺序两端都只能用共享那一份', () => {
  /** 两端的「渲染方式」探测所在文件。 */
  const PROBES: ReadonlyArray<readonly [string, string]> = [
    ['浏览器端 entry.ts', '../client/pet/card/entry.ts'],
    ['桌面端 init.js', '../../runtime/electron-helper/sprite/init.js'],
  ];

  for (const [label, file] of PROBES) {
    test(label + '：可用态走 shared/renderer-availability，候选路径走 shared/layered-paths', () => {
      const code = source(file);
      assert.match(code, /availableRenderers/, label + ' 必须用共享判据，不能自己拼「webm + 条件 push」');
      assert.match(code, /layeredManifestPaths/, label + ' 必须按共享候选表探清单（含当前皮肤子目录）');
      // 老写法：只探根布局两种布局 → 配置的皮肤在 `<皮肤>/manifest.json` 时必然置灰
      assert.doesNotMatch(code, /LAYERED_MANIFEST_PATHS\.map\(/, label + ' 不能退回只探根布局的老写法');
    });
  }

  test('两端挂载 layered 都用共享的回落解析（配置的皮肤取不到时换一套，不空画布）', () => {
    for (const file of ['../client/pet/render/layered.ts', '../../runtime/electron-helper/sprite/backend.js']) {
      assert.match(source(file), /resolveLayeredManifest/, file + ' 必须用共享回落解析');
    }
  });
});
