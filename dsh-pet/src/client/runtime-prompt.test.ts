/**
 * 运行时缺失弹窗（src/client/runtime-prompt.ts）的判定契约。
 *
 * 弹不弹只有四种组合值得钉死：宿主要不要、装没装、下载是否已在进行、用户按掉的是不是这一条。
 * 判定做成纯函数就是为了能这样直接断言——组件本身只管渲染。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { RuntimeSnapshot } from './settings/config/http.ts';
import { shouldPrompt } from './runtime-prompt.ts';

/** 造一份快照：默认「缺失、未装、桌面模式需要」。 */
function snapshot(overrides: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  return {
    runtime: { dir: 'D:/e', exe: 'D:/e/electron.exe', installed: false },
    download: { active: false, doneBytes: 0, totalBytes: 0 },
    prompt: { needed: true, reason: 'missing', since: 1000 },
    wanted: true,
    ...overrides,
  };
}

describe('shouldPrompt', () => {
  test('宿主说要、又没装：弹', () => {
    assert.equal(shouldPrompt(snapshot(), undefined), true);
  });

  test('宿主没说要（纯网页用户）：永远不弹', () => {
    assert.equal(shouldPrompt(snapshot({ prompt: { needed: false } }), undefined), false);
  });

  test('已经装好了：不弹（哪怕提示还挂着）', () => {
    assert.equal(
      shouldPrompt(
        snapshot({ runtime: { dir: 'D:/e', exe: 'D:/e/electron.exe', installed: true, version: '43.3.0' } }),
        undefined,
      ),
      false,
    );
  });

  test('按掉的正是这一条：不弹；来了新提示（since 更大）再弹', () => {
    assert.equal(shouldPrompt(snapshot(), 1000), false);
    assert.equal(shouldPrompt(snapshot(), 999), true);
    assert.equal(shouldPrompt(snapshot({ prompt: { needed: true, since: 2000 } }), 1000), true);
  });

  test('快照还没到：不弹（不拿空数据猜）', () => {
    assert.equal(shouldPrompt(undefined, undefined), false);
  });
});
