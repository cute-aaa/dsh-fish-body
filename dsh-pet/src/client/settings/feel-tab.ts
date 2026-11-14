/**
 * 「外观与手感」分区：物理（拖拽抛掷手感，含移动端折叠）、动作频率与字体三张卡。
 *
 * 原先分成「行为」与「外观」两个分区，而「外观」只有一张字体卡——一个分区换一次点击，
 * 只值一张卡就不值得占一个分区位。合并后这一页回答同一个问题：这只宠物看起来、动手起来是什么样。
 * 三张卡都只改本地状态，随「保存」整包写；卡之间互不认识，也不读对方的字段。
 * owns only 这一块的装配，never 字段的编辑态。
 * @module dsh-fish-body/src/client/settings/feel-tab
 */
import type { FunctionComponent } from 'react';
import type { DirtyQuery } from './dirty.ts';
import { makeFontCard } from './font-card.ts';
import { makeMotionCard } from './motion-card.ts';
import { makePhysicsCard } from './physics-card.ts';
import type { SettingsRuntime } from './runtime.ts';
import type { AppearanceSettings } from './use-appearance-settings.ts';

/** 外观与手感分区的输入。 */
export interface FeelTabProps {
  /** 表单是否禁用（保存中或配置还没加载好）。 */
  readonly busy: boolean;
  /** 物理、权重与字体状态。 */
  readonly look: AppearanceSettings;
  /** 未保存改动查询口。 */
  readonly dirty: DirtyQuery;
}

/**
 * 造外观与手感分区。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 分区组件。
 */
export function makeFeelTab(rt: SettingsRuntime): FunctionComponent<FeelTabProps> {
  const { h } = rt;
  const PhysicsCard = makePhysicsCard(rt);
  const MotionCard = makeMotionCard(rt);
  const FontCard = makeFontCard(rt);

  return function FeelTab(props: FeelTabProps) {
    const { busy, look, dirty } = props;
    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        // 顺序按「改完能立刻感知」排：拖一下就能试的物理在最前，字号最后。
        h(PhysicsCard, { key: 'physics', busy, physics: look.physics, onChange: look.patchPhysics, dirty }),
        h(MotionCard, { key: 'motion', busy, weights: look.weights, onChange: look.setWeights, dirty }),
        h(FontCard, { key: 'font', busy, font: look.font, onChange: look.patchFont, dirty }),
      ],
    });
  };
}
