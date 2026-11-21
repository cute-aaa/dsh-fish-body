/**
 * live2d 表演清单（host 侧）：只读盘、只认现成纯函数，把「模型里有什么」翻成「AI 能说什么」。
 *
 * 守卫重点：VTS 工程的清单里一条动作都不写（都靠热键/目录补全），所以不跑 `mergeModelExtras`
 * 就等于空清单——那会让「人设能自己动」这个功能在标准 VTS 工程上完全失效。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { live2dCatalogOf } from './live2d-catalog.ts';

/**
 * 造一个「用户根 + 池根 + live2d 模型」的目录树。
 *
 * @param withMotions - 是否给模型目录放 Animation/Exp3 与 .vtube.json（true = 典型 VTS 工程）。
 * @returns 用户根路径（`assets.pool` 相对它）。
 */
function makeRoot(withMotions: boolean): string {
  const userRoot = mkdtempSync(join(tmpdir(), 'dsh-pet-catalog-'));
  const modelDir = join(userRoot, 'assets', 'pet', 'live2d', 'demo-skin');
  mkdirSync(modelDir, { recursive: true });
  writeFileSync(
    join(modelDir, 'demo.model3.json'),
    JSON.stringify({ Version: 3, FileReferences: { Moc: 'demo.moc3' } }),
  );
  if (!withMotions) return userRoot;
  mkdirSync(join(modelDir, 'Animation'));
  mkdirSync(join(modelDir, 'Exp3'));
  writeFileSync(
    join(modelDir, 'Animation', '抬手.motion3.json'),
    JSON.stringify({ Version: 3, Meta: { Duration: 1.2 }, Curves: [] }),
  );
  writeFileSync(join(modelDir, 'Exp3', '兔牙.exp3.json'), JSON.stringify({ Type: 'Live2D Expression' }));
  writeFileSync(
    join(modelDir, 'demo.vtube.json'),
    JSON.stringify({
      Hotkeys: [
        {
          Name: '抬手打招呼',
          Action: 'TriggerAnimation',
          File: '抬手.motion3.json',
          FadeSecondsAmount: 0.2,
          StopsOnLastFrame: true,
        },
        { Name: '兔牙', Action: 'ToggleExpression', File: '兔牙.exp3.json', FadeSecondsAmount: 0.5 },
      ],
    }),
  );
  return userRoot;
}

/** 一只 live2d 宠物的成品配置（只写被测字段）。 */
const live2dConf = (model: string): Record<string, unknown> => ({
  renderer: 'live2d',
  model,
  assets: { pool: 'assets/pet' },
});

describe('live2dCatalogOf —— 模型清单 → 可表演清单', () => {
  test('VTS 工程：热键补全后的动作 label 与外观都进清单', () => {
    const userRoot = makeRoot(true);
    const catalog = live2dCatalogOf(userRoot, live2dConf('demo-skin/demo.model3.json'));
    assert.deepEqual(catalog.actions, ['抬手打招呼'], 'label 取热键名，不是文件名');
    assert.deepEqual(catalog.expressions, ['兔牙']);
  });

  test('不是 live2d / 没选模型 / 模型不存在：一律空清单', () => {
    const userRoot = makeRoot(true);
    assert.deepEqual(live2dCatalogOf(userRoot, { renderer: 'webm', model: 'x' }), { actions: [], expressions: [] });
    assert.deepEqual(live2dCatalogOf(userRoot, live2dConf('')), { actions: [], expressions: [] });
    assert.deepEqual(live2dCatalogOf(userRoot, live2dConf('nope/none.model3.json')), {
      actions: [],
      expressions: [],
    });
  });

  test('模型目录里没有任何素材：清单空，但不抛', () => {
    const userRoot = makeRoot(false);
    assert.deepEqual(live2dCatalogOf(userRoot, live2dConf('demo-skin/demo.model3.json')), {
      actions: [],
      expressions: [],
    });
  });

  test('坏 JSON / 坏配置形状都不抛', () => {
    const userRoot = makeRoot(false);
    const modelDir = join(userRoot, 'assets', 'pet', 'live2d', 'demo-skin');
    writeFileSync(join(modelDir, 'demo.model3.json'), '{ 坏掉');
    assert.deepEqual(live2dCatalogOf(userRoot, live2dConf('demo-skin/demo.model3.json')), {
      actions: [],
      expressions: [],
    });
    assert.deepEqual(live2dCatalogOf(userRoot, null), { actions: [], expressions: [] });
    assert.deepEqual(live2dCatalogOf(userRoot, 'nope'), { actions: [], expressions: [] });
  });
});
