/**
 * 「备份与恢复」卡：导出快照、或挑一个快照文件恢复。
 *
 * 放在「系统」分区靠前的位置：它是维护动作，不属于任何一个具体设置项，也不产生「未保存改动」。
 * 恢复走两步（选文件 → 确认弹窗 → 上传），所以卡片本身只负责把文件交出去，写盘时机不在这里。
 * @module dsh-pet/src/client/settings/backup-card
 */
import type { FunctionComponent } from 'react';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

/** 备份卡的输入。 */
export interface BackupCardProps {
  /** 保存 / 导出 / 恢复进行中：两个按钮一起禁用。 */
  readonly busy: boolean;
  /** 导出并下载一份快照。 */
  onExport(): void;
  /** 选中一个备份文件（预检与确认由外壳负责）。 */
  onPick(file: File): void;
}

/**
 * 造备份卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export function makeBackupCard(rt: SettingsRuntime): FunctionComponent<BackupCardProps> {
  const { h, t, useRef } = rt;
  const { cardHead } = makeUiKit({ h, t });

  return function BackupCard(props: BackupCardProps) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('backupTitle'), t('backupHint')),
        h('div', {
          className: 'dsh-pet-cfg__actions',
          children: [
            h('button', {
              key: 'export',
              type: 'button',
              className: 'dsh-pet-cfg__btn',
              disabled: props.busy,
              onClick: props.onExport,
              children: t('backupExport'),
            }),
            h('button', {
              key: 'restore',
              type: 'button',
              className: 'dsh-pet-cfg__btn',
              disabled: props.busy,
              onClick: () => inputRef.current?.click(),
              children: t('backupRestore'),
            }),
            // 真正的文件框藏起来：按钮只是触发它，样式与其它按钮一致。
            h('input', {
              key: 'file',
              ref: (element: HTMLInputElement | null) => {
                inputRef.current = element;
              },
              type: 'file',
              accept: '.json,application/json',
              style: { display: 'none' },
              'aria-hidden': 'true',
              tabIndex: -1,
              onChange: (event: { target: { files: FileList | null; value: string } }) => {
                const file = event.target.files?.[0];
                // 清空 value：连续选同一个文件也要能再次触发 change。
                event.target.value = '';
                if (file) props.onPick(file);
              },
            }),
          ],
        }),
      ],
    });
  };
}
