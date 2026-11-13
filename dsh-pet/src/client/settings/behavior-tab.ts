/**
 * 「行为」分区：物理（拖拽抛掷手感）、动作频率与移动端效果三张卡。
 *
 * 三张卡都是「改本地 → 随保存整包写」，读写同一份 `physics` / `weights`，卡之间互不认识；
 * 原先和字体挤在「外观」里，但字体是排版、这三项是手感，改一个需求不会同时动两处。
 * owns only 这一块的装配，never 字段的编辑态。
 * @module dsh-pet/src/client/settings/behavior-tab
 */
import type { FunctionComponent } from 'react';
import type { DirtyQuery } from './dirty.ts';
import { makeMobileCard } from './mobile-card.ts';
import { makeMotionCard } from './motion-card.ts';
import { makePhysicsCard } from './physics-card.ts';
import type { SettingsRuntime } from './runtime.ts';
import type { AppearanceSettings } from './use-appearance-settings.ts';

/** 行为分区的输入。 */
export interface BehaviorTabProps {
  /** 表单是否禁用（保存中或配置还没加载好）。 */
  readonly busy: boolean;
  /** 物理、权重与字体状态（本分区只读前两者）。 */
  readonly look: AppearanceSettings;
  /** 未保存改动查询口。 */
  readonly dirty: DirtyQuery;
}

/**
 * 造行为分区。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 分区组件。
 */
export function makeBehaviorTab(rt: SettingsRuntime): FunctionComponent<BehaviorTabProps> {
  const { h } = rt;
  const PhysicsCard = makePhysicsCard(rt);
  const MotionCard = makeMotionCard(rt);
  const MobileCard = makeMobileCard(rt);

  return function BehaviorTab(props: BehaviorTabProps) {
    const { busy, look, dirty } = props;
    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        h(PhysicsCard, { key: 'physics', busy, physics: look.physics, onChange: look.patchPhysics, dirty }),
        h(MotionCard, { key: 'motion', busy, weights: look.weights, onChange: look.setWeights, dirty }),
        h(MobileCard, { key: 'mobile', busy, physics: look.physics, onChange: look.patchPhysics, dirty }),
      ],
    });
  };
}
