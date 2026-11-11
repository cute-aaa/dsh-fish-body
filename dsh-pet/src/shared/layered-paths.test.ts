/**
 * 分层清单路径的契约测试：两种布局的地址前缀必须能被拼成可取的 URL。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { LAYERED_MANIFEST_PATHS, layeredBaseOf } from './layered-paths.ts';

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
});
