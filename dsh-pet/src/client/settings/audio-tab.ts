/**
 * 「声音」分区：音效总闸、事件音效、语音播报与本地语音接入四张卡。
 *
 * 音效与语音原先各占一个分区，但它们回答的是同一个问题（这只宠物出什么声），
 * 分开后「音效总音量」和「播报音量」永远看不到对方；合成一个分区，两套开关的从属关系才读得出来。
 * 两种写入语义仍分开：音效与语音播报随「保存」写，接入配置与音色切换立即落盘（卡片自己说明）。
 * owns only 这一块的装配，never 字段状态与写盘。
 * @module dsh-pet/src/client/settings/audio-tab
 */
import type { FunctionComponent } from 'react';
import type { DirtyQuery } from './dirty.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeSfxCard } from './sfx-card.ts';
import { makeSfxMasterCard } from './sfx-master-card.ts';
import type { GlobalSettings } from './use-global-settings.ts';
import type { SfxSettings } from './use-sfx-settings.ts';
import type { VoiceSettings } from './use-voice-settings.ts';
import { makeVoiceTab } from './voice-tab.ts';

/** 声音分区的输入。 */
export interface AudioTabProps {
  /** 表单是否禁用（保存中或配置还没加载好）。 */
  readonly busy: boolean;
  /** 全局开关里的音效三项（总开关 / 常驻预热 / 总音量）。 */
  readonly global: GlobalSettings;
  /** 八个事件槽与 hook 登记。 */
  readonly sfx: SfxSettings;
  /** 语音播报与本地接入。 */
  readonly voice: VoiceSettings;
  /** 未保存改动查询口。 */
  readonly dirty: DirtyQuery;
}

/**
 * 造声音分区。
 *
 * @param rt - 注入的 react 能力、hooks 与翻译函数。
 * @returns 分区组件。
 */
export function makeAudioTab(rt: SettingsRuntime): FunctionComponent<AudioTabProps> {
  const { h } = rt;
  const SfxMasterCard = makeSfxMasterCard(rt);
  const SfxCard = makeSfxCard(rt);
  const VoiceTab = makeVoiceTab(rt);

  return function AudioTab(props: AudioTabProps) {
    const { busy, global, sfx, voice, dirty } = props;
    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        h(SfxMasterCard, {
          key: 'master',
          busy,
          flags: global.values,
          onFlag: global.setFlag,
          volume: global.sfxVolume,
          onVolume: global.setSfxVolume,
          dirty,
        }),
        h(SfxCard, { key: 'sfx', busy, sfx, dirty }),
        h(VoiceTab, { key: 'voice', busy, voice, dirty }),
      ],
    });
  };
}
