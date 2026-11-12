/**
 * 设置页「音效」分区的状态：把成品配置的 `sfx` 段与宿主索引拼成一张可编辑的槽位表。
 *
 * 只改本地状态、随「保存」整包写回；试听直接走共享播放器（不落盘、不进配置）。
 * 索引是宿主扫盘算出来的「这台机器上实际有什么」：卡片上的文件名与来源都由它决定，
 * 用户改音量/开关只是往 `sfx` 段里补一条覆盖，不改自动匹配的结果。
 * owns only 槽位编辑与试听，never 保存、加载与顶层三件套（那两个在 use-global-settings）。
 * @module dsh-pet/src/client/settings/use-sfx-settings
 */
import { petBridge } from './bridge.ts';
import { loadSfxIndex, sfxUrl } from '../pet/sfx.ts';
import { playSfx } from '../../shared/sfx/player.ts';
import { resolveSfx } from '../../shared/sfx/resolve.ts';
import { SFX_EVENT_SLOTS } from '../../shared/sfx/types.ts';
import type { MainConfigPatch } from './config/index.ts';
import type { SettingsRuntime } from './runtime.ts';
import type { Pet, SfxConfig, SfxEventSlot, SfxIndex, SfxOrigin } from '../../shared/types.ts';

/** 一行槽位的展示数据。 */
export interface SfxSlotView {
  /** 槽位。 */
  readonly slot: SfxEventSlot;
  /** 生效文件名；空串 = 这一槽不响。 */
  readonly file: string;
  /** 文件从哪来（皮肤 / 声音目录 / 动画同目录 / 用户 / 内置默认 / 配置覆盖）。 */
  readonly origin: SfxOrigin | 'none';
  /** 当前是否出声。 */
  readonly enabled: boolean;
  /** 分项音量（0–1）。 */
  readonly volume: number;
}

/** 音效分区的状态与回调。 */
export interface SfxSettings {
  /** 九个事件槽的当前状态。 */
  readonly slots: readonly SfxSlotView[];
  /** 可试听的 hook 名（配置 ∪ 索引）。 */
  readonly hooks: readonly string[];
  /** 保存体里的 `sfx` 段（已含本次编辑）。 */
  readonly config: SfxConfig;
  /** 用成品配置覆盖基线。 */
  apply(patch: MainConfigPatch): void;
  /** 改一个槽的开关。 */
  setSlotEnabled(slot: SfxEventSlot, enabled: boolean): void;
  /** 改一个槽的分项音量。 */
  setSlotVolume(slot: SfxEventSlot, volume: number): void;
  /** 试听一个槽。 */
  trySlot(slot: SfxEventSlot): void;
  /** 试听一个 hook。 */
  tryHook(hook: string): void;
  /** 拉一次索引（设置页打开时调；失败静默降级成内置默认）。 */
  load(): void;
}

/** 一次编辑：只记用户动过的两项。 */
interface SlotEdit {
  enabled?: boolean;
  volume?: number;
}

/** 把编辑叠到基线配置上；数组变体逐项同步（设置页不负责编辑变体清单）。 */
function withEdits(base: SfxConfig, edits: Partial<Record<SfxEventSlot, SlotEdit>>): SfxConfig {
  const keys = Object.keys(edits) as SfxEventSlot[];
  if (keys.length === 0) return base;
  const events: Record<string, unknown> = { ...(base.events ?? {}) };
  for (const slot of keys) {
    const edit = edits[slot];
    if (edit === undefined) continue;
    const previous = events[slot];
    const patch = {
      ...(edit.enabled === undefined ? {} : { enabled: edit.enabled }),
      ...(edit.volume === undefined ? {} : { volume: edit.volume }),
    };
    if (Array.isArray(previous)) {
      events[slot] = (previous as Array<Record<string, unknown>>).map((item) => ({ ...item, ...patch }));
    } else {
      events[slot] = { ...((previous as Record<string, unknown> | undefined) ?? {}), ...patch };
    }
  }
  return { ...base, events: events as SfxConfig['events'] };
}

/** 当前页面上的第一只宠物：索引与试听都按它的素材根/皮肤算。 */
function currentPet(): Pet | undefined {
  return petBridge.current[0];
}

/**
 * 管理音效分区。
 *
 * @param rt - 只用到 `useState` 与 `useCallback`。
 * @returns 槽位表、hook 清单、可写回的 `sfx` 段与试听入口。
 */
export function useSfxSettings(rt: Pick<SettingsRuntime, 'useState' | 'useCallback'>): SfxSettings {
  const { useState, useCallback } = rt;
  const [base, setBase] = useState<SfxConfig>({});
  const [edits, setEdits] = useState<Partial<Record<SfxEventSlot, SlotEdit>>>({});
  const [index, setIndex] = useState<SfxIndex | null>(null);
  const [, setVersion] = useState(0);

  const apply = useCallback((patch: MainConfigPatch): void => {
    setBase(patch.sfx ?? {});
    // 配置重新下发（首次加载 / 保存成功 / 同步）后，本地编辑已经被落盘值取代。
    setEdits({});
  }, []);

  const load = useCallback((): void => {
    const pet = currentPet();
    if (pet === undefined) return;
    void loadSfxIndex(pet).then((next) => {
      setIndex(next);
      setVersion((v) => v + 1);
    });
  }, []);

  const edit = useCallback((slot: SfxEventSlot, patch: SlotEdit): void => {
    setEdits((prev) => ({ ...prev, [slot]: { ...prev[slot], ...patch } }));
    setVersion((v) => v + 1);
  }, []);

  const config = withEdits(base, edits);
  const plan = resolveSfx({ index, layers: [config], lane: 'web' });
  const slots: SfxSlotView[] = SFX_EVENT_SLOTS.map((slot) => {
    const cue = plan.slot(slot);
    return {
      enabled: cue !== null,
      file: cue?.file ?? '',
      origin: cue?.origin ?? 'none',
      slot,
      volume: cue?.volume ?? 1,
    };
  });
  const hooks = [...new Set([...Object.keys(index?.hooks ?? {}), ...Object.keys(config.hooks ?? {})])].sort();

  const trySlot = useCallback(
    (slot: SfxEventSlot): void => {
      const pet = currentPet();
      if (pet === undefined) return;
      const cue = resolveSfx({ index, layers: [withEdits(base, edits)], lane: 'web' }).slot(slot);
      if (cue === null) return;
      playSfx(sfxUrl(pet, cue.file), { volume: cue.volume, throttleMs: 0, throttleKey: 'preview:' + slot });
    },
    [base, edits, index],
  );

  const tryHook = useCallback(
    (hook: string): void => {
      const pet = currentPet();
      if (pet === undefined) return;
      const cue = resolveSfx({ index, layers: [withEdits(base, edits)], lane: 'web' }).hook(hook);
      if (cue === null) return;
      playSfx(sfxUrl(pet, cue.file), { volume: cue.volume, throttleMs: 0, throttleKey: 'preview:hook:' + hook });
    },
    [base, edits, index],
  );

  return {
    apply,
    config,
    hooks,
    load,
    setSlotEnabled: (slot, enabled) => edit(slot, { enabled }),
    setSlotVolume: (slot, volume) => edit(slot, { volume }),
    slots,
    tryHook,
    trySlot,
  };
}
