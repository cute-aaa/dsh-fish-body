/**
 * 选中宠物的配置卡：身份（头像 / 名字 / 大小）→ 角色卡（常显）→ 人设正文（折叠，含 AI 润色）→ 能力开关。
 *
 * 只编辑 main 条目的实例字段：条目级字段由成品配置回落，卡里不出现也不回写；文件宠物永不进这张卡。
 * 纯展示 + 回调，状态全在设置页外壳；`onChange` 的补丁形状即提交形状的预览。
 * 渲染方式 / 位置 / 尺寸已经搬到「外观与手感」的渲染卡——这张卡只回答「它是谁、用什么人设、开什么能力」。
 * @module dsh-fish-body/src/client/settings/pet-card
 */
import type { ChangeEvent, FunctionComponent } from 'react';
import type { Pet } from '../../shared/types.ts';
import type { DirtyQuery } from './dirty.ts';
import { makeCharacterCard } from './character-card.ts';
import { makePetAvatarCell, makePetFieldGroups, type PetPatch } from './pet-card-parts.ts';
import type { SettingsRuntime } from './runtime.ts';
import { INPUT_CLASS, makeUiKit } from './ui.ts';
import type { PersonaImportState } from './use-persona-import.ts';
import type { PersonaPolishState } from './use-persona-polish.ts';
import type { PersonaCharactersState } from './use-persona-characters.ts';

/** 折叠正文的 id：与标题按钮的 `aria-controls` 成对。 */
const PERSONA_BODY_ID = 'pet-cfg-persona';

/** 角色卡需要的三个外部状态（卡片本身不持有它们）。 */
export interface PetCharacterDeps {
  readonly persona: PersonaCharactersState;
  readonly importer: PersonaImportState;
  readonly polish: PersonaPolishState;
  /** 应用 / 导入成功后回填草稿（装配根接到 `list.update` + 基线推进）。 */
  readonly onChange: (patch: PetPatch) => void;
}

/** 宠物卡的全部输入。 */
export interface PetCardProps {
  /** 当前选中的宠物；`null` 表示列表为空。 */
  pet: Pet | null;
  /** 这只宠物在宠物列表里的下标：与快照路径 `pets.<下标>` 对齐，改动逐项标记靠它。 */
  petIndex: number;
  /** 表单是否禁用（保存中或配置还没加载好）。 */
  busy: boolean;
  /** 条目级人设正文，作为实例人设输入框的 placeholder。 */
  entryPrompt: string;
  /** 头像预览地址（已带破缓存版本号）；没上传过时宿主回的就是默认 logo。 */
  avatarSrc: string;
  /** 头像正在上传：遮罩常显且文件框禁用。 */
  avatarBusy: boolean;
  /** 选中一张新头像；内置条目没有这个能力，传 undefined 时只显示预览、不可点。 */
  onAvatar?: (file: File) => void;
  /** 改选中宠物的字段。 */
  onChange: (patch: PetPatch) => void;
  /** 删除当前宠物（先弹确认）。 */
  onRemove: () => void;
  /** 未保存改动查询口（整只宠物算一条路径）。 */
  dirty: DirtyQuery;
  /** 角色 / 导入 / 润色三个数据源；缺省时不渲染角色卡（单测与精简渲染零负担）。 */
  character?: PetCharacterDeps;
}

/**
 * 造宠物配置卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export function makePetCard(rt: SettingsRuntime): FunctionComponent<PetCardProps> {
  const { h, t, useState } = rt;
  // 部件工厂在装配时各调一次：组件类型跨渲染稳定，卡片重渲染不会重建它们。
  const AvatarCell = makePetAvatarCell(rt);
  const groups = makePetFieldGroups(rt);
  const CharacterCard = makeCharacterCard(rt);

  return function PetCard(props: PetCardProps) {
    const { pet, busy, dirty, character } = props;
    const at = 'pets.' + props.petIndex;
    const { cardHead, section, toggleCell, switchGrid, foldCard, note } = makeUiKit({ h, t }, dirty);
    const [personaOpen, setPersonaOpen] = useState(false);
    if (pet === null) return h('p', { className: 'dsh-pet-cfg__note', children: t('emptyPets') });

    const fields = { pet, busy, dirty, onChange: props.onChange, path: at };
    const personaText = String(pet.whisperPrompt ?? '');
    const polish = character?.polish;

    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(
          t('petCardTitle'),
          t('petCardHint'),
          'pets',
          // 右侧只剩删除：保存已收进底部操作栏，卡片上不再有第二个保存入口。
          h('button', {
            type: 'button',
            onClick: props.onRemove,
            disabled: busy,
            className: 'dsh-pet-cfg__btn is-danger is-sm',
            children: t('remove'),
          }),
        ),

        // 身份：头像作左列，名字与大小作右列（最常改的两项就在这一行）。
        h('div', {
          key: 'identity',
          className: 'dsh-pet-cfg__identity',
          children: [
            h(AvatarCell, {
              key: 'avatar',
              avatarSrc: props.avatarSrc,
              avatarBusy: props.avatarBusy,
              busy,
              onAvatar: props.onAvatar,
            }),
            h('div', { key: 'fields', className: 'dsh-pet-cfg__identityFields', children: groups.identity(fields) }),
          ],
        }),

        // 角色卡：常显（它是这一页的主语义），作用域 = 当前实例。
        character === undefined
          ? null
          : h(CharacterCard, {
              key: 'character',
              pet,
              petIndex: props.petIndex,
              busy,
              dirty,
              persona: character.persona,
              importer: character.importer,
              onChange: character.onChange,
            }),

        // 人设（可选，实例级）：写在这只宠物上的 whisperPrompt，空 = 跟随所属条目的人设。
        // 占位符直接用条目人设正文，让「跟随的是什么」可见；人设没有长度上限，右下角只显示字数。
        foldCard({
          id: PERSONA_BODY_ID,
          title: t('personaLabel'),
          hint: t('personaHint'),
          open: personaOpen,
          onToggle: () => setPersonaOpen(!personaOpen),
          body: [
            h('div', {
              key: 'area',
              className: 'dsh-pet-cfg__persona',
              children: [
                h('textarea', {
                  className: INPUT_CLASS + ' dsh-pet-cfg__area',
                  rows: 3,
                  value: personaText,
                  disabled: busy,
                  placeholder: props.entryPrompt,
                  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => props.onChange({ whisperPrompt: e.target.value }),
                }),
                h('span', {
                  className: 'dsh-pet-cfg__count',
                  children: t('personaCount').replace('{n}', String(personaText.length)),
                }),
              ],
            }),
            // AI 润色：只出预览，点「应用」才进草稿；取消则正文一字不变。
            h('div', {
              key: 'toolbar',
              className: 'dsh-pet-cfg__actions',
              children: [
                h('button', {
                  key: 'polish',
                  type: 'button',
                  className: 'dsh-pet-cfg__btn is-sm',
                  disabled: busy || polish === undefined || polish.busy || personaText.trim() === '',
                  onClick: () => void polish?.polish(personaText),
                  children: t('personaPolish'),
                }),
                h('span', { key: 'note', className: 'dsh-pet-cfg__note is-tight', children: t('personaPolishHint') }),
              ],
            }),
            polish === undefined || polish.preview === null
              ? null
              : h('div', {
                  key: 'preview',
                  className: 'dsh-pet-cfg__previewBlock',
                  children: [
                    // 原文 / 润色后对照：两列只读，点「应用」才写进草稿。
                    h('div', {
                      key: 'diff',
                      className: 'dsh-pet-cfg__previewGrid',
                      children: [
                        h('div', {
                          key: 'before',
                          className: 'dsh-pet-cfg__previewCell',
                          children: [
                            h('span', {
                              key: 'l',
                              className: 'dsh-pet-cfg__flabel',
                              children: t('personaPolishBefore'),
                            }),
                            h('p', { key: 't', className: 'dsh-pet-cfg__note', children: personaText }),
                          ],
                        }),
                        h('div', {
                          key: 'after',
                          className: 'dsh-pet-cfg__previewCell',
                          children: [
                            h('span', {
                              key: 'l',
                              className: 'dsh-pet-cfg__flabel',
                              children: t('personaPolishAfter'),
                            }),
                            h('p', { key: 't', className: 'dsh-pet-cfg__note', children: polish.preview }),
                          ],
                        }),
                      ],
                    }),
                    h('p', {
                      key: 'text',
                      className: 'dsh-pet-cfg__note',
                      children: t('personaPolishPreview').replace('{n}', String(polish.preview.length)),
                    }),
                    h('div', {
                      key: 'acts',
                      className: 'dsh-pet-cfg__actions',
                      children: [
                        h('button', {
                          key: 'apply',
                          type: 'button',
                          className: 'dsh-pet-cfg__btn is-primary is-sm',
                          disabled: busy,
                          onClick: polish.apply,
                          children: t('apply'),
                        }),
                        h('button', {
                          key: 'cancel',
                          type: 'button',
                          className: 'dsh-pet-cfg__btn is-sm',
                          disabled: busy,
                          onClick: polish.cancel,
                          children: t('cancel'),
                        }),
                      ],
                    }),
                  ],
                }),
          ],
        }),

        section(t('secFeatures'), [
          switchGrid([
            toggleCell(
              'balanceEnabled',
              !!pet.balanceEnabled,
              busy,
              (v) => props.onChange({ balanceEnabled: v }),
              at + '.balanceEnabled',
            ),
            toggleCell(
              'whisperEnabled',
              !!pet.whisperEnabled,
              busy,
              (v) => props.onChange({ whisperEnabled: v }),
              at + '.whisperEnabled',
            ),
            toggleCell(
              'workStatusEnabled',
              !!pet.workStatusEnabled,
              busy,
              (v) => props.onChange({ workStatusEnabled: v }),
              at + '.workStatusEnabled',
            ),
            toggleCell(
              'fixedEnabled',
              !!pet.fixedEnabled,
              busy,
              (v) => props.onChange({ fixedEnabled: v }),
              at + '.fixedEnabled',
            ),
          ]),
        ]),
        note(t('petCardNote'), true),
      ],
    });
  };
}
