/**
 * 音效卡：九个事件槽 + 自定义 hook 的只读来源与可编辑音量。
 *
 * 卡片只回传槽位与值——文件名从哪来（皮肤 / 声音目录 / 动画同目录 / 内置默认）由宿主索引决定，
 * 这一页不提供「挑文件」，要换文件就把音频放进对应目录（见 MAKE-YOUR-OWN-PET.md）。
 * 试听走共享播放器，不落盘、不进配置。
 * @module dsh-pet/src/client/settings/sfx-card
 */
import type { FunctionComponent } from 'react';
import type { SfxEventSlot } from '../../shared/types.ts';
import type { SettingsRuntime } from './runtime.ts';
import type { SfxSettings, SfxSlotView } from './use-sfx-settings.ts';
import { makeUiKit } from './ui.ts';

/** 音效卡的输入。 */
export interface SfxCardProps {
  /** 保存中或配置未就绪时禁用编辑。 */
  busy: boolean;
  /** 分区状态与试听入口。 */
  sfx: SfxSettings;
}

/** 槽位 → 文案键（`sfxSlot<Name>`）；顺序与 SFX_EVENT_SLOTS 一致。 */
const SLOT_LABEL: Record<SfxEventSlot, string> = {
  click: 'sfxSlotClick',
  drag: 'sfxSlotDrag',
  throw: 'sfxSlotThrow',
  floor: 'sfxSlotFloor',
  wall: 'sfxSlotWall',
  ceiling: 'sfxSlotCeiling',
  pet: 'sfxSlotPet',
  sleepStart: 'sfxSlotSleepStart',
  sleepEnd: 'sfxSlotSleepEnd',
};

/** 来源 → 文案键。 */
const ORIGIN_LABEL: Record<SfxSlotView['origin'], string> = {
  skin: 'sfxOriginSkin',
  sound: 'sfxOriginSound',
  animation: 'sfxOriginAnimation',
  user: 'sfxOriginUser',
  'package-default': 'sfxOriginDefault',
  config: 'sfxOriginConfig',
  none: 'sfxOriginNone',
};

/**
 * 造音效卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export function makeSfxCard(rt: SettingsRuntime): FunctionComponent<SfxCardProps> {
  const { h, t } = rt;
  const { cardHead, field, toggleCell } = makeUiKit({ h, t });

  return function SfxCard(props: SfxCardProps) {
    const { busy, sfx } = props;
    const row = (view: SfxSlotView) => {
      const label = t(SLOT_LABEL[view.slot] as Parameters<typeof t>[0]);
      const source = t(ORIGIN_LABEL[view.origin] as Parameters<typeof t>[0]);
      return h('div', {
        key: view.slot,
        className: 'dsh-pet-cfg__grid4',
        children: [
          // 开关 + 音量 + 试听：三件套与槽位名放在同一格，行读起来是「这个时机多响」。
          toggleCell(label, view.enabled, busy, (value) => sfx.setSlotEnabled(view.slot, value)),
          field(
            `${t('sfxVolumeLabel')}（${Math.round(view.volume * 100)}%）`,
            h('input', {
              type: 'range',
              className: 'dsh-pet-cfg__range',
              min: '0',
              max: '1',
              step: '0.05',
              value: String(view.volume),
              disabled: busy || !view.enabled,
              onChange: (event: { target: { value: string } }) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) sfx.setSlotVolume(view.slot, next);
              },
            }),
            `${source}：${view.file === '' ? t('sfxNone') : view.file}`,
          ),
          h('button', {
            type: 'button',
            className: 'dsh-pet-cfg__btn',
            disabled: busy || !view.enabled,
            onClick: () => sfx.trySlot(view.slot),
            children: t('sfxTry'),
          }),
        ],
      });
    };

    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        h('div', {
          key: 'slots',
          className: 'dsh-pet-cfg__card',
          children: [
            cardHead(t('sfxTitle'), t('sfxHint')),
            ...sfx.slots.map(row),
            h('div', {
              className: 'dsh-pet-cfg__hint',
              children: t('sfxFileHint'),
            }),
          ],
        }),
        h('div', {
          key: 'hooks',
          className: 'dsh-pet-cfg__card',
          children: [
            cardHead(t('sfxHooksTitle'), t('sfxHooksHint')),
            sfx.hooks.length === 0
              ? h('div', { className: 'dsh-pet-cfg__hint', children: t('sfxHookEmpty') })
              : h('div', {
                  className: 'dsh-pet-cfg__grid4',
                  children: sfx.hooks.map((hook) =>
                    h('div', {
                      key: hook,
                      className: 'dsh-pet-cfg__field',
                      children: [
                        h('span', { key: 'l', className: 'dsh-pet-cfg__flabel', children: hook }),
                        h('button', {
                          key: 'b',
                          type: 'button',
                          className: 'dsh-pet-cfg__btn',
                          disabled: busy,
                          onClick: () => sfx.tryHook(hook),
                          children: t('sfxTry'),
                        }),
                      ],
                    }),
                  ),
                }),
            h('div', {
              className: 'dsh-pet-cfg__hint',
              children: t('sfxHookCurlHint'),
            }),
          ],
        }),
      ],
    });
  };
}
