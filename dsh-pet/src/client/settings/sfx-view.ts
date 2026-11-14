/**
 * 音效的两个口径：**开关**（运行时响不响）与**匹配**（有没有文件可响）。
 *
 * 解析器把两者都收成 `null`——关掉开关等于不发声，没有文件也等于不发声。设置页要分开看：
 * checkbox 看真实开关，来源徽标与试听看「有没有文件」。所以这里提供一份「开关全当开着」的覆盖层，
 * 以及一个直接读配置判断开关的判据，两样都是纯函数，不碰播放器也不碰 React。
 * @module dsh-fish-body/src/client/settings/sfx-view
 */

import type { SfxConfig, SfxCue, SfxEventSlot } from '../../shared/types.ts';

/** 把一条 cue 的 `enabled` 抹掉（其余字段原样保留）。 */
function cueWithoutSwitch(cue: SfxCue): SfxCue {
  if (cue.enabled === undefined) return cue;
  const rest: SfxCue = { ...cue };
  delete (rest as { enabled?: boolean }).enabled;
  return rest;
}

/** 抹掉一段（事件 / 动画 / hook）里的 `enabled`；数组（变体 / 时间线）逐项处理。 */
function bucketWithoutSwitch<T>(bucket: Record<string, T> | undefined): Record<string, T> | undefined {
  if (bucket === undefined) return undefined;
  const out: Record<string, T> = {};
  for (const [key, item] of Object.entries(bucket)) {
    const mapped = Array.isArray(item)
      ? (item as readonly SfxCue[]).map(cueWithoutSwitch)
      : cueWithoutSwitch(item as SfxCue);
    out[key] = mapped as unknown as T;
  }
  return out;
}

/**
 * 一张「开关全部当作开着」的覆盖层，只回答「这一槽 / 这个 hook 有没有文件」。
 *
 * 关掉开关只该让运行时静音，不该顺手把「有没有文件」也抹掉：那样试听就没法在开启之前先听一遍，
 * 来源徽标也会从「皮肤」谎变成「未匹配」。
 *
 * @param config - 已含本次编辑的 `sfx` 段。
 * @returns 抹掉所有 `enabled` 的副本。
 */
export function switchesIgnored(config: SfxConfig): SfxConfig {
  const events = bucketWithoutSwitch(config.events);
  const animations = bucketWithoutSwitch(config.animations);
  const hooks = bucketWithoutSwitch(config.hooks);
  return {
    ...(events === undefined ? {} : { events: events as SfxConfig['events'] }),
    ...(animations === undefined ? {} : { animations: animations as SfxConfig['animations'] }),
    ...(hooks === undefined ? {} : { hooks: hooks as SfxConfig['hooks'] }),
  };
}

/**
 * 这个槽位的开关是不是开着。
 *
 * 不能从解析结果反推（关掉开关与没有文件都会让 cue 变成 `null`）。没写过覆盖 = 默认开；
 * 变体数组按「每一项都开着」算——设置页改开关时会把 `enabled` 落到每一项上。
 *
 * @param events - 配置里的 `sfx.events` 段。
 * @param slot - 槽位。
 * @returns 开关是否开着。
 */
export function slotSwitchOn(events: SfxConfig['events'], slot: SfxEventSlot): boolean {
  const raw = events?.[slot];
  if (raw === undefined) return true;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.length > 0 && list.every((cue) => cue.enabled !== false);
}
