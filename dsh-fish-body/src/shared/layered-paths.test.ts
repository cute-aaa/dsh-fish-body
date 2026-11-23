/**
 * 分层清单路径与回落解析的契约测试：
 * 候选顺序（选中的那套在前）、地址前缀、以及「配置的那套取不到时用清单里的另一套」。
 *
 * 这几个函数是**加载器与右键可用性探测共用的唯一一份判据**——漂移的症状是
 * 「菜单里 layered 置灰、其实有资源」或「菜单说能用、点下去一片空白」，所以顺序钉死在这里。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LAYERED_MANIFEST_PATHS,
  layeredBaseOf,
  layeredManifestPathOf,
  layeredManifestPaths,
  resolveLayeredManifest,
  type LayeredManifestFetcher,
} from './layered-paths.ts';

/** 造一个只认给定路径的取数器，并记下被问过哪些路径。 */
function fetcherOf(available: Record<string, unknown>): { asked: string[]; getJson: LayeredManifestFetcher } {
  const asked: string[] = [];
  return {
    asked,
    getJson: async (path) => {
      asked.push(path);
      return path in available ? available[path] : undefined;
    },
  };
}

describe('layeredBaseOf —— 清单地址 → 资源前缀', () => {
  test('根布局没有前缀', () => {
    assert.equal(layeredBaseOf('manifest.json'), '');
  });

  test('子目录布局带上目录名与斜杠', () => {
    assert.equal(layeredBaseOf('layered/manifest.json'), 'layered/');
  });

  test('候选顺序固定：先根后子目录', () => {
    assert.deepEqual([...LAYERED_MANIFEST_PATHS], ['manifest.json', 'layered/manifest.json']);
  });

  test('选中一套皮肤时前缀就是那套皮肤的子目录', () => {
    assert.equal(layeredBaseOf('feiyu-05/manifest.json'), 'feiyu-05/');
  });
});

describe('layeredManifestPathOf —— 皮肤 id → 清单路径', () => {
  test('根布局的 id 是空串', () => {
    assert.equal(layeredManifestPathOf(''), 'manifest.json');
    assert.equal(layeredManifestPathOf(undefined), 'manifest.json');
    assert.equal(layeredManifestPathOf(null), 'manifest.json');
  });

  test('手法容错：反斜杠、首尾分隔符都归一', () => {
    assert.equal(layeredManifestPathOf('feiyu-05/'), 'feiyu-05/manifest.json');
    assert.equal(layeredManifestPathOf('\\feiyu-05\\'), 'feiyu-05/manifest.json');
    assert.equal(layeredManifestPathOf('  feiyu-05  '), 'feiyu-05/manifest.json');
  });
});

describe('layeredManifestPaths —— 加载顺序', () => {
  test('选中一套皮肤：它自己的清单排在根布局之前', () => {
    assert.deepEqual(layeredManifestPaths('feiyu-05'), [
      'feiyu-05/manifest.json',
      'manifest.json',
      'layered/manifest.json',
    ]);
  });

  test('没有选中（根布局）：只有两种根级布局，不重复', () => {
    assert.deepEqual(layeredManifestPaths(''), ['manifest.json', 'layered/manifest.json']);
  });

  test('皮肤本身就是 `layered` 时不重复问同一个地址', () => {
    assert.deepEqual(layeredManifestPaths('layered'), ['layered/manifest.json', 'manifest.json']);
  });
});

describe('resolveLayeredManifest —— 取到为止，最后按清单回落', () => {
  test('选中那套在：直接用它，不碰别处', async () => {
    const { asked, getJson } = fetcherOf({ 'feiyu-05/manifest.json': { layers: [] } });
    const hit = await resolveLayeredManifest('feiyu-05', getJson, async () => {
      throw new Error('不该走到清单回落');
    });
    assert.deepEqual(asked, ['feiyu-05/manifest.json']);
    assert.equal(hit?.path, 'feiyu-05/manifest.json');
    assert.equal(hit?.fellBack, false);
  });

  test('选中那套不在、根布局在：用根布局（它本来就是候选之一，不算回落、不额外告警）', async () => {
    const { getJson } = fetcherOf({ 'manifest.json': { layers: [] } });
    const hit = await resolveLayeredManifest('feiyu-05', getJson);
    assert.equal(hit?.path, 'manifest.json');
    assert.equal(hit?.fellBack, false);
  });

  test('候选全不在：按 /skins 的顺序再试一遍，命中即回落（切渲染方式后 model 还是另一种后端的值时靠它）', async () => {
    const { asked, getJson } = fetcherOf({ 'feiyu-01/manifest.json': { layers: [] } });
    const hit = await resolveLayeredManifest('deepseek-live2d-skin/大肥鱼.model3.json', getJson, async () => [
      'feiyu-01',
      'feiyu-02',
    ]);
    assert.equal(hit?.path, 'feiyu-01/manifest.json');
    assert.equal(hit?.fellBack, true);
    // 模型路径被当成皮肤 id 试过一次，那是配置里的原值，不做特殊处理
    assert.deepEqual(asked, [
      'deepseek-live2d-skin/大肥鱼.model3.json/manifest.json',
      'manifest.json',
      'layered/manifest.json',
      'feiyu-01/manifest.json',
    ]);
  });

  test('清单里带根布局的空串 id：不会重复问已经问过的地址', async () => {
    const { asked, getJson } = fetcherOf({ 'feiyu-02/manifest.json': { layers: [] } });
    const hit = await resolveLayeredManifest('', getJson, async () => ['', 'feiyu-02']);
    assert.equal(hit?.path, 'feiyu-02/manifest.json');
    assert.deepEqual(asked, ['manifest.json', 'layered/manifest.json', 'feiyu-02/manifest.json']);
  });

  test('一处都没有：null（调用方抛自己的错，别编一个假清单）', async () => {
    const { getJson } = fetcherOf({});
    assert.equal(await resolveLayeredManifest('feiyu-05', getJson, async () => ['feiyu-01']), null);
  });

  test('清单接口本身炸了：也算没有，不往上抛', async () => {
    const { getJson } = fetcherOf({});
    const hit = await resolveLayeredManifest('feiyu-05', getJson, async () => {
      throw new Error('network down');
    });
    assert.equal(hit, null);
  });
});
