/**
 * 音效槽位的两种呈现：紧凑列表（开关 + 试听 + 来源徽标）与明细行（路径 + 打开文件夹 + 命名规则）。
 *
 * 拆成两张脸是因为过去它们挤在同一行里：八个槽位 × （开关 + 试听 + 来源 + 路径 + 打开文件夹 + 命名规则）
 * 就是一面墙，其中「打开文件夹」还重复了八次。常用动作（开关、试听）留在明面，
 * 排障时才需要的路径与命名规则收进同一个折叠，八条并排展开也还是一份清单。
 * @module dsh-pet/src/client/settings/sfx-slot-row
 */
import type { FunctionComponent } from 'react';
import { slotFileStem } from '../../shared/sfx/names.ts';
import type { SfxEventSlot } from '../../shared/types.ts';
import { makeFolderButton } from './folder-button.ts';
import type { SettingsRuntime } from './runtime.ts';
import type { SfxSettings, SfxSlotView } from './use-sfx-settings.ts';

/** 槽位 → 文案键（`sfxSlot<Name>`）；顺序与 SFX_EVENT_SLOTS 一致。 */
export const SLOT_LABEL: Record<SfxEventSlot, string> = {
  click: 'sfxSlotClick',
  throw: 'sfxSlotThrow',
  floor: 'sfxSlotFloor',
  wall: 'sfxSlotWall',
  ceiling: 'sfxSlotCeiling',
  pet: 'sfxSlotPet',
  sleepStart: 'sfxSlotSleepStart',
  sleepEnd: 'sfxSlotSleepEnd',
};

/** 来源 → 文案键。 */
export const ORIGIN_LABEL: Record<SfxSlotView['origin'], string> = {
  'pool-skin': 'sfxOriginPoolSkin',
  'pool-renderer': 'sfxOriginPoolRenderer',
  'pool-global': 'sfxOriginPoolGlobal',
  skin: 'sfxOriginSkin',
  sound: 'sfxOriginSound',
  animation: 'sfxOriginAnimation',
  user: 'sfxOriginUser',
  'package-default': 'sfxOriginDefault',
  config: 'sfxOriginConfig',
  none: 'sfxOriginNone',
};

/** 槽位列表的输入。 */
export interface SfxSlotListProps {
  /** 保存中或配置未就绪时禁用编辑。 */
  readonly busy: boolean;
  /** 分区状态与试听入口。 */
  readonly sfx: SfxSettings;
}

/**
 * 造槽位紧凑列表：一行一个时机，开关 + 试听 + 来源徽标。
 *
 * @param rt - 注入的节点工厂与翻译函数。
 * @returns 列表组件。
 */
export function makeSfxSlotRows(rt: SettingsRuntime): FunctionComponent<SfxSlotListProps> {
  const { h, t } = rt;

  return function SfxSlotRows(props: SfxSlotListProps) {
    const { busy, sfx } = props;
    return h('div', {
      className: 'dsh-pet-cfg__rows',
      children: sfx.slots.map((view) =>
        h('div', {
          key: view.slot,
          className: 'dsh-pet-cfg__row',
          children: [
            h('div', {
              key: 'main',
              className: 'dsh-pet-cfg__rowMain',
              children: [
                // 开关沿用「开关视觉 + checkbox 语义」，与分区里其它开关同形。
                h('div', {
                  key: 'sw',
                  className: 'dsh-pet-cfg__switch',
                  children: h('label', {
                    children: [
                      h('input', {
                        key: 'i',
                        type: 'checkbox',
                        checked: view.enabled,
                        disabled: busy,
                        onChange: (event: { target: { checked: boolean } }) =>
                          sfx.setSlotEnabled(view.slot, event.target.checked),
                      }),
                      h('span', { key: 't', children: t(SLOT_LABEL[view.slot] as Parameters<typeof t>[0]) }),
                    ],
                  }),
                }),
                // 来源徽标：没匹配到文件时给一句「未匹配」，否则没人知道为什么点了没声。
                h('span', {
                  key: 'src',
                  className: 'dsh-pet-cfg__badge' + (view.origin === 'none' ? ' is-warn' : ''),
                  children: t(ORIGIN_LABEL[view.origin] as Parameters<typeof t>[0]),
                }),
                h('button', {
                  key: 'try',
                  type: 'button',
                  className: 'dsh-pet-cfg__btn is-text',
                  disabled: busy || !view.enabled,
                  onClick: () => sfx.trySlot(view.slot),
                  children: t('sfxTry'),
                }),
              ],
            }),
          ],
        }),
      ),
    });
  };
}

/**
 * 造槽位明细：一行一个时机，路径 / 建议落点 / 打开文件夹 / 命名规则。
 *
 * @param rt - 注入的节点工厂与翻译函数。
 * @returns 明细组件。
 */
export function makeSfxSlotMeta(rt: SettingsRuntime): FunctionComponent<SfxSlotListProps> {
  const { h, t } = rt;
  const FolderButton = makeFolderButton(rt);

  return function SfxSlotMeta(props: SfxSlotListProps) {
    const { busy, sfx } = props;
    return h('div', {
      className: 'dsh-pet-cfg__rows',
      children: sfx.slots.map((view) =>
        h('div', {
          key: view.slot,
          className: 'dsh-pet-cfg__row',
          children: [
            h('div', {
              key: 'top',
              className: 'dsh-pet-cfg__rowMeta',
              children: [
                h('span', { key: 'n', children: t(SLOT_LABEL[view.slot] as Parameters<typeof t>[0]) }),
                view.path !== undefined
                  ? h('code', { key: 'p', className: 'dsh-pet-cfg__mono', children: view.path })
                  : view.suggestion === undefined
                    ? null
                    : h('span', {
                        key: 's',
                        children: t('sfxWhereToPut').replace('{path}', view.suggestion.relative),
                      }),
              ],
            }),
            h('div', {
              key: 'meta',
              className: 'dsh-pet-cfg__rowMeta',
              children: [
                h('code', {
                  key: 'pat',
                  className: 'dsh-pet-cfg__mono',
                  children: t('sfxSlotPattern').replace('{name}', slotFileStem(view.slot)),
                }),
                h(FolderButton, { key: 'open', which: view.which, disabled: busy }),
              ],
            }),
          ],
        }),
      ),
    });
  };
}
