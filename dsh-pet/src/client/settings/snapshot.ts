/**
 * 表单快照的唯一出处：把各分区的 hook 状态摊成一份与基线同形的对象。
 *
 * 形状必须与 {@link FormSnapshot} 完全一致，diff 才能按点分路径比较——所以这张映射只写在这里一份，
 * 装配根每次渲染调一次 `makeSnapshot`，保存成功后用 {@link withoutFish} 推进基线。
 * 会话鱼那半截永远取它的服务端权威值，不能拿保存前的快照盖回去（否则刚存完的页又亮起点）。
 * owns only 形状映射，never 状态、diff 与写盘。
 * @module dsh-fish-body/src/client/settings/snapshot
 */
import type { FormSnapshot } from './dirty.ts';
import type { AppearanceSettings } from './use-appearance-settings.ts';
import type { GlobalSettings } from './use-global-settings.ts';
import type { ModelSettings } from './use-model-settings.ts';
import type { PetList } from './use-pet-list.ts';
import type { SessionFishState } from './use-session-fish.ts';
import type { SfxSettings } from './use-sfx-settings.ts';
import type { VoiceSettings } from './use-voice-settings.ts';

/** 快照的原料：各分区的状态对象（本文件只读它们的公开字段）。 */
export interface SnapshotSources {
  readonly list: PetList;
  readonly global: GlobalSettings;
  readonly sfx: SfxSettings;
  readonly voice: VoiceSettings;
  readonly model: ModelSettings;
  readonly look: AppearanceSettings;
  readonly fish: SessionFishState;
}

/**
 * 摊出此刻的表单快照。
 *
 * @param sources - 各分区的状态对象。
 * @returns 与基线同形的快照；会话鱼草稿没读到时为 `null`（整块不参与比较）。
 */
export function makeSnapshot(sources: SnapshotSources): FormSnapshot {
  const { list, global, sfx, voice, model, look, fish } = sources;
  return {
    pets: list.pets,
    global: { ...global.values, sfxVolume: global.sfxVolume },
    sfx: sfx.config,
    voice: {
      enabled: voice.enabled,
      name: voice.name,
      volume: voice.volume,
      whisper: voice.whisper,
      todo: voice.todo,
      notify: voice.notify,
      stripEmoji: voice.stripEmoji,
    },
    model: {
      whisperModel: model.whisperModel,
      chatModel: model.chatModel,
      chatMemory: model.chatMemory,
      chatImageLimit: model.chatImageLimit,
      ...model.chatFlags,
    },
    look: { physics: look.physics, weights: look.weights, font: look.font },
    fish: fish.draft,
  };
}

/**
 * 去掉会话鱼那一截的快照：只推进主配置基线时用。
 *
 * @param snapshot - 此刻的表单快照。
 * @returns 不含 `fish` 的快照片段。
 */
export function withoutFish(snapshot: FormSnapshot): Omit<FormSnapshot, 'fish'> {
  return {
    pets: snapshot.pets,
    global: snapshot.global,
    sfx: snapshot.sfx,
    voice: snapshot.voice,
    model: snapshot.model,
    look: snapshot.look,
  };
}
