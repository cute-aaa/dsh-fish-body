/**
 * 把扫到的文件清单收敛成一份索引：每个事件槽一个文件、每段动画一个动作音、每个 hook 一个文件。
 *
 * 优先级（高 → 低，与 host/sfx/order 的层序一致）：
 * 池资源目录（结构文件基名 / 目录名前缀）→ 池渲染方式兜底（`<渲染方式>-<事件>`）→ 池全局音效
 * （无前缀优先）→ 旧皮肤目录（位置即身份）→ `-sound/`（带皮肤前缀 → 不带）→ 动画同目录 →
 * `<数据根>/assets/sound/` → 包内 `assets/sound/` → 内置默认。
 * 事件槽永远有值（除睡眠两段没有默认），动画音与 hook 只收录真正匹配到的。
 * 纯函数：输入是清单，不读盘；唯一的副作用是「池全局同事件多份」时的一次告警回调。
 * @module dsh-fish-body/src/host/sfx/index-build
 */
import { COLLISION_SLOTS, DEFAULT_EVENT_FILES } from '../../shared/sfx/defaults.ts';
import { parseSfxFileName, stripAudioExt, type ParsedSfxName } from '../../shared/sfx/names.ts';
import { SFX_EVENT_SLOTS } from '../../shared/sfx/types.ts';
import type { RendererKind, SfxEventSlot, SfxIndex, SfxOrigin } from '../../shared/types.ts';
import type { SfxSources } from './scan.ts';

/** 建索引的输入：清单 + 该宠物的渲染方式与皮肤。 */
export interface SfxIndexInput {
  readonly sources: SfxSources;
  /** 皮肤 id（layered 皮肤目录名 / live2d 模型所在目录名）；`''` = 根布局。 */
  readonly model: string;
  /** 渲染方式：决定池第 2/3 级用的目录名前缀；缺省 `webm`（与历史行为一致）。 */
  readonly renderer?: RendererKind;
  /** 池资源目录名（第 2 级前缀，如 `character1`）。 */
  readonly poolSkinName?: string;
  /** 池结构文件基名（第 1 级前缀，如 `xxx`）。 */
  readonly poolSkinStructures?: readonly string[];
  /** 告警出口：池全局同一事件出现多份时提示一次（去重由调用方负责）。 */
  readonly warn?: (message: string) => void;
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
 * 扫一个**只认前缀**的目录（池的资源目录 / 渲染方式兜底目录）。
 *
 * 池里的文件必须带前缀（`<结构文件基名>-click.wav` / `<目录名>-click.wav` / `<渲染方式>-click.wav`）：
 * 池是所有宠物共用的，裸 `click.wav` 会被别的宠物误命中，所以这里不认无前缀的写法。
 * 动画名在池里不算动作音（文档 §3 的池三层只有事件与 hook）。
 *
 * @param builder - 累积器。
 * @param files - 文件名。
 * @param prefixes - 允许的前缀（短的会被长的优先匹配，由 names.ts 负责）。
 * @param origin - 来源标签。
 */
function takePrefixedDir(
  builder: Builder,
  files: readonly string[],
  prefixes: readonly string[],
  origin: SfxOrigin,
): void {
  const usable = prefixes.filter((prefix) => prefix !== '');
  if (usable.length === 0) return;
  const pass = (phase: 'specific' | 'bump'): void => {
    for (const file of files) {
      const parsed = parseSfxFileName(file, usable);
      if (parsed === null || parsed.skin === '') continue;
      if (parsed.kind === 'anim') continue;
      if ((parsed.kind === 'bump') !== (phase === 'bump')) continue;
      takeParsed(builder, parsed, file, origin);
    }
  };
  pass('specific');
  pass('bump');
}

/** 文件扩展名（含点，小写）；没有则空串。 */
function extOf(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot <= 0 ? '' : file.slice(dot).toLowerCase();
}

/** 去掉最后一个 `-` 之前的全部字符（`common-click.wav` → `click.wav`）。 */
function tailAfterLastDash(file: string): string | null {
  const ext = extOf(file);
  const stem = stripAudioExt(file);
  const cut = stem.lastIndexOf('-');
  if (cut <= 0) return null;
  return stem.slice(cut + 1) + ext;
}

/**
 * 扫池的全局音效目录：无前缀优先，其次「任意前缀 + `-<事件>`」按文件名排序取第一个。
 *
 * 同事件出现多份带前缀的文件时只告警一次——用户放了一堆同义文件，说一句就够了，
 * 不必每个请求都刷屏。
 *
 * @param builder - 累积器。
 * @param files - 文件名（未排序，函数内部排序）。
 * @param warn - 告警出口。
 */
function takePoolGlobal(
  builder: Builder,
  files: readonly string[],
  warn: ((message: string) => void) | undefined,
): void {
  const sorted = [...files].sort((a, b) => a.localeCompare(b));
  // 第一趟：无前缀（`click.wav` / `hook-ding.wav`）。池全局没有「位置即身份」的动画音。
  const bareBump: string[] = [];
  for (const file of sorted) {
    const parsed = parseSfxFileName(file, []);
    if (parsed === null || parsed.skin !== '' || parsed.kind === 'anim') continue;
    // bump 放最后：它在同一层里仍是兜底，具体 floor/wall/ceiling 先填。
    if (parsed.kind === 'bump') {
      bareBump.push(file);
      continue;
    }
    takeParsed(builder, parsed, file, 'pool-global');
  }
  // 第二趟：任意前缀（`common-click.wav`）。按事件聚齐后取第一个命中，多份时告警一次。
  const bySlot = new Map<SfxEventSlot, string[]>();
  const bumpFiles: string[] = [];
  const byHook = new Map<string, string[]>();
  for (const file of sorted) {
    const tail = tailAfterLastDash(file);
    if (tail === null) continue;
    const parsed = parseSfxFileName(tail, []);
    if (parsed === null) continue;
    if (parsed.kind === 'slot' && parsed.slot !== undefined) {
      const list = bySlot.get(parsed.slot) ?? [];
      list.push(file);
      bySlot.set(parsed.slot, list);
    } else if (parsed.kind === 'bump') {
      bumpFiles.push(file);
    } else if (parsed.kind === 'hook' && parsed.name !== undefined) {
      const list = byHook.get(parsed.name) ?? [];
      list.push(file);
      byHook.set(parsed.name, list);
    }
  }
  for (const [slot, list] of bySlot) {
    if (builder.events[slot] !== undefined) continue;
    takeSlot(builder, slot, list[0], 'pool-global');
    if (list.length > 1) {
      warn?.(
        '池的全局音效里「' + slot + '」有多份候选（' + list.join('、') + '），已取「' + list[0] + '」；建议只留一份',
      );
    }
  }
  if (bumpFiles.length > 0) {
    takeBump(builder, bumpFiles[0], 'pool-global');
    if (bumpFiles.length > 1) {
      warn?.('池的全局音效里碰撞兜底有多份候选（' + bumpFiles.join('、') + '），已取「' + bumpFiles[0] + '」');
    }
  }
  for (const [name, list] of byHook) {
    if (builder.hooks[name] !== undefined) continue;
    builder.hooks[name] = list[0];
    if (list.length > 1) {
      warn?.('池的全局音效里 hook「' + name + '」有多份候选（' + list.join('、') + '），已取「' + list[0] + '」');
    }
  }
  if (bareBump.length > 0) takeBump(builder, bareBump[0], 'pool-global');
}

/**
 * 建索引。
 *
 * @param input - 文件清单、该宠物的皮肤与渲染方式，以及池目录的前缀信息。
 * @returns 已填满事件槽的索引。
 */
export function buildSfxIndex(input: SfxIndexInput): SfxIndex {
  const { sources, model } = input;
  const renderer = input.renderer ?? 'webm';
  const builder: Builder = { animations: {}, events: {}, hooks: {}, origin: {} };

  // 1~2. 池资源目录：结构文件基名优先，其次目录名。
  takePrefixedDir(
    builder,
    sources.poolSkin,
    [...(input.poolSkinStructures ?? []), input.poolSkinName ?? ''].filter((value) => value !== ''),
    'pool-skin',
  );
  // 3. 池渲染方式兜底：前缀恒为该渲染方式名（webm 的平铺目录与 `sound/` 都在 sources.poolRenderer 里）。
  takePrefixedDir(builder, sources.poolRenderer, [renderer], 'pool-renderer');
  // 4. 池全局音效：无前缀优先，其次任意前缀。
  takePoolGlobal(builder, sources.poolGlobal, input.warn);
  // 5. 旧皮肤目录内：位置即身份，文件名不需要前缀（也按无前缀解析，避免把皮肤名当成前缀剥两遍）。
  const skinFiles = sources.bySkin[model] ?? (model === '' ? sources.bySkin[''] : undefined);
  for (const file of skinFiles ?? []) {
    const parsed = parseSfxFileName(file, []);
    if (parsed !== null) takeParsed(builder, parsed, file, 'skin');
  }
  // 6~7. 素材根自己的声音目录（带皮肤前缀的压过通用的）。
  takeFlatDir(builder, sources.sound, sources.skins, model, 'sound');
  // 8. 动画同目录：只当动作音，槽名在这里不认（否则 `click.wav` 会被当成一段动画）。
  for (const file of sources.animation) {
    const parsed = parseSfxFileName(file, []);
    if (parsed === null || parsed.kind !== 'anim' || parsed.name === undefined) continue;
    if (builder.animations[parsed.name] === undefined) builder.animations[parsed.name] = file;
  }
  // 9. 用户级共享目录。
  takeFlatDir(builder, sources.user, sources.skins, model, 'user');
  // 10. 包内默认目录：既是「随包发布的素材」，也是内置默认文件的落点。
  takeFlatDir(builder, sources.packaged, sources.skins, model, 'package-default');

  // 11. 兜底：事件槽没有命中就用内置默认文件名（文件一定在包内）。
  for (const slot of SFX_EVENT_SLOTS) {
    if (builder.events[slot] !== undefined) continue;
    const file = DEFAULT_EVENT_FILES[slot];
    if (file === undefined) continue;
    builder.events[slot] = file;
    builder.origin[slot] = 'package-default';
  }

  return { animations: builder.animations, events: builder.events, hooks: builder.hooks, origin: builder.origin };
}
