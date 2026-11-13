/**
 * 「外观」分区：字体种类、字号与字号是否跟随宠物大小。
 *
 * 原先和物理、动作频率、移动端挤在一个分区里；那三项是手感、这项是排版，按功能拆开后
 * 「外观」只剩字，改字体的人不用再滚过一堆物理参数。
 * 只改本地状态，随「保存」整包写入。
 * @module dsh-pet/src/client/settings/look-tab
 */
import type { FunctionComponent } from 'react';
import type { DirtyQuery } from './dirty.ts';
import { makeFontCard } from './font-card.ts';
import type { SettingsRuntime } from './runtime.ts';
import type { AppearanceSettings } from './use-appearance-settings.ts';

/** 外观分区的输入。 */
export interface LookTabProps {
  /** 表单是否禁用（保存中或配置还没加载好）。 */
  readonly busy: boolean;
  /** 外观与手感状态（本分区只读字体）。 */
  readonly look: AppearanceSettings;
  /** 未保存改动查询口。 */
  readonly dirty: DirtyQuery;
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

  return function LookTab(props: LookTabProps) {
    const { busy, look, dirty } = props;
    return h(FontCard, { busy, font: look.font, onChange: look.patchFont, dirty });
  };
}
