/**
 * 前台窗口行的解析（src/shared/foreground.ts）。
 *
 * 采集端是长驻 PowerShell，输出质量取决于窗口状态：最小化/UWP 壳会给出 0×0 甚至负值。
 * 这组测试钉的是「坏行一律当不知道」，而不是拿半截数据去决定要不要藏宠物。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeAppName, parseForegroundLine } from './foreground.ts';

describe('parseForegroundLine', () => {
  test('平铺写法（采集端的真实输出）', () => {
    const snap = parseForegroundLine('{"pid":1234,"app":"chrome","title":"深度求索","x":0,"y":0,"w":3840,"h":2160}');
    assert.deepEqual(snap, {
      pid: 1234,
      app: 'chrome',
      title: '深度求索',
      rect: { x: 0, y: 0, width: 3840, height: 2160 },
    });
  });

  test('嵌套 rect 写法也接受（便于手写与测试）', () => {
    const snap = parseForegroundLine(
      JSON.stringify({ pid: 7, app: 'Code', title: '', rect: { x: -1920, y: 0, width: 1920, height: 1080 } }),
    );
    assert.deepEqual(snap?.rect, { x: -1920, y: 0, width: 1920, height: 1080 });
    assert.equal(snap?.title, '');
  });

  test('坏行：非 JSON / 空串 / 非字符串', () => {
    for (const bad of ['', '   ', '{oops', null, undefined, 42]) {
      assert.equal(parseForegroundLine(bad), null, String(bad));
    }
  });

  test('字段不可用：pid 非法、缺坐标、零/负尺寸', () => {
    assert.equal(parseForegroundLine('{"pid":0,"app":"a","x":0,"y":0,"w":10,"h":10}'), null);
    assert.equal(parseForegroundLine('{"pid":"x","app":"a","x":0,"y":0,"w":10,"h":10}'), null);
    assert.equal(parseForegroundLine('{"pid":1,"app":"a","y":0,"w":10,"h":10}'), null);
    assert.equal(parseForegroundLine('{"pid":1,"app":"a","x":0,"y":0,"w":0,"h":10}'), null);
    assert.equal(parseForegroundLine('{"pid":1,"app":"a","x":0,"y":0,"w":10,"h":-5}'), null);
  });

  test('进程名归一：去 .exe、去空白、小写', () => {
    assert.equal(normalizeAppName(' Chrome.EXE '), 'chrome');
    assert.equal(normalizeAppName('Code'), 'code');
    assert.equal(normalizeAppName(undefined), '');
  });
});
