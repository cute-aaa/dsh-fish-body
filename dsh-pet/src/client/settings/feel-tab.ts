/**
 * 「外观与手感」分区：渲染卡（渲染方式 + 模型/皮肤 → 缺文件 → 位置 → 尺寸）→ 皮肤目录三行 → 手感三张卡。
 *
 * 渲染方式与模型/皮肤是「看起来是什么」，位置与尺寸是「摆在哪、多大」；两者同属外观，所以同处页首。
 * 物理 / 动作频率 / 字体回答「动手起来什么感觉」，放在最后的「手感」小节。
 * 三组都只改本地状态，随「保存」整包写；卡之间互不认识，也不读对方的字段。
 * owns only 这一块的装配，never 字段的编辑态。
 * @module dsh-fish-body/src/client/settings/feel-tab
 */
import type { FunctionComponent } from 'react';
import type { Pet } from '../../shared/types.ts';
import type { DirtyQuery } from './dirty.ts';
import { makeFontCard } from './font-card.ts';
import { makeMotionCard } from './motion-card.ts';
import { makePhysicsCard } from './physics-card.ts';
import type { PetPatch } from './pet-card-parts.ts';
import { makeRenderCard } from './render-card.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeSkinDirs } from './skin-dirs.ts';
import { makeUiKit } from './ui.ts';
import type { AppearanceSettings } from './use-appearance-settings.ts';
import type { GlobalSettings } from './use-global-settings.ts';
import type { RenderResourcesState } from './use-render-resources.ts';
import { makeWindowBehavior } from './window-behavior.ts';

/** 外观与手感分区的输入。 */
export interface FeelTabProps {
  /** 表单是否禁用（保存中或配置还没加载好）。 */
  readonly busy: boolean;
  /** 物理、权重与字体状态。 */
  readonly look: AppearanceSettings;
  /** 未保存改动查询口。 */
  readonly dirty: DirtyQuery;
  /** 当前选中的实例（渲染 / 位置 / 尺寸都写它）。 */
  readonly pet: Pet | null;
  readonly petIndex: number;
  /** 三桶渲染资源清单。 */
  readonly resources: RenderResourcesState;
  /** 全局开关（窗口行为卡的「锁定在当前屏幕」）。 */
  readonly global: GlobalSettings;
  /** 实例字段补丁（渲染方式 / 模型 / 位置 / 尺寸）。 */
  readonly onChange: (patch: PetPatch) => void;
}

/**
 * 造外观与手感分区。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 分区组件。
 */
export function makeFeelTab(rt: SettingsRuntime): FunctionComponent<FeelTabProps> {
  const { h, t } = rt;
  const PhysicsCard = makePhysicsCard(rt);
  const MotionCard = makeMotionCard(rt);
  const FontCard = makeFontCard(rt);
  const RenderCard = makeRenderCard(rt);
  const SkinDirs = makeSkinDirs(rt);
  const WindowBehavior = makeWindowBehavior(rt);

  return function FeelTab(props: FeelTabProps) {
    const { busy, look, dirty, pet, resources } = props;
    const { section } = makeUiKit({ h, t });
    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        pet === null
          ? null
          : h(RenderCard, {
              key: 'render',
              pet,
              petIndex: props.petIndex,
              busy,
              dirty,
              resources,
              onChange: props.onChange,
            }),
        h(SkinDirs, { key: 'skinDirs', resources, busy }),
        h(WindowBehavior, {
          key: 'window',
          pet,
          petIndex: props.petIndex,
          busy,
          dirty,
          global: props.global,
          onChange: props.onChange,
        }),
        section(t('secFeel'), [
          // 顺序按「改完能立刻感知」排：拖一下就能试的物理在最前，字号最后。
          h(PhysicsCard, { key: 'physics', busy, physics: look.physics, onChange: look.patchPhysics, dirty }),
          h(MotionCard, { key: 'motion', busy, weights: look.weights, onChange: look.setWeights, dirty }),
          h(FontCard, { key: 'font', busy, font: look.font, onChange: look.patchFont, dirty }),
        ]),
      ],
    });
  };
}
