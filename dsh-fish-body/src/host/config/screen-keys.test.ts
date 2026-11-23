/**
 * 十三个看屏幕 / 避让键的写盘校验（src/host/config/screen-keys.ts）。
 *
 * 与运行期归一化的分工是这组测试的重点：**写盘拒绝、运行期夹取**。
 * 两条规则一旦混用，用户要么被静默改成自己没填过的值，要么能存进一份跑不起来的配置。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { screenPatchOf } from './screen-keys.ts';

describe('screenPatchOf', () => {
  test('只挑本批真的传了的键，没传的完全不碰', () => {
    const patch = screenPatchOf({ screenReadEnabled: true, pets: [] });
    assert.equal(patch.ok, true);
    if (!patch.ok) return;
    assert.deepEqual(patch.owned, ['screenReadEnabled']);
    assert.deepEqual(patch.value, { screenReadEnabled: true });
  });

  test('布尔键只认真布尔', () => {
    for (const bad of ['true', 1, null]) {
      const patch = screenPatchOf({ avoidAppsEnabled: bad });
      assert.equal(patch.ok, false, String(bad));
    }
  });

  test('数值键：越界拒绝（不夹取）、非整数拒绝、字符串数字接受', () => {
    const tooBig = screenPatchOf({ avoidDelayMs: 10001 });
    assert.equal(tooBig.ok, false);
    if (!tooBig.ok) assert.match(tooBig.message, /0–10000/);

    assert.equal(screenPatchOf({ screenReadIntervalSec: 29 }).ok, false);
    assert.equal(screenPatchOf({ avoidPollMs: 299 }).ok, false);
    assert.equal(screenPatchOf({ avoidDelayMs: 12.5 }).ok, false);
    assert.equal(screenPatchOf({ screenReadIntervalSec: 'abc' }).ok, false);

    const ok = screenPatchOf({ screenReadIntervalSec: '120', avoidDelayMs: 0 });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.deepEqual(ok.value, { screenReadIntervalSec: 120, avoidDelayMs: 0 });
  });

  test('时段：空串合法（= 不设），宽松写法归一，越界拒绝', () => {
    const empty = screenPatchOf({ screenReadQuietFrom: '', screenReadQuietTo: '' });
    assert.equal(empty.ok, true);
    if (empty.ok) assert.deepEqual(empty.value, { screenReadQuietFrom: '', screenReadQuietTo: '' });

    const loose = screenPatchOf({ screenReadQuietFrom: '9:5' });
    assert.equal(loose.ok, true);
    if (loose.ok) assert.equal(loose.value.screenReadQuietFrom, '09:05');

    assert.equal(screenPatchOf({ screenReadQuietTo: '24:00' }).ok, false);
    assert.equal(screenPatchOf({ screenReadQuietTo: 900 }).ok, false);
  });

  test('白名单：去重、拒绝空项 / 非字符串 / 超长 / 超条数', () => {
    const ok = screenPatchOf({ avoidApps: ['chrome.exe', 'Chrome.exe', '哔哩哔哩'] });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.deepEqual(ok.value.avoidApps, ['chrome.exe', '哔哩哔哩']);

    assert.equal(screenPatchOf({ avoidApps: [''] }).ok, false);
    assert.equal(screenPatchOf({ avoidApps: [1] }).ok, false);
    assert.equal(screenPatchOf({ avoidApps: ['x'.repeat(65)] }).ok, false);
    assert.equal(screenPatchOf({ avoidApps: 'chrome.exe' }).ok, false);
    const many = Array.from({ length: 51 }, (_, i) => 'app' + i + '.exe');
    const tooMany = screenPatchOf({ avoidApps: many });
    assert.equal(tooMany.ok, false);
    if (!tooMany.ok) assert.match(tooMany.message, /最多 50 条/);
  });

  test('整批校验：任一键非法即整体拒绝，不落半份', () => {
    const patch = screenPatchOf({ screenReadEnabled: true, avoidDelayMs: -1 });
    assert.equal(patch.ok, false);
  });
});
