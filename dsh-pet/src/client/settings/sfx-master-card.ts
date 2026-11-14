/**
 * 音效总闸卡：总开关、常驻预热与总音量。
 *
 * 从原先的「全局开关」卡里拆出来，和事件音效卡同属「声音」分区：这三项决定「响不响、多响」，
 * 事件卡决定「哪个时机用什么文件」，两件事放在一起才读得懂。
 * 位置在这一页最前面：静音是这里最高频的动作，滚到事件列表后面才找得到就太晚了。
 * 只改本地状态，随「保存」整包写入；总音量与语音音量各管各的。
 * @module dsh-fish-body/src/client/settings/sfx-master-card
 */
import type { FunctionComponent } from 'react';
import type { DirtyQuery } from './dirty.ts';
import { type GlobalFlagKey, type GlobalFlags } from './global-flags.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

/** 音效总闸卡的输入。 */
export interface SfxMasterCardProps {
  /** 保存中或配置未就绪时禁用全部控件。 */
  readonly busy: boolean;
  /** 五个全局开关的当前值（本卡只读其中三个音效项）。 */
  readonly flags: GlobalFlags;
  /** 切一个开关。 */
  readonly onFlag: (key: GlobalFlagKey, value: boolean) => void;
  /** 音效总音量（0–1）。 */
  readonly volume: number;
  /** 改音效总音量。 */
  readonly onVolume: (value: number) => void;
  /** 未保存改动查询口。 */
  readonly dirty: DirtyQuery;
}

/**
 * 造音效总闸卡。
 *
 * @param rt - 注入的节点工厂与翻译函数。
 * @returns 卡片组件。
 */
export function makeSfxMasterCard(rt: SettingsRuntime): FunctionComponent<SfxMasterCardProps> {
  const { h, t } = rt;

  return function SfxMasterCard(props: SfxMasterCardProps) {
    const { busy, flags, dirty } = props;
    const { cardHead, field, toggleCell, switchGrid } = makeUiKit({ h, t }, dirty);
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('sfxMasterTitle'), t('sfxMasterHint'), [
          'global.sfxEnabled',
          'global.sfxKeepAlive',
          'global.sfxVolume',
        ]),
        switchGrid([
          toggleCell(
            'sfxToggle',
            flags.sfxEnabled,
            busy,
            (value) => props.onFlag('sfxEnabled', value),
            'global.sfxEnabled',
          ),
          toggleCell(
            'sfxKeepAliveToggle',
            flags.sfxKeepAlive,
            busy,
            (value) => props.onFlag('sfxKeepAlive', value),
            'global.sfxKeepAlive',
          ),
        ]),
        // 总音量独立于语音音量：混音器里那条是进程级总闸，这里才是「所有音效多响」的分项旋钮。
        field(
          `${t('sfxVolumeLabel')}（${Math.round(props.volume * 100)}%）`,
          h('input', {
            type: 'range',
            className: 'dsh-pet-cfg__range',
            min: '0',
            max: '1',
            step: '0.05',
            value: String(props.volume),
            disabled: busy,
            onChange: (event: { target: { value: string } }) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) props.onVolume(next);
            },
          }),
          t('sfxVolumeHint'),
          'global.sfxVolume',
        ),
      ],
    });
  };
}
