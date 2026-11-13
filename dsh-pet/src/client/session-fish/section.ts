/**
 * 「会话鱼」设置分区：总开关、尺寸、数量、皮肤、跟随桌宠、气泡与三类播报。
 *
 * 独立成 settings.section（不塞进「桌宠配置」的七个标签），因为它写的是另一份文件
 * （`session-fish.json`），保存语义是「只改这几项」，不该触发主配置的整包写入。
 * 保存成功后宿主会重新发布 `/state`，浮层即时按新尺寸/开关/皮肤渲染，不需要刷新页面。
 * 皮肤清单只读（`GET /session-fish/skins`）：选择器里没有的皮肤不可能是当前值，
 * 文件被删掉后那一项会显示成「已失效」，但不会挡住保存。
 * @module dsh-pet/src/client/session-fish/section
 */
import type { DependencyList, Dispatch, SetStateAction, EffectCallback } from 'react';
import type { jsx } from 'react/jsx-runtime';
import {
  DEFAULT_SESSION_FISH_SETTINGS,
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
  type SessionFishSettings,
} from '../../shared/session-fish.ts';
import {
  loadSessionFishSettings,
  loadSessionFishSkins,
  saveSessionFishSettings,
  type SessionFishSkinOption,
} from './api.ts';
import { injectSessionFishCss } from './css.ts';
import { injectSettingsCss } from '../settings/css.ts';
import { INPUT_CLASS, makeUiKit, numberInputProps } from '../settings/ui.ts';
import { openFolderOf } from '../settings/open-folder.ts';
import type { H } from '../settings/runtime.ts';
import { makeSessionFishMedia, sessionFishAspectOf, sessionFishHeightOf } from './media.ts';
import { clearFishOffsets } from './offsets.ts';

/** 设置分区用的 react 能力。 */
export interface SessionFishSectionRuntime {
  h: typeof jsx;
  useState: <T>(init: T) => [T, Dispatch<SetStateAction<T>>];
  useEffect: (effect: EffectCallback, deps?: DependencyList) => void;
  t: (key: string) => string;
}

/** 一处反馈。 */
interface Feedback {
  kind: 'ok' | 'err' | '';
  text: string;
}

/** 数字夹取（UI 侧先夹一次，宿主仍会严格校验）。 */
function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 造「会话鱼」设置分区。
 *
 * @param rt - 节点工厂、hooks 与翻译。
 * @returns 可注册进 `settings.section` 的组件。
 */
export function makeSessionFishSection(rt: SessionFishSectionRuntime) {
  const { h, useState, useEffect, t } = rt;
  injectSettingsCss();
  injectSessionFishCss();
  // 设置页的小件用更严格的 H（逐字校验组件 props）；本文件其余节点仍走注入的 jsx。
  // 两者运行时是同一个函数，这里只做类型桥接，不改变行为。
  const uiH = h as unknown as H;
  const { cardHead, field, toggleCell, q } = makeUiKit({ h: uiH, t });
  const SessionFishMedia = makeSessionFishMedia({ h, useState });

  return function SessionFishSection(): ReturnType<typeof jsx> {
    const [draft, setDraft] = useState<SessionFishSettings | null>(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<Feedback>({ kind: '', text: '' });
    const [skins, setSkins] = useState<SessionFishSkinOption[] | null>(null);
    // 皮肤量到真实尺寸后重排一次预览（第一帧按 16:9 排）。
    const [, setAspectTick] = useState(0);
    const [skinBusy, setSkinBusy] = useState(false);

    useEffect(() => {
      let alive = true;
      void loadSessionFishSettings().then((settings) => {
        if (!alive) return;
        if (settings !== null) {
          setDraft(settings);
          return;
        }
        setDraft(DEFAULT_SESSION_FISH_SETTINGS);
        setMsg({ kind: 'err', text: t('loadFailed') });
      });
      void loadSessionFishSkins().then((items) => {
        if (alive) setSkins(items);
      });
      return () => {
        alive = false;
      };
    }, []);

    /** 重新扫一遍皮肤目录（用户刚把文件拖进去时用）。 */
    const rescanSkins = (): void => {
      if (skinBusy) return;
      setSkinBusy(true);
      void loadSessionFishSkins().then((items) => {
        setSkinBusy(false);
        setSkins(items);
        setMsg(
          items === null
            ? { kind: 'err', text: t('skinRescanFailed') }
            : { kind: 'ok', text: t('skinRescanned') + '：' + String(items.length) },
        );
      });
    };

    /** 改一个字段（草稿态；点保存才落盘）。 */
    const update = <K extends keyof SessionFishSettings>(key: K, value: SessionFishSettings[K]): void => {
      setDraft((current) => (current === null ? current : { ...current, [key]: value }));
      setMsg({ kind: '', text: '' });
    };

    /** 保存：只提交这几个字段；宿主返回权威设置后再覆盖草稿。 */
    const save = (): void => {
      if (draft === null || busy) return;
      setBusy(true);
      void saveSessionFishSettings(draft).then((result) => {
        setBusy(false);
        if (result.ok) {
          setDraft(result.settings);
          setMsg({ kind: 'ok', text: t('saved') });
          return;
        }
        setMsg({ kind: 'err', text: t('saveFailed') + '：' + result.message });
      });
    };

    if (draft === null) {
      return h('div', {
        className: 'dsh-pet-cfg',
        style: { maxWidth: '720px' },
        children: h('p', { className: 'dsh-pet-cfg__note', children: t('intro') }),
      });
    }

    const second = (ms: number): number => Math.round(ms / 1000);
    const previewSkin = effectiveSessionFishSkin(draft.skin);
    const previewHeight = sessionFishHeightOf(draft.sizePx, sessionFishAspectOf(previewSkin));
    const known = skins ?? [];
    const packSkins = known.filter((item) => item.source === 'pack');
    const userSkins = known.filter((item) => item.source === 'user');
    const currentLabel = known.find((item) => item.id === previewSkin)?.label ?? previewSkin;
    const missing = draft.skin !== '' && skins !== null && !known.some((item) => item.id === draft.skin);

    /** 皮肤下拉的一项。 */
    const skinOption = (item: SessionFishSkinOption) =>
      h('option', { key: item.id, value: item.id, children: item.label });

    return h('div', {
      className: 'dsh-pet-cfg',
      style: { maxWidth: '720px' },
      children: [
        h('h2', { key: 'title', className: 'dsh-pet-cfg__title', children: t('nav') }),
        h('p', { key: 'intro', className: 'dsh-pet-cfg__note', children: t('intro') }),
        h('div', {
          key: 'group',
          className: 'dsh-pet-cfg__group',
          children: [
            h('div', {
              key: 'card',
              className: 'dsh-pet-cfg__card',
              children: [
                cardHead(t('nav'), t('enabledHint')),
                h('div', {
                  key: 'preview',
                  className: 'dsh-session-fish-preview',
                  children: [
                    h(SessionFishMedia, {
                      width: draft.sizePx,
                      height: previewHeight,
                      skin: previewSkin,
                      kind: sessionFishSkinKindOf(previewSkin) ?? 'video',
                      state: 'working',
                      onAspect: () => setAspectTick((tick) => tick + 1),
                    }),
                    h('span', {
                      key: 'text',
                      className: 'dsh-pet-cfg__note',
                      children: t('preview') + ' · ' + draft.sizePx + '×' + previewHeight + 'px · ' + currentLabel,
                    }),
                  ],
                }),
                h('div', {
                  key: 'skin',
                  className: 'dsh-pet-cfg__grid',
                  children: [
                    field(
                      t('skin'),
                      h('div', {
                        className: 'dsh-pet-cfg__sizeRow',
                        children: [
                          h('select', {
                            key: 'select',
                            className: INPUT_CLASS,
                            value: draft.skin,
                            disabled: busy || skinBusy,
                            'aria-label': t('skin'),
                            onChange: (event: { target: { value: string } }) => update('skin', event.target.value),
                            children: [
                              h('option', { key: 'default', value: '', children: t('skinDefault') }),
                              packSkins.length > 0
                                ? h('optgroup', {
                                    key: 'pack',
                                    label: t('skinBuiltin'),
                                    children: packSkins.map(skinOption),
                                  })
                                : null,
                              userSkins.length > 0
                                ? h('optgroup', {
                                    key: 'user',
                                    label: t('skinMine'),
                                    children: userSkins.map(skinOption),
                                  })
                                : null,
                              // 选中的文件被删掉：留一个占位项，免得下拉静默跳回默认值。
                              missing
                                ? h('option', { key: 'missing', value: draft.skin, children: t('skinMissing') })
                                : null,
                            ],
                          }),
                          h('button', {
                            key: 'rescan',
                            type: 'button',
                            className: 'dsh-pet-cfg__btn',
                            disabled: busy || skinBusy,
                            onClick: rescanSkins,
                            children: skinBusy ? t('saving') : t('skinRescan'),
                          }),
                          h('button', {
                            key: 'folder',
                            type: 'button',
                            className: 'dsh-pet-cfg__btn',
                            onClick: () => void openFolderOf('fish-skin', undefined, true),
                            children: t('openSkinFolder'),
                          }),
                        ],
                      }),
                      t('skinHint') + ' ' + t('skinDefaultName') + '：' + SESSION_FISH_SKIN_DEFAULT,
                    ),
                  ],
                }),
                h('div', {
                  key: 'toggles',
                  className: 'dsh-pet-cfg__grid',
                  children: [
                    toggleCell('enabled', draft.enabled, busy, (value) => update('enabled', value)),
                    toggleCell('followPet', draft.followPet, busy || !draft.enabled, (value) =>
                      update('followPet', value),
                    ),
                    toggleCell('speakEnabled', draft.speakEnabled, busy, (value) => update('speakEnabled', value)),
                    toggleCell('speakProgress', draft.speakProgress, busy || !draft.speakEnabled, (value) =>
                      update('speakProgress', value),
                    ),
                    toggleCell('speakTurnEnd', draft.speakTurnEnd, busy || !draft.speakEnabled, (value) =>
                      update('speakTurnEnd', value),
                    ),
                    toggleCell('speakWaiting', draft.speakWaiting, busy || !draft.speakEnabled, (value) =>
                      update('speakWaiting', value),
                    ),
                  ],
                }),
                h('div', {
                  key: 'grid',
                  className: 'dsh-pet-cfg__grid',
                  children: [
                    field(
                      t('size') + '（px）',
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
                            'aria-label': t('size'),
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
                                'aria-label': t('size'),
                              },
                            ),
                          }),
                        ],
                      }),
                      t('sizeHint'),
                    ),
                    field(
                      t('maxCount'),
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
                            'aria-label': t('maxCount'),
                          },
                        ),
                      }),
                      t('maxCountHint'),
                    ),
                    field(
                      t('bubbleSec') + '（s）',
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
                            'aria-label': t('bubbleSec'),
                          },
                        ),
                      }),
                      t('bubbleSecHint'),
                    ),
                    field(
                      t('progressGapSec') + '（s）',
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
                            'aria-label': t('progressGapSec'),
                          },
                        ),
                      }),
                      t('progressGapSecHint'),
                    ),
                  ],
                }),
              ],
            }),
          ],
        }),
        h('div', {
          key: 'actions',
          className: 'dsh-pet-cfg__actions',
          children: [
            h('button', {
              key: 'save',
              type: 'button',
              className: 'dsh-pet-cfg__btn is-primary',
              disabled: busy,
              onClick: save,
              children: busy ? t('saving') : t('save'),
            }),
            h('button', {
              key: 'reset',
              type: 'button',
              className: 'dsh-pet-cfg__btn',
              onClick: () => {
                clearFishOffsets();
                setMsg({ kind: 'ok', text: t('positionsReset') });
              },
              children: t('resetPositions'),
            }),
            q(t('enabledHint')),
            msg.text
              ? h('span', {
                  key: 'msg',
                  className: 'dsh-pet-cfg__msg' + (msg.kind === 'err' ? ' is-err' : ''),
                  children: msg.text,
                })
              : null,
          ],
        }),
      ],
    });
  };
}
