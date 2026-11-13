/**
 * 「会话鱼」分区：总开关、预览、皮肤、尺寸、数量、气泡与播报开关。
 *
 * 原先是独立分区（写另一份 `session-fish.json`），并入本页后仍只提交这几项：草稿与写盘都在
 * `./use-session-fish` 里，本文件只排布控件，保存由底部栏统一触发。
 * 皮肤清单只读（`GET /session-fish/skins`）：列表里没有的皮肤不可能是当前值，文件被删掉后
 * 那一项显示成「已失效」，但不会挡住保存。
 * owns only 这一块的排布与输入夹取，never 加载、写盘与基线。
 * @module dsh-pet/src/client/settings/fish-tab
 */
import type { FunctionComponent } from 'react';
import type { jsx } from 'react/jsx-runtime';
import {
  effectiveSessionFishSkin,
  sessionFishSkinKindOf,
  SESSION_FISH_BUBBLE_MS_MAX,
  SESSION_FISH_BUBBLE_MS_MIN,
  SESSION_FISH_MAX_COUNT_MAX,
  SESSION_FISH_MAX_COUNT_MIN,
  SESSION_FISH_PROGRESS_GAP_MS_MAX,
  SESSION_FISH_PROGRESS_GAP_MS_MIN,
  SESSION_FISH_SIZE_MAX,
  SESSION_FISH_SIZE_MIN,
  SESSION_FISH_SKIN_DEFAULT,
} from '../../shared/session-fish.ts';
import { makeSessionFishMedia, sessionFishAspectOf, sessionFishHeightOf } from '../session-fish/media.ts';
import { injectSessionFishCss } from '../session-fish/css.ts';
import { openFolderOf } from './open-folder.ts';
import { injectSettingsCss } from './css.ts';
import type { DirtyQuery } from './dirty.ts';
import type { SettingsRuntime } from './runtime.ts';
import { INPUT_CLASS, makeUiKit, numberInputProps } from './ui.ts';
import type { SessionFishState } from './use-session-fish.ts';

/** 会话鱼分区的输入。 */
export interface FishTabProps {
  /** 保存中或配置未就绪：全部控件禁用。 */
  readonly busy: boolean;
  /** 会话鱼草稿与动作。 */
  readonly fish: SessionFishState;
  /** 未保存改动查询口。 */
  readonly dirty: DirtyQuery;
}

/** 数字夹取（UI 侧先夹一次，宿主仍会严格校验）。 */
function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 造会话鱼分区。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 分区组件。
 */
export function makeFishTab(rt: SettingsRuntime): FunctionComponent<FishTabProps> {
  const { h, t, useState } = rt;
  injectSettingsCss();
  injectSessionFishCss();
  // 媒体组件自带一套更宽松的运行时类型（浮层与设置页共用）；运行时是同一个 jsx，这里只做类型桥接。
  const SessionFishMedia = makeSessionFishMedia({ h: h as unknown as typeof jsx, useState });

  return function FishTab(props: FishTabProps) {
    const { busy, fish, dirty } = props;
    const { cardHead, field, toggleCell } = makeUiKit({ h, t }, dirty);
    // 皮肤量到真实尺寸后重排一次预览（第一帧按 16:9 排）。
    const [, setAspectTick] = useState(0);
    const draft = fish.draft;

    if (draft === null) {
      return h('p', { className: 'dsh-pet-cfg__note', children: t('fish.intro') });
    }

    /** 改一个字段。 */
    const update = fish.update;
    const second = (ms: number): number => Math.round(ms / 1000);
    const previewSkin = effectiveSessionFishSkin(draft.skin);
    const previewHeight = sessionFishHeightOf(draft.sizePx, sessionFishAspectOf(previewSkin));
    const known = fish.skins ?? [];
    const packSkins = known.filter((item) => item.source === 'pack');
    const userSkins = known.filter((item) => item.source === 'user');
    const currentLabel = known.find((item) => item.id === previewSkin)?.label ?? previewSkin;
    const missing = draft.skin !== '' && fish.skins !== null && !known.some((item) => item.id === draft.skin);
    const disabled = busy || fish.skinBusy;

    /** 皮肤下拉的一项。 */
    const skinOption = (item: { id: string; label: string }) =>
      h('option', { key: item.id, value: item.id, children: item.label });

    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        h('p', { key: 'intro', className: 'dsh-pet-cfg__note', children: t('fish.intro') }),
        fish.loadFailed
          ? h('p', {
              key: 'loadFailed',
              className: 'dsh-pet-cfg__note',
              children: [
                t('fish.loadFailed') + ' ',
                h('button', {
                  key: 'retry',
                  type: 'button',
                  className: 'dsh-pet-cfg__btn is-sm',
                  onClick: fish.reload,
                  children: t('retry'),
                }),
              ],
            })
          : null,
        h('div', {
          key: 'card',
          className: 'dsh-pet-cfg__card',
          children: [
            cardHead(t('fish.cardTitle'), t('fish.enabledHint'), 'fish'),
            h('div', {
              key: 'preview',
              className: 'dsh-session-fish-preview',
              children: [
                h(SessionFishMedia, {
                  width: draft.sizePx,
                  skin: previewSkin,
                  kind: sessionFishSkinKindOf(previewSkin) ?? 'video',
                  state: 'working',
                  onAspect: () => setAspectTick((tick) => tick + 1),
                }),
                h('span', {
                  key: 'text',
                  className: 'dsh-pet-cfg__note',
                  children: t('fish.preview') + ' · ' + draft.sizePx + '×' + previewHeight + 'px · ' + currentLabel,
                }),
              ],
            }),
            h('div', {
              key: 'skin',
              className: 'dsh-pet-cfg__grid2',
              children: [
                field(
                  t('fish.skin'),
                  h('div', {
                    className: 'dsh-pet-cfg__sizeRow',
                    children: [
                      h('select', {
                        key: 'select',
                        className: INPUT_CLASS,
                        value: draft.skin,
                        disabled,
                        'aria-label': t('fish.skin'),
                        onChange: (event: { target: { value: string } }) => update('skin', event.target.value),
                        children: [
                          h('option', { key: 'default', value: '', children: t('fish.skinDefault') }),
                          packSkins.length > 0
                            ? h('optgroup', {
                                key: 'pack',
                                label: t('fish.skinBuiltin'),
                                children: packSkins.map(skinOption),
                              })
                            : null,
                          userSkins.length > 0
                            ? h('optgroup', {
                                key: 'user',
                                label: t('fish.skinMine'),
                                children: userSkins.map(skinOption),
                              })
                            : null,
                          // 选中的文件被删掉：留一个占位项，免得下拉静默跳回默认值。
                          missing
                            ? h('option', { key: 'missing', value: draft.skin, children: t('fish.skinMissing') })
                            : null,
                        ],
                      }),
                      h('button', {
                        key: 'rescan',
                        type: 'button',
                        className: 'dsh-pet-cfg__btn',
                        disabled,
                        onClick: fish.rescan,
                        children: t('fish.skinRescan'),
                      }),
                      h('button', {
                        key: 'folder',
                        type: 'button',
                        className: 'dsh-pet-cfg__btn',
                        onClick: () => void openFolderOf('fish-skin', undefined, true),
                        children: t('fish.openSkinFolder'),
                      }),
                    ],
                  }),
                  t('fish.skinHint') + ' ' + t('fish.skinDefaultName') + '：' + SESSION_FISH_SKIN_DEFAULT,
                  'fish.skin',
                ),
              ],
            }),
            h('div', {
              key: 'toggles',
              className: 'dsh-pet-cfg__grid2',
              children: [
                toggleCell('fish.enabled', draft.enabled, busy, (value) => update('enabled', value), 'fish.enabled'),
                toggleCell(
                  'fish.followPet',
                  draft.followPet,
                  busy || !draft.enabled,
                  (value) => update('followPet', value),
                  'fish.followPet',
                ),
                toggleCell(
                  'fish.speakEnabled',
                  draft.speakEnabled,
                  busy,
                  (value) => update('speakEnabled', value),
                  'fish.speakEnabled',
                ),
                toggleCell(
                  'fish.speakProgress',
                  draft.speakProgress,
                  busy || !draft.speakEnabled,
                  (value) => update('speakProgress', value),
                  'fish.speakProgress',
                ),
                toggleCell(
                  'fish.speakTurnEnd',
                  draft.speakTurnEnd,
                  busy || !draft.speakEnabled,
                  (value) => update('speakTurnEnd', value),
                  'fish.speakTurnEnd',
                ),
                toggleCell(
                  'fish.speakWaiting',
                  draft.speakWaiting,
                  busy || !draft.speakEnabled,
                  (value) => update('speakWaiting', value),
                  'fish.speakWaiting',
                ),
              ],
            }),
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
                            update(
                              'sizePx',
                              clampInt(value, SESSION_FISH_SIZE_MIN, SESSION_FISH_SIZE_MAX, draft.sizePx),
                            ),
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
                  'fish.sizePx',
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
                  'fish.maxCount',
                ),
                field(
                  t('fish.bubbleSec') + '（s）',
                  h('input', {
                    ...numberInputProps(
                      second(draft.bubbleMs),
                      (value) =>
                        update(
                          'bubbleMs',
                          clampInt(
                            value * 1000,
                            SESSION_FISH_BUBBLE_MS_MIN,
                            SESSION_FISH_BUBBLE_MS_MAX,
                            draft.bubbleMs,
                          ),
                        ),
                      {
                        min: String(second(SESSION_FISH_BUBBLE_MS_MIN)),
                        max: String(second(SESSION_FISH_BUBBLE_MS_MAX)),
                        step: '1',
                        disabled: busy,
                        'aria-label': t('fish.bubbleSec'),
                      },
                    ),
                  }),
                  t('fish.bubbleSecHint'),
                  'fish.bubbleMs',
                ),
                field(
                  t('fish.progressGapSec') + '（s）',
                  h('input', {
                    ...numberInputProps(
                      second(draft.progressGapMs),
                      (value) =>
                        update(
                          'progressGapMs',
                          clampInt(
                            value * 1000,
                            SESSION_FISH_PROGRESS_GAP_MS_MIN,
                            SESSION_FISH_PROGRESS_GAP_MS_MAX,
                            draft.progressGapMs,
                          ),
                        ),
                      {
                        min: String(second(SESSION_FISH_PROGRESS_GAP_MS_MIN)),
                        max: String(second(SESSION_FISH_PROGRESS_GAP_MS_MAX)),
                        step: '1',
                        disabled: busy,
                        'aria-label': t('fish.progressGapSec'),
                      },
                    ),
                  }),
                  t('fish.progressGapSecHint'),
                  'fish.progressGapMs',
                ),
              ],
            }),
            h('div', {
              key: 'positions',
              className: 'dsh-pet-cfg__actions',
              children: [
                // 只动浏览器里记的偏移，不写 session-fish.json：所以它不产生改动圆点。
                h('button', {
                  key: 'reset',
                  type: 'button',
                  className: 'dsh-pet-cfg__btn is-sm',
                  onClick: fish.resetPositions,
                  children: t('fish.resetPositions'),
                }),
              ],
            }),
          ],
        }),
      ],
    });
  };
}
