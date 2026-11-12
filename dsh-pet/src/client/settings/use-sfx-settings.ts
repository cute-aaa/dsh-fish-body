/**
 * 设置页「音效」分区的状态：把成品配置的 `sfx` 段与宿主索引拼成一张可编辑的槽位表。
 *
 * 只改本地状态、随「保存」整包写回；试听直接走共享播放器（不落盘、不进配置）。
 * 索引是宿主扫盘算出来的「这台机器上实际有什么」：卡片上的文件名与来源都由它决定，
 * 用户改开关只是往 `sfx` 段里补一条覆盖，不改自动匹配的结果；hook 可以在这一页登记名字。
 * owns only 开关编辑、hook 登记与试听，never 保存、加载与顶层三件套（那两个在 use-global-settings）。
 * @module dsh-pet/src/client/settings/use-sfx-settings
 */
import { petBridge } from './bridge.ts';
import { loadSfxIndex, sfxUrl } from '../pet/sfx.ts';
import { playSfx } from '../../shared/sfx/player.ts';
import { resolveSfx } from '../../shared/sfx/resolve.ts';
import { SFX_EVENT_SLOTS, SFX_HOOK_NAME_RE, BUILTIN_HOOKS } from '../../shared/sfx/types.ts';
import type { MainConfigPatch } from './config/index.ts';
import type { SettingsRuntime } from './runtime.ts';
import type { Pet, SfxConfig, SfxCue, SfxEventSlot, SfxIndex, SfxOrigin } from '../../shared/types.ts';

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
}

/** 一个自定义 hook 的展示数据。 */
export interface SfxHookView {
  /** hook 名（`POST /sfx/<名字>` 的那个名字）。 */
  readonly name: string;
  /** 生效文件名；空串 = 还没有对应素材，触发时不出声。 */
  readonly file: string;
  /** 文件从哪来。 */
  readonly origin: SfxOrigin | 'none';
  /** 是否已写进配置的 `sfx.hooks`（决定能不能「删除」）。 */
  readonly declared: boolean;
  /** 是否是内置 hook 点（两端自己在固定时机触发，不需要外部调用）。 */
  readonly builtin: boolean;
}

/** 音效分区的状态与回调。 */
export interface SfxSettings {
  /** 八个事件槽的当前状态。 */
  readonly slots: readonly SfxSlotView[];
  /** 可试听的 hook（配置 ∪ 索引）。 */
  readonly hooks: readonly SfxHookView[];
  /** 保存体里的 `sfx` 段（已含本次编辑）。 */
  readonly config: SfxConfig;
  /** 用成品配置覆盖基线。 */
  apply(patch: MainConfigPatch): void;
  /** 改一个槽的开关。 */
  setSlotEnabled(slot: SfxEventSlot, enabled: boolean): void;
  /** 试听一个槽。 */
  trySlot(slot: SfxEventSlot): void;
  /** 试听一个 hook。 */
  tryHook(hook: string): void;
  /**
   * 把一个 hook 名写进配置的 `sfx.hooks`（只在本地，随「保存」落盘）。
   *
   * @param name - hook 名；不合法或已登记时返回 false（调用方据此提示）。
   * @returns 是否真的新增了一条。
   */
  addHook(name: string): boolean;
  /** 删掉配置里的一条 hook 声明（磁盘上的素材不动）。 */
  removeHook(name: string): void;
  /** 拉一次索引（设置页打开时调；失败静默降级成内置默认）。 */
  load(): void;
}

/** 本次编辑的累积：开关与 hook 增删。 */
interface SfxEdits {
  slots: Partial<Record<SfxEventSlot, { enabled?: boolean }>>;
  addHooks: string[];
  removeHooks: string[];
}

/** 空编辑：避免每次渲染新建对象。 */
const EMPTY_EDITS: SfxEdits = { addHooks: [], removeHooks: [], slots: {} };

/**
 * 把编辑叠到基线配置上；数组变体逐项同步（设置页不负责编辑变体清单）。
 *
 * @param base - 基线 `sfx` 段。
 * @param edits - 本次编辑。
 * @returns 新的 `sfx` 段；没有任何编辑时原样返回基线。
 */
function withEdits(base: SfxConfig, edits: SfxEdits): SfxConfig {
  const slots = Object.keys(edits.slots) as SfxEventSlot[];
  let out = base;
  if (slots.length > 0) {
    const events: Record<string, unknown> = { ...(base.events ?? {}) };
    for (const slot of slots) {
      const enabled = edits.slots[slot]?.enabled;
      if (enabled === undefined) continue;
      const previous = events[slot];
      const patch = { enabled };
      // 事件槽允许写成变体数组：开关要落到每一项上，否则数组分支会整段被覆盖。
      if (Array.isArray(previous)) {
        events[slot] = (previous as Array<Record<string, unknown>>).map((item) => ({ ...item, ...patch }));
      } else {
        events[slot] = { ...((previous as Record<string, unknown> | undefined) ?? {}), ...patch };
      }
    }
    out = { ...out, events: events as SfxConfig['events'] };
  }
  if (edits.addHooks.length > 0 || edits.removeHooks.length > 0) {
    const hooks: Record<string, SfxCue | readonly SfxCue[]> = { ...(base.hooks ?? {}) };
    for (const name of edits.removeHooks) delete hooks[name];
    // 空 cue = 「用自动匹配到的文件，只登记名字」。
    for (const name of edits.addHooks) hooks[name] ??= {};
    out = { ...out, hooks };
  }
  return out;
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
  const [edits, setEdits] = useState<SfxEdits>(EMPTY_EDITS);
  const [index, setIndex] = useState<SfxIndex | null>(null);
  const [, setVersion] = useState(0);

  const apply = useCallback((patch: MainConfigPatch): void => {
    setBase(patch.sfx ?? {});
    // 配置重新下发（首次加载 / 保存成功 / 同步）后，本地编辑已经被落盘值取代。
    setEdits(EMPTY_EDITS);
  }, []);

  const load = useCallback((): void => {
    const pet = currentPet();
    if (pet === undefined) return;
    void loadSfxIndex(pet).then((next) => {
      setIndex(next);
      setVersion((v) => v + 1);
    });
  }, []);

  const edit = useCallback((patch: (prev: SfxEdits) => SfxEdits): void => {
    setEdits(patch);
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
    };
  });
  const builtin = new Set(BUILTIN_HOOKS);
  // 内置 hook 点排在前面（没有文件也照样展示命名提示并可登记）；其余按名字排序。
  const hookNames = [
    ...BUILTIN_HOOKS,
    ...[...new Set([...Object.keys(config.hooks ?? {}), ...Object.keys(index?.hooks ?? {})])]
      .filter((name) => !builtin.has(name))
      .sort(),
  ];
  const hooks: SfxHookView[] = hookNames.map((name) => {
    const cue = plan.hook(name);
    return {
      builtin: builtin.has(name),
      declared: (config.hooks ?? {})[name] !== undefined,
      file: cue?.file ?? '',
      name,
      origin: cue?.origin ?? 'none',
    };
  });

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
    setSlotEnabled: (slot, enabled) => edit((prev) => ({ ...prev, slots: { ...prev.slots, [slot]: { enabled } } })),
    slots,
    tryHook,
    trySlot,
    addHook: (name) => {
      const trimmed = name.trim();
      if (!SFX_HOOK_NAME_RE.test(trimmed)) return false;
      // 已经登记过的名字再「添加」只是重复，直接当失败交给卡片提示，不往配置里堆第二份。
      if ((config.hooks ?? {})[trimmed] !== undefined) return false;
      edit((prev) => ({
        addHooks: [...prev.addHooks, trimmed],
        removeHooks: prev.removeHooks.filter((one) => one !== trimmed),
        slots: prev.slots,
      }));
      return true;
    },
    removeHook: (name) => {
      edit((prev) => ({
        addHooks: prev.addHooks.filter((one) => one !== name),
        removeHooks: [...prev.removeHooks, name],
        slots: prev.slots,
      }));
    },
  };
}
