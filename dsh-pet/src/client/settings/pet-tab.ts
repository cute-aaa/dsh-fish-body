/**
 * 「桌宠」分区：一个选择器行（种类 + 实例）+ 选中实例的配置卡。
 *
 * 过去这里是三排同形按钮（顶层分区、种类、实例），彼此只靠颜色区分层级，读起来像三份平级菜单。
 * 现在第一层是顶部分段标签，第二层是这一行的 chip，第三层才是卡片里的字段——
 * 层级靠形状与尺寸分开，不再靠在三排里长得一样的方块。
 * 实例的增删与选中都在 `use-pet-list` 里；本分区不持有任何状态。
 * owns only 这一块的装配，never 字段值、保存与头像上传的实现。
 * @module dsh-pet/src/client/settings/pet-tab
 */
import type { FunctionComponent } from 'react';
import type { DirtyQuery } from './dirty.ts';
import { makeSelect } from './panel/select.ts';
import { makePetCard } from './pet-card.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';
import type { PetList } from './use-pet-list.ts';

/** 头像预览的一格。 */
export interface PetAvatarView {
  /** 预览地址（已带破缓存版本号）；没上传过时就是默认 logo。 */
  readonly src: string;
  /** 上传中：按钮禁用并换文案。 */
  readonly busy: boolean;
  /** 选中一张新头像；只有 pet pack 的实例可以换，`main` 只显示预览。 */
  readonly onPick: (file: File) => void;
}

/** 宠物分区的输入。 */
export interface PetTabProps {
  /** 列表状态与全部操作。 */
  readonly list: PetList;
  /** 头像格。 */
  readonly avatar: PetAvatarView;
  /** 表单是否禁用（保存中或配置还没加载好）。 */
  readonly busy: boolean;
  /** 未保存改动查询口。 */
  readonly dirty: DirtyQuery;
}

/**
 * 造宠物分区。
 *
 * @param rt - 注入的 react 能力、hooks 与翻译函数。
 * @returns 分区组件。
 */
export function makePetTab(rt: SettingsRuntime): FunctionComponent<PetTabProps> {
  const { h, t } = rt;
  const Select = makeSelect(rt);
  const PetCard = makePetCard(rt);
  const { note } = makeUiKit({ h, t });

  return function PetTab(props: PetTabProps) {
    const { list, busy, avatar, dirty } = props;
    const current = list.pets.find((pet) => pet.id === list.selId) ?? null;
    // 头像只能属于 pet pack：main（含没有 assetRoot 的实例）用插件默认 logo，不给上传入口。
    const avatarEditable = current !== null && current.assetRoot !== undefined && current.assetRoot !== 'main';
    // 另 n 个种类来自 pet/ 目录：只在真有文件宠物时提一句，普通用户不被打扰。
    const packCount = list.kinds.filter((item) => item.kind === 'pack').length;

    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        h('div', {
          key: 'picker',
          className: 'dsh-pet-cfg__picker',
          children: [
            // 种类：条目名可能很长（pet/ 下的目录前缀），所以用下拉而不是再排一排按钮。
            h('div', {
              key: 'kind',
              className: 'dsh-pet-cfg__kindPicker',
              children: h(Select, {
                label: t('kindLabel'),
                value: list.kind,
                options: list.kinds.map((item) => ({
                  id: item.entry,
                  label: (item.kind === 'main' ? t('kindMain') : item.entry) + ' (' + item.count + ')',
                })),
                disabled: busy,
                onChange: list.selectKind,
              }),
            }),
            h('div', {
              key: 'pets',
              className: 'dsh-pet-cfg__chips',
              children: [
                ...list.visiblePets.map((pet) =>
                  h('button', {
                    key: pet.id,
                    type: 'button',
                    className: 'dsh-pet-cfg__chip' + (pet.id === list.selId ? ' is-active' : ''),
                    title: pet.name + ' · ' + pet.size + 'px',
                    onClick: () => list.select(pet.id),
                    children: pet.name || pet.id,
                  }),
                ),
                h('button', {
                  key: 'add',
                  type: 'button',
                  className: 'dsh-pet-cfg__chip is-add',
                  disabled: busy,
                  onClick: list.add,
                  children: '+ ' + t('add'),
                }),
              ],
            }),
          ],
        }),
        packCount > 0 ? note(t('extraPetsHint').replace('{n}', String(packCount)), true) : null,
        h(PetCard, {
          key: 'card',
          pet: current,
          busy,
          entryPrompt: list.entryPrompt,
          avatarSrc: avatar.src,
          avatarBusy: avatar.busy,
          // 内置条目没有这个能力：不传 onAvatar，卡片就只渲染预览。
          ...(avatarEditable ? { onAvatar: avatar.onPick } : {}),
          onChange: list.update,
          onRemove: list.requestRemove,
          dirty,
        }),
      ],
    });
  };
}
