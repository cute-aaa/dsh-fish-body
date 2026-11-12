/**
 * 「宠物」分区：种类条 + 宠物条 + 选中实例的配置卡。
 *
 * 三个部件共享同一个列表状态（`PetList`），所以整块一起装配、一起接收同一个 `list`；
 * 分区本身不持有任何状态，增删与选中都在 `use-pet-list` 里。
 * owns only 这一块的装配，never 字段值、保存与头像上传的实现。
 * @module dsh-pet/src/client/settings/pet-tab
 */
import type { FunctionComponent } from 'react';
import type { Feedback } from './actions.ts';
import { makeKindTabs } from './kind-tabs.ts';
import { makePetCard } from './pet-card.ts';
import { makePetTabs } from './pet-tabs.ts';
import type { SettingsRuntime } from './runtime.ts';
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
  /** 保存反馈（头像上传结果也写在这里）。 */
  readonly feedback: Feedback;
  /** 头像格。 */
  readonly avatar: PetAvatarView;
  /** 表单是否禁用（保存中或配置还没加载好）。 */
  readonly busy: boolean;
  /** 就近保存。 */
  onSave(): void;
}

/**
 * 造宠物分区。
 *
 * @param rt - 注入的 react 能力、hooks 与翻译函数。
 * @returns 分区组件。
 */
export function makePetTab(rt: SettingsRuntime): FunctionComponent<PetTabProps> {
  const { h, t } = rt;
  // 三个部件在装配时各造一次：组件类型跨渲染稳定，切分区不会把浮层状态带乱。
  const KindTabs = makeKindTabs({ h, t });
  const PetTabs = makePetTabs({ h, t });
  const PetCard = makePetCard(rt);

  return function PetTab(props: PetTabProps) {
    const { list, busy, feedback, avatar } = props;
    const current = list.pets.find((pet) => pet.id === list.selId) ?? null;
    // 头像只能属于 pet pack：main（含没有 assetRoot 的实例）用插件默认 logo，不给上传入口。
    const avatarEditable = current !== null && current.assetRoot !== undefined && current.assetRoot !== 'main';
    // 分区可以有多张卡：外层这层容器只负责把子节点交给分区的纵向 flex（`display:contents`），
    // 自己不出盒子；组件的返回值仍是单节点，与其余分区同形。
    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        h(KindTabs, { key: 'kinds', kinds: list.kinds, kind: list.kind, busy, onSelect: list.selectKind }),
        h(PetTabs, {
          key: 'pets',
          pets: list.visiblePets,
          selId: list.selId,
          busy,
          onSelect: list.select,
          onAdd: list.add,
        }),
        h(PetCard, {
          key: 'card',
          pet: current,
          busy,
          msg: feedback,
          entryPrompt: list.entryPrompt,
          avatarSrc: avatar.src,
          avatarBusy: avatar.busy,
          // 内置条目没有这个能力：不传 onAvatar，卡片就只渲染预览。
          ...(avatarEditable ? { onAvatar: avatar.onPick } : {}),
          onChange: list.update,
          onSave: props.onSave,
          onRemove: list.requestRemove,
        }),
      ],
    });
  };
}
