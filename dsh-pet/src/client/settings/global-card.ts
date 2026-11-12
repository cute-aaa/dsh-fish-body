/**
 * 全局开关卡：通知、音效总闸（含常驻预热与总音量）、锁定在当前屏幕与系统托盘。
 * 切换只改本地状态，随「保存」整包写入——即时写盘会重启桌面 Helper、重建全部桌面宠物窗口。
 * 通知开关额外需要用户手势，开与关都要走外壳的同一个入口，因此卡里只回传键名与目标值。
 * @module dsh-pet/src/client/settings/global-card
 */
import type { FunctionComponent } from 'react';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

/** 五个全局开关的键名，与成品配置的字段名一致。 */
export type GlobalFlagKey = 'notificationsEnabled' | 'sfxEnabled' | 'sfxKeepAlive' | 'confineToScreen' | 'trayEnabled';

/** 五个全局开关的当前值。 */
export type GlobalFlags = Record<GlobalFlagKey, boolean>;

/** 全局开关卡的输入。 */
export interface GlobalCardProps {
  /** 保存中或配置未就绪时禁用全部开关。 */
  busy: boolean;
  /** 当前值。 */
  values: GlobalFlags;
  /** 某个开关被切换；通知开关的权限申请由外壳处理。 */
  onChange: (key: GlobalFlagKey, value: boolean) => void;
  /** 音效总音量（0–1）：与语音音量各管各的，宿主给的成品值。 */
  sfxVolume: number;
  /** 音效总音量被拖动。 */
  onSfxVolumeChange: (value: number) => void;
}

/** 开关的展示顺序与文案键。 */
const TOGGLES: Array<{ key: GlobalFlagKey; label: string }> = [
  { key: 'notificationsEnabled', label: 'notifyToggle' },
  { key: 'sfxEnabled', label: 'sfxToggle' },
  { key: 'sfxKeepAlive', label: 'sfxKeepAliveToggle' },
  { key: 'confineToScreen', label: 'confineToggle' },
  { key: 'trayEnabled', label: 'trayToggle' },
];

/**
 * 造全局开关卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export function makeGlobalCard(rt: SettingsRuntime): FunctionComponent<GlobalCardProps> {
  const { h, t } = rt;
  const { cardHead, toggleCell, field } = makeUiKit({ h, t });

  return function GlobalCard(props: GlobalCardProps) {
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('globalTitle'), t('globalHint')),
        h('div', {
          className: 'dsh-pet-cfg__grid4',
          children: TOGGLES.map((toggle) =>
            toggleCell(toggle.label, props.values[toggle.key], props.busy, (value) =>
              props.onChange(toggle.key, value),
            ),
          ),
        }),
        // 总音量独立于语音音量：混音器里那条是进程级总闸，这里才是「所有音效多响」的分项旋钮。
        h('div', {
          className: 'dsh-pet-cfg__grid4',
          children: [
            field(
              `${t('sfxVolumeLabel')}（${Math.round(props.sfxVolume * 100)}%）`,
              h('input', {
                type: 'range',
                className: 'dsh-pet-cfg__range',
                min: '0',
                max: '1',
                step: '0.05',
                value: String(props.sfxVolume),
                disabled: props.busy,
                onChange: (event: { target: { value: string } }) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next)) props.onSfxVolumeChange(next);
                },
              }),
              t('sfxVolumeHint'),
            ),
          ],
        }),
      ],
    });
  };
}
