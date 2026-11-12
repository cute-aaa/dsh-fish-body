/**
 * 「外观」分区：字体、物理（拖拽抛掷）、动作频率与移动端效果四张卡。
 *
 * 四张卡都是「改本地 → 随保存整包写」，所以整块只吃同一个 `AppearanceSettings`。
 * 卡之间没有联动：物理卡与移动端卡读写同一份 `physics`，但互不认识。
 * owns only 这一块的装配，never 字段的编辑态。
 * @module dsh-pet/src/client/settings/look-tab
 */
import type { FunctionComponent } from 'react';
import { makeFontCard } from './font-card.ts';
import { makeMobileCard } from './mobile-card.ts';
import { makeMotionCard } from './motion-card.ts';
import { makePhysicsCard } from './physics-card.ts';
import type { SettingsRuntime } from './runtime.ts';
import type { AppearanceSettings } from './use-appearance-settings.ts';

/** 外观分区的输入。 */
export interface LookTabProps {
  /** 表单是否禁用（保存中或配置还没加载好）。 */
  readonly busy: boolean;
  /** 外观与手感分区的全部状态与改值入口。 */
  readonly look: AppearanceSettings;
}

/**
 * 造外观分区。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 分区组件。
 */
export function makeLookTab(rt: SettingsRuntime): FunctionComponent<LookTabProps> {
  const { h } = rt;
  const FontCard = makeFontCard(rt);
  const PhysicsCard = makePhysicsCard(rt);
  const MotionCard = makeMotionCard(rt);
  const MobileCard = makeMobileCard(rt);

  return function LookTab(props: LookTabProps) {
    const { busy, look } = props;
    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        h(FontCard, { key: 'font', busy, font: look.font, onChange: look.patchFont }),
        h(PhysicsCard, { key: 'physics', busy, physics: look.physics, onChange: look.patchPhysics }),
        h(MotionCard, { key: 'motion', busy, weights: look.weights, onChange: look.setWeights }),
        h(MobileCard, { key: 'mobile', busy, physics: look.physics, onChange: look.patchPhysics }),
      ],
    });
  };
}
