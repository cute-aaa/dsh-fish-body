/**
 * 「语音」分区：语音播报卡（七个随保存写入的字段 + 音色）与语音接入卡（每个实现一张：
 * 本地 GSV 的地址、音色包目录与启停，云端骨架的地址与密钥）。
 *
 * 两类卡写的是两套东西——音色与音量跟「保存」走，接入配置与启停立即落盘——所以只共用同一个
 * `VoiceSettings`，不互相读对方的状态。分区自己不轮询，只持有一个「导入弹窗开没开」的本地开关。
 * owns only 这一块的装配，never 拉取、轮询与提交逻辑。
 * @module dsh-fish-body/src/client/settings/voice-tab
 */
import type { FunctionComponent } from 'react';
import type { DirtyQuery } from './dirty.ts';
import { makeVoicePicker } from './picker/voice-picker.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';
import { makeVoiceCard } from './voice-card.ts';
import { makeVoiceImportDialog, makeVoiceImportRow } from './voice-import.ts';
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
  const VoiceImportRow = makeVoiceImportRow(rt);
  const VoiceImportDialog = makeVoiceImportDialog(rt);
  const { section } = makeUiKit({ h, t });

  return function VoiceTab(props: VoiceTabProps) {
    const { busy, voice, dirty } = props;
    const { local, forms } = voice;
    // 导入弹窗的开合是本分区自己的界面状态：它不参与保存，也不需要活过离开分区。
    const [importOpen, setImportOpen] = useState(false);
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
          // 本地音色（GSV）：有音色候选才出现这一格；缺权重/参考音频的音色也列出，选中框里置灰。
          ...(local === undefined
            ? {}
            : {
                localVoices: local.voices.map((choice) => ({
                  id: choice.id,
                  name: choice.name,
                  tag: choice.tag ?? '',
                  ...(choice.available === false ? { disabled: true } : {}),
                  ...(choice.reason === undefined ? {} : { hint: choice.reason }),
                })),
                localVoice: local.voice,
                localVoiceReason: local.voices.find((choice) => choice.id === local.voice)?.reason ?? '',
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
                    notes: form.notes ?? [],
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
                    // 音色导入只服务 GSV：别的实现没有「音色包目录」这个概念。
                    // 扫描按钮同理——它清的是该实现的音色扫描缓存，重新同步目录里现有的音色。
                    beforeActions:
                      form.id === 'gsv'
                        ? h(VoiceImportRow, {
                            busy,
                            onOpen: () => setImportOpen(true),
                            onScanned: voice.refreshProviders,
                          })
                        : null,
                  });
                }),
              ),
            ]),
        // 导入弹窗挂在分区末尾：它是整页级的浮层，不该被卡片的裁剪层裁掉。
        h(VoiceImportDialog, {
          key: 'voice-import',
          open: importOpen,
          busy,
          draftVoicesDir: voice.formState('gsv').values.voicesDir ?? '',
          onClose: () => setImportOpen(false),
          onRefresh: voice.refreshProviders,
        }),
      ],
    });
  };
}
