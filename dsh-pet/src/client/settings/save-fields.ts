/**
 * 「保存」请求体的摊平：把各分区此刻的值拼成 `PUT /config` 的 `SaveFields`。
 *
 * 放在装配根之外是因为它是一条可被测的规则：每个分区贡献哪几个键、键名与成品字段怎么对应。
 * 键名必须与宿主白名单逐字一致（`http.ts` 的 `SaveFields` 就是契约），漏一个键等于「改了不生效」，
 * 多一个键会被宿主按未知字段拒绝——所以这里不接未知字段，也绝不静默丢键。
 * owns only 字段映射，never 校验、写盘与任何状态。
 * @module dsh-fish-body/src/client/settings/save-fields
 */
import type { HotkeyMap } from '../../shared/hotkeys.ts';
import type { Pet, SfxConfig } from '../../shared/types.ts';
import type { SaveFields } from './config/index.ts';
import type { GlobalFlags } from './global-flags.ts';
import type { ChatFlagValues } from './model-card.ts';
import type { AppearanceSettings } from './use-appearance-settings.ts';
import type { ModelSettings } from './use-model-settings.ts';
import type { VoiceSettings } from './use-voice-settings.ts';

/** 各分区贡献给保存请求体的那几项（只取值，不含任何提交方法）。 */
export interface SaveFieldParts {
  /** main 层实例：`PUT /config` 只写用户主配置，pack 实例走 `POST /pet-config`。 */
  readonly pets: readonly Pet[];
  /** 五个全局开关，键名即成品字段名。 */
  readonly global: GlobalFlags;
  /** 九个悬停键（设置页「快捷键」卡）。 */
  readonly hotkeys: HotkeyMap;
  /** 音效总音量（0–1）；与语音音量分开，混音器那条是进程级总闸。 */
  readonly sfxVolume: number;
  /** 音效分区写回的 `sfx` 段（事件槽覆盖 / 动作音 / hook / 按渲染方式 / 按皮肤）。 */
  readonly sfx: SfxConfig;
  /** 三个对话开关，键名即成品字段名。 */
  readonly chat: ChatFlagValues;
  /** 语音分区里随「保存」写入的七个字段（远端音色与接入配置不在此列）。 */
  readonly voice: Pick<VoiceSettings, 'enabled' | 'name' | 'volume' | 'whisper' | 'todo' | 'notify' | 'stripEmoji'>;
  /** 对话分区的模型与上下文上限。 */
  readonly model: Pick<ModelSettings, 'whisperModel' | 'chatModel' | 'chatMemory' | 'chatImageLimit'>;
  /** 外观与手感：物理参数、字体与动作权重。 */
  readonly look: Pick<AppearanceSettings, 'physics' | 'font' | 'weights'>;
}

/**
 * 摊平保存请求体。
 *
 * @param parts - 各分区此刻的值。
 * @returns 可直接交给 `persistSettings` 的表单字段。
 */
export function buildSaveFields(parts: SaveFieldParts): SaveFields {
  return {
    pets: parts.pets,
    // 两个开关组各自就是成品字段名的一份映射，摊平即可：漏键会被类型检查逮住。
    ...parts.global,
    hotkeys: parts.hotkeys,
    sfxVolume: parts.sfxVolume,
    sfx: parts.sfx,
    ...parts.chat,
    voiceEnabled: parts.voice.enabled,
    voiceName: parts.voice.name,
    voiceVolume: parts.voice.volume,
    voiceWhisperEnabled: parts.voice.whisper,
    voiceTodoEnabled: parts.voice.todo,
    voiceNotifyEnabled: parts.voice.notify,
    speakStripEmoji: parts.voice.stripEmoji,
    physics: parts.look.physics,
    whisperModel: parts.model.whisperModel,
    chatModel: parts.model.chatModel,
    chatMemoryRounds: parts.model.chatMemory,
    chatImageLimit: parts.model.chatImageLimit,
    font: parts.look.font,
    animationWeights: parts.look.weights,
  };
}
