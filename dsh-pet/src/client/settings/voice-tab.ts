/**
 * 「语音」分区：语音播报卡（六个随保存写入的字段 + 音色）与本地语音接入卡（GSV 地址与启停）。
 *
 * 两张卡写的是两套东西——音色与音量跟「保存」走，接入配置与启停立即落盘——所以只共用同一个
 * `VoiceSettings`，不互相读对方的状态。分区自己不持有状态，也不轮询。
 * owns only 这一块的装配，never 拉取、轮询与提交逻辑。
 * @module dsh-pet/src/client/settings/voice-tab
 */
import type { FunctionComponent } from 'react';
import { makeVoicePicker } from './picker/voice-picker.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeVoiceCard } from './voice-card.ts';
import { makeVoiceProviderCard } from './voice-provider-card.ts';
import type { VoiceSettings } from './use-voice-settings.ts';

/** 语音分区的输入。 */
export interface VoiceTabProps {
  /** 表单是否禁用（保存中或配置还没加载好）。 */
  readonly busy: boolean;
  /** 语音分区的全部状态与提交入口。 */
  readonly voice: VoiceSettings;
}

/**
 * 造语音分区。
 *
 * @param rt - 注入的 react 能力、hooks 与翻译函数。
 * @returns 分区组件。
 */
export function makeVoiceTab(rt: SettingsRuntime): FunctionComponent<VoiceTabProps> {
  const { h, useState, useEffect, useRef } = rt;
  const VoicePicker = makeVoicePicker({ h, useState, useEffect, useRef });
  const VoiceCard = makeVoiceCard(rt, VoicePicker);
  const VoiceProviderCard = makeVoiceProviderCard(rt);

  return function VoiceTab(props: VoiceTabProps) {
    const { busy, voice } = props;
    const { local, form } = voice;
    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        h(VoiceCard, {
          key: 'voice',
          busy,
          enabled: voice.enabled,
          voiceName: voice.name,
          volume: voice.volume,
          voices: voice.voices,
          // 本地音色（GSV）：有可切音色才出现这一格；服务没起时置灰，说明写在 hint 里。
          ...(local === undefined
            ? {}
            : {
                localVoices: local.voices.map((choice) => ({
                  id: choice.id,
                  name: choice.name,
                  tag: choice.tag ?? '',
                })),
                localVoice: local.voice,
                localAvailable: local.available,
                localReason: local.reason ?? '',
                localBusy: voice.voiceBusy,
                onLocalVoiceChange: (id: string) => voice.changeProviderVoice(local.id, id),
              }),
          whisperEnabled: voice.whisper,
          todoEnabled: voice.todo,
          notifyEnabled: voice.notify,
          onToggle: (value: boolean) => voice.setEnabled(value),
          onVoiceChange: (value: string) => voice.setName(value),
          onVolumeChange: (value: number) => voice.setVolume(value),
          onWhisperToggle: (value: boolean) => voice.setWhisper(value),
          onTodoToggle: (value: boolean) => voice.setTodo(value),
          onNotifyToggle: (value: boolean) => voice.setNotify(value),
        }),
        form
          ? h(VoiceProviderCard, {
              key: 'provider',
              busy: voice.draftBusy,
              name: form.name,
              available: form.available,
              reason: form.reason ?? '',
              fields: form.fields,
              values: voice.draft,
              message: voice.draftMessage,
              onChange: voice.setDraftField,
              onSave: () => voice.saveProvider(form.id, voice.draft),
              canStart: Boolean(voice.draft.startScript),
              // 停止总有办法：配了脚本就跑脚本，没配就走 api_v2 的 /control?command=exit。
              canStop: true,
              running: form.available,
              starting: voice.starting,
              processBusy: voice.processBusy,
              processMessage: voice.processMessage,
              onStart: () => voice.runProcess(form.id, 'start'),
              onStop: () => voice.runProcess(form.id, 'stop'),
            })
          : null,
      ],
    });
  };
}
