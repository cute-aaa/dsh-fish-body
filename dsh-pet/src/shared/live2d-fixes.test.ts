/**
 * 逐模型修正表的契约测试：按文件名（可带路径）查要隐藏的 drawable 序号，未知模型返回空。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { hiddenDrawableIndexesOf } from './live2d-fixes.ts';

describe('hiddenDrawableIndexesOf —— 逐模型隐藏 drawable', () => {
  test('DeepSeek 公皮：鼻梁上的两块纯黑遮罩源不参与可见绘制', () => {
    assert.deepEqual(hiddenDrawableIndexesOf('大肥鱼.model3.json'), [513, 514]);
  });

  test('带子目录的相对路径只看最后一段', () => {
    assert.deepEqual(hiddenDrawableIndexesOf('深色/大肥鱼.model3.json'), [513, 514]);
  });

  test('没登记的模型 → 空数组（不动别人的模型）', () => {
    assert.deepEqual(hiddenDrawableIndexesOf('haru.model3.json'), []);
    assert.deepEqual(hiddenDrawableIndexesOf(''), []);
  });
});
