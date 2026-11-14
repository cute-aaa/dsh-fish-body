/**
 * 「语音」分区：语音播报卡（七个随保存写入的字段 + 音色）与语音接入卡（每个实现一张：
 * 本地 GSV 的地址与启停、云端骨架的地址与密钥）。
 *
 * 两类卡写的是两套东西——音色与音量跟「保存」走，接入配置与启停立即落盘——所以只共用同一个
 * `VoiceSettings`，不互相读对方的状态。分区自己不持有状态，也不轮询。
 * owns only 这一块的装配，never 拉取、轮询与提交逻辑。
 * @module dsh-fish-body/src/client/settings/voice-tab
 */
import type { FunctionComponent } from 'react';
import type { DirtyQuery } from './dirty.ts';
import { makeVoicePicker } from './picker/voice-picker.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';
import { makeVoiceCard } from './voice-card.ts';
import { makeVoiceProviderCard } from './voice-provider-card.ts';
import type { VoiceSettings } from './use-voice-settings.ts';
import type { VoiceProviderView } from '../../shared/voice-providers.ts';

/** 语音分区的输入。 */
export interface VoiceTabProps {
  /** 表单是否禁用（保存中或配置还没加载好）。 */
  readonly busy: boolean;
  /** 语音分区的全部状态与提交入口。 */
  readonly voice: VoiceSettings;
  /** 未保存改动查询口。 */
  readonly dirty: DirtyQuery;
}

/** 这个实现的接入卡要不要显示启停按钮：声明了 `startScript` 才有本地进程可跑。 */
const hasProcessScript = (form: VoiceProviderView): boolean => form.fields.some((field) => field.key === 'startScript');

/**
 * 造语音分区。
 *
 * @param rt - 注入的 react 能力、hooks 与翻译函数。
 * @returns 分区组件。
 */
export function makeVoiceTab(rt: SettingsRuntime): FunctionComponent<VoiceTabProps> {
  const { h, useState, useEffect, useRef, t } = rt;
  const VoicePicker = makeVoicePicker({ h, useState, useEffect, useRef });
  const VoiceCard = makeVoiceCard(rt, VoicePicker);
  const VoiceProviderCard = makeVoiceProviderCard(rt);
  const { section } = makeUiKit({ h, t });

  return function VoiceTab(props: VoiceTabProps) {
    const { busy, voice, dirty } = props;
    const { local, forms } = voice;
    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        h(VoiceCard, {
          key: 'voice',
          busy,
          dirty,
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
          stripEmoji: voice.stripEmoji,
          onToggle: (value: boolean) => voice.setEnabled(value),
          onVoiceChange: (value: string) => voice.setName(value),
          onVolumeChange: (value: number) => voice.setVolume(value),
          onWhisperToggle: (value: boolean) => voice.setWhisper(value),
          onTodoToggle: (value: boolean) => voice.setTodo(value),
          onNotifyToggle: (value: boolean) => voice.setNotify(value),
          onStripEmojiToggle: (value: boolean) => voice.setStripEmoji(value),
          // 试听走与真实播报同一条链路（合成 → 预热 → 播放），所以它验的就是用户会听到的东西。
          preview: voice.preview,
        }),
        // 接入卡按实现各一张：本地 GSV 与云端骨架互不影响，各自带自己的保存结论与启停状态。
        ...(forms.length === 0
          ? []
          : [
              section(
                t('voiceProviderTitle'),
                forms.map((form) => {
                  const state = voice.formState(form.id);
                  return h(VoiceProviderCard, {
                    key: form.id,
                    busy: state.busy,
                    name: form.name,
                    available: form.available,
                    reason: form.reason ?? '',
                    lastError: form.lastError ?? '',
                    fields: form.fields,
                    values: state.values,
                    secrets: state.secrets,
                    message: state.message,
                    onChange: (key: string, value: string) => voice.setDraftField(form.id, key, value),
                    onSave: () => voice.saveProvider(form.id, state.values),
                    onClearSecret: (key: string) => voice.clearSecret(form.id, key),
                    showProcess: hasProcessScript(form),
                    canStart: Boolean(state.values.startScript),
                    // 停止总有办法：配了脚本就跑脚本，没配就走 api_v2 的 /control?command=exit。
                    canStop: true,
                    running: form.available,
                    starting: state.starting,
                    processBusy: state.processBusy,
                    processMessage: state.processMessage,
                    onStart: () => voice.runProcess(form.id, 'start'),
                    onStop: () => voice.runProcess(form.id, 'stop'),
                  });
                }),
              ),
            ]),
      ],
    });
  };
}
