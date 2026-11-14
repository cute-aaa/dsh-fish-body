/**
 * 设置页的外观与手感表单状态：字体、物理参数、动作频率权重。
 *
 * 三项都是「改本地 → 随『保存』整包写」，没有即时提交，也没有自己的异步；抽成一个模块是因为
 * 它们一起变（改外观需求常常同时动字体与物理卡），而不是因为行数。
 * `apply` 接成品配置里能信的那部分，回放同一组控件；加载状态与写盘都不在这里。
 * owns only 这三个字段的编辑态，never 保存、加载与其它分区的字段。
 * @module dsh-fish-body/src/client/settings/use-appearance-settings
 */
import { DEFAULT_FONT } from '../../shared/fonts.ts';
import { DEFAULT_PHYSICS } from '../../shared/physics.ts';
import type { FontConfig, PhysicsParams, Weights } from '../../shared/types.ts';
import { DEFAULT_WEIGHTS } from '../../shared/weights.ts';
import type { MainConfigPatch } from './config/index.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 外观与手感分区的状态与提交回调。 */
export interface AppearanceSettings {
  /** 物理参数（全局默认）。 */
  readonly physics: PhysicsParams;
  /** 字体（全局默认）。 */
  readonly font: FontConfig;
  /** 动作频率权重（main 条目）。 */
  readonly weights: Weights;
  /** 改物理参数里的几个字段。 */
  patchPhysics(patch: Partial<PhysicsParams>): void;
  /** 改字体里的几个字段。 */
  patchFont(patch: Partial<FontConfig>): void;
  /** 整体替换权重（卡片按一次交互算出四个框的新值）。 */
  setWeights(value: Weights): void;
  /** 用成品配置覆盖能信的字段。 */
  apply(patch: MainConfigPatch): void;
}

/**
 * 管理外观与手感分区的表单状态。
 *
 * @param rt - 只用到 `useState` 与 `useCallback`。
 * @returns 三个字段的当前值与改值入口。
 */
export function useAppearanceSettings(rt: Pick<SettingsRuntime, 'useState' | 'useCallback'>): AppearanceSettings {
  const { useState, useCallback } = rt;
  // 初值只是占位：加载成功后被成品值覆盖，未就绪期间整页只读，存不出去。
  const [physics, setPhysics] = useState<PhysicsParams>({ ...DEFAULT_PHYSICS });
  const [font, setFont] = useState<FontConfig>({ ...DEFAULT_FONT });
  const [weights, setWeights] = useState<Weights>({ ...DEFAULT_WEIGHTS });

  // 补丁式写入：卡片只知道自己改的那几个键，整段对象由这里合并。
  const patchPhysics = useCallback((patch: Partial<PhysicsParams>): void => {
    setPhysics((current) => ({ ...current, ...patch }));
  }, []);
  const patchFont = useCallback((patch: Partial<FontConfig>): void => {
    setFont((current) => ({ ...current, ...patch }));
  }, []);

  // 只有 setState，跨渲染稳定：放进设置页 applyConfig 的依赖里不会让配置反复重拉。
  const apply = useCallback((patch: MainConfigPatch): void => {
    if (patch.physics !== undefined) setPhysics(patch.physics);
    if (patch.font !== undefined) setFont(patch.font);
    if (patch.animationWeights !== undefined) setWeights(patch.animationWeights);
  }, []);

  return { physics, font, weights, patchPhysics, patchFont, setWeights, apply };
}
