/**
 * 音效卡：音效总闸之外的「哪个时机响什么」——八个事件槽的开关与试听，加上明细折叠。
 *
 * 卡片回传槽位/开关与 hook 名单；文件名从哪来（皮肤 / 声音目录 / 动画同目录 / 内置默认）由宿主索引决定。
 * 每个槽位可以导入一份文件，宿主按当前建议落点自动命名；打开目录仍保留给批量整理。
 * 音量不在这里：分项音量由配置的 `sfx` 段表达，设置页只在总闸卡里留一个总音量。
 * 试听走共享播放器，不落盘、不进配置。
 * owns only 这张卡的装配，never 槽位状态机与索引。
 * @module dsh-fish-body/src/client/settings/sfx-card
 */
import type { FunctionComponent } from 'react';
import type { DirtyQuery } from './dirty.ts';
import { makeFolderButton } from './folder-button.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeSfxHooks } from './sfx-hooks.ts';
import { makeSfxSlotMeta, makeSfxSlotRows } from './sfx-slot-row.ts';
import type { SfxSettings } from './use-sfx-settings.ts';
import { NO_ASSET_IMPORTS, type AssetImportsState } from './use-asset-imports.ts';
import { makeUiKit } from './ui.ts';

/** 明细折叠正文的 id：与标题按钮的 `aria-controls` 成对。 */
const SOURCES_BODY_ID = 'pet-cfg-sfx-sources';

/** 音效卡的输入。 */
export interface SfxCardProps {
  /** 保存中或配置未就绪时禁用编辑。 */
  busy: boolean;
  /** 分区状态与试听入口。 */
  sfx: SfxSettings;
  /** 音效导入动作。 */
  assetImports?: AssetImportsState;
  /** 未保存改动查询口（本卡按「音效段整体」画一个点）。 */
  dirty: DirtyQuery;
}

/**
 * 造音效卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export function makeSfxCard(rt: SettingsRuntime): FunctionComponent<SfxCardProps> {
  const { h, t, useState } = rt;
  const SlotRows = makeSfxSlotRows(rt);
  const SlotMeta = makeSfxSlotMeta(rt);
  const Hooks = makeSfxHooks(rt);
  const FolderButton = makeFolderButton(rt);

  return function SfxCard(props: SfxCardProps) {
    const { busy, sfx } = props;
    const assetImports = props.assetImports ?? NO_ASSET_IMPORTS;
    const { cardHead, foldCard, note } = makeUiKit({ h, t }, props.dirty);
    const [sourcesOpen, setSourcesOpen] = useState(false);
    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        h('div', {
          key: 'slots',
          className: 'dsh-pet-cfg__card',
          children: [
            cardHead(
              t('sfxTitle'),
              t('sfxHint'),
              'sfx',
              h('div', {
                key: 'head-actions',
                className: 'dsh-pet-cfg__actions',
                children: [
                  h('button', {
                    key: 'import',
                    type: 'button',
                    className: 'dsh-pet-cfg__btn is-sm',
                    disabled: busy || assetImports.busy !== '',
                    onClick: () => {
                      void assetImports.importSharedSfx().then((ok) => {
                        if (ok) sfx.load();
                      });
                    },
                    children: assetImports.busy === 'sfx:shared:' ? t('assetImportWorking') : t('sfxImport'),
                  }),
                  h(FolderButton, { which: 'sound', disabled: busy }),
                ],
              }),
            ),
            h(SlotRows, { key: 'rows', busy, dirty: props.dirty, sfx }),
            note(t('sfxFileHint'), true),
            h(foldCard, {
              key: 'sources',
              id: SOURCES_BODY_ID,
              title: t('sfxSourcesTitle'),
              hint: t('sfxFileHint'),
              open: sourcesOpen,
              onToggle: () => setSourcesOpen(!sourcesOpen),
              body: [
                h(SlotMeta, {
                  busy,
                  sfx,
                  onImportSlot: (slot) => {
                    void assetImports.importSfxSlot(slot).then((ok) => {
                      if (ok) sfx.load();
                    });
                  },
                  importBusy: assetImports.busy,
                }),
              ],
            }),
          ],
        }),
        h(Hooks, {
          key: 'hooks',
          busy,
          dirty: props.dirty,
          sfx,
          onImportHook: (name) => {
            void assetImports.importHookSfx(name).then((ok) => {
              if (ok) sfx.load();
            });
          },
          importBusy: assetImports.busy,
        }),
      ],
    });
  };
}
