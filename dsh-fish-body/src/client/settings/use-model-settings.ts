/**
 * 设置页的对话分区状态：两个模型字段、对话历史条数、配图张数上限，以及三个对话开关。
 *
 * 这些字段一起变（「对话怎么带上下文」是一个需求），也都随「保存」整包写入；
 * 模型候选清单不在这里——它是页面级的一次性拉取，归 `use-remote-data`。
 * owns only 对话分区的编辑态与开关，never 候选清单、保存与其它分区字段。
 * @module dsh-fish-body/src/client/settings/use-model-settings
 */
import type { ModelSelection } from '../../shared/types.ts';
import type { MainConfigPatch } from './config/index.ts';
import type { ChatFlagKey, ChatFlagValues, ModelFieldKey } from './model-card.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 对话分区的状态与回调。 */
export interface ModelSettings {
  /** 碎碎念用的模型。 */
  readonly whisperModel: ModelSelection;
  /** 对话用的模型。 */
  readonly chatModel: ModelSelection;
  /** 每次对话携带的历史轮数（0 = 不带历史）。 */
  readonly chatMemory: number;
  /** 每次对话发给模型的表情包上限（0 = 不限制）。 */
  readonly chatImageLimit: number;
  /** 三个对话开关的当前值。 */
  readonly chatFlags: ChatFlagValues;
  /** 改一个模型字段（卡片只回传键名）。 */
  setModel(key: ModelFieldKey, value: ModelSelection): void;
  /** 改对话历史条数。 */
  setChatMemory(value: number): void;
  /** 改配图张数上限。 */
  setChatImageLimit(value: number): void;
  /** 切一个对话开关。 */
  setChatFlag(key: ChatFlagKey, value: boolean): void;
  /** 用成品配置覆盖能信的字段。 */
  apply(patch: MainConfigPatch): void;
}

/**
 * 管理对话分区的表单状态。
 *
 * @param rt - 只用到 `useState` 与 `useCallback`。
 * @returns 当前值与改值入口。
 */
export function useModelSettings(rt: Pick<SettingsRuntime, 'useState' | 'useCallback'>): ModelSettings {
  const { useState, useCallback } = rt;
  // 初值只是占位（两个空串 = 跟随当前对话），加载成功后由成品值覆盖。
  const [whisperModel, setWhisperModel] = useState<ModelSelection>({ provider: '', model: '' });
  const [chatModel, setChatModel] = useState<ModelSelection>({ provider: '', model: '' });
  const [chatMemory, setChatMemory] = useState(10);
  const [chatImageLimit, setChatImageLimit] = useState(20);
  const [whisperImageEnabled, setWhisperImageEnabled] = useState(false);
  const [chatImageEnabled, setChatImageEnabled] = useState(false);
  const [chatAnimationEnabled, setChatAnimationEnabled] = useState(true);

  const setModel = useCallback(
    (key: ModelFieldKey, value: ModelSelection): void => {
      if (key === 'whisperModel') setWhisperModel(value);
      else setChatModel(value);
    },
    [setChatModel, setWhisperModel],
  );

  const setChatFlag = useCallback(
    (key: ChatFlagKey, value: boolean): void => {
      if (key === 'whisperImageEnabled') setWhisperImageEnabled(value);
      else if (key === 'chatImageEnabled') setChatImageEnabled(value);
      else setChatAnimationEnabled(value);
    },
    [setChatAnimationEnabled, setChatImageEnabled, setWhisperImageEnabled],
  );

  // 只有 setState，跨渲染稳定：放进设置页 applyConfig 的依赖里不会让配置反复重拉。
  const apply = useCallback((patch: MainConfigPatch): void => {
    if (patch.whisperModel !== undefined) setWhisperModel(patch.whisperModel);
    if (patch.chatModel !== undefined) setChatModel(patch.chatModel);
    if (patch.chatMemoryRounds !== undefined) setChatMemory(patch.chatMemoryRounds);
    if (patch.chatImageLimit !== undefined) setChatImageLimit(patch.chatImageLimit);
    if (patch.whisperImageEnabled !== undefined) setWhisperImageEnabled(patch.whisperImageEnabled);
    if (patch.chatImageEnabled !== undefined) setChatImageEnabled(patch.chatImageEnabled);
    if (patch.chatAnimationEnabled !== undefined) setChatAnimationEnabled(patch.chatAnimationEnabled);
  }, []);

  return {
    whisperModel,
    chatModel,
    chatMemory,
    chatImageLimit,
    chatFlags: { whisperImageEnabled, chatImageEnabled, chatAnimationEnabled },
    setModel,
    setChatMemory,
    setChatImageLimit,
    setChatFlag,
    apply,
  };
}
