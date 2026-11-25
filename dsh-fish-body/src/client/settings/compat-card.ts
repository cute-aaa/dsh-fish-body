/**
 * 「兼容与记忆」卡：谁也在驱动这只宠物（共存）+ 装了记忆插件有没有接上。
 *
 * 两张信息合一张卡的理由：它们回答的是同一个问题——「除了本插件，还有谁在参与这只宠物」。
 * 分成两张卡会让用户在两处之间对照，而它们本来就该一起读。
 *
 * 两个刻意不做的：
 * - **不自动切模式**：`auto` 只报告。自动静音会被当成「宠物坏了」，改不改由人点。
 * - **不做保存按钮**：模式是即时生效的运行时开关（不是配置），点了就变，不需要「保存」这个动作。
 * @module dsh-fish-body/src/client/settings/compat-card
 */
import type { FunctionComponent } from 'react';
import { loadCompat, setCoexistMode, type CompatSnapshot, type CoexistMode } from './compat-api.ts';
import { NO_INTEGRATIONS, type IntegrationsState } from './use-integrations.ts';
import { pickFolder } from './layout-api.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

/** 卡片输入（这张卡不产生「未保存改动」，因此只接 busy）。 */
export interface CompatCardProps {
  /** 保存中或配置未就绪时禁用模式按钮。 */
  readonly busy: boolean;
  /** persona / memory 接入配置。 */
  readonly integrations?: IntegrationsState;
}

/** 三个模式的显示顺序与 i18n 键。 */
const MODES: readonly { mode: CoexistMode; key: string }[] = [
  { mode: 'auto', key: 'compatModeAuto' },
  { mode: 'full', key: 'compatModeFull' },
  { mode: 'body-only', key: 'compatModeBodyOnly' },
];

/**
 * 造「兼容与记忆」卡。
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export function makeCompatCard(rt: SettingsRuntime): FunctionComponent<CompatCardProps> {
  const { h, t, useState, useEffect } = rt;

  return function CompatCard(props: CompatCardProps) {
    const { cardHead, note } = makeUiKit({ h, t });
    const integrations = props.integrations ?? NO_INTEGRATIONS;
    const [snapshot, setSnapshot] = useState<CompatSnapshot | null>(null);
    const [message, setMessage] = useState('');
    const [failed, setFailed] = useState(false);
    const [pending, setPending] = useState<CoexistMode | ''>('');
    const [draftDir, setDraftDir] = useState<string | null>(null);
    const [draftMode, setDraftMode] = useState<'auto' | 'custom' | null>(null);
    const [needsApproval, setNeedsApproval] = useState(false);

    // 挂载拉一次：两个端点都只读、零副作用，不需要轮询
    useEffect(() => {
      let alive = true;
      void loadCompat().then((next) => {
        if (alive) setSnapshot(next);
      });
      return () => {
        alive = false;
      };
    }, []);

    /** 点一个模式：即时生效，成功后整体刷新（记忆状态也可能随之变）。 */
    const pick = (mode: CoexistMode): void => {
      setPending(mode);
      void setCoexistMode(mode).then((result) => {
        setPending('');
        if (result.ok) {
          setSnapshot(result.snapshot);
          setMessage('');
          setFailed(false);
          return;
        }
        setMessage(result.message);
        setFailed(true);
      });
    };

    const disabled = props.busy || pending !== '';
    const coexist = snapshot?.coexist ?? null;
    const memory = snapshot?.memory ?? null;
    const mode = draftMode ?? integrations.view?.memory.mode ?? memory?.mode ?? 'auto';
    const customDir = draftDir ?? integrations.view?.memory.path ?? memory?.customDir ?? '';

    const refreshMemory = (): void => {
      void loadCompat().then((next) => setSnapshot(next));
    };

    const saveMemory = async (nextMode: 'auto' | 'custom', dir: string | null, approve: boolean): Promise<void> => {
      const outcome = await integrations.saveMemory(nextMode, dir, approve);
      if (!outcome.ok) {
        setNeedsApproval(outcome.reason === 'external-approval-required');
        setMessage(outcome.message);
        setFailed(true);
        return;
      }
      setNeedsApproval(false);
      setMessage('');
      setFailed(false);
      setDraftMode(null);
      refreshMemory();
    };

    const pickMemoryDir = async (): Promise<void> => {
      const picked = await pickFolder(t('compatMemoryPick'));
      if (picked.kind === 'picked') {
        setDraftDir(picked.path);
        setNeedsApproval(false);
        return;
      }
      if (picked.kind === 'unsupported') {
        setMessage(picked.message || t('compatMemoryPickFailed'));
        setFailed(true);
      }
    };

    /** 共存段：检测到的同伴 + 三个模式按钮。 */
    const coexistBlock = [
      h('div', {
        key: 'partners',
        className: 'dsh-pet-cfg__rowMeta',
        children:
          coexist === null
            ? t('compatUnavailable')
            : coexist.partners.length === 0
              ? t('compatNoPartner')
              : t('compatPartners') + '：' + coexist.partners.map((item) => item.label).join('、'),
      }),
      h('div', {
        key: 'modes',
        className: 'dsh-pet-cfg__row',
        children: [
          h('div', {
            key: 'main',
            className: 'dsh-pet-cfg__rowMain',
            children: MODES.map((item) =>
              h('button', {
                key: item.mode,
                type: 'button',
                className: 'dsh-pet-cfg__btn' + (coexist?.mode === item.mode ? '' : ' is-text'),
                disabled,
                onClick: () => pick(item.mode),
                children: pending === item.mode ? t('compatWorking') : t(item.key),
              }),
            ),
          }),
        ],
      }),
      h('div', {
        key: 'paused',
        className: 'dsh-pet-cfg__rowMeta',
        children: coexist === null ? '' : coexist.autoWhisperPaused ? t('compatPaused') : t('compatActive'),
      }),
    ];

    /** 记忆段：接上了谁 / 为什么没接上。 */
    const memoryLines =
      memory === null
        ? [note(t('compatUnavailable'))]
        : [
            note(
              memory.provider !== null
                ? t('compatMemoryOn') + '：' + memory.provider.id + '（' + String(memory.provider.notes) + ' 条）'
                : memory.slotTakenByOther
                  ? t('compatMemoryTaken')
                  : t('compatMemoryNone'),
              false,
            ),
            ...memory.candidates.map((item) =>
              h('div', {
                key: item.id,
                className: 'dsh-pet-cfg__rowMeta',
                children: [item.label, item.installed ? t('compatInstalled') : t('compatNotInstalled'), item.evidence]
                  .filter((part) => part !== '')
                  .join(' · '),
              }),
            ),
          ];

    const memoryControls = [
      h('div', {
        key: 'memory-modes',
        className: 'dsh-pet-cfg__actions',
        children: [
          h('button', {
            key: 'auto',
            type: 'button',
            className: 'dsh-pet-cfg__btn is-sm' + (mode === 'auto' ? ' is-primary' : ' is-text'),
            disabled: disabled || integrations.busy,
            onClick: () => {
              setDraftMode('auto');
              void saveMemory('auto', null, false);
            },
            children: t('compatMemoryAuto'),
          }),
          h('button', {
            key: 'custom',
            type: 'button',
            className: 'dsh-pet-cfg__btn is-sm' + (mode === 'custom' ? ' is-primary' : ' is-text'),
            disabled: disabled || integrations.busy,
            onClick: () => {
              setDraftMode('custom');
              if (customDir.trim() !== '') void saveMemory('custom', customDir, false);
            },
            children: t('compatMemoryCustom'),
          }),
        ],
      }),
      mode === 'custom'
        ? h('div', {
            key: 'memory-path',
            className: 'dsh-pet-cfg__pair',
            children: [
              h('input', {
                key: 'input',
                type: 'text',
                className: 'dsh-pet-cfg__inp',
                value: customDir,
                placeholder: t('compatMemoryPathHint'),
                disabled: disabled || integrations.busy,
                onChange: (e: { target: { value: string } }) => {
                  setDraftDir(e.target.value);
                  setNeedsApproval(false);
                },
              }),
              h('div', {
                key: 'actions',
                className: 'dsh-pet-cfg__actions',
                children: [
                  h('button', {
                    key: 'pick',
                    type: 'button',
                    className: 'dsh-pet-cfg__btn is-sm',
                    disabled: disabled || integrations.busy,
                    onClick: () => void pickMemoryDir(),
                    children: t('compatMemoryPick'),
                  }),
                  h('button', {
                    key: 'save',
                    type: 'button',
                    className: 'dsh-pet-cfg__btn is-sm is-primary',
                    disabled: disabled || integrations.busy || customDir.trim() === '',
                    onClick: () => void saveMemory('custom', customDir, false),
                    children: integrations.busy ? t('compatWorking') : t('compatMemoryReconnect'),
                  }),
                ],
              }),
            ],
          })
        : null,
      mode === 'custom' && needsApproval
        ? h('div', {
            key: 'memory-approval',
            className: 'dsh-pet-cfg__banner is-warn',
            children: [
              h('span', { key: 'text', children: t('compatMemoryExternalWarning') }),
              h('button', {
                key: 'approve',
                type: 'button',
                className: 'dsh-pet-cfg__btn is-sm is-primary',
                disabled: integrations.busy,
                onClick: () => void saveMemory('custom', customDir, true),
                children: t('compatMemoryApprove'),
              }),
              h('button', {
                key: 'cancel',
                type: 'button',
                className: 'dsh-pet-cfg__btn is-sm',
                onClick: () => setNeedsApproval(false),
                children: t('cancel'),
              }),
            ],
          })
        : null,
    ];

    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('compatTitle'), t('compatHint')),
        ...coexistBlock,
        message !== '' ? note(message, failed) : null,
        h('div', { key: 'mem-head', className: 'dsh-pet-cfg__rowMeta', children: t('compatMemoryTitle') }),
        ...memoryControls,
        ...memoryLines,
      ],
    });
  };
}
