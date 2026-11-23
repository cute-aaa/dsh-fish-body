/**
 * 自定义 hook 卡：登记一个名字即可用 `POST /sfx/<名字>?pet=<id>` 触发，列表里可试听与取消登记。
 *
 * 名字就是标识符，文件由命名规则自动匹配，所以这张卡只有「输入 + 登记」和一份名单，
 * 不需要文件选择器。名单里的每一行只说三件事：名字、来源（内置触发点 / 扫描到的文件 / 未匹配）、能做什么。
 * 末尾那句 curl 示例留常显：它是这个功能唯一的用法说明，藏进折叠里等于没写。
 * owns only 这张卡的输入与名单，never 索引构建与写盘。
 * @module dsh-fish-body/src/client/settings/sfx-hooks
 */
import type { FunctionComponent } from 'react';
import { SFX_HOOK_NAME_RE } from '../../shared/sfx/types.ts';
import { NO_DIRTY, type DirtyQuery } from './dirty.ts';
import { makeFolderButton } from './folder-button.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';
import type { SfxHookView, SfxSettings } from './use-sfx-settings.ts';
import { ORIGIN_LABEL } from './sfx-slot-row.ts';

/** hook 卡的输入。 */
export interface SfxHooksProps {
  /** 保存中或配置未就绪时禁用编辑。 */
  readonly busy: boolean;
  /** 分区状态：名单、登记与删除。 */
  readonly sfx: SfxSettings;
  /** 未保存改动查询口：被改过的那一条自己亮一颗圆点。 */
  readonly dirty?: DirtyQuery;
}

/**
 * 造自定义 hook 卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export function makeSfxHooks(rt: SettingsRuntime): FunctionComponent<SfxHooksProps> {
  const { h, t, useState } = rt;
  const FolderButton = makeFolderButton(rt);

  return function SfxHooks(props: SfxHooksProps) {
    const { busy, sfx } = props;
    const dirty = props.dirty ?? NO_DIRTY;
    const { cardHead, note } = makeUiKit({ h, t });
    const [draft, setDraft] = useState('');
    const [error, setError] = useState('');

    /** 提交表单：名字非法与已登记分别提示，成功的清空输入。 */
    const submit = (): void => {
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

    /** 一行：名字、来源、试听、取消登记与路径。 */
    const row = (view: SfxHookView) => {
      const touched = dirty.has('sfx.hooks.' + view.name);
      return h('div', {
        key: view.name,
        className: 'dsh-pet-cfg__row' + (touched ? ' is-dirty' : ''),
        children: [
          h('div', {
            key: 'main',
            className: 'dsh-pet-cfg__rowMain',
            children: [
              h('code', { key: 'n', className: 'dsh-pet-cfg__mono', children: view.name }),
              h('span', {
                key: 'b',
                className: 'dsh-pet-cfg__badge' + (view.file === '' ? ' is-warn' : ''),
                children: view.builtin
                  ? t('sfxHookBuiltinTag')
                  : t(ORIGIN_LABEL[view.origin] as Parameters<typeof t>[0]),
              }),
              h('button', {
                key: 'try',
                type: 'button',
                className: 'dsh-pet-cfg__btn is-text',
                disabled: busy || view.file === '',
                onClick: () => sfx.tryHook(view.name),
                children: t('sfxTry'),
              }),
              // 只有写进配置的那些才有「取消登记」：索引里扫到的素材删了会自己回来。
              view.declared
                ? h('button', {
                    key: 'rm',
                    type: 'button',
                    className: 'dsh-pet-cfg__btn is-text',
                    disabled: busy,
                    onClick: () => sfx.removeHook(view.name),
                    children: t('sfxHookRemove'),
                  })
                : null,
            ],
          }),
          h('div', {
            key: 'meta',
            className: 'dsh-pet-cfg__rowMeta',
            children: [
              h('code', {
                key: 'f',
                className: 'dsh-pet-cfg__mono',
                children: view.file === '' ? t('sfxNone') : view.file,
              }),
              h(FolderButton, { key: 'open', which: view.which, disabled: busy }),
            ],
          }),
        ],
      });
    };

    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('sfxHooksTitle'), t('sfxHooksHint'), 'sfx'),
        h('div', {
          key: 'add',
          className: 'dsh-pet-cfg__actions',
          children: [
            h('input', {
              key: 'i',
              type: 'text',
              className: 'dsh-pet-cfg__inp',
              placeholder: t('sfxHookPlaceholder'),
              value: draft,
              disabled: busy,
              maxLength: 64,
              style: { flex: '1 1 180px', minWidth: '0' },
              onChange: (event: { target: { value: string } }) => {
                setDraft(event.target.value);
                if (error !== '') setError('');
              },
              onKeyDown: (event: { key: string }) => {
                if (event.key === 'Enter') submit();
              },
            }),
            h('button', {
              key: 'b',
              type: 'button',
              className: 'dsh-pet-cfg__btn is-primary',
              disabled: busy || draft.trim() === '',
              onClick: submit,
              children: t('sfxHookAdd'),
            }),
          ],
        }),
        error === '' ? null : h('div', { key: 'err', className: 'dsh-pet-cfg__msg is-err', children: error }),
        note(t('sfxHookPattern')),
        sfx.hooks.length === 0
          ? note(t('sfxHookEmpty'))
          : h('div', { key: 'list', className: 'dsh-pet-cfg__rows', children: sfx.hooks.map(row) }),
        note(t('sfxHookCurlHint'), true),
      ],
    });
  };
}
