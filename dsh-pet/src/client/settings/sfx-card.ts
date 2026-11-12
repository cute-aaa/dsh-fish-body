/**
 * 音效卡：事件槽与自定义 hook 的可调开关、来源展示与试听。
 *
 * 卡片只回传槽位/开关与 hook 名单——文件名从哪来（皮肤 / 声音目录 / 动画同目录 / 内置默认）由宿主索引决定，
 * 这一页不提供「挑文件」，要换文件就把音频放进对应目录（命名规则写在各行的小字里，见 MAKE-YOUR-OWN-PET.md）。
 * 音量不在这里：分项音量由配置的 `sfx` 段表达，设置页只在全局卡里留一个总音量。
 * 试听走共享播放器，不落盘、不进配置。
 * @module dsh-pet/src/client/settings/sfx-card
 */
import type { FunctionComponent } from 'react';
import { slotFileStem } from '../../shared/sfx/names.ts';
import { SFX_HOOK_NAME_RE } from '../../shared/sfx/types.ts';
import { tooltipPlacement } from '../../shared/tooltip.ts';
import { openAssetFolder } from './open-folder.ts';
import type { SfxEventSlot, SfxFolderTarget } from '../../shared/types.ts';
import type { SettingsRuntime } from './runtime.ts';
import type { SfxHookView, SfxSettings, SfxSlotView } from './use-sfx-settings.ts';
import { makeUiKit } from './ui.ts';

/**
 * 按钮旁的小气泡：`create` 问「是否创建」，`failed` 只说一句失败原因。
 *
 * 锚点是按钮右下角（视口坐标），摆位交给 `tooltipPlacement`，贴边自动翻到另一侧。
 */
type FolderTip =
  | {
      readonly kind: 'create';
      readonly which: SfxFolderTarget;
      readonly path: string;
      readonly anchor: { x: number; y: number };
    }
  | { readonly kind: 'failed'; readonly message: string; readonly anchor: { x: number; y: number } };

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
  const { h, t, useState, useEffect, useRef } = rt;
  const { q } = makeUiKit({ h, t });

  return function SfxCard(props: SfxCardProps) {
    const { busy, sfx } = props;
    const [draft, setDraft] = useState('');
    const [error, setError] = useState('');
    /** 按钮旁的小气泡：问「是否创建」或报一次失败。 */
    const [tip, setTip] = useState<FolderTip | null>(null);
    /** 气泡实测坐标；首帧没有尺寸时先藏起来，量完再显示。 */
    const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);
    const [creating, setCreating] = useState(false);
    const tipRef = useRef<HTMLDivElement | null>(null);

    // 摆位要在气泡渲染之后：tooltipPlacement 需要真实宽高才能决定翻不翻边。
    useEffect(() => {
      const el = tipRef.current;
      if (tip === null || el === null) {
        setTipPos(null);
        return;
      }
      setTipPos(
        tooltipPlacement(
          tip.anchor,
          { w: el.offsetWidth, h: el.offsetHeight },
          { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
          6,
        ),
      );
    }, [tip]);

    /** 点「打开文件夹」：成功不弹东西，目录没建就在按钮旁问一句。 */
    const openFolder = (which: SfxFolderTarget, event: { currentTarget: EventTarget }): void => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const anchor = { x: rect.right, y: rect.bottom };
      void openAssetFolder(which).then((outcome) => {
        if (outcome.ok) {
          setTip(null);
          return;
        }
        if (outcome.reason === 'not-found') {
          setTip({ kind: 'create', which, path: outcome.path, anchor });
          return;
        }
        setTip({
          kind: 'failed',
          message: outcome.message === '' ? t('sfxOpenFolderFailed') : outcome.message,
          anchor,
        });
      });
    };

    /** 气泡里的「是」：建出来再打开。 */
    const confirmCreate = (): void => {
      if (tip === null || tip.kind !== 'create') return;
      const { which, anchor } = tip;
      setCreating(true);
      void openAssetFolder(which, undefined, true).then((outcome) => {
        setCreating(false);
        if (outcome.ok) {
          setTip(null);
          return;
        }
        setTip({
          kind: 'failed',
          message: outcome.message === '' ? t('sfxOpenFolderFailed') : outcome.message,
          anchor,
        });
      });
    };

    /** 卡头：标题 + 问号 + 右侧「打开文件夹」（素材都是放进这些目录才生效的）。 */
    const head = (title: string, hint: string, which: SfxFolderTarget) =>
      h('div', {
        className: 'dsh-pet-cfg__cardHead',
        children: [
          h('span', { key: 't', className: 'dsh-pet-cfg__cardTitle', children: title }),
          q(hint),
          h('button', {
            key: 'b',
            type: 'button',
            className: 'dsh-pet-cfg__btn is-sm',
            disabled: busy,
            onClick: (event: { currentTarget: EventTarget }) => openFolder(which, event),
            children: t('sfxOpenFolder'),
          }),
        ],
      });

    /** 按钮旁的气泡：创建确认或失败说明。 */
    const tipNode =
      tip === null
        ? null
        : h('div', {
            key: 'tip',
            ref: (el: HTMLDivElement | null) => {
              tipRef.current = el;
            },
            className: 'dsh-pet-cfg__sfxTip',
            role: 'dialog',
            style:
              tipPos === null
                ? { left: '0px', top: '0px', visibility: 'hidden' }
                : { left: tipPos.x + 'px', top: tipPos.y + 'px' },
            children: [
              h('div', {
                key: 'm',
                className: 'dsh-pet-cfg__sfxTipText',
                children: tip.kind === 'create' ? t('sfxFolderMissing') : tip.message,
              }),
              tip.kind === 'create' && tip.path !== ''
                ? h('div', { key: 'p', className: 'dsh-pet-cfg__sfxTipPath', children: tip.path })
                : null,
              h('div', {
                key: 'a',
                className: 'dsh-pet-cfg__sfxTipActions',
                children: [
                  tip.kind === 'create'
                    ? h('button', {
                        key: 'y',
                        type: 'button',
                        className: 'dsh-pet-cfg__btn is-sm is-primary',
                        disabled: creating,
                        onClick: confirmCreate,
                        children: t('sfxFolderCreateYes'),
                      })
                    : null,
                  h('button', {
                    key: 'n',
                    type: 'button',
                    className: 'dsh-pet-cfg__btn is-sm',
                    disabled: creating,
                    onClick: () => setTip(null),
                    children: tip.kind === 'create' ? t('sfxFolderCreateNo') : t('sfxFolderDismiss'),
                  }),
                ],
              }),
            ],
          });

    /** 槽位行：开关与试听在上，来源与命名规则在下（小字）。 */
    const slotRow = (view: SfxSlotView) => {
      const label = t(SLOT_LABEL[view.slot] as Parameters<typeof t>[0]);
      const source = t(ORIGIN_LABEL[view.origin] as Parameters<typeof t>[0]);
      return h('div', {
        key: view.slot,
        className: 'dsh-pet-cfg__sfxRow',
        children: [
          h('div', {
            key: 'top',
            className: 'dsh-pet-cfg__sfxTop',
            children: [
              h('label', {
                key: 'l',
                className: 'dsh-pet-cfg__sfxName',
                children: [
                  h('input', {
                    key: 'i',
                    type: 'checkbox',
                    checked: view.enabled,
                    disabled: busy,
                    onChange: (event: { target: { checked: boolean } }) =>
                      sfx.setSlotEnabled(view.slot, event.target.checked),
                  }),
                  h('span', { key: 't', children: label }),
                ],
              }),
              h('button', {
                key: 'b',
                type: 'button',
                className: 'dsh-pet-cfg__btn is-sm',
                disabled: busy || !view.enabled,
                onClick: () => sfx.trySlot(view.slot),
                children: t('sfxTry'),
              }),
            ],
          }),
          h('div', {
            key: 'meta',
            className: 'dsh-pet-cfg__sfxMeta',
            children: [
              h('span', {
                key: 'f',
                className: 'dsh-pet-cfg__sfxFile',
                children: `${source}：${view.file === '' ? t('sfxNone') : view.file}`,
              }),
              h('code', {
                key: 'p',
                className: 'dsh-pet-cfg__sfxPattern',
                children: t('sfxSlotPattern').replace('{name}', slotFileStem(view.slot)),
              }),
            ],
          }),
        ],
      });
    };

    /** hook 行：名字与按钮在上，来源在下。 */
    const hookRow = (view: SfxHookView) => {
      const source = t(ORIGIN_LABEL[view.origin] as Parameters<typeof t>[0]);
      return h('div', {
        key: view.name,
        className: 'dsh-pet-cfg__sfxRow',
        children: [
          h('div', {
            key: 'top',
            className: 'dsh-pet-cfg__sfxTop',
            children: [
              h('code', { key: 'n', className: 'dsh-pet-cfg__sfxHook', children: view.name }),
              h('button', {
                key: 'b',
                type: 'button',
                className: 'dsh-pet-cfg__btn is-sm',
                disabled: busy || view.file === '',
                onClick: () => sfx.tryHook(view.name),
                children: t('sfxTry'),
              }),
              // 只有写进配置的那些才有「删除」：索引里扫到的素材删了会自己回来。
              view.declared
                ? h('button', {
                    key: 'd',
                    type: 'button',
                    className: 'dsh-pet-cfg__btn is-sm is-danger',
                    disabled: busy,
                    onClick: () => sfx.removeHook(view.name),
                    children: t('sfxHookRemove'),
                  })
                : null,
            ],
          }),
          h('span', {
            key: 'meta',
            className: 'dsh-pet-cfg__sfxMeta',
            children: [
              h('span', {
                key: 'f',
                className: 'dsh-pet-cfg__sfxFile',
                children: `${source}：${view.file === '' ? t('sfxNone') : view.file}`,
              }),
              // 内置点：两端口自己会在固定时机触发，不需要外部 POST；缺文件时它只是安静。
              view.builtin
                ? h('span', { key: 'b', className: 'dsh-pet-cfg__sfxPattern', children: t('sfxHookBuiltinTag') })
                : null,
            ],
          }),
        ],
      });
    };

    /** 提交表单：名字非法与已登记分别提示，成功的清空输入。 */
    const submitHook = (): void => {
      const name = draft.trim();
      if (!SFX_HOOK_NAME_RE.test(name)) {
        setError(t('sfxHookInvalid'));
        return;
      }
      if (!sfx.addHook(name)) {
        setError(t('sfxHookExists'));
        return;
      }
      setDraft('');
      setError('');
    };

    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        h('div', {
          key: 'slots',
          className: 'dsh-pet-cfg__card',
          children: [
            head(t('sfxTitle'), t('sfxHint'), 'sound'),
            h('div', { key: 'list', className: 'dsh-pet-cfg__sfxList', children: sfx.slots.map(slotRow) }),
            h('div', {
              key: 'hint',
              className: 'dsh-pet-cfg__note',
              children: t('sfxFileHint'),
            }),
          ],
        }),
        h('div', {
          key: 'hooks',
          className: 'dsh-pet-cfg__card',
          children: [
            head(t('sfxHooksTitle'), t('sfxHooksHint'), 'sound'),
            // 表单式登记：名字即标识，文件由命名规则自动匹配。
            h('div', {
              key: 'add',
              className: 'dsh-pet-cfg__sfxAdd',
              children: [
                h('input', {
                  key: 'i',
                  type: 'text',
                  className: 'dsh-pet-cfg__inp',
                  placeholder: t('sfxHookPlaceholder'),
                  value: draft,
                  disabled: busy,
                  maxLength: 64,
                  onChange: (event: { target: { value: string } }) => {
                    setDraft(event.target.value);
                    if (error !== '') setError('');
                  },
                  onKeyDown: (event: { key: string }) => {
                    if (event.key === 'Enter') submitHook();
                  },
                }),
                h('button', {
                  key: 'b',
                  type: 'button',
                  className: 'dsh-pet-cfg__btn is-primary',
                  disabled: busy || draft.trim() === '',
                  onClick: submitHook,
                  children: t('sfxHookAdd'),
                }),
              ],
            }),
            error === '' ? null : h('div', { key: 'err', className: 'dsh-pet-cfg__msg is-err', children: error }),
            h('div', {
              key: 'hint',
              className: 'dsh-pet-cfg__note',
              children: t('sfxHookPattern'),
            }),
            sfx.hooks.length === 0
              ? h('div', { key: 'empty', className: 'dsh-pet-cfg__note', children: t('sfxHookEmpty') })
              : h('div', { key: 'list', className: 'dsh-pet-cfg__sfxList', children: sfx.hooks.map(hookRow) }),
            h('div', {
              key: 'curl',
              className: 'dsh-pet-cfg__note',
              children: t('sfxHookCurlHint'),
            }),
          ],
        }),
        // 按钮旁的气泡（fixed 定位，不占布局）：问「是否创建」或说一句失败原因。
        tipNode,
      ],
    });
  };
}
