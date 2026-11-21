/**
 * VTube Studio 热键表的解析与文件探测：菜单文案、淡入时长、定格标记都从这里来。
 *
 * 守卫重点是「热键里的文件名不带目录」——不探测就取不到文件，菜单会多出点不动的条目；
 * 以及「非素材热键要跳过」（`RemoveAllExpressions` / 移动模型这类不是动作）。
 * 跑法：node --experimental-strip-types --test src/host/vtube.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseVtubeHotkeys, readVtubeHotkeys, vtubeFileOf } from './vtube.ts';

/** 造一个带 Animation / Exp3 的模型目录。 */
function makeDir(files: { animation?: string[]; exp3?: string[] }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-vtube-'));
  for (const [folder, names] of [
    ['Animation', files.animation ?? []],
    ['Exp3', files.exp3 ?? []],
  ] as const) {
    if (names.length === 0) continue;
    mkdirSync(join(dir, folder));
    for (const name of names) writeFileSync(join(dir, folder, name), '{}');
  }
  return dir;
}

/** 一条热键的原始形状（只写被测字段）。 */
const hotkey = (over: Record<string, unknown>): unknown => ({
  HotkeyID: 'x',
  Name: '热键',
  Action: 'TriggerAnimation',
  File: 'a.motion3.json',
  FadeSecondsAmount: 0.2,
  StopsOnLastFrame: false,
  ...over,
});

describe('parseVtubeHotkeys —— 热键 → 动作/外观', () => {
  test('TriggerAnimation 带淡入与定格，ToggleExpression 只有名字与文件', () => {
    const dir = makeDir({ animation: ['举手.motion3.json'], exp3: ['脸红.exp3.json'] });
    const parsed = parseVtubeHotkeys(
      {
        Hotkeys: [
          hotkey({ Name: '抚胸手打开', File: '举手.motion3.json', FadeSecondsAmount: 0.2, StopsOnLastFrame: true }),
          hotkey({ Name: '脸红', Action: 'ToggleExpression', File: '脸红.exp3.json', FadeSecondsAmount: 0.5 }),
        ],
      },
      dir,
    );
    assert.deepEqual(parsed.motions, [
      { name: '抚胸手打开', file: 'Animation/举手.motion3.json', fadeSeconds: 0.2, hold: true },
    ]);
    assert.deepEqual(parsed.expressions, [{ name: '脸红', file: 'Exp3/脸红.exp3.json', fadeSeconds: 0.5 }]);
    assert.equal(parsed.resetExpressions, null);
  });

  test('RemoveAllExpressions 收下名字（复位项文案用它），其余非素材热键仍跳过', () => {
    const dir = makeDir({ animation: ['a.motion3.json'] });
    const parsed = parseVtubeHotkeys(
      {
        Hotkeys: [
          hotkey({ Name: '关掉全部外观', Action: 'RemoveAllExpressions', File: '' }),
          hotkey({ Name: '移动模型', Action: 'MoveModel', File: '' }),
          hotkey({ Name: '真的动作' }),
        ],
      },
      dir,
    );
    assert.equal(parsed.motions.length, 1);
    assert.equal(parsed.motions[0]?.name, '真的动作');
    assert.equal(parsed.expressions.length, 0);
    assert.equal(parsed.resetExpressions, '关掉全部外观');
  });

  test('多条 RemoveAllExpressions 只取第一条，空名不算', () => {
    const parsed = parseVtubeHotkeys({
      Hotkeys: [
        { Name: '', Action: 'RemoveAllExpressions' },
        { Name: '第一颗', Action: 'RemoveAllExpressions' },
        { Name: '第二颗', Action: 'RemoveAllExpressions' },
      ],
    });
    assert.equal(parsed.resetExpressions, '第一颗');
  });

  test('磁盘上没有这份文件的热键整条丢弃（不留下点不动的菜单项）', () => {
    const dir = makeDir({ animation: ['有.motion3.json'] });
    const parsed = parseVtubeHotkeys(
      { Hotkeys: [hotkey({ Name: '有', File: '有.motion3.json' }), hotkey({ Name: '无', File: '无.motion3.json' })] },
      dir,
    );
    assert.deepEqual(
      parsed.motions.map((motion) => motion.name),
      ['有'],
    );
  });

  test('文件名也可能就在模型根目录（不在子目录里）', () => {
    const dir = makeDir({});
    writeFileSync(join(dir, 'root.motion3.json'), '{}');
    const parsed = parseVtubeHotkeys({ Hotkeys: [hotkey({ Name: '根目录', File: 'root.motion3.json' })] }, dir);
    assert.equal(parsed.motions[0]?.file, 'root.motion3.json');
  });

  test('没有目录信息时按 VTube 的约定猜目录', () => {
    const parsed = parseVtubeHotkeys({ Hotkeys: [hotkey({ Name: '猜' })] });
    assert.equal(parsed.motions[0]?.file, 'Animation/a.motion3.json');
  });

  test('坏结构一律给空结果，不抛异常', () => {
    for (const raw of [null, {}, { Hotkeys: 'nope' }, { Hotkeys: [null, 3, {}] }]) {
      assert.deepEqual(parseVtubeHotkeys(raw, undefined), { motions: [], expressions: [], resetExpressions: null });
    }
  });
});

describe('vtubeFileOf / readVtubeHotkeys —— 从模型清单定位热键表', () => {
  test('同名 .vtube.json；文件不存在时读空', () => {
    const dir = makeDir({ animation: ['a.motion3.json'] });
    const modelFile = join(dir, '大肥鱼.model3.json');
    assert.equal(vtubeFileOf(modelFile), join(dir, '大肥鱼.vtube.json'));
    assert.deepEqual(readVtubeHotkeys(modelFile), { motions: [], expressions: [], resetExpressions: null });
  });

  test('读得到热键表时按目录探测文件', () => {
    const dir = makeDir({ animation: ['a.motion3.json'] });
    const modelFile = join(dir, '大肥鱼.model3.json');
    writeFileSync(
      join(dir, '大肥鱼.vtube.json'),
      JSON.stringify({ Hotkeys: [hotkey({ Name: '举手', File: 'a.motion3.json' })] }),
    );
    assert.deepEqual(
      readVtubeHotkeys(modelFile).motions.map((motion) => [motion.name, motion.file]),
      [['举手', 'Animation/a.motion3.json']],
    );
  });

  test('坏 JSON（用户手改坏了）当没有热键表', () => {
    const dir = makeDir({});
    const modelFile = join(dir, '大肥鱼.model3.json');
    writeFileSync(join(dir, '大肥鱼.vtube.json'), '{ 坏掉');
    assert.deepEqual(readVtubeHotkeys(modelFile), { motions: [], expressions: [], resetExpressions: null });
  });
});
