/**
 * 选中宠物的配置卡：头像与名字、大小、显示与位置、五个功能开关、实例级人设（折叠）。
 *
 * 只编辑 main 条目的实例字段：条目级字段由成品配置回落，卡里不出现也不回写；文件宠物永不进这张卡。
 * 纯展示 + 回调，状态全在设置页外壳；`onChange` 的补丁形状即提交形状的预览。
 * 版式分三段而不是「一排排同权字段」：身份（头像 + 名字 + 大小）最常用，显示与位置次之，
 * 功能开关再次之，人设默认收起——一屏之内先看到的是最常改的东西。
 * @module dsh-fish-body/src/client/settings/pet-card
 */
import type { ChangeEvent, FunctionComponent } from 'react';
import type { Pet } from '../../shared/types.ts';
import type { DirtyQuery } from './dirty.ts';
import { makePetAvatarCell, makePetFieldGroups, type PetPatch } from './pet-card-parts.ts';
import type { SettingsRuntime } from './runtime.ts';
import { INPUT_CLASS, makeUiKit } from './ui.ts';

/** 折叠正文的 id：与标题按钮的 `aria-controls` 成对。 */
const PERSONA_BODY_ID = 'pet-cfg-persona';
const SIZE_BODY_ID = 'pet-cfg-sizes';

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

  return function PetCard(props: PetCardProps) {
    const { pet, busy, dirty } = props;
    const at = 'pets.' + props.petIndex;
    const { cardHead, section, toggleCell, switchGrid, foldCard } = makeUiKit({ h, t }, dirty);
    const [personaOpen, setPersonaOpen] = useState(false);
    const [sizesOpen, setSizesOpen] = useState(false);
    if (pet === null) return h('p', { className: 'dsh-pet-cfg__note', children: t('emptyPets') });

    const fields = { pet, busy, dirty, onChange: props.onChange, path: at };

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

        section(t('secDisplay'), [
          h('div', { key: 'display', className: 'dsh-pet-cfg__grid3', children: groups.display(fields) }),
          h('div', { key: 'pos', className: 'dsh-pet-cfg__grid3', children: groups.positions(fields) }),
          // 三种素材各一套尺寸，但只有正在用的那种才需要调：收进折叠，展开就是同一个滑块。
          h(foldCard, {
            key: 'sizes',
            id: SIZE_BODY_ID,
            title: t('sizesTitle'),
            hint: t('sizeHint'),
            open: sizesOpen,
            onToggle: () => setSizesOpen(!sizesOpen),
            body: groups.sizeOverrides(fields),
          }),
        ]),

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
            // 鼠标穿透（桌面端）：开了以后该宠物的透明窗整窗忽略鼠标、点击落到下层应用。
            // 出口就在这里——窗内的右键菜单在开启后点不到，这是有意的（与配置字段同一份语义）。
            toggleCell(
              'clickThrough',
              pet.clickThrough === true,
              busy,
              (v) => props.onChange({ clickThrough: v }),
              at + '.clickThrough',
            ),
          ]),
        ]),

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
                  value: String(pet.whisperPrompt ?? ''),
                  disabled: busy,
                  placeholder: props.entryPrompt,
                  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => props.onChange({ whisperPrompt: e.target.value }),
                }),
                h('span', {
                  className: 'dsh-pet-cfg__count',
                  children: t('personaCount').replace('{n}', String(String(pet.whisperPrompt ?? '').length)),
                }),
              ],
            }),
          ],
        }),
      ],
    });
  };
}
