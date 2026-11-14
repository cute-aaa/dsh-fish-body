/**
 * 通用「打开文件夹」按钮：点一下让宿主打开对应目录；目录还没建时就地询问要不要创建。
 *
 * 为什么不做成每条目各写一遍：设置页上有三类地方要它（音效槽位、落盘位置卡、未来的其它卡），
 * 而「先打开 → not-found → 问 → 创建再打开」这套结论判定只该有一份。
 * 只用 `h` / `t` / `useState`：气泡是行内块（跟着行流走），不需要测宽高，也就不需要 ref 与 effect。
 * @module dsh-fish-body/src/client/settings/folder-button
 */
import { openFolderOf } from './open-folder.ts';
import type { FolderTarget } from '../../shared/folders.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 按钮的输入。 */
export interface FolderButtonProps {
  /** 目录类别（素材类或全局类）。 */
  which: FolderTarget;
  /** 素材类要打开的宠物；缺省用页面上第一只。 */
  petId?: string;
  /** 保存中等场景禁用。 */
  disabled?: boolean;
}

/** 行内提示：问「是否创建」或说明一次失败。 */
type FolderTip =
  { readonly kind: 'create'; readonly path: string } | { readonly kind: 'failed'; readonly message: string };

/**
 * 造按钮组件。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 接收类别名并负责打开/创建流程的组件。
 */
export function makeFolderButton(rt: Pick<SettingsRuntime, 'h' | 't' | 'useState'>) {
  const { h, t, useState } = rt;

  return function FolderButton(props: FolderButtonProps) {
    const [tip, setTip] = useState<FolderTip | null>(null);
    const [busy, setBusy] = useState(false);

    /** 打开一次；not-found 时转为就地询问，其它失败直接说明。 */
    const run = (create: boolean): void => {
      setBusy(true);
      void openFolderOf(props.which, props.petId, create).then((outcome) => {
        setBusy(false);
        if (outcome.ok) {
          setTip(null);
          return;
        }
        if (outcome.reason === 'not-found') {
          setTip({ kind: 'create', path: outcome.path });
          return;
        }
        setTip({ kind: 'failed', message: outcome.message === '' ? t('sfxOpenFolderFailed') : outcome.message });
      });
    };

    const tipNode =
      tip === null
        ? null
        : h('span', {
            key: 'tip',
            className: 'dsh-pet-cfg__note',
            children: [
              h('span', {
                key: 'm',
                children: tip.kind === 'create' ? t('sfxFolderMissing') : tip.message,
              }),
              tip.kind === 'create'
                ? h('code', { key: 'p', className: 'dsh-pet-cfg__sfxPattern', children: tip.path })
                : null,
              h('span', {
                key: 'a',
                children: [
                  tip.kind === 'create'
                    ? h('button', {
                        key: 'y',
                        type: 'button',
                        className: 'dsh-pet-cfg__btn is-sm is-primary',
                        disabled: busy,
                        onClick: () => run(true),
                        children: t('sfxFolderCreateYes'),
                      })
                    : null,
                  h('button', {
                    key: 'n',
                    type: 'button',
                    className: 'dsh-pet-cfg__btn is-sm',
                    onClick: () => setTip(null),
                    children: tip.kind === 'create' ? t('sfxFolderCreateNo') : t('sfxFolderDismiss'),
                  }),
                ],
              }),
            ],
          });

    return h('span', {
      className: 'dsh-pet-cfg__folderBtn',
      children: [
        h('button', {
          key: 'b',
          type: 'button',
          className: 'dsh-pet-cfg__btn is-sm',
          disabled: props.disabled === true || busy,
          onClick: () => run(false),
          children: t('sfxOpenFolder'),
        }),
        tipNode,
      ],
    });
  };
}

/** 按钮组件类型。 */
export type FolderButton = ReturnType<typeof makeFolderButton>;
