/**
 * 语音卡：四个播报开关与音色、音量。
 *
 * 切换只改本地状态、随「保存」整包写入——即时写盘会重启桌面 Helper、重建全部桌面宠物窗口。
 * 音色选择器由外壳注入（与模型卡注入 picker 同构），卡片本身不硬编码任何音色 id。
 * @module dsh-pet/src/client/settings/voice-card
 */
import type { FunctionComponent } from 'react';
import type { SpeakPhase } from '../../shared/voice.ts';
import type { VoiceOption, VoicePickerProps } from './picker/voice-picker.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

export type { VoiceOption } from './picker/voice-picker.ts';

/** 试听这一格的状态与入口。 */
export interface VoicePreviewProps {
  /** 当前阶段：合成中 / 播放中 / 空闲或失败。 */
  readonly phase: SpeakPhase;
  /** 失败时的一句说明（其余阶段为空串）。 */
  readonly message: string;
  /** 用当前选中的音色与音量试听一句。 */
  test(): void;
}

/** 语音卡的输入。 */
export interface VoiceCardProps {
  /** 保存中或配置未就绪时禁用全部控件。 */
  readonly busy: boolean;
  /** 手动播报开关的当前值：手动触发的碎碎念与对话回复。 */
  readonly enabled: boolean;
  /** 当前音色 id。 */
  readonly voiceName: string;
  /** 播放音量系数：0–1 的小数，1 = 最大音量。 */
  readonly volume: number;
  /** 可选音色；为空时选择器只显示当前值（列表还没拉回来或拉取失败）。 */
  readonly voices: readonly VoiceOption[];
  /** 周期碎碎念要不要念出来。 */
  readonly whisperEnabled: boolean;
  /** 待办提醒要不要念出来。 */
  readonly todoEnabled: boolean;
  /** 工作状态播报要不要念出来。 */
  readonly notifyEnabled: boolean;
  /** 切换手动播报开关。 */
  readonly onToggle: (value: boolean) => void;
  /** 选择音色。 */
  readonly onVoiceChange: (voiceName: string) => void;
  /** 调整播放音量。 */
  readonly onVolumeChange: (volume: number) => void;
  /** 切换周期碎碎念的播报。 */
  readonly onWhisperToggle: (value: boolean) => void;
  /** 切换待办提醒的播报。 */
  readonly onTodoToggle: (value: boolean) => void;
  /** 切换工作状态播报。 */
  readonly onNotifyToggle: (value: boolean) => void;
  /** 本地音色（第三方实现，如 GSV）的可选清单；缺席 = 这台机器上没有可切音色的实现。 */
  readonly localVoices?: readonly VoiceOption[];
  /** 本地音色当前值。 */
  readonly localVoice?: string;
  /** 本地实现此刻可用否（服务没起时置灰，但选项仍列出，让人知道有这些嗓子）。 */
  readonly localAvailable?: boolean;
  /** 不可用原因（服务没起 / 没配音色目录），显示在控件下方。 */
  readonly localReason?: string;
  /** 本地音色切换中。 */
  readonly localBusy?: boolean;
  /** 选择本地音色（即时落盘，不随「保存」）。 */
  readonly onLocalVoiceChange?: (voice: string) => void;
  /** 试听：用当前音色（本地可用时是本地那一格）合成一句示例。 */
  readonly preview: VoicePreviewProps;
}

/**
 * 造语音卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @param picker - 音色选择器组件；与模型卡一样由装配根造一次后注入，保证组件类型跨渲染稳定。
 * @returns 卡片组件。
 */
export function makeVoiceCard(
  rt: SettingsRuntime,
  picker: FunctionComponent<VoicePickerProps>,
): FunctionComponent<VoiceCardProps> {
  const { h, t } = rt;
  const { cardHead, field, toggleCell } = makeUiKit({ h, t });

  return function VoiceCard(props: VoiceCardProps) {
    // 本地实现（GSV）此刻可用且有音色可切：edge 那一格只是兜底，置灰并说明。
    const localActive = props.localAvailable === true && (props.localVoices?.length ?? 0) > 0;
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('voiceTitle'), t('voiceHint')),
        // 第一行四个开关：四类语音各一个，必须相邻，读得出是「同一类」；第二行两个输入：音色与音量。
        // 音色不挂文字标签也不挂问号：下拉当前值「晓伊（女·活泼）」自己就说明了它是什么。
        h('div', {
          className: 'dsh-pet-cfg__grid4',
          children: [
            toggleCell('voiceEnabled', props.enabled, props.busy, props.onToggle),
            toggleCell('voiceWhisperEnabled', props.whisperEnabled, props.busy, props.onWhisperToggle),
            toggleCell('voiceTodoEnabled', props.todoEnabled, props.busy, props.onTodoToggle),
            toggleCell('voiceNotifyEnabled', props.notifyEnabled, props.busy, props.onNotifyToggle),
          ],
        }),
        h('div', {
          className: 'dsh-pet-cfg__grid2',
          children: [
            // edge 音色：本地 GSV 可用时置灰（这一项只决定「GSV 不可用时 edge 用谁的嗓子」），
            // 并挂一句说明——否则选了晓晓却发现声音没变，只会让人以为配置没生效。
            field(
              t('voiceNameLabel'),
              h(picker, {
                label: t('voiceNameLabel'),
                value: props.voiceName,
                options: props.voices,
                disabled: props.busy || localActive,
                onChange: props.onVoiceChange,
              }),
              localActive ? t('voiceNameFallbackHint') : undefined,
            ),
            // 音量：播放端系数（0–1）。用滑块 + 百分比读数而不是裸小数——「0.65」没人看得出是多大，
            // 而且 GSV 与 edge 的响度本来就不同，用户需要边放边拖。落盘仍是 0–1（配置校验不变）。
            field(
              `${t('voiceVolumeLabel')}（${Math.round(props.volume * 100)}%）`,
              h('input', {
                type: 'range',
                className: 'dsh-pet-cfg__range',
                min: '0',
                max: '1',
                step: '0.05',
                value: String(props.volume),
                disabled: props.busy,
                onChange: (event: { target: { value: string } }) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next)) props.onVolumeChange(next);
                },
              }),
              t('voiceVolumeHint'),
            ),
            // 本地音色（GSV）：与 edge 白名单并列但互不覆盖——上面那格是「云端换声线」，
            // 这格是「本机音色包」。没有可切音色时整格不出现，不留一个空下拉。
            ...(props.localVoices && props.localVoices.length > 0
              ? [
                  field(
                    t('voiceLocalLabel'),
                    h(picker, {
                      label: t('voiceLocalLabel'),
                      value: props.localVoice ?? '',
                      options: props.localVoices,
                      disabled: props.busy || props.localBusy === true || props.localAvailable === false,
                      onChange: (voice: string) => props.onLocalVoiceChange?.(voice),
                    }),
                    props.localAvailable === false ? props.localReason || t('voiceLocalHint') : t('voiceLocalHint'),
                  ),
                ]
              : []),
          ],
        }),
        // 试听：不放音色格里是因为它属于「这一嗓子听起来怎么样」，跟选哪个音色是两件事；
        // 单独一行也让失败原因有地方落地（服务没起时点下去只会静默）。
        h('div', {
          className: 'dsh-pet-cfg__actions',
          children: [
            h('button', {
              key: 'preview',
              type: 'button',
              className: 'dsh-pet-cfg__btn is-sm',
              // 合成中禁掉：再点一次只会顶掉正在合成的那一句，用户以为按钮没响应。
              disabled: props.busy || props.preview.phase === 'loading',
              onClick: props.preview.test,
              children: props.preview.phase === 'loading' ? t('voicePreviewLoading') : t('voicePreview'),
            }),
            props.preview.phase === 'playing'
              ? h('span', { key: 'playing', className: 'dsh-pet-cfg__msg', children: t('voicePreviewPlaying') })
              : null,
            props.preview.message
              ? h('span', { key: 'msg', className: 'dsh-pet-cfg__msg is-err', children: props.preview.message })
              : null,
          ],
        }),
      ],
    });
  };
}
