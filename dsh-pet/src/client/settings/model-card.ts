/**
 * 「AI 模型与对话上下文」卡：碎碎念 / 对话各自的模型、对话历史条数与配图张数上限，
 * 以及三个与对话相关的开关（碎碎念配图 / 对话配图 / 对话动作联动）。
 *
 * 都与全局开关同语义：只改本地状态，随「保存」整包写入；宿主生成时优先用模型，失败自动回落。
 * 三个开关的说明都长到不适合挂在问号里（讲的是 token 怎么涨的），所以收进卡尾一个折叠：
 * 需要判断成本的人展开就有全部依据，不需要的人只看见三个开关，页面上也不再是三段常显小字。
 * 候选清单拉取失败只在这里提示一行，不阻塞已有配置值的显示与保存。
 * @module dsh-fish-body/src/client/settings/model-card
 */
import type { FunctionComponent } from 'react';
import type { ModelSelection } from '../../shared/types.ts';
import type { DirtyQuery } from './dirty.ts';
import type { ModelCatalogGroup, ModelPickerProps } from './picker/index.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit, numberInputProps } from './ui.ts';

/** 折叠正文的 id：与标题按钮的 `aria-controls` 成对。 */
const COST_BODY_ID = 'pet-cfg-chat-cost';

/** 两个模型字段的键名。 */
export type ModelFieldKey = 'whisperModel' | 'chatModel';

/** 三个对话开关的键名，与成品配置的字段名一致。 */
export type ChatFlagKey = 'whisperImageEnabled' | 'chatImageEnabled' | 'chatAnimationEnabled';

/** 三个对话开关的当前值。 */
export type ChatFlagValues = Record<ChatFlagKey, boolean>;

/** 对话开关的展示顺序与文案键。 */
const CHAT_TOGGLES: Array<{ key: ChatFlagKey; label: string }> = [
  { key: 'whisperImageEnabled', label: 'whisperImageToggle' },
  { key: 'chatImageEnabled', label: 'chatImageToggle' },
  { key: 'chatAnimationEnabled', label: 'chatAnimationToggle' },
];

/** 模型卡的输入。 */
export interface ModelCardProps {
  /** 保存中或配置未就绪时禁用全部控件。 */
  busy: boolean;
  /** 候选清单；`null` 表示还在拉取。 */
  catalog: readonly ModelCatalogGroup[] | null;
  /** 候选清单拉取失败。 */
  failed: boolean;
  /** 碎碎念用的模型。 */
  whisperModel: ModelSelection;
  /** 对话用的模型。 */
  chatModel: ModelSelection;
  /** 某个模型字段被改。 */
  onModelChange: (key: ModelFieldKey, value: ModelSelection) => void;
  /** 对话历史条数。 */
  chatMemory: number;
  /** 对话配图张数上限。 */
  chatImageLimit: number;
  /** 改对话历史条数。 */
  onChatMemoryChange: (value: number) => void;
  /** 改对话配图张数上限。 */
  onChatImageLimitChange: (value: number) => void;
  /** 三个对话开关的当前值。 */
  values: ChatFlagValues;
  /** 某个对话开关被切换。 */
  onFlagChange: (key: ChatFlagKey, value: boolean) => void;
  /** 未保存改动查询口。 */
  dirty: DirtyQuery;
}

/**
 * 造模型卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @param picker - 模型选择器组件（由外壳用同一份运行时造好，跨渲染稳定）。
 * @returns 卡片组件。
 */
export function makeModelCard(
  rt: SettingsRuntime,
  picker: FunctionComponent<ModelPickerProps>,
): FunctionComponent<ModelCardProps> {
  const { h, t, useState } = rt;

  return function ModelCard(props: ModelCardProps) {
    const { busy, catalog, failed, dirty } = props;
    const { cardHead, field, toggleCell, switchGrid, foldCard, note } = makeUiKit({ h, t }, dirty);
    const [open, setOpen] = useState(false);

    /** 「全局默认」的数字格：标签在上、数字输入在下。 */
    const numField = (label: string, value: number, setter: (v: number) => void) =>
      field(
        t(label),
        h('input', numberInputProps(value, setter, { step: '1', min: '0', disabled: busy })),
        t(label + 'Hint'),
        'model.' + label,
      );

    /** 「AI 模型」的一格：标签在上、单下拉选择器在下。 */
    const modelCell = (key: ModelFieldKey, value: ModelSelection) => {
      const label = t(key === 'whisperModel' ? 'whisperModelLabel' : 'chatModelLabel');
      return field(
        label,
        h(picker, {
          label,
          value,
          disabled: busy,
          catalog,
          failed,
          onChange: (next: ModelSelection) => props.onModelChange(key, next),
        }),
        t('modelFieldHint'),
        'model.' + key,
      );
    };

    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        h('div', {
          key: 'card',
          className: 'dsh-pet-cfg__card',
          children: [
            cardHead(t('modelTitle'), t('modelHint'), 'model'),
            failed
              ? h('p', {
                  key: 'failed',
                  className: 'dsh-pet-cfg__note',
                  style: { color: 'var(--dsw-alias-state-error-primary)' },
                  children: t('modelCatalogFailed'),
                })
              : null,
            h('div', {
              key: 'models',
              className: 'dsh-pet-cfg__grid2',
              children: [modelCell('whisperModel', props.whisperModel), modelCell('chatModel', props.chatModel)],
            }),
            h('div', {
              key: 'context',
              className: 'dsh-pet-cfg__grid2',
              children: [
                numField('chatMemory', props.chatMemory, props.onChatMemoryChange),
                numField('chatImageLimit', props.chatImageLimit, props.onChatImageLimitChange),
              ],
            }),
            switchGrid(
              CHAT_TOGGLES.map((toggle) =>
                toggleCell(
                  toggle.label,
                  props.values[toggle.key],
                  busy,
                  (value) => props.onFlagChange(toggle.key, value),
                  'model.' + toggle.key,
                ),
              ),
            ),
          ],
        }),
        // token 成本说明：三段说明都长到不适合挂问号，但删掉又会让人不知道「开了要花多少」。
        h(foldCard, {
          key: 'cost',
          id: COST_BODY_ID,
          title: t('chatCostTitle'),
          hint: t('chatCostHint'),
          open,
          onToggle: () => setOpen(!open),
          scope: 'model',
          body: [note(t('whisperImageToggleHint')), note(t('chatImageToggleHint')), note(t('chatAnimationToggleHint'))],
        }),
      ],
    });
  };
}
