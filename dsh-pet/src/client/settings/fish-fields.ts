/**
 * 会话鱼的显示字段：皮肤（含重新扫描 / 打开文件夹）、大小、最多同时几条。
 *
 * 三格共用同一份草稿与同一个禁用条件，所以一起装配；皮肤下拉用原生 `<select>`——
 * 它带着 `<optgroup>` 分「内置 / 我自己的」两组，条目数会随用户放进去的文件增长，
 * 自绘下拉要为此再写一遍分组与滚动，收益不抵成本。
 * owns only 这三格的排布与夹取，never 草稿状态与写盘。
 * @module dsh-pet/src/client/settings/fish-fields
 */
import type { FunctionComponent } from 'react';
import {
  SESSION_FISH_MAX_COUNT_MAX,
  SESSION_FISH_MAX_COUNT_MIN,
  SESSION_FISH_SIZE_MAX,
  SESSION_FISH_SIZE_MIN,
  type SessionFishSettings,
} from '../../shared/session-fish.ts';
import type { SessionFishSkinOption } from '../session-fish/api.ts';
import type { FishSkinView } from './fish-skins.ts';
import { openFolderOf } from './open-folder.ts';
import type { SettingsRuntime } from './runtime.ts';
import { INPUT_CLASS, makeUiKit, numberInputProps } from './ui.ts';

/** 一格的通用输入。 */
export interface FishFieldsProps {
  /** 保存中或皮肤扫描中：全部控件禁用。 */
  readonly busy: boolean;
  /** 当前草稿（值的唯一来源）。 */
  readonly draft: SessionFishSettings;
  /** 皮肤清单的分组结果。 */
  readonly skins: FishSkinView;
  /** 改一个字段（草稿态）。 */
  update<K extends keyof SessionFishSettings>(key: K, value: SessionFishSettings[K]): void;
  /** 重新扫描皮肤目录。 */
  onRescan(): void;
  /** 皮肤扫描进行中。 */
  readonly skinBusy: boolean;
}

/** 整数夹取（UI 侧先夹一次，宿主仍会严格校验）。 */
function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 造会话鱼显示字段。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 三格字段组件。
 */
export function makeFishFields(rt: SettingsRuntime): FunctionComponent<FishFieldsProps> {
  const { h, t } = rt;
  const { field } = makeUiKit({ h, t });

  return function FishFields(props: FishFieldsProps) {
    const { busy, draft, skins, update } = props;

    /** 皮肤下拉的一项。 */
    const option = (item: SessionFishSkinOption) => h('option', { key: item.id, value: item.id, children: item.label });

    return h('div', {
      className: 'dsh-pet-cfg__stack',
      children: [
        // 皮肤独占一行：下拉里是「默认 / 内置 / 我自己的」三组，右边还得跟两个动作按钮。
        field(
          t('fish.skin'),
          h('div', {
            className: 'dsh-pet-cfg__actions',
            children: [
              h('select', {
                key: 'select',
                className: INPUT_CLASS,
                value: draft.skin,
                disabled: busy,
                'aria-label': t('fish.skin'),
                onChange: (event: { target: { value: string } }) => update('skin', event.target.value),
                children: [
                  h('option', { key: 'default', value: '', children: t('fish.skinDefault') }),
                  skins.pack.length > 0
                    ? h('optgroup', { key: 'pack', label: t('fish.skinBuiltin'), children: skins.pack.map(option) })
                    : null,
                  skins.user.length > 0
                    ? h('optgroup', { key: 'user', label: t('fish.skinMine'), children: skins.user.map(option) })
                    : null,
                  // 选中的文件被删掉：留一个占位项，免得下拉静默跳回默认值。
                  skins.missing
                    ? h('option', { key: 'missing', value: draft.skin, children: t('fish.skinMissing') })
                    : null,
                ],
              }),
              // 两个动作降级成文字按钮：它们一年用一次，不该和下拉抢同一格的宽度。
              h('button', {
                key: 'rescan',
                type: 'button',
                className: 'dsh-pet-cfg__btn is-text',
                disabled: busy,
                onClick: props.onRescan,
                children: props.skinBusy ? t('fish.skinRescan') + '…' : t('fish.skinRescan'),
              }),
              h('button', {
                key: 'folder',
                type: 'button',
                className: 'dsh-pet-cfg__btn is-text',
                disabled: busy,
                onClick: () => void openFolderOf('fish-skin', undefined, true),
                children: t('fish.openSkinFolder'),
              }),
            ],
          }),
          t('fish.skinHint'),
        ),
        h('div', {
          key: 'numbers',
          className: 'dsh-pet-cfg__grid2',
          children: [
            field(
              t('fish.size') + '（px）',
              h('div', {
                className: 'dsh-pet-cfg__sizeRow',
                children: [
                  h('input', {
                    key: 'range',
                    type: 'range',
                    className: 'dsh-pet-cfg__range',
                    min: String(SESSION_FISH_SIZE_MIN),
                    max: String(SESSION_FISH_SIZE_MAX),
                    step: '1',
                    value: String(draft.sizePx),
                    disabled: busy,
                    'aria-label': t('fish.size'),
                    onChange: (event: { target: { value: string } }) =>
                      update(
                        'sizePx',
                        clampInt(
                          Number(event.target.value),
                          SESSION_FISH_SIZE_MIN,
                          SESSION_FISH_SIZE_MAX,
                          draft.sizePx,
                        ),
                      ),
                  }),
                  h('input', {
                    key: 'num',
                    ...numberInputProps(
                      draft.sizePx,
                      (value) =>
                        update('sizePx', clampInt(value, SESSION_FISH_SIZE_MIN, SESSION_FISH_SIZE_MAX, draft.sizePx)),
                      {
                        min: String(SESSION_FISH_SIZE_MIN),
                        max: String(SESSION_FISH_SIZE_MAX),
                        step: '1',
                        disabled: busy,
                        'aria-label': t('fish.size'),
                      },
                    ),
                  }),
                ],
              }),
              t('fish.sizeHint'),
            ),
            field(
              t('fish.maxCount'),
              h('input', {
                ...numberInputProps(
                  draft.maxCount,
                  (value) =>
                    update(
                      'maxCount',
                      clampInt(value, SESSION_FISH_MAX_COUNT_MIN, SESSION_FISH_MAX_COUNT_MAX, draft.maxCount),
                    ),
                  {
                    min: String(SESSION_FISH_MAX_COUNT_MIN),
                    max: String(SESSION_FISH_MAX_COUNT_MAX),
                    step: '1',
                    disabled: busy,
                    'aria-label': t('fish.maxCount'),
                  },
                ),
              }),
              t('fish.maxCountHint'),
            ),
          ],
        }),
      ],
    });
  };
}
