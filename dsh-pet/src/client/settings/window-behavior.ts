/**
 * 窗口行为卡：一张卡两行——「鼠标穿透（这只）」与「锁定在当前屏幕（全部）」。
 *
 * 两行回答同一个问题：这个窗口能不能碰、能跑到哪。差别只在作用域：穿透是实例级
 * （`pets[i].clickThrough`，走 `onChange` 随保存落盘），锁屏是全局
 * （`global.confineToScreen`，走 `global.setFlag`，同样随保存落盘）。
 * 说明文案沿用宠物卡里的原文（桌面端整窗忽略鼠标、开启后右键菜单不可达），这里不新编。
 * owns only 这两行的排布与作用域标注，never 字段状态、保存与窗口实现。
 * @module dsh-fish-body/src/client/settings/window-behavior
 */
import type { FunctionComponent } from 'react';
import type { Pet } from '../../shared/types.ts';
import type { DirtyQuery } from './dirty.ts';
import type { PetPatch } from './pet-card-parts.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';
import type { GlobalSettings } from './use-global-settings.ts';

/** 窗口行为卡的输入。 */
export interface WindowBehaviorProps {
  /** 当前实例；`null` 时「鼠标穿透」置灰（没有可写的对象）。 */
  readonly pet: Pet | null;
  readonly petIndex: number;
  readonly busy: boolean;
  readonly dirty: DirtyQuery;
  /** 全局开关（`confineToScreen`）。 */
  readonly global: GlobalSettings;
  /** 实例字段补丁（`clickThrough`）。 */
  readonly onChange: (patch: PetPatch) => void;
}

/**
 * 造窗口行为卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export function makeWindowBehavior(rt: SettingsRuntime): FunctionComponent<WindowBehaviorProps> {
  const { h, t } = rt;

  return function WindowBehavior(props: WindowBehaviorProps) {
    const { pet, petIndex, busy, dirty, global } = props;
    const { cardHead, toggleCell, note } = makeUiKit({ h, t }, dirty);
    const at = 'pets.' + petIndex;

    /** 一行：开关 + 作用域徽标（「这只」/「全部」）。 */
    const row = (options: {
      readonly key: string;
      readonly label: string;
      readonly scope: string;
      readonly value: boolean;
      readonly disabled: boolean;
      readonly onToggle: (value: boolean) => void;
      readonly path: string;
    }) =>
      h('div', {
        key: options.key,
        className: 'dsh-pet-cfg__row',
        children: [
          toggleCell(options.label, options.value, options.disabled, options.onToggle, options.path),
          h('span', { key: 'scope', className: 'dsh-pet-cfg__treeBadge', children: t(options.scope) }),
        ],
      });

    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('windowBehaviorTitle'), t('windowBehaviorHint'), 'pets'),
        row({
          key: 'clickThrough',
          label: 'clickThrough',
          scope: 'scopeThis',
          value: pet?.clickThrough === true,
          disabled: busy || pet === null,
          onToggle: (value) => props.onChange({ clickThrough: value }),
          path: at + '.clickThrough',
        }),
        row({
          key: 'confine',
          label: 'confineToggle',
          scope: 'scopeAll',
          value: global.values.confineToScreen === true,
          disabled: busy,
          onToggle: (value) => global.setFlag('confineToScreen', value),
          path: 'global.confineToScreen',
        }),
        note(t('windowBehaviorNote'), true),
      ],
    });
  };
}
