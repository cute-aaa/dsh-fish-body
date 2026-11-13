/**
 * 确认 / 提示弹窗：遮罩 + 居中卡片 + 按钮，样式全在 `./css` 的 `__mask` / `__dialog` 上。
 *
 * 六种场景各有自己的按钮组合：删除要确认、只剩一只（main / 某个种类）只能「知道了」、
 * 重置与「从备份恢复」要确认（都会写盘且不可撤销）、配置损坏要确认强行重建。
 * 确认后的动作由设置页外壳执行（它才知道怎么删、怎么带 force 存盘），这里只负责问与答。
 * owns only 问与答，never 删除 / 重置 / 恢复的实现。
 * @module dsh-pet/src/client/settings/dialog
 */
import type { FunctionComponent } from 'react';
import type * as ReactNS from 'react';
import type { SettingsRuntime } from './runtime.ts';

/** 弹窗场景；`corrupt` 带出宿主给的真实写入路径，`lastOfKind` 带出删不掉的种类名。 */
export type DialogState =
  | null
  | { kind: 'remove' }
  | { kind: 'lastOne' }
  | { kind: 'lastOfKind'; entry: string }
  | { kind: 'reset' }
  | { kind: 'restore'; name: string }
  | { kind: 'corrupt'; path: string };

/** 弹窗的输入。 */
export interface DialogProps {
  /** 当前场景；`null` 表示不显示。 */
  dialog: Exclude<DialogState, null>;
  /** 当前选中的宠物 id，用于「删除宠物 X」的确认文案。 */
  selId: string;
  /** 取消：点遮罩、取消按钮或「知道了」。 */
  onDismiss: () => void;
  /** 确认：由外壳按场景派发到删除 / 强行重建 / 同步。 */
  onConfirm: () => void;
}

/** 正文文案：每个场景一句，参数就地代入。 */
function bodyText(dialog: Exclude<DialogState, null>, t: (key: string) => string, selId: string): string {
  if (dialog.kind === 'remove') return t('confirmRemove').replace('{id}', selId);
  if (dialog.kind === 'lastOne') return t('atLeastOne');
  if (dialog.kind === 'lastOfKind') return t('lastOfKind').replace('{entry}', dialog.entry);
  if (dialog.kind === 'restore') return t('confirmRestore').replace('{name}', dialog.name);
  if (dialog.kind === 'corrupt') return t('corruptBody').replace('{path}', dialog.path);
  return t('confirmReset');
}

/** 确认按钮文案：三个可确认场景各一句。 */
function confirmLabel(kind: 'remove' | 'reset' | 'restore' | 'corrupt', t: (key: string) => string): string {
  if (kind === 'remove') return t('remove');
  if (kind === 'corrupt') return t('corruptConfirm');
  if (kind === 'restore') return t('restoreConfirm');
  return t('resetSettings');
}

/**
 * 造确认弹窗。
 *
 * @param rt - 注入的节点工厂与翻译函数。
 * @returns 弹窗组件。
 */
export function makeDialog(rt: SettingsRuntime): FunctionComponent<DialogProps> {
  const { h, t } = rt;

  return function SettingsDialog(props: DialogProps) {
    const { dialog } = props;
    // 只剩一只（main 或某个种类）没有可确认的动作：直接收窄成 null，下面的分支就不用再看 kind。
    const confirmable = dialog.kind === 'lastOne' || dialog.kind === 'lastOfKind' ? null : dialog;
    const title = t(dialog.kind === 'corrupt' ? 'corruptTitle' : 'confirmTitle');
    return h('div', {
      className: 'dsh-pet-cfg__mask',
      onClick: props.onDismiss,
      children: h('div', {
        className: 'dsh-pet-cfg__dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': title,
        onClick: (e: ReactNS.MouseEvent<HTMLDivElement>) => e.stopPropagation(),
        children: [
          h('div', { key: 'title', className: 'dsh-pet-cfg__dialogTitle', children: title }),
          h('div', { key: 'body', className: 'dsh-pet-cfg__dialogBody', children: bodyText(dialog, t, props.selId) }),
          h('div', {
            key: 'acts',
            className: 'dsh-pet-cfg__dialogActions',
            // 只剩一只没有可确认的动作，只给「知道了」；其余都是取消 + 确认双按钮。
            children:
              confirmable === null
                ? [
                    h('button', {
                      key: 'ok',
                      type: 'button',
                      onClick: props.onDismiss,
                      className: 'dsh-pet-cfg__btn is-primary',
                      children: t('ok'),
                    }),
                  ]
                : [
                    h('button', {
                      key: 'cancel',
                      type: 'button',
                      onClick: props.onDismiss,
                      className: 'dsh-pet-cfg__btn',
                      children: t('cancel'),
                    }),
                    h('button', {
                      key: 'confirm',
                      type: 'button',
                      onClick: props.onConfirm,
                      // 三个可确认场景都会丢东西：删除、重置、强行重建一律走危险样式。
                      className: 'dsh-pet-cfg__btn is-danger',
                      children: confirmLabel(confirmable.kind, t),
                    }),
                  ],
          }),
        ],
      }),
    });
  };
}
