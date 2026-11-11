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

describe('isModelSettingsFile', () => {
  test('按扩展名判定，大小写不敏感，带路径也算', () => {
    assert.equal(isModelSettingsFile('大肥鱼.model3.json'), true);
    assert.equal(isModelSettingsFile('live2d/大肥鱼.MODEL3.JSON'), true);
    assert.equal(isModelSettingsFile('manifest.json'), false);
  });
});
