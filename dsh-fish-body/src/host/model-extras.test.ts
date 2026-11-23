/**
 * 模型清单补全的契约测试：Animation / Exp3 目录里的素材要进清单，用户已写好的段落一律不覆盖。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isModelSettingsFile, mergeModelExtras } from './model-extras.ts';

/**
 * 造一个「模型目录」：model3 + 动作目录 + 表情目录。
 *
 * @param motionDirs - 要造的动作目录名（每个目录一个 motion3）。
 * @param expressionDirs - 要造的表情目录名（每个目录一个 exp3）。
 * @returns 模型清单的磁盘路径。
 */
function makeModel(motionDirs: readonly string[], expressionDirs: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-model-'));
  for (const name of motionDirs) {
    mkdirSync(join(dir, name));
    writeFileSync(
      join(dir, name, '默认手切举手.motion3.json'),
      JSON.stringify({ Version: 3, Meta: { Duration: 1.133 }, Curves: [] }),
    );
    writeFileSync(join(dir, name, '举手切默认手.motion3.json'), JSON.stringify({ Version: 3, Meta: {}, Curves: [] }));
  }
  for (const name of expressionDirs) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, '单片眼镜.exp3.json'), JSON.stringify({ Type: 'Live2D Expression' }));
  }
  const file = join(dir, '大肥鱼.model3.json');
  writeFileSync(file, JSON.stringify({ Version: 3, FileReferences: { Moc: '大肥鱼.moc3' } }));
  return file;
}

describe('mergeModelExtras —— 目录里的动作与表情补进清单', () => {
  test('Animation + Exp3：组名、条目名、时长、相对地址都对得上', () => {
    const file = makeModel(['Animation'], ['Exp3']);
    const merged = mergeModelExtras(file, JSON.parse('{"Version":3,"FileReferences":{"Moc":"大肥鱼.moc3"}}')) as {
      FileReferences: { Motions: Record<string, unknown[]>; Expressions: unknown[]; Moc: string };
    };
    assert.equal(merged.FileReferences.Moc, '大肥鱼.moc3', '原有字段不能丢');
    const motions = merged.FileReferences.Motions.Animation as Array<Record<string, unknown>>;
    assert.equal(motions.length, 2);
    // 目录里的文件名按码位排序，断言按名字查，不绑顺序。
    const withDuration = motions.find((m) => m.Name === '默认手切举手');
    const withoutDuration = motions.find((m) => m.Name === '举手切默认手');
    assert.deepEqual(withDuration, {
      File: 'Animation/默认手切举手.motion3.json',
      Name: '默认手切举手',
      FadeInTime: 0.3,
      Duration: 1.133,
    });
    assert.equal(withoutDuration?.Duration, undefined, 'Meta 没有 Duration 就不写这个字段');
    const expressions = merged.FileReferences.Expressions as Array<Record<string, unknown>>;
    assert.deepEqual(expressions[0], { Name: '单片眼镜', File: 'Exp3/单片眼镜.exp3.json' });
  });

  test('Motions 目录也认（Cubism 官方模板口径）', () => {
    const file = makeModel(['Motions'], []);
    const merged = mergeModelExtras(file, { FileReferences: {} }) as {
      FileReferences: { Motions: Record<string, unknown[]>; Expressions?: unknown };
    };
    assert.ok(Array.isArray(merged.FileReferences.Motions.Motions));
    assert.equal(merged.FileReferences.Expressions, undefined, '没有表情目录就不插段落');
  });

  test('文件名带 idle 的单独成 Idle 组（两端 setIdle 按组名起播）', () => {
    const file = makeModel(['Animation'], []);
    const idlePath = join(file, '..', 'Animation', 'IDLE.motion3.json');
    writeFileSync(idlePath, JSON.stringify({ Version: 3, Meta: { Duration: 5.983, Loop: true }, Curves: [] }));
    const merged = mergeModelExtras(file, { FileReferences: {} }) as {
      FileReferences: { Motions: Record<string, Array<Record<string, unknown>>> };
    };
    assert.equal(merged.FileReferences.Motions.Idle?.length, 1);
    assert.equal(merged.FileReferences.Motions.Idle?.[0]?.Name, 'IDLE');
    assert.equal(merged.FileReferences.Motions.Idle?.[0]?.Duration, 5.983);
    assert.equal(merged.FileReferences.Motions.Animation?.length, 2, '待机不再混进动作组');
  });

  test('用户自己写了 Motions / Expressions → 原样不动', () => {
    const file = makeModel(['Animation'], ['Exp3']);
    const raw = {
      FileReferences: {
        Motions: { Idle: [{ File: 'idle.motion3.json' }] },
        Expressions: [{ Name: '脸红', File: '脸红.exp3.json' }],
      },
    };
    assert.deepEqual(mergeModelExtras(file, raw), raw);
  });

  test('目录里什么都没有：清单一个字节都不改', () => {
    const file = makeModel([], []);
    const raw = { FileReferences: { Moc: 'x.moc3' } };
    assert.equal(mergeModelExtras(file, raw), raw);
    assert.equal(mergeModelExtras(file, null), null);
  });
});

describe('mergeModelExtras —— VTube Studio 工程优先', () => {
  /** 给模型目录补一份 `.vtube.json`（热键表）。 */
  const writeVtube = (file: string, hotkeys: readonly Record<string, unknown>[]): void => {
    writeFileSync(join(file, '..', '大肥鱼.vtube.json'), JSON.stringify({ Hotkeys: hotkeys }));
  };

  test('热键名当菜单文案，StopsOnLastFrame 带出来，顺序按热键表', () => {
    const file = makeModel(['Animation'], ['Exp3']);
    writeFileSync(
      join(file, '..', 'Animation', '默认手切举手.motion3.json'),
      JSON.stringify({ Version: 3, Meta: { Duration: 1.133 }, Curves: [] }),
    );
    writeVtube(file, [
      {
        Name: '抚胸手打开',
        Action: 'TriggerAnimation',
        File: '默认手切举手.motion3.json',
        FadeSecondsAmount: 0.2,
        StopsOnLastFrame: true,
      },
      {
        Name: '抚胸手关闭',
        Action: 'TriggerAnimation',
        File: '举手切默认手.motion3.json',
        FadeSecondsAmount: 0.2,
        StopsOnLastFrame: false,
      },
      { Name: '单片眼镜', Action: 'ToggleExpression', File: '单片眼镜.exp3.json' },
      { Name: '清空表情', Action: 'RemoveAllExpressions', File: '' },
    ]);
    const merged = mergeModelExtras(file, { FileReferences: {} }) as {
      FileReferences: { Motions: Record<string, Array<Record<string, unknown>>>; Expressions: unknown[] };
    };
    const motions = merged.FileReferences.Motions.Animation;
    assert.deepEqual(
      motions.map((motion) => motion.Name),
      ['抚胸手打开', '抚胸手关闭'],
      '文案取热键名而不是文件名，顺序取热键表',
    );
    assert.equal(motions[0]?.File, 'Animation/默认手切举手.motion3.json');
    assert.equal(motions[0]?.StopsOnLastFrame, true, '定格标记要传给叠加层');
    assert.equal(motions[0]?.Duration, 1.133);
    assert.equal(motions[1]?.StopsOnLastFrame, undefined, '不定格就不写这个字段');
    assert.deepEqual(merged.FileReferences.Expressions, [{ Name: '单片眼镜', File: 'Exp3/单片眼镜.exp3.json' }]);
    assert.deepEqual(
      (merged.FileReferences as { ExpressionReset?: unknown }).ExpressionReset,
      { Name: '清空表情' },
      '复位热键转成非标准字段，前端拿它当外观菜单末项的文案',
    );
  });

  test('外观热键的 FadeSecondsAmount 透传到清单条目（叠加层据此淡入）', () => {
    const file = makeModel([], ['Exp3']);
    writeVtube(file, [
      { Name: '脸红', Action: 'ToggleExpression', File: '单片眼镜.exp3.json', FadeSecondsAmount: 0.5 },
      { Name: '硬切的那个', Action: 'ToggleExpression', File: '单片眼镜.exp3.json' },
    ]);
    const merged = mergeModelExtras(file, { FileReferences: {} }) as {
      FileReferences: { Expressions: Array<Record<string, unknown>> };
    };
    assert.deepEqual(merged.FileReferences.Expressions[0], {
      Name: '脸红',
      File: 'Exp3/单片眼镜.exp3.json',
      FadeSecondsAmount: 0.5,
    });
    assert.equal(merged.FileReferences.Expressions[1]?.FadeSecondsAmount, undefined, '没写就不造字段');
  });

  test('热键表没给出素材时回落到目录扫描（Cubism 导出流程删掉 .vtube.json 也照常可用）', () => {
    const file = makeModel(['Animation'], ['Exp3']);
    writeVtube(file, [{ Name: '移除所有按键', Action: 'RemoveAllExpressions', File: '' }]);
    const merged = mergeModelExtras(file, { FileReferences: {} }) as {
      FileReferences: { Motions: Record<string, Array<Record<string, unknown>>>; Expressions: unknown[] };
    };
    assert.equal(merged.FileReferences.Motions.Animation?.length, 2, '按文件名补出来');
    assert.equal(merged.FileReferences.Expressions.length, 1);
  });

  test('热键没覆盖的文件也要补进来：待机 IDLE 成组、没绑热键的动作与表情接在后面', () => {
    const file = makeModel(['Animation'], ['Exp3']);
    // 目录里再加三份：待机循环、一个没绑热键的动作、一个没绑热键的表情
    writeFileSync(
      join(file, '..', 'Animation', 'IDLE.motion3.json'),
      JSON.stringify({ Version: 3, Meta: { Duration: 5.983, Loop: true }, Curves: [] }),
    );
    writeFileSync(
      join(file, '..', 'Animation', '脱捕.motion3.json'),
      JSON.stringify({ Version: 3, Meta: {}, Curves: [] }),
    );
    writeFileSync(join(file, '..', 'Exp3', '竖食指开.exp3.json'), JSON.stringify({ Type: 'Live2D Expression' }));
    writeVtube(file, [
      { Name: '抚胸手打开', Action: 'TriggerAnimation', File: '默认手切举手.motion3.json', StopsOnLastFrame: true },
      { Name: '单片眼镜', Action: 'ToggleExpression', File: '单片眼镜.exp3.json' },
    ]);
    const merged = mergeModelExtras(file, { FileReferences: {} }) as {
      FileReferences: {
        Motions: Record<string, Array<Record<string, unknown>>>;
        Expressions: Array<Record<string, unknown>>;
      };
    };
    // 热键在前、扫描在后（扫描按文件名码位排序）：菜单第一项就是用户在 VTube 里点的那个
    assert.deepEqual(
      merged.FileReferences.Motions.Animation?.map((motion) => motion.Name),
      ['抚胸手打开', '举手切默认手', '脱捕'],
      '热键动作 + 没绑热键的动作（跳过已被热键占用的那份）',
    );
    assert.equal(merged.FileReferences.Motions.Idle?.[0]?.Name, 'IDLE', '待机必须有 Idle 组，否则模型不会自己动');
    assert.deepEqual(
      merged.FileReferences.Expressions.map((expression) => expression.Name),
      ['单片眼镜', '竖食指开'],
      '热键外观在前，没绑热键的按文件名接在后面',
    );
  });

  test('用户自己声明了 Motions → 热键表整段让位', () => {
    const file = makeModel(['Animation'], []);
    writeVtube(file, [{ Name: '抚胸手打开', Action: 'TriggerAnimation', File: '默认手切举手.motion3.json' }]);
    const raw = { FileReferences: { Motions: { Idle: [{ File: 'idle.motion3.json' }] } } };
    assert.deepEqual(mergeModelExtras(file, raw), raw);
  });
});

describe('isModelSettingsFile', () => {
  test('按扩展名判定，大小写不敏感，带路径也算', () => {
    assert.equal(isModelSettingsFile('大肥鱼.model3.json'), true);
    assert.equal(isModelSettingsFile('live2d/大肥鱼.MODEL3.JSON'), true);
    assert.equal(isModelSettingsFile('manifest.json'), false);
  });
});
