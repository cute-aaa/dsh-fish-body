/**
 * 菜单放行判定与第三方菜单层级的单元测试。
 *
 * 这两份判据被浏览器与桌面两端共用（桌面经 shared-core 拿到同一份），所以钉在这里，
 * 免得一端改了另一端跟着漂移。
 * 跑法：node --experimental-strip-types --test src/shared/menu/tree.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPRESSION_RESET,
  accessoryMenuBranch,
  buildMoreBranch,
  isSleepAllowedAction,
  modelMenuBranch,
  readMenuItems,
  rendererMenuBranch,
  sizeMenuBranch,
  skinMenuBranch,
} from './tree.ts';
import type { MenuLeaf, MenuSlider } from './types.ts';
import { SIZE_MAX, SIZE_MIN, SIZE_STEP } from '../pet-size.ts';

describe('isSleepAllowedAction —— 睡着时仍然放行的动作', () => {
  test('睡觉 / 起来 / 维护类 / 第三方菜单项放行', () => {
    for (const action of ['sleep', 'wake', 'home', 'set-display', 'reload', 'reload-plugin', 'third-party']) {
      assert.equal(isSleepAllowedAction(action), true, action + ' 应放行');
    }
    // 鼠标穿透是窗口属性、不改宠物状态：睡着时也要能开/关，否则「点了没反应」会被当成 bug。
    assert.equal(isSleepAllowedAction('set-click-through'), true);
  });

  test('打扰类一律不放行（对话 / 碎碎念 / 余额 / 待办 / 动作点播）', () => {
    for (const action of ['chat', 'whisper', 'show-balance', 'todo']) {
      assert.equal(isSleepAllowedAction(action), false, action + ' 应被拒');
    }
    // 点播动画的叶子只有 anim、没有 action
    assert.equal(isSleepAllowedAction(undefined), false);
  });
});

describe('buildMoreBranch —— 「更多」：label 唯一平铺，重名收进 owner 子菜单', () => {
  test('没有第三方项 → null（菜单里不出现空的「更多」）', () => {
    assert.equal(buildMoreBranch([]), null);
  });

  test('label 全局唯一 → 直接平铺在「更多」下，顺序 = 注册顺序', () => {
    const items = [
      { owner: '状态桥', label: '今日积分' },
      { owner: '小游戏', label: '弹弓' },
    ];
    assert.deepEqual(buildMoreBranch(items), {
      label: '更多',
      children: [
        { label: '今日积分', action: 'third-party', owner: '状态桥' },
        { label: '弹弓', action: 'third-party', owner: '小游戏' },
      ],
    });
  });

  test('label 重名 → 每个 owner 在「更多」下各占一个子菜单，子项仍是原 label', () => {
    const items = [
      { owner: '插件A', label: '签到' },
      { owner: '插件B', label: '签到' },
    ];
    assert.deepEqual(buildMoreBranch(items), {
      label: '更多',
      children: [
        { label: '插件A', children: [{ label: '签到', action: 'third-party', owner: '插件A' }] },
        { label: '插件B', children: [{ label: '签到', action: 'third-party', owner: '插件B' }] },
      ],
    });
  });

  test('同一 owner 的多个重名项收进同一个子菜单，组内保持注册顺序', () => {
    const items = [
      { owner: '插件A', label: '签到' },
      { owner: '插件B', label: '签到' },
      { owner: '插件A', label: '查积分' },
      { owner: '插件B', label: '查积分' },
    ];
    assert.deepEqual(buildMoreBranch(items), {
      label: '更多',
      children: [
        {
          label: '插件A',
          children: [
            { label: '签到', action: 'third-party', owner: '插件A' },
            { label: '查积分', action: 'third-party', owner: '插件A' },
          ],
        },
        {
          label: '插件B',
          children: [
            { label: '签到', action: 'third-party', owner: '插件B' },
            { label: '查积分', action: 'third-party', owner: '插件B' },
          ],
        },
      ],
    });
  });

  test('唯一项与重名项混合：唯一项平铺，重名项才进 owner 子菜单', () => {
    const items = [
      { owner: '插件A', label: '签到' },
      { owner: '小游戏', label: '弹弓' },
      { owner: '插件B', label: '签到' },
    ];
    assert.deepEqual(buildMoreBranch(items), {
      label: '更多',
      children: [
        { label: '插件A', children: [{ label: '签到', action: 'third-party', owner: '插件A' }] },
        { label: '弹弓', action: 'third-party', owner: '小游戏' },
        { label: '插件B', children: [{ label: '签到', action: 'third-party', owner: '插件B' }] },
      ],
    });
  });

  test('重名判定用端过滤之后的结果：本端只有一条时不该被另一端拖进子菜单', () => {
    const data = {
      items: [
        { owner: '插件A', label: '签到', target: 'web' },
        { owner: '插件B', label: '签到', target: 'desktop' },
      ],
    };
    assert.deepEqual(buildMoreBranch(readMenuItems(data, 'desktop')), {
      label: '更多',
      children: [{ label: '签到', action: 'third-party', owner: '插件B' }],
    });
    assert.deepEqual(buildMoreBranch(readMenuItems(data, 'web')), {
      label: '更多',
      children: [{ label: '签到', action: 'third-party', owner: '插件A' }],
    });
  });
});

describe('rendererMenuBranch —— 「渲染方式」子菜单', () => {
  test('三种后端各一个叶子，动作名与取值都对齐 pets[].renderer', () => {
    assert.deepEqual(rendererMenuBranch(), {
      label: '渲染方式',
      children: [
        { label: 'webm（视频）', action: 'set-renderer', renderer: 'webm' },
        { label: 'layered（分层 PNG）', action: 'set-renderer', renderer: 'layered' },
        { label: 'live2d（Cubism）', action: 'set-renderer', renderer: 'live2d' },
      ],
    });
  });

  test('给了当前值就在对应项上打勾（两端共用这一份选中态）', () => {
    const branch = rendererMenuBranch('layered');
    assert.deepEqual(
      branch.children.map((leaf) => leaf.label),
      ['webm（视频）', 'layered（分层 PNG） ✓', 'live2d（Cubism）'],
    );
  });

  test('缺素材的后端置灰不可点；当前值与未探测时的缺省都不置灰', () => {
    // 这一层按构造只有叶子（webm / layered / live2d 三项），断言前先收窄类型。
    const leavesOf = (branch: { children: unknown[] }): MenuLeaf[] => branch.children as MenuLeaf[];
    const branch = rendererMenuBranch('layered', ['webm', 'layered']);
    assert.deepEqual(
      leavesOf(branch).map((leaf) => leaf.disabled === true),
      [false, false, true],
      'live2d 没有 .model3.json → 置灰',
    );
    // 配置说当前是 live2d、探测却说没素材：以配置为准，不把正在用的项置灰。
    const configured = rendererMenuBranch('live2d', ['webm']);
    assert.equal(leavesOf(configured)[2]?.disabled, undefined);
    // 探测还没回来（缺省）：三项都可点，不耽误切换。
    assert.ok(leavesOf(rendererMenuBranch('webm')).every((leaf) => leaf.disabled === undefined));
  });

  test('睡着时放行：换后端不改宠物状态，属于维护类', () => {
    assert.equal(isSleepAllowedAction('set-renderer'), true);
  });
});

describe('modelMenuBranch —— 「模型」子菜单', () => {
  test('列出模型清单，当前选中的打勾', () => {
    assert.deepEqual(modelMenuBranch(['a.model3.json', 'b.model3.json'], 'b.model3.json'), {
      label: '模型',
      children: [
        { label: 'a.model3.json', action: 'set-model', model: 'a.model3.json' },
        { label: 'b.model3.json ✓', action: 'set-model', model: 'b.model3.json' },
      ],
    });
  });

  test('清单为空 → null（菜单里不出现空的「模型」）', () => {
    assert.equal(modelMenuBranch([], undefined), null);
  });
});

describe('skinMenuBranch / accessoryMenuBranch —— 皮肤与外观（按渲染方式配套）', () => {
  test('皮肤：空串记作「默认皮肤」，当前那项打勾', () => {
    assert.deepEqual(skinMenuBranch(['', 'layered'], ''), {
      label: '皮肤',
      children: [
        { label: '默认皮肤 ✓', action: 'set-model', model: '' },
        { label: 'layered', action: 'set-model', model: 'layered' },
      ],
    });
    assert.equal(skinMenuBranch([], ''), null, '没有可切换的皮肤就不出现这一项');
  });

  test('外观：勾表示当前挂着它，末尾恒有「恢复默认外观」', () => {
    const branch = accessoryMenuBranch(['单片眼镜', '尾巴开关'], ['尾巴开关']);
    assert.ok(branch !== null);
    assert.equal(branch.label, '外观');
    assert.deepEqual(
      branch.children.map((leaf) => leaf.label),
      ['单片眼镜', '尾巴开关 ✓', '恢复默认外观'],
    );
    const reset = branch.children[2] as MenuLeaf;
    assert.equal(reset.rendererAction, EXPRESSION_RESET);
    assert.equal(accessoryMenuBranch([], []), null);
  });

  test('外观可同时挂多个：勾不只一个（眼镜 + 脸红 + 兔牙一起开）', () => {
    const branch = accessoryMenuBranch(['黑框眼镜', '脸红', '兔牙'], ['黑框眼镜', '兔牙']);
    const shown = branch?.children.map((leaf) => leaf.label) ?? [];
    assert.deepEqual(shown, ['黑框眼镜 ✓', '脸红', '兔牙 ✓', '恢复默认外观']);
  });
});

describe('sizeMenuBranch —— 「大小」子菜单（滑块 + 恢复默认）', () => {
  test('一级是滑块：初值 = 当前生效值，区间与步进取自 shared/pet-size', () => {
    const branch = sizeMenuBranch(555, 462);
    assert.equal(branch.label, '大小');
    const slider = branch.children[0] as MenuSlider;
    assert.equal(slider.slider, 'size');
    assert.equal(slider.value, 555, '滑块初值是当前生效值，不是基准值');
    assert.equal(slider.min, SIZE_MIN);
    assert.equal(slider.max, SIZE_MAX);
    assert.equal(slider.step, SIZE_STEP);
    assert.equal(slider.action, 'set-size');
  });

  test('越界/异常值夹回区间；非法当前值回落基准值', () => {
    assert.equal((sizeMenuBranch(99999, 462).children[0] as MenuSlider).value, SIZE_MAX);
    assert.equal((sizeMenuBranch(1, 462).children[0] as MenuSlider).value, SIZE_MIN);
    assert.equal((sizeMenuBranch(Number.NaN, 462).children[0] as MenuSlider).value, 462);
  });

  test('末尾一条是「恢复默认」：不带 size = 删掉当前渲染方式的覆盖', () => {
    const reset = sizeMenuBranch(462, 462).children[1] as MenuLeaf;
    assert.equal(reset.action, 'set-size');
    assert.equal(reset.size, undefined);
    assert.ok(reset.label.includes('462'), '文案带上基准值，让人知道会回到多大');
  });

  test('睡着时放行：改大小不改宠物状态，属于维护类', () => {
    assert.equal(isSleepAllowedAction('set-size'), true);
  });
});

describe('资源池 —— 清单来源标注', () => {
  test('皮肤子菜单：池里的皮肤后缀「（池）」，pack 里的不标', () => {
    const branch = skinMenuBranch(['winter', 'character1'], 'winter', [
      { id: 'winter', source: 'pack' },
      { id: 'character1', source: 'pool' },
    ]);
    assert.ok(branch !== null);
    assert.deepEqual(
      branch.children.map((child) => (child as { label: string }).label),
      ['winter ✓', 'character1（池）'],
    );
  });

  test('模型子菜单：没给 items 时文案保持纯 id（老调用方不受影响）', () => {
    const branch = modelMenuBranch(['a.model3.json'], 'a.model3.json');
    assert.deepEqual((branch?.children[0] as { label: string }).label, 'a.model3.json ✓');
  });

  test('模型子菜单：池里的模型也带标注', () => {
    const branch = modelMenuBranch(['m1/a.model3.json'], undefined, [{ id: 'm1/a.model3.json', source: 'pool' }]);
    assert.equal((branch?.children[0] as { label: string }).label, 'm1/a.model3.json（池）');
  });
});
