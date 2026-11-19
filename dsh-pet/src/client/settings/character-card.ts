/**
 * 角色卡：来源扫描 / 角色列表 + 应用 / 删除 / 导入文档预览。
 *
 * 作用域是**当前 chip 选中的实例**（`pet.id`）：标题行写明「作用于 <宠物名>」，切 chip 就换作用域。
 * 非 main 实例（pet pack）只禁用「应用」与「删除」——扫描 / 导入 / 浏览角色库只写全局库，仍可用。
 * 卡片只做展示与回调；数据在 `use-persona-characters` / `use-persona-import` 里。
 * @module dsh-fish-body/src/client/settings/character-card
 */
import type { ChangeEvent, FunctionComponent } from 'react';
import type { Pet } from '../../shared/types.ts';
import type { DirtyQuery } from './dirty.ts';
import { makeSelect } from './panel/select.ts';
import type { PersonaImportState } from './use-persona-import.ts';
import type { PersonaCharactersState } from './use-persona-characters.ts';
import type { SettingsRuntime } from './runtime.ts';
import { INPUT_CLASS, makeUiKit } from './ui.ts';

/** 角色卡的输入。 */
export interface CharacterCardProps {
  /** 当前实例（作用域与只读判定的来源）。 */
  readonly pet: Pet;
  readonly petIndex: number;
  readonly busy: boolean;
  readonly dirty: DirtyQuery;
  /** 来源 / 角色库与三个动作。 */
  readonly persona: PersonaCharactersState;
  /** 文档导入草稿。 */
  readonly importer: PersonaImportState;
  /** 应用成功后回填草稿（装配根把它接到 `list.update` + 基线推进）。 */
  readonly onChange: (patch: { whisperPrompt?: string; name?: string; personaCharacter?: string }) => void;
}

/**
 * 造角色卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export function makeCharacterCard(rt: SettingsRuntime): FunctionComponent<CharacterCardProps> {
  const { h, t, useState } = rt;
  const Select = makeSelect(rt);

  return function CharacterCard(props: CharacterCardProps) {
    const { pet, busy, dirty, persona, importer } = props;
    const { cardHead, field, note } = makeUiKit({ h, t }, dirty);
    const [writeName, setWriteName] = useState(true);
    const [sourceId, setSourceId] = useState<string | null>(null);
    // 角色选择只在本地：点「应用」才把 personaCharacter + 正文（+ 可选名字）一起写进草稿。
    const [pickedId, setPickedId] = useState<string | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const at = 'pets.' + props.petIndex;
    const writable = persona.scope?.writable === true;
    const currentId = persona.scope?.character ?? pet.personaCharacter ?? '';
    const selectedId = pickedId ?? currentId;
    const disabled = busy || !persona.ready;
    const chosenSourceId = sourceId ?? persona.sources.find((item) => item.scannable && item.installed)?.id ?? '';
    const selectedSource = persona.sources.find((item) => item.id === chosenSourceId) ?? null;

    /** 来源下拉：未安装项置灰并显示期望路径。 */
    const sourceOptions = persona.sources.map((source) => ({
      id: source.id,
      label:
        source.name +
        (source.installed ? '' : '（' + t('characterSourceMissing') + '）') +
        (source.scannable ? '' : ' · ' + t('characterSourceNoScan')),
    }));

    /** 角色下拉：没有角色时给一条空项，避免「下拉空白但按钮可点」。 */
    const characterOptions = [
      { id: '', label: t('characterNone') },
      ...persona.characters.map((item) => ({
        id: item.id,
        label: item.name + ' · ' + item.source.kind,
      })),
    ];

    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(
          t('characterTitle') + ' · ' + t('characterScopeLabel').replace('{pet}', pet.name || pet.id),
          t('characterHint'),
          'pets',
          h('button', {
            type: 'button',
            className: 'dsh-pet-cfg__btn is-sm',
            disabled: busy,
            onClick: () => persona.reload(),
            children: t('characterReload'),
          }),
        ),

        // 来源：下拉 + 「扫描并导入」
        h('div', {
          key: 'source',
          className: 'dsh-pet-cfg__pair',
          children: [
            field(
              t('characterSourceLabel'),
              h(Select, {
                label: t('characterSourceLabel'),
                value: selectedSource?.id ?? '',
                options: sourceOptions,
                disabled: disabled,
                onChange: (id: string) => setSourceId(id),
              }),
              t('characterSourceHint'),
              at + '.personaCharacter',
            ),
            h('div', {
              key: 'scan',
              className: 'dsh-pet-cfg__actions',
              children: h('button', {
                type: 'button',
                className: 'dsh-pet-cfg__btn is-sm',
                disabled: disabled || selectedSource === null || persona.busy,
                onClick: () => {
                  if (selectedSource !== null) void persona.scan(selectedSource.id);
                },
                children: t('characterScan'),
              }),
            }),
          ],
        }),
        // 未安装来源的期望路径：逐条列出（路径只由宿主给，客户端不拼）
        ...persona.sources
          .filter((source) => !source.installed && source.expectedPath !== null)
          .map((source) => note(t('characterExpectedPath').replace('{path}', String(source.expectedPath)), true)),

        // 角色：下拉 + 应用 / 删除 + 同时改名字
        h('div', {
          key: 'pick',
          className: 'dsh-pet-cfg__pair',
          children: [
            field(
              t('characterPickLabel'),
              h(Select, {
                label: t('characterPickLabel'),
                value: selectedId,
                options: characterOptions,
                // 只读实例（pet pack）：下拉与「应用 / 删除」一起禁用，别让「不引用」绕道写盘。
                disabled: disabled || !writable,
                onChange: (id: string) => {
                  setPickedId(id);
                  // 「（不引用角色）」是唯一立刻生效的选项：只删引用键，正文一个字不动。
                  if (id === '') props.onChange({ personaCharacter: undefined });
                },
              }),
              t('characterPickHint'),
              at + '.personaCharacter',
            ),
            h('div', {
              key: 'acts',
              className: 'dsh-pet-cfg__actions',
              children: [
                h('button', {
                  key: 'apply',
                  type: 'button',
                  className: 'dsh-pet-cfg__btn is-primary is-sm',
                  disabled: disabled || !writable || selectedId === '' || persona.busy,
                  onClick: () => {
                    if (selectedId !== '') void persona.apply(selectedId, writeName, String(pet.whisperPrompt ?? ''));
                  },
                  children: t('characterApply'),
                }),
                h('button', {
                  key: 'remove',
                  type: 'button',
                  className: 'dsh-pet-cfg__btn is-danger is-sm',
                  disabled: disabled || !writable || selectedId === '' || persona.busy,
                  onClick: () => {
                    if (selectedId !== '') void persona.remove(selectedId);
                  },
                  children: t('characterRemove'),
                }),
              ],
            }),
          ],
        }),
        h('label', {
          key: 'writeName',
          className: 'dsh-pet-cfg__checkRow',
          children: [
            h('input', {
              type: 'checkbox',
              checked: writeName,
              disabled: disabled,
              onChange: (e: ChangeEvent<HTMLInputElement>) => setWriteName(e.target.checked),
            }),
            h('span', { children: t('characterWriteName') }),
          ],
        }),
        writable ? null : note(t('characterReadonly'), true),

        // 导入文档：入口 + 预览（三格可编辑）
        h('div', {
          key: 'import',
          className: 'dsh-pet-cfg__actions',
          children: h('button', {
            type: 'button',
            className: 'dsh-pet-cfg__btn is-sm',
            disabled: busy,
            onClick: () => setImportOpen(!importOpen),
            children: t('characterImport'),
          }),
        }),
        importOpen
          ? h('div', {
              key: 'preview',
              className: 'dsh-pet-cfg__importBox',
              children: [
                // 文件框铺满这条虚线区（不是整张卡）：position:relative 的边界就在这里。
                h('label', {
                  key: 'file',
                  className: 'dsh-pet-cfg__importPick',
                  children: [
                    h('span', { key: 't', children: t('characterImportPick') }),
                    h('input', {
                      key: 'i',
                      className: 'dsh-pet-cfg__file',
                      type: 'file',
                      multiple: true,
                      accept: '.md,.txt,.json,.png,.docx',
                      disabled: busy || importer.busy,
                      'aria-label': t('characterImportPick'),
                      onChange: (e: ChangeEvent<HTMLInputElement>) => {
                        const picked = [...(e.target.files ?? [])];
                        e.target.value = '';
                        if (picked.length > 0) void importer.pick(picked);
                      },
                    }),
                  ],
                }),
                importer.preview === null
                  ? note(t('characterImportHint'), true)
                  : h('div', {
                      key: 'fields',
                      className: 'dsh-pet-cfg__columns',
                      children: [
                        field(
                          t('characterImportedName'),
                          h('input', {
                            type: 'text',
                            className: INPUT_CLASS,
                            value: importer.preview.name,
                            disabled: busy,
                            onChange: (e: ChangeEvent<HTMLInputElement>) => importer.update({ name: e.target.value }),
                          }),
                        ),
                        field(
                          t('characterImportedDescription'),
                          h('textarea', {
                            className: INPUT_CLASS + ' dsh-pet-cfg__area',
                            rows: 3,
                            value: importer.preview.description,
                            disabled: busy,
                            onChange: (e: ChangeEvent<HTMLTextAreaElement>) =>
                              importer.update({ description: e.target.value }),
                          }),
                        ),
                        field(
                          t('characterImportedPersonality'),
                          h('textarea', {
                            className: INPUT_CLASS + ' dsh-pet-cfg__area',
                            rows: 2,
                            value: importer.preview.personality,
                            disabled: busy,
                            onChange: (e: ChangeEvent<HTMLTextAreaElement>) =>
                              importer.update({ personality: e.target.value }),
                          }),
                        ),
                        h('div', {
                          key: 'acts',
                          className: 'dsh-pet-cfg__actions',
                          children: [
                            h('button', {
                              key: 'commit',
                              type: 'button',
                              className: 'dsh-pet-cfg__btn is-primary is-sm',
                              disabled: busy || importer.busy,
                              onClick: () => void importer.commit(),
                              children: t('characterImportCommit'),
                            }),
                            h('button', {
                              key: 'cancel',
                              type: 'button',
                              className: 'dsh-pet-cfg__btn is-sm',
                              disabled: busy,
                              onClick: importer.cancel,
                              children: t('cancel'),
                            }),
                          ],
                        }),
                      ],
                    }),
              ],
            })
          : null,
      ],
    });
  };
}
