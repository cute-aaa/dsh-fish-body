/**
 * `.exp3.json` 解析的契约测试：把外观变成「每帧重写的一组参数」。
 *
 * 三条契约：
 *   1. 参数只认 Id / Value / Blend，缺 `Blend` 按 `Add`（与 Cubism 一致），坏条目逐条跳过；
 *   2. 淡入淡出取文件里的 `FadeInTime` / `FadeOutTime`，缺省 0.2 秒（换外观不该等一秒）；
 *   3. 垃圾输入不抛：外观挂不上只是没效果，抛出去会把整帧渲染打断（画布黑掉）。
 *
 * 跑法：node --experimental-strip-types --test src/shared/live2d-exp3.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseExp3 } from './live2d-exp3.ts';

describe('parseExp3 —— 真实 exp3 形状', () => {
  test('兔牙：单个 Add 参数（VTube 导出的 key* 形状）', () => {
    const parsed = parseExp3({
      Type: 'Live2D Expression',
      IsModelCustomizationExpression: false,
      Parameters: [{ Id: 'key9', Value: 1.0, Blend: 'Add' }],
    });
    assert.deepEqual(parsed.parameters, [{ id: 'key9', value: 1, blend: 'Add' }]);
    assert.equal(parsed.fadeIn, 0.2, '文件没写淡入 → 缺省 0.2 秒');
  });

  test('三种混合方式都认；缺 Blend 按 Add', () => {
    const parsed = parseExp3({
      Parameters: [
        { Id: 'a', Value: 1, Blend: 'Add' },
        { Id: 'b', Value: 0.5, Blend: 'Multiply' },
        { Id: 'c', Value: 0, Blend: 'Overwrite' },
        { Id: 'd', Value: 2 },
      ],
    });
    assert.deepEqual(
      parsed.parameters.map((p) => p.blend),
      ['Add', 'Multiply', 'Overwrite', 'Add'],
    );
  });

  test('文件自带的淡入淡出优先', () => {
    const parsed = parseExp3({ FadeInTime: 0.8, FadeOutTime: 1.2, Parameters: [] });
    assert.equal(parsed.fadeIn, 0.8);
    assert.equal(parsed.fadeOut, 1.2);
  });
});

describe('parseExp3 —— 容错', () => {
  test('垃圾输入不抛：null / 字符串 / 数组 / 缺 Parameters', () => {
    for (const raw of [null, 'x', [], {}, { Parameters: 'key9' }]) {
      const parsed = parseExp3(raw);
      assert.deepEqual(parsed.parameters, [], `raw=${JSON.stringify(raw)} 应得到空参数`);
      assert.equal(parsed.fadeIn, 0.2);
    }
  });

  test('逐条跳过坏参数（缺 Id / 非数字 Value / 非对象）', () => {
    const parsed = parseExp3({
      Parameters: [{ Id: 'ok', Value: 1 }, { Value: 1 }, { Id: 'x', Value: '1' }, null, { Id: '', Value: 1 }],
    });
    assert.deepEqual(parsed.parameters, [{ id: 'ok', value: 1, blend: 'Add' }]);
  });

  test('负数 / 非有限淡入回落缺省', () => {
    assert.equal(parseExp3({ FadeInTime: -1 }).fadeIn, 0.2);
    assert.equal(parseExp3({ FadeInTime: Number.NaN }).fadeIn, 0.2);
  });

  test('参数条数有上限（防坏数据把每帧写爆）', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ Id: 'p' + String(i), Value: 1 }));
    assert.ok(parseExp3({ Parameters: many }).parameters.length <= 64);
  });
});

describe('外观常驻 —— 两端实现守卫', () => {
  // 背景：外观曾经走运行库的 `CubismExpressionMotion`，它是一次性动作（淡入 → 淡出 → isFinished），
  // 我们照动作的做法「播完出队」，于是参数回到默认值——用户看到的是外观闪一下，
  // 报上来是「兔牙没生效」。两端的叠加层都必须自己解析 exp3 并每帧重写参数。
  const web = readFileSync(fileURLToPath(new URL('../client/pet/render/live2d/overlay.ts', import.meta.url)), 'utf8');
  const desktop = readFileSync(
    fileURLToPath(new URL('../../runtime/electron-helper/sprite/overlay.js', import.meta.url)),
    'utf8',
  );

  test('两端都用 parseExp3 自己解析外观', () => {
    assert.ok(/parseExp3\(/.test(web), '网页端叠加层必须自己解析 exp3');
    assert.ok(/S\.parseExp3\(/.test(desktop), '桌面端叠加层必须自己解析 exp3');
  });

  test('两端都不再使用一次性表达式动作', () => {
    // 只禁「构造」：注释里提它是为了解释为什么不用，那是文档不是代码。
    assert.ok(
      !/CubismExpressionMotion\s*\.\s*create/.test(web),
      '网页端不该再 create CubismExpressionMotion（它挂不住）',
    );
    assert.ok(
      !/CubismExpressionMotion\s*\.\s*create/.test(desktop),
      '桌面端不该再 create CubismExpressionMotion（它挂不住）',
    );
  });

  test('两端都在 tick 里按帧写外观参数（不是播一次就完）', () => {
    for (const [name, src] of [
      ['网页端', web],
      ['桌面端', desktop],
    ] as const) {
      assert.ok(
        /entry\.kind === 'expression'[\s\S]{0,200}applyParams\(/.test(src),
        `${name}：tick 里必须每帧写外观参数`,
      );
    }
  });
});
