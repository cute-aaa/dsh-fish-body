/**
 * 右键「动作」树按渲染方式差异化的判据测试：皮肤清单手势、model3 声明、以及两端的选树入口。
 *
 * 浏览器（card/entry）与桌面（sprite/menu）经 shared-core 共用同一份实现，所以钉在这里；
 * 动作名是两端渲染器 `playAction` 的入参，格式一改就得两边同时改，测试是这条契约的唯一守卫。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  actionMenuTree,
  model3ActionGroups,
  model3ExpressionRefs,
  model3ExpressionReset,
  model3Expressions,
  model3Motions,
  rendererActionTree,
  resolveModelFile,
  skinMenuGroups,
} from './renderer-actions.ts';
import type { Animations } from '../types.ts';

/** 一份最小动画池（只有 webm 分支读它）。 */
const animations = {
  idle: ['待机呼吸'],
  turn: [],
  drag: [],
  clicks: ['点击回应-开心'],
  moves: { default: {}, actions: [] },
  categories: [],
  events: {},
} as unknown as Animations;

describe('skinMenuGroups —— 皮肤清单 interaction.menu', () => {
  test('手势 id 按声明顺序折成中文条目，name 仍是手势 id', () => {
    const groups = skinMenuGroups(['wag', 'tailpet', 'pat', 'hop', 'blink', 'talk', 'mouth']);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, '皮肤手势');
    assert.deepEqual(
      groups[0].actions.map((action) => action.name),
      ['wag', 'tailpet', 'pat', 'hop', 'blink', 'talk', 'mouth'],
      'name 必须是 rig 认识的手势 id，不能是中文文案',
    );
    assert.equal(groups[0].actions[0].label, '摇尾巴');
  });

  test('宿主应用命令（separator / resize / recenter / hide / quit）与重复项被丢掉', () => {
    const groups = skinMenuGroups(['mouth', 'separator', 'resize', 'recenter', 'hide', 'quit', 'mouth', 'MOUTH']);
    assert.deepEqual(
      groups[0].actions.map((action) => action.name),
      ['mouth'],
      '应用命令不是动作，重复手势只留第一次',
    );
  });

  test('没有任何可播条目 → 空数组（菜单里不出现空的「动作」）', () => {
    assert.deepEqual(skinMenuGroups([]), []);
    assert.deepEqual(skinMenuGroups(['separator', 'resize', 'quit']), []);
  });
});

describe('model3ActionGroups —— model3 的 Motions / Expressions', () => {
  test('motion 组逐组展开，多条目用「组名 序号」区分；Idle 组不进菜单', () => {
    const groups = model3ActionGroups({
      FileReferences: {
        Motions: {
          Idle: [{ File: 'Animation/IDLE.motion3.json' }],
          TapBody: [{ File: 'a.json' }, { File: 'b.json' }],
          Broken: 'not-an-array',
        },
      },
    });
    assert.equal(groups.length, 1, '待机组与坏形状都不出现');
    assert.equal(groups[0]?.label, 'TapBody');
    assert.deepEqual(groups[0]?.actions, [
      { label: 'TapBody 1', name: 'motion:TapBody:0' },
      { label: 'TapBody 2', name: 'motion:TapBody:1' },
    ]);
  });

  test('声明的 Name 是菜单文案（VTube 热键名就补在这里）', () => {
    const groups = model3ActionGroups({
      FileReferences: {
        Motions: {
          Animation: [
            { File: 'a.json', Name: '抚胸手打开' },
            { File: 'b.json', Name: '竖手指打开' },
          ],
        },
      },
    });
    assert.deepEqual(
      groups[0]?.actions.map((action) => action.label),
      ['抚胸手打开', '竖手指打开'],
    );
  });

  test('Expressions 不进「动作」：外观是挂着的状态，归「外观」子菜单', () => {
    const raw = {
      FileReferences: {
        Motions: { Animation: [{ File: 'a.json' }] },
        Expressions: [{ Name: '脸红', File: 'a.exp3.json' }, { File: 'b.exp3.json' }],
      },
    };
    assert.deepEqual(
      model3ActionGroups(raw).map((group) => group.label),
      ['Animation'],
      '动作树里只留 motion 组',
    );
    assert.deepEqual(model3Expressions(raw), ['脸红'], '缺 Name 的表情跳过，其余留给外观菜单');
  });

  test('未声明 / 坏形状 → 空数组（DeepSeek 公皮就是这一种）', () => {
    assert.deepEqual(model3ActionGroups({ Version: 3, FileReferences: { Moc: 'a.moc3' } }), []);
    assert.deepEqual(model3ActionGroups({ FileReferences: { Motions: {} } }), []);
    assert.deepEqual(model3ActionGroups(null), []);
    assert.deepEqual(model3Expressions({ FileReferences: {} }), []);
  });
});

describe('model3Motions / model3ExpressionRefs —— 点哪个文件、定格与淡入', () => {
  test('动作表带 File / hold / fadeSeconds，序号与原声明一致', () => {
    const motions = model3Motions({
      FileReferences: {
        Motions: {
          Animation: [
            { File: 'Animation/a.motion3.json', Name: '举手', FadeInTime: 0.2, StopsOnLastFrame: true },
            { File: 'Animation/b.motion3.json', Name: '放下' },
            { Name: '缺 File' },
          ],
        },
      },
    });
    assert.deepEqual(
      motions.map((motion) => [motion.action, motion.label, motion.file, motion.hold, motion.fadeSeconds]),
      [
        ['motion:Animation:0', '举手', 'Animation/a.motion3.json', true, 0.2],
        ['motion:Animation:1', '放下', 'Animation/b.motion3.json', false, undefined],
      ],
      '缺 File 的条目不可播，整条丢掉（序号仍是声明里的位置）',
    );
  });

  test('外观表带文件与淡入；缺 Name / File 的跳过', () => {
    assert.deepEqual(
      model3ExpressionRefs({
        FileReferences: {
          Expressions: [
            { Name: '单片眼镜', File: 'Exp3/a.exp3.json' },
            { Name: '脸红', File: 'Exp3/b.exp3.json', FadeSecondsAmount: 0.5 },
            { Name: '' },
          ],
        },
      }),
      [
        { name: '单片眼镜', file: 'Exp3/a.exp3.json', fadeSeconds: undefined },
        { name: '脸红', file: 'Exp3/b.exp3.json', fadeSeconds: 0.5 },
      ],
    );
  });

  test('复位外观文案来自清单的 ExpressionReset；没有或坏了给 null', () => {
    assert.equal(
      model3ExpressionReset({ FileReferences: { ExpressionReset: { Name: '关掉全部外观' } } }),
      '关掉全部外观',
    );
    assert.equal(
      model3ExpressionReset({ FileReferences: { ExpressionReset: { Name: '  关掉全部外观  ' } } }),
      '关掉全部外观',
    );
    assert.equal(model3ExpressionReset({ FileReferences: {} }), null);
    assert.equal(model3ExpressionReset({ FileReferences: { ExpressionReset: { Name: 3 } } }), null);
    assert.equal(model3ExpressionReset(null), null);
  });

  test('资源 File 相对模型目录解析：池里模型要补上目录前缀', () => {
    // 守卫「右键动作/外观点下去什么都不播」：清单 File 相对模型目录，取文件走的是
    // 相对素材根的 URL，缺了模型目录就是 404。
    assert.equal(
      resolveModelFile('deepseek-live2d-skin/大肥鱼.model3.json', 'Animation/举手.motion3.json'),
      'deepseek-live2d-skin/Animation/举手.motion3.json',
    );
    assert.equal(
      resolveModelFile('deepseek-live2d-skin/大肥鱼.model3.json', 'Exp3/兔牙.exp3.json'),
      'deepseek-live2d-skin/Exp3/兔牙.exp3.json',
    );
    // 模型就在素材根下：不加前缀，也不出现前导斜杠。
    assert.equal(resolveModelFile('大肥鱼.model3.json', 'Animation/x.motion3.json'), 'Animation/x.motion3.json');
  });
});

describe('rendererActionTree —— 动作树形状', () => {
  test('只有一组：条目直接摊在「动作」下', () => {
    const tree = rendererActionTree(skinMenuGroups(['blink', 'mouth']));
    assert.deepEqual(tree, [
      {
        label: '动作',
        children: [
          { label: '眨个眼', action: 'renderer-action', rendererAction: 'blink', keepOpen: true },
          { label: '张个嘴', action: 'renderer-action', rendererAction: 'mouth', keepOpen: true },
        ],
      },
    ]);
  });

  test('多组：每组一个子菜单（live2d 的多组 motion；待机组不出现）', () => {
    const tree = rendererActionTree(
      model3ActionGroups({
        FileReferences: {
          Motions: {
            TapBody: [{ File: 'a.json' }],
            TapHead: [{ File: 'b.json' }],
            Idle: [{ File: 'c.json' }],
          },
        },
      }),
    );
    assert.deepEqual(tree, [
      {
        label: '动作',
        children: [
          {
            label: 'TapBody',
            children: [
              { label: 'TapBody', action: 'renderer-action', rendererAction: 'motion:TapBody:0', keepOpen: true },
            ],
          },
          {
            label: 'TapHead',
            children: [
              { label: 'TapHead', action: 'renderer-action', rendererAction: 'motion:TapHead:0', keepOpen: true },
            ],
          },
        ],
      },
    ]);
  });

  test('给 resetAction 时末尾补一条「恢复默认动作」（叠加上去的姿态要有出口）', () => {
    const tree = rendererActionTree(skinMenuGroups(['blink']), 'motion-reset');
    assert.deepEqual(tree, [
      {
        label: '动作',
        children: [
          { label: '眨个眼', action: 'renderer-action', rendererAction: 'blink', keepOpen: true },
          { label: '恢复默认动作', action: 'renderer-action', rendererAction: 'motion-reset', keepOpen: true },
        ],
      },
    ]);
  });

  test('空组与空标签被剔掉，全空时返回空数组', () => {
    assert.deepEqual(rendererActionTree([{ label: '空组', actions: [] }]), []);
    assert.deepEqual(rendererActionTree([{ label: '坏标签', actions: [{ label: ' ', name: 'blink' }] }]), []);
  });
});

describe('actionMenuTree —— 按渲染方式选树', () => {
  test('webm 走动画池，渲染器动作组一概不读', () => {
    const tree = actionMenuTree('webm', animations, skinMenuGroups(['blink']));
    assert.deepEqual(tree, [
      {
        label: '动作',
        children: [
          { label: '待机', children: [{ label: '待机呼吸', anim: '待机呼吸', keepOpen: true }] },
          { label: '点击回应', children: [{ label: '点击回应-开心', anim: '点击回应-开心', keepOpen: true }] },
        ],
      },
    ]);
  });

  test('layered 走皮肤手势，不再混入 webm 动画池', () => {
    const tree = actionMenuTree('layered', animations, skinMenuGroups(['pat', 'wag']));
    assert.deepEqual(tree, [
      {
        label: '动作',
        children: [
          { label: '摸摸头', action: 'renderer-action', rendererAction: 'pat', keepOpen: true },
          { label: '摇尾巴', action: 'renderer-action', rendererAction: 'wag', keepOpen: true },
        ],
      },
    ]);
  });

  test('live2d 未声明动作 → 没有「动作」树（只留渲染方式与模型）', () => {
    assert.deepEqual(actionMenuTree('live2d', animations, []), []);
  });
});
