/**
 * 插件维护卡（系统分区末尾）：重启插件、重置设置，以及这一页的分区说明。
 *
 * 这三个东西以前占着页面最显眼的位置——重启在底部操作栏、重置在每个分区底部各渲染一次、
 * 分区说明塞在标题的悬浮气泡里。它们都是「配一次就不动」的动作，所以集中到一张卡里：
 * 底部栏只留保存相关的按钮，页面底部也不再重复出现「重置」入口。
 * 两个按钮都不产生「未保存改动」：重启会先保存再重组，重置走宿主默认值写盘。
 * owns only 这张卡的排布，never 重启 / 重置 / 确认弹窗的实现。
 * @module dsh-fish-body/src/client/settings/maintenance-card
 */
import type { FunctionComponent } from 'react';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

/** 维护卡的输入。 */
export interface MaintenanceCardProps {
  /** 保存中或配置未就绪：两个按钮一起禁用。 */
  readonly busy: boolean;
  /** 页面级说明（分区怎么分、改完怎么存）。 */
  readonly intro: string;
  /** 重启：先保存，再让宿主重新组合本插件。 */
  onRestart(): void;
  /** 重置：弹确认后把全部设置写回内置默认。 */
  onReset(): void;
}

/**
 * 造插件维护卡。
 *
 * @param rt - 注入的节点工厂与翻译函数。
 * @returns 卡片组件。
 */
export function makeMaintenanceCard(rt: SettingsRuntime): FunctionComponent<MaintenanceCardProps> {
  const { h, t } = rt;

  return function MaintenanceCard(props: MaintenanceCardProps) {
    const { cardHead, note, tip } = makeUiKit({ h, t });
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('maintenanceTitle'), t('maintenanceHint')),
        h('div', {
          key: 'acts',
          className: 'dsh-pet-cfg__actions',
          children: [
            h('button', {
              key: 'restart',
              type: 'button',
              className: 'dsh-pet-cfg__btn',
              disabled: props.busy,
              onClick: props.onRestart,
              ...tip(t('barRestartHint')),
              children: t('barRestart'),
            }),
            // 唯一的破坏性入口：点击先弹确认，确认文案里写明「不可撤销」。
            h('button', {
              key: 'reset',
              type: 'button',
              className: 'dsh-pet-cfg__btn is-danger',
              disabled: props.busy,
              onClick: props.onReset,
              children: t('resetSettings'),
            }),
          ],
        }),
        note(t('resetHint')),
        note(props.intro, true),
      ],
    });
  };
}
