/**
 * 「素材与字体」卡：把可获取的资源包列出来，装 / 删。
 *
 * 这一卡刻意只做三件事——列清单、装、删。**不做下载进度条**：宿主的安装是同步等待的，
 * 按钮上标「处理中…」即可；进度条会诱导用户以为可以取消，而这里取消不了。
 *
 * 许可徽标必须显示在按钮**之前**：字体包与表情包的授权各不相同，用户应当在点下去之前
 * 就知道自己能拿它做什么（见 NOTICE 第 4、5、7 节）。
 * @module dsh-fish-body/src/client/settings/packs-card
 */
import type { FunctionComponent } from 'react';
import type { PackView } from './packs-api.ts';
import type { SettingsRuntime } from './runtime.ts';
import type { PacksState } from './use-packs.ts';
import { makeUiKit } from './ui.ts';

/** 卡片的输入。 */
export interface PacksCardProps {
  /** 保存中或配置未就绪时禁用全部控件。 */
  readonly busy: boolean;
  /** 资源包状态与动作（含清单、进行中的 id、结论文案）。 */
  readonly packs: PacksState;
}

/** 把字节数收成人读的大小（1.5 MB / 820 KB）。 */
function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

/**
 * 造「素材与字体」卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export function makePacksCard(rt: SettingsRuntime): FunctionComponent<PacksCardProps> {
  const { h, t } = rt;

  return function PacksCard(props: PacksCardProps) {
    const { cardHead, note } = makeUiKit({ h, t });
    const { packs, busy } = props;
    const disabled = busy || packs.busyId !== '';

    /** 一行：名字 + 许可徽标 + 动作；次行是体积与状态。 */
    const row = (pack: PackView) => {
      const acting = packs.busyId === pack.id;
      const state = acting
        ? t('packsWorking')
        : pack.installed === null
          ? t('packsNotInstalled')
          : pack.upToDate
            ? t('packsInstalledState')
            : t('packsOutdated');
      return h('div', {
        key: pack.id,
        className: 'dsh-pet-cfg__row',
        children: [
          h('div', {
            key: 'main',
            className: 'dsh-pet-cfg__rowMain',
            children: [
              h('span', { key: 'label', children: pack.label }),
              // 许可紧挨名字：这是「能不能商用」的唯一提示，不能塞进折叠区。
              h('span', { key: 'license', className: 'dsh-pet-cfg__badge', children: pack.license }),
              pack.installed === null
                ? h('div', {
                    key: 'install',
                    className: 'dsh-pet-cfg__actions',
                    children: [
                      h('button', {
                        key: 'online',
                        type: 'button',
                        className: 'dsh-pet-cfg__btn',
                        disabled,
                        onClick: () => packs.install(pack.id),
                        children: acting ? t('packsWorking') : t('packsInstall'),
                      }),
                      h('button', {
                        key: 'zip',
                        type: 'button',
                        className: 'dsh-pet-cfg__btn is-text',
                        disabled,
                        onClick: () => packs.installLocal(pack.id, 'zip'),
                        children: t('packsInstallZip'),
                      }),
                      h('button', {
                        key: 'dir',
                        type: 'button',
                        className: 'dsh-pet-cfg__btn is-text',
                        disabled,
                        onClick: () => packs.installLocal(pack.id, 'dir'),
                        children: t('packsInstallDir'),
                      }),
                    ],
                  })
                : h('button', {
                    key: 'remove',
                    type: 'button',
                    className: 'dsh-pet-cfg__btn is-text',
                    disabled,
                    onClick: () => packs.remove(pack.id),
                    children: acting ? t('packsWorking') : t('packsRemove'),
                  }),
            ],
          }),
          h('div', {
            key: 'meta',
            className: 'dsh-pet-cfg__rowMeta',
            children: [sizeText(pack.bytes), state, pack.note ?? ''].filter((part) => part !== '').join(' · '),
          }),
        ],
      });
    };

    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('packsTitle'), t('packsHint')),
        packs.items.length === 0
          ? note(t('packsEmpty'))
          : h('div', { key: 'rows', className: 'dsh-pet-cfg__rows', children: packs.items.map(row) }),
        packs.message !== '' ? note(packs.message, packs.failed) : null,
        note(t('packsFontsHint')),
      ],
    });
  };
}
