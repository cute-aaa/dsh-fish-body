/**
 * 语音接入卡：按宿主声明的 `fields` 生成输入框，保存到 `<userRoot>/config/voice-providers.json`，
 * 其中 `password` 字段的值写进 DSH 凭据库（配置文件里一个字节都不留）。
 *
 * 为什么表单由宿主声明驱动而不是写死几个路径：换一台机器、换一个部署，要填的东西就变了；
 * 声明在 provider 里（`fields`），两端与设置页都不用跟着改代码（T3.6）。一张卡对应一个实现，
 * 本地 GSV 与云端骨架因此可以并排出现，各自有自己的保存结论与启停按钮。
 * 与语音卡分开：音色是「日常切换」，目录与地址是「一次性接入配置」，混在一起会天天误触。
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
  /** 实现展示名（「GSV（本地 GPT-SoVITS）」/「云端语音（骨架）」）。 */
  readonly name: string;
  /** 此刻可用否：不可用时顶部直接显示原因（服务没起、目录没配、尚未接入）。 */
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
  /** 当前值（键 = `fields[].key`；密钥字段恒为空串，值从不回传）。 */
  readonly values: Readonly<Record<string, string>>;
  /** 密钥字段配没配（键 = 密钥字段的 key）。 */
  readonly secrets: Readonly<Record<string, boolean>>;
  /** 上一次保存的结论（成功/失败一句话）。 */
  readonly message: string;
  /** 改一个字段的草稿值（保存前不落盘）。 */
  readonly onChange: (key: string, value: string) => void;
  /** 提交全部草稿值。 */
  readonly onSave: () => void;
  /** 删掉一项已保存的密钥（立即落盘）。 */
  readonly onClearSecret: (key: string) => void;
  /** 这个实现有启停能力吗（声明了 `startScript` 才显示两个按钮）。 */
  readonly showProcess: boolean;
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

/** 上一次动作的结论（保存或启停）。 */
export interface VoiceActionStatus {
  /** 已剥掉 `!` 前缀的文案。 */
  readonly text: string;
  /** 是否失败（原来的 `!` 前缀）。 */
  readonly failed: boolean;
}

/**
 * 把「保存结论」与「启停结论」合成一条。
 *
 * 两条都放在按钮行里时，右半截排着一串按钮、左半截是两段文字，读起来像按钮的注解；
 * 而且两个结论同屏出现时，用户也分不清哪条是刚点出来的。规则只有一条：**启停优先**——
 * 它总是最后一次点击（保存完才可能点启停），两者都空才不显示。
 *
 * @param message - 上一次保存的结论（失败带 `!` 前缀）。
 * @param processMessage - 上一次启停的结论（失败带 `!` 前缀）。
 * @returns 要显示的那一条；都没有时 `null`。
 */
export function actionStatusOf(message: string, processMessage: string): VoiceActionStatus | null {
  const raw = processMessage !== '' ? processMessage : message;
  const text = raw.replace(/^!/, '');
  return text === '' ? null : { text, failed: raw.startsWith('!') };
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
    const action = actionStatusOf(props.message, props.processMessage);
    // 两个按钮互斥，且都看「服务地址此刻通不通」：通了只该停，不通只该启；
    // 刚发过启动时按住「启动」——服务要几十秒才起来，连点会起出两份抢同一个端口。
    const startDisabled = props.busy || props.processBusy || !props.canStart || props.running || props.starting;
    const stopDisabled = props.busy || props.processBusy || !props.canStop || !props.running;
    /**
     * 密钥字段的占位文案：已保存时明说「留空不改」，否则用户会以为那是自己的密钥被清空了。
     * （值从不回传，输入框本来就只能是空的。）
     */
    const placeholderOf = (item: VoiceFieldView): string => {
      if (item.kind !== 'password') return item.placeholder ?? '';
      return props.secrets[item.key] === true ? t('voiceProviderSecretSaved') : (item.placeholder ?? '');
    };
    /**
     * 下拉的选中值：草稿为空或不在候选里时显示第一项。
     *
     * 不为此插一个空项——「没配」与「配成第一项」在这里的语义本来就一样（关 / 默认音色），
     * 多一个空项只会让用户以为还有个「未设置」状态要选。
     */
    const selectedOf = (item: VoiceFieldView): string => {
      const options = item.options ?? [];
      const current = props.values[item.key] ?? '';
      return options.includes(current) ? current : (options[0] ?? '');
    };
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(props.name, t('voiceProviderHint')),
        // 出问题时把原因摆在最上面：先让人知道「服务没起/目录没配/念不出来」，再去改下面的路径。
        status
          ? h('div', { className: 'dsh-pet-cfg__msg is-err', children: [status] })
          : h('div', { className: 'dsh-pet-cfg__msg', children: [t('voiceProviderReady')] }),
        h('div', {
          className: 'dsh-pet-cfg__grid2',
          children: props.fields.map((item) =>
            field(
              item.label + (item.required ? ' *' : ''),
              // 密钥字段多一个「清除」：值不回传，所以「清空」不能靠删掉输入框里的字来猜。
              item.kind === 'password'
                ? h('div', {
                    className: 'dsh-pet-cfg__actions',
                    children: [
                      h('input', {
                        type: 'password',
                        className: INPUT_CLASS,
                        value: props.values[item.key] ?? '',
                        placeholder: placeholderOf(item),
                        disabled: props.busy,
                        onChange: (event: { target: { value: string } }) =>
                          props.onChange(item.key, event.target.value),
                      }),
                      ...(props.secrets[item.key] === true
                        ? [
                            h('button', {
                              type: 'button',
                              className: 'dsh-pet-cfg__btn',
                              disabled: props.busy,
                              onClick: () => props.onClearSecret(item.key),
                              children: [t('voiceProviderSecretClear')],
                            }),
                          ]
                        : []),
                    ],
                  })
                : item.kind === 'select' && (item.options?.length ?? 0) > 0
                  ? h('select', {
                      className: INPUT_CLASS,
                      value: selectedOf(item),
                      disabled: props.busy,
                      onChange: (event: { target: { value: string } }) => props.onChange(item.key, event.target.value),
                      children: (item.options ?? []).map((option) =>
                        h('option', { key: option, value: option, children: [option] }),
                      ),
                    })
                  : h('input', {
                      type: 'text',
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
            // 云端这类没有本地进程的实现不显示这两个按钮（`showProcess` 由字段声明决定）。
            ...(props.showProcess
              ? [
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
                ]
              : []),
          ],
        }),
        // 动作结论单独一行：它说的是「上一次点击的结果」，与顶部「服务通不通」分开，也不该挤进按钮行。
        action === null
          ? null
          : h('div', {
              className: 'dsh-pet-cfg__msg' + (action.failed ? ' is-err' : ''),
              role: 'status',
              children: action.text,
            }),
      ],
    });
  };
}
