/**
 * 分区底部的常驻操作栏：反馈文案 + 重启 / 取消 / 应用 / 确定。
 *
 * 贴底常显（`position:sticky`），长表单滚动时四个动作始终在手边；按钮顺序按「越靠右越终局」
 * 排，确定用实心主按钮。写盘或配置未就绪时禁掉的只有会改东西的三个（重启 / 应用 / 确定）：
 * 「取消」只关闭页面，留着它才有退路——它同时也是「配置读失败」时唯一能用的按钮。
 * owns only 按钮与反馈的排布，never 保存 / 关闭 / 重启的实现。
 * @module dsh-pet/src/client/settings/bar
 */
import type { FunctionComponent } from 'react';
import type { Feedback } from './feedback.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

/** 底部操作栏的输入。 */
export interface BarProps {
  /** 保存中或配置未就绪：四个按钮一起禁用。 */
  readonly busy: boolean;
  /** 保存 / 重置 / 重启的最近一次结论。 */
  readonly msg: Feedback;
  /** 确定：保存成功后由外壳关闭设置页。 */
  onConfirm(): void;
  /** 取消：不保存直接关闭设置页。 */
  onCancel(): void;
  /** 应用：保存但不关闭。 */
  onApply(): void;
  /** 重启：先保存，再让宿主重新组合本插件。 */
  onRestart(): void;
}

/**
 * 造底部操作栏。
 *
 * @param rt - 注入的节点工厂与翻译函数。
 * @returns 操作栏组件。
 */
export function makeBar(rt: SettingsRuntime): FunctionComponent<BarProps> {
  const { h, t } = rt;
  const { tip } = makeUiKit({ h, t });

  return function Bar(props: BarProps) {
    const { busy, msg } = props;
    return h('div', {
      className: 'dsh-pet-cfg__bar',
      role: 'group',
      'aria-label': t('barGroup'),
      children: [
        msg.text
          ? h('span', {
              key: 'msg',
              className: 'dsh-pet-cfg__msg' + (msg.kind === 'err' ? ' is-err' : ''),
              role: 'status',
              children: msg.text,
            })
          : null,
        // 撑开中间：反馈贴左、动作贴右，反馈出现 / 消失时按钮不跳位。
        h('span', { key: 'spacer', className: 'dsh-pet-cfg__barSpacer' }),
        h('button', {
          key: 'restart',
          type: 'button',
          className: 'dsh-pet-cfg__btn',
          disabled: busy,
          onClick: props.onRestart,
          ...tip(t('barRestartHint')),
          children: t('barRestart'),
        }),
        h('button', {
          key: 'cancel',
          type: 'button',
          className: 'dsh-pet-cfg__btn',
          onClick: props.onCancel,
          ...tip(t('barCancelHint')),
          children: t('barCancel'),
        }),
        h('button', {
          key: 'apply',
          type: 'button',
          className: 'dsh-pet-cfg__btn',
          disabled: busy,
          onClick: props.onApply,
          ...tip(t('barApplyHint') + '（' + t('saveHotkey') + '）'),
          children: t('barApply'),
        }),
        h('button', {
          key: 'confirm',
          type: 'button',
          className: 'dsh-pet-cfg__btn is-primary',
          disabled: busy,
          onClick: props.onConfirm,
          ...tip(t('barConfirmHint')),
          children: t('barConfirm'),
        }),
      ],
    });
  };
}
