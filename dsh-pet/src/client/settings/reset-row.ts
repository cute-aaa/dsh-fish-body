/**
 * 设置项最底部的一行：重置说明 + 「重置设置」按钮。
 *
 * 它排在标签内容之后、底部栏之上，是这一页唯一一个「把已有配置抹掉」的入口，所以走危险样式，
 * 且真正动手前必须过确认弹窗（弹窗与派发都在外壳与写路径里，本文件只画按钮）。
 * owns only 这一行的外观与点击，never 重置的实现与确认流程。
 * @module dsh-pet/src/client/settings/reset-row
 */
import type { FunctionComponent } from 'react';
import type { SettingsRuntime } from './runtime.ts';

/** 重置行的输入。 */
export interface ResetRowProps {
  /** 保存中或配置未就绪：按钮禁用。 */
  readonly busy: boolean;
  /** 请求重置（外壳弹确认框）。 */
  onReset(): void;
}

/**
 * 造重置行。
 *
 * @param rt - 注入的节点工厂与翻译函数。
 * @returns 重置行组件。
 */
export function makeResetRow(rt: SettingsRuntime): FunctionComponent<ResetRowProps> {
  const { h, t } = rt;

  return function ResetRow(props: ResetRowProps) {
    return h('div', {
      className: 'dsh-pet-cfg__resetRow',
      children: [
        h('p', { key: 'note', className: 'dsh-pet-cfg__note', children: t('resetHint') }),
        h('button', {
          key: 'btn',
          type: 'button',
          className: 'dsh-pet-cfg__btn is-danger',
          disabled: props.busy,
          onClick: props.onReset,
          children: t('resetSettings'),
        }),
      ],
    });
  };
}
