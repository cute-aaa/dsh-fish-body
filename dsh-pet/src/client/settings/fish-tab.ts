/**
 * 「会话鱼」分区：启用与预览、皮肤与尺寸、播报四项、两条节奏参数，以及高级动作。
 *
 * 原先是独立分区（写另一份 `session-fish.json`），并入本页后仍只提交这几项：草稿与写盘都在
 * `./use-session-fish` 里，本文件只排布控件，保存由底部栏统一触发。
 * 顺序按「先决定要不要、再决定长什么样、最后才是播报与节奏」：总开关与预览在最前，
 * 播报的四项收在同一段里（三级从属关系靠缩进与整块降透明表达），节奏参数在最后。
 * owns only 这一块的排布与输入夹取，never 加载、写盘与基线。
 * @module dsh-pet/src/client/settings/fish-tab
 */
import type { FunctionComponent } from 'react';
import type { jsx } from 'react/jsx-runtime';
import {
  SESSION_FISH_BUBBLE_MS_MAX,
  SESSION_FISH_BUBBLE_MS_MIN,
  SESSION_FISH_PROGRESS_GAP_MS_MAX,
  SESSION_FISH_PROGRESS_GAP_MS_MIN,
  effectiveSessionFishSkin,
  sessionFishSkinKindOf,
} from '../../shared/session-fish.ts';
import { injectSessionFishCss } from '../session-fish/css.ts';
import { makeSessionFishMedia, sessionFishAspectOf, sessionFishHeightOf } from '../session-fish/media.ts';
import { injectSettingsCss } from './css.ts';
import type { DirtyQuery } from './dirty.ts';
import { makeFishFields } from './fish-fields.ts';
import { DEFAULT_FISH_SKIN, fishSkinView } from './fish-skins.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit, numberInputProps } from './ui.ts';
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
  const FishFields = makeFishFields(rt);

  return function FishTab(props: FishTabProps) {
    const { busy, fish, dirty } = props;
    const { cardHead, field, toggleCell, switchGrid, section, note } = makeUiKit({ h, t }, dirty);
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
    const skins = fishSkinView(fish.skins, draft.skin, previewSkin);
    const disabled = busy || fish.skinBusy;
    /** 秒 → 毫秒的输入格：两条节奏参数在配置里都是毫秒，界面上只出现秒。 */
    const secondsField = (
      labelKey: 'fish.bubbleSec' | 'fish.progressGapSec',
      valueMs: number,
      key: 'bubbleMs' | 'progressGapMs',
      minMs: number,
      maxMs: number,
    ) =>
      field(
        t(labelKey) + '（s）',
        h('input', {
          ...numberInputProps(second(valueMs), (value) => update(key, clampInt(value * 1000, minMs, maxMs, valueMs)), {
            min: String(second(minMs)),
            max: String(second(maxMs)),
            step: '1',
            disabled: busy,
            'aria-label': t(labelKey),
          }),
        }),
        t(labelKey + 'Hint'),
      );

    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        fish.loadFailed
          ? h('div', {
              key: 'failed',
              className: 'dsh-pet-cfg__banner is-err',
              role: 'status',
              children: [
                h('span', { key: 't', children: t('fish.loadFailed') }),
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
            cardHead(t('fish.cardTitle'), t('fish.intro'), 'fish'),
            // 预览与两个「长什么样、在哪跑」的开关并排：它们是这一页最先要判断的事。
            h('div', {
              key: 'top',
              className: 'dsh-pet-cfg__fishTop',
              children: [
                h('div', {
                  key: 'preview',
                  className: 'dsh-pet-cfg__preview',
                  children: [
                    // 预览框用浮层同一套类（`.dsh-session-fish-preview`）：两处看到的边框与留白一致。
                    h('div', {
                      key: 'media',
                      className: 'dsh-session-fish-preview',
                      children: h(SessionFishMedia, {
                        width: draft.sizePx,
                        skin: previewSkin,
                        kind: sessionFishSkinKindOf(previewSkin) ?? 'video',
                        state: 'working',
                        onAspect: () => setAspectTick((tick) => tick + 1),
                      }),
                    }),
                    h('span', {
                      key: 'text',
                      className: 'dsh-pet-cfg__note is-tight',
                      children:
                        t('fish.preview') + ' · ' + draft.sizePx + '×' + previewHeight + 'px · ' + skins.currentLabel,
                    }),
                  ],
                }),
                switchGrid([
                  toggleCell('fish.enabled', draft.enabled, busy, (value) => update('enabled', value)),
                  toggleCell('fish.followPet', draft.followPet, busy || !draft.enabled, (value) =>
                    update('followPet', value),
                  ),
                ]),
              ],
            }),
            section(t('secDisplay'), [
              h(FishFields, {
                key: 'fields',
                busy: disabled,
                draft,
                skins,
                update,
                onRescan: fish.rescan,
                skinBusy: fish.skinBusy,
              }),
            ]),
            // 播报：总开关与三类子播报的从属关系靠整块降透明表达，不再逐个解释「为什么点不动」。
            section(t('secSpeak'), [
              switchGrid([
                toggleCell('fish.speakEnabled', draft.speakEnabled, busy, (value) => update('speakEnabled', value)),
              ]),
              switchGrid(
                [
                  toggleCell('fish.speakProgress', draft.speakProgress, busy || !draft.speakEnabled, (value) =>
                    update('speakProgress', value),
                  ),
                  toggleCell('fish.speakTurnEnd', draft.speakTurnEnd, busy || !draft.speakEnabled, (value) =>
                    update('speakTurnEnd', value),
                  ),
                  toggleCell('fish.speakWaiting', draft.speakWaiting, busy || !draft.speakEnabled, (value) =>
                    update('speakWaiting', value),
                  ),
                ],
                !draft.speakEnabled,
              ),
            ]),
            section(t('secTiming'), [
              h('div', {
                key: 'gap',
                className: 'dsh-pet-cfg__grid2',
                children: [
                  secondsField(
                    'fish.bubbleSec',
                    draft.bubbleMs,
                    'bubbleMs',
                    SESSION_FISH_BUBBLE_MS_MIN,
                    SESSION_FISH_BUBBLE_MS_MAX,
                  ),
                  secondsField(
                    'fish.progressGapSec',
                    draft.progressGapMs,
                    'progressGapMs',
                    SESSION_FISH_PROGRESS_GAP_MS_MIN,
                    SESSION_FISH_PROGRESS_GAP_MS_MAX,
                  ),
                ],
              }),
              // 只动浏览器里记的偏移，不写 session-fish.json：所以它不产生改动圆点。
              h('div', {
                key: 'acts',
                className: 'dsh-pet-cfg__actions',
                children: h('button', {
                  type: 'button',
                  className: 'dsh-pet-cfg__btn is-sm',
                  onClick: fish.resetPositions,
                  children: t('fish.resetPositions'),
                }),
              }),
            ]),
            note(t('fish.skinDefaultName') + '：' + DEFAULT_FISH_SKIN, true),
          ],
        }),
      ],
    });
  };
}
