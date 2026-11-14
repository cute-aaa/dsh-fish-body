/**
 * 本地语音接入卡：按宿主声明的 `fields` 生成输入框，保存到 `<DSH_HOME>/dsh-pet/voice-providers.json`。
 *
 * 为什么表单由宿主声明驱动而不是写死四个路径：换一台机器、换一个 GPT-SoVITS 部署，
 * 要填的东西就变了；声明在 provider 里（`fields`），两端与设置页都不用跟着改代码（T3.6 的第一步）。
 * 与语音卡分开一张卡：音色是「日常切换」，目录与地址是「一次性接入配置」，混在一起会天天误触。
 * @module dsh-fish-body/src/client/settings/voice-provider-card
 */
import type { FunctionComponent } from 'react';
import type { VoiceFieldView } from '../../shared/voice-providers.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit, INPUT_CLASS } from './ui.ts';

/** 接入卡的输入。 */
export interface VoiceProviderCardProps {
  /** 保存中或配置未就绪时禁用控件。 */
  readonly busy: boolean;
  /** 实现展示名（「GSV（本地 GPT-SoVITS）」）。 */
  readonly name: string;
  /** 此刻可用否：不可用时顶部直接显示原因（服务没起、目录没配）。 */
  readonly available: boolean;
  /** 不可用原因。 */
  readonly reason: string;
  /**
   * 最近一次合成失败的原因（服务通着却念不出来）。
   *
   * 与 `reason` 分开传：可用时这张卡本来只剩一句「就绪」，可「通着但念不出来」正是最难被发现的状态
   * ——回退链会静默换嗓子，不写出来用户只会以为音色变了。
   */
  readonly lastError: string;
  /** 宿主声明的配置项。 */
  readonly fields: readonly VoiceFieldView[];
  /** 当前值（键 = `fields[].key`）。 */
  readonly values: Readonly<Record<string, string>>;
  /** 上一次保存的结论（成功/失败一句话）。 */
  readonly message: string;
  /** 改一个字段的草稿值（保存前不落盘）。 */
  readonly onChange: (key: string, value: string) => void;
  /** 提交全部草稿值。 */
  readonly onSave: () => void;
  /** 配了启动脚本 → 「启动服务」有脚本可跑。 */
  readonly canStart: boolean;
  /** 配了停止脚本 → 「停止服务」有脚本可跑。 */
  readonly canStop: boolean;
  /** 服务此刻可用（探活结论）：可用时只该点「停止」，不可用时只该点「启动」。 */
  readonly running: boolean;
  /** 刚发过启动、还在等它起来（此时「启动」也要按住，避免连点起两份）。 */
  readonly starting: boolean;
  /** 启停请求进行中。 */
  readonly processBusy: boolean;
  /** 启停结论（一句话，失败带 `!` 前缀）。 */
  readonly processMessage: string;
  /** 跑启动脚本。 */
  readonly onStart: () => void;
  /** 跑停止脚本。 */
  readonly onStop: () => void;
}

/**
 * 造接入卡。
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件；`fields` 为空时整张卡不渲染。
 */
export function makeVoiceProviderCard(rt: SettingsRuntime): FunctionComponent<VoiceProviderCardProps> {
  const { h, t } = rt;
  const { cardHead, field } = makeUiKit({ h, t });

  return function VoiceProviderCard(props: VoiceProviderCardProps) {
    if (props.fields.length === 0) return null;
    // 不可用优先（连都连不上），其次「通着但上一句合成失败」，都没有才是就绪。
    const status = props.available ? props.lastError : props.reason;
    // 两个按钮互斥，且都看「服务地址此刻通不通」：通了只该停，不通只该启；
    // 刚发过启动时按住「启动」——服务要几十秒才起来，连点会起出两份抢同一个端口。
    const startDisabled = props.busy || props.processBusy || !props.canStart || props.running || props.starting;
    const stopDisabled = props.busy || props.processBusy || !props.canStop || !props.running;
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('voiceProviderTitle'), t('voiceProviderHint')),
        // 出问题时把原因摆在最上面：先让人知道「服务没起/目录没配/念不出来」，再去改下面的路径。
        status
          ? h('div', { className: 'dsh-pet-cfg__msg is-err', children: [props.name + '：' + status] })
          : h('div', { className: 'dsh-pet-cfg__msg', children: [props.name + '：' + t('voiceProviderReady')] }),
        h('div', {
          className: 'dsh-pet-cfg__grid2',
          children: props.fields.map((item) =>
            field(
              item.label + (item.required ? ' *' : ''),
              h('input', {
                type: item.kind === 'password' ? 'password' : 'text',
                className: INPUT_CLASS,
                value: props.values[item.key] ?? '',
                placeholder: item.placeholder ?? '',
                disabled: props.busy,
                onChange: (event: { target: { value: string } }) => props.onChange(item.key, event.target.value),
              }),
              item.description,
            ),
          ),
        }),
        h('div', {
          className: 'dsh-pet-cfg__actions',
          children: [
            h('button', {
              type: 'button',
              className: 'dsh-pet-cfg__btn is-primary',
              disabled: props.busy,
              onClick: props.onSave,
              children: [t('voiceProviderSave')],
            }),
            // 启停：只跑用户填的脚本。启动要几十秒，所以点完只回一句「已发送」，可用性由探活翻牌。
            h('button', {
              type: 'button',
              className: 'dsh-pet-cfg__btn',
              disabled: startDisabled,
              onClick: props.onStart,
              children: [t('voiceProviderStart')],
            }),
            h('button', {
              type: 'button',
              className: 'dsh-pet-cfg__btn',
              disabled: stopDisabled,
              onClick: props.onStop,
              children: [t('voiceProviderStop')],
            }),
            props.message
              ? h('div', {
                  className: 'dsh-pet-cfg__msg' + (props.message.startsWith('!') ? ' is-err' : ''),
                  children: [props.message.replace(/^!/, '')],
                })
              : null,
            props.processMessage
              ? h('div', {
                  className: 'dsh-pet-cfg__msg' + (props.processMessage.startsWith('!') ? ' is-err' : ''),
                  children: [props.processMessage.replace(/^!/, '')],
                })
              : null,
          ],
        }),
      ],
    });
  };
}
