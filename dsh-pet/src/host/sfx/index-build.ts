/**
 * 把扫到的文件清单收敛成一份索引：每个事件槽一个文件、每段动画一个动作音、每个 hook 一个文件。
 *
 * 优先级（高 → 低）：
 * 皮肤目录内（位置即身份）→ `-sound/` 里带皮肤前缀 → `-sound/` 里不带前缀 →
 * 动画同目录 → `<用户根>/main-sound/` → 包内 `assets/sound/` → 内置默认。
 * 事件槽永远有值（除睡眠两段没有默认），动画音与 hook 只收录真正匹配到的。
 * 纯函数：输入是清单，不读盘、不读配置。
 * @module dsh-pet/src/host/sfx/index-build
 */
import { COLLISION_SLOTS, DEFAULT_EVENT_FILES } from '../../shared/sfx/defaults.ts';
import { parseSfxFileName, type ParsedSfxName } from '../../shared/sfx/names.ts';
import { SFX_EVENT_SLOTS } from '../../shared/sfx/types.ts';
import type { SfxEventSlot, SfxIndex, SfxOrigin } from '../../shared/types.ts';
import type { SfxSources } from './scan.ts';

/** 建索引的输入：清单 + 该宠物的渲染方式与皮肤。 */
export interface SfxIndexInput {
  readonly sources: SfxSources;
  /** 皮肤 id（layered 皮肤目录名 / live2d 模型所在目录名）；`''` = 根布局。 */
  readonly model: string;
}

/** 索引的累积器：先命中的赢，后续来源不再覆盖。 */
interface Builder {
  readonly events: Partial<Record<SfxEventSlot, string>>;
  readonly origin: Partial<Record<SfxEventSlot, SfxOrigin>>;
  readonly animations: Record<string, string>;
  readonly hooks: Record<string, string>;
}

/** 记一个槽位（已有值就跳过，先命中的优先级更高）。 */
function takeSlot(builder: Builder, slot: SfxEventSlot, file: string, origin: SfxOrigin): void {
  if (builder.events[slot] !== undefined) return;
  builder.events[slot] = file;
  builder.origin[slot] = origin;
}

/** `bump` 兜底：三个碰撞槽一起填（已经填过的保持不动）。 */
function takeBump(builder: Builder, file: string, origin: SfxOrigin): void {
  for (const slot of COLLISION_SLOTS) takeSlot(builder, slot, file, origin);
}

/** 按解析结果落到对应的桶。 */
function takeParsed(builder: Builder, parsed: ParsedSfxName, file: string, origin: SfxOrigin): void {
  if (parsed.kind === 'slot' && parsed.slot !== undefined) {
    takeSlot(builder, parsed.slot, file, origin);
    return;
  }
  if (parsed.kind === 'bump') {
    takeBump(builder, file, origin);
    return;
  }
  if (parsed.kind === 'hook' && parsed.name !== undefined) {
    if (builder.hooks[parsed.name] === undefined) builder.hooks[parsed.name] = file;
    return;
  }
  if (parsed.kind === 'anim' && parsed.name !== undefined && builder.animations[parsed.name] === undefined) {
    builder.animations[parsed.name] = file;
  }
}

/**
 * 扫一个扁平目录（`-sound/` 或用户共享目录）：先收带当前皮肤前缀的，再收不带前缀的。
 *
 * @param builder - 累积器。
 * @param files - 文件名。
 * @param skins - 已知皮肤清单（用于剥前缀）。
 * @param model - 当前皮肤；空串表示这套素材没有皮肤。
 * @param origin - 来源标签。
 */
function takeFlatDir(
  builder: Builder,
  files: readonly string[],
  skins: readonly string[],
  model: string,
  origin: SfxOrigin,
): void {
  const pass = (wanted: string, phase: 'specific' | 'bump'): void => {
    for (const file of files) {
      const parsed = parseSfxFileName(file, skins);
      if (parsed === null || parsed.skin !== wanted) continue;
      // bump 是所有碰撞槽的**兜底**：同一目录里写了具体 floor/wall/ceiling 时它不许抢先。
      if ((parsed.kind === 'bump') !== (phase === 'bump')) continue;
      takeParsed(builder, parsed, file, origin);
    }
  };
  for (const phase of ['specific', 'bump'] as const) {
    if (model !== '') pass(model, phase);
    pass('', phase);
  }
}

/**
 * 建索引。
 *
 * @param input - 文件清单与该宠物的皮肤。
 * @returns 已填满事件槽的索引。
 */
export function buildSfxIndex(input: SfxIndexInput): SfxIndex {
  const { sources, model } = input;
  const builder: Builder = { animations: {}, events: {}, hooks: {}, origin: {} };

  // 1. 皮肤目录内：位置即身份，文件名不需要前缀（也按无前缀解析，避免把皮肤名当成前缀剥两遍）。
  const skinFiles = sources.bySkin[model] ?? (model === '' ? sources.bySkin[''] : undefined);
  for (const file of skinFiles ?? []) {
    const parsed = parseSfxFileName(file, []);
    if (parsed !== null) takeParsed(builder, parsed, file, 'skin');
  }
  // 2~3. 素材根自己的声音目录。
  takeFlatDir(builder, sources.sound, sources.skins, model, 'sound');
  // 4. 动画同目录：只当动作音，槽名在这里不认（否则 `click.wav` 会被当成一段动画）。
  for (const file of sources.animation) {
    const parsed = parseSfxFileName(file, []);
    if (parsed === null || parsed.kind !== 'anim' || parsed.name === undefined) continue;
    if (builder.animations[parsed.name] === undefined) builder.animations[parsed.name] = file;
  }
  // 5. 用户级共享目录。
  takeFlatDir(builder, sources.user, sources.skins, model, 'user');
  // 6. 包内默认目录：既是「随包发布的素材」，也是内置默认文件的落点。
  takeFlatDir(builder, sources.packaged, sources.skins, model, 'package-default');

  // 7. 兜底：事件槽没有命中就用内置默认文件名（文件一定在包内）。
  for (const slot of SFX_EVENT_SLOTS) {
    if (builder.events[slot] !== undefined) continue;
    const file = DEFAULT_EVENT_FILES[slot];
    if (file === undefined) continue;
    builder.events[slot] = file;
    builder.origin[slot] = 'package-default';
  }

  return { animations: builder.animations, events: builder.events, hooks: builder.hooks, origin: builder.origin };
}
