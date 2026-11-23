/**
 * 音效的网页端入口：把成品配置 + 宿主索引收成一次播放。
 *
 * 素材地址只在这里拼（`/sound/<素材根>/<文件名>`）；解析顺序、音量、节流与调度全在 shared/sfx，
 * 桌面 Helper 调同一份，两端不会各写一套判定。
 * 索引按「素材根 + 渲染方式 + 皮肤」缓存：切皮肤必然伴随配置重载，重载时 {@link loadSfxIndex} 会换一份。
 * @module dsh-fish-body/src/client/pet/sfx
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import {
  configureSfx,
  playSfx,
  preloadSfx,
  resolveSfx,
  scheduleSfx,
  stopScheduledSfx,
} from '../../shared/sfx/index.ts';
import type { Pet, SfxEventSlot, SfxIndex, SfxLayer } from '../../shared/types.ts';

/** 空索引：宿主还没回应或请求失败时用它，解析器会把事件槽填成内置默认。 */
const EMPTY_INDEX: SfxIndex = { animations: {}, events: {}, hooks: {}, origin: {} };

/** 已载入的索引：宠物 id → 索引。 */
const indexes = new Map<string, SfxIndex>();

/** 已载入索引对应的缓存键：宠物 id → 键；与 {@link indexes} 一起判断「要不要重取」。 */
const loadedKeys = new Map<string, string>();

/** 已经打过告警的「宠物 id + 缓存键」：同一份配置只提醒一次，避免每次触发都刷屏。 */
const warned = new Set<string>();

/** 索引缓存键：素材根 + 渲染方式 + 皮肤，三者任一变化都要重取。 */
function indexKeyOf(pet: Pet): string {
  return (pet.assetRoot ?? pet.id) + '|' + (pet.renderer ?? 'webm') + '|' + (pet.model ?? '');
}

/**
 * 写入音效总开关、总音量与常驻预热（配置到手时调一次）。
 *
 * @param main - 成品配置的 main 条目。
 */
export function configureSfxFromMain(main: Record<string, unknown> | undefined): void {
  const volume = main?.sfxVolume;
  configureSfx({
    enabled: main?.sfxEnabled === true,
    keepAlive: main?.sfxKeepAlive !== false,
    ...(typeof volume === 'number' ? { volume } : {}),
  });
}

/**
 * 拉取该宠物的音效索引（宿主已按搜索链算好优先级并填入内置默认）。
 *
 * 失败只告警一次并保留空索引：事件槽仍按内置默认发声，用户不会因为一次请求失败就没声音。
 *
 * @param pet - 成品配置里的一只宠物。
 * @returns 本次可用的索引（失败时是空索引）。
 */
export async function loadSfxIndex(pet: Pet): Promise<SfxIndex> {
  const key = indexKeyOf(pet);
  const cached = indexes.get(pet.id);
  if (cached !== undefined && loadedKeys.get(pet.id) === key) return cached;
  const query =
    '/sound/' +
    encodeURIComponent(pet.assetRoot ?? pet.id) +
    '/index?renderer=' +
    encodeURIComponent(pet.renderer ?? 'webm') +
    '&model=' +
    encodeURIComponent(pet.model ?? '');
  try {
    const response = await fetch(ROUTE_PATH + query, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const body = (await response.json()) as { ok?: boolean } & Partial<SfxIndex>;
    if (body.ok === false) throw new Error('index failed');
    const index: SfxIndex = {
      events: body.events ?? {},
      animations: body.animations ?? {},
      hooks: body.hooks ?? {},
      origin: body.origin ?? {},
      // 落地信息（宿主算好的绝对路径与「建议放这里」）：设置页只展示，播放链不用它。
      ...(body.paths === undefined ? {} : { paths: body.paths }),
      ...(body.hookPaths === undefined ? {} : { hookPaths: body.hookPaths }),
      ...(body.suggestions === undefined ? {} : { suggestions: body.suggestions }),
    };
    indexes.set(pet.id, index);
    loadedKeys.set(pet.id, key);
    // 预热事件槽素材：首声不依赖「取文件 + 解码」的延迟，也避免第一下走回退路径。
    for (const file of Object.values(index.events)) preloadSfx(sfxUrl(pet, file));
    return index;
  } catch (error) {
    if (!warned.has(pet.id + '|' + key)) {
      warned.add(pet.id + '|' + key);
      console.warn('[fish-body] 音效索引加载失败 pet=' + pet.id + '：' + String(error) + '（改用内置默认音效）');
    }
    return indexes.get(pet.id) ?? EMPTY_INDEX;
  }
}

/**
 * 直接写入一份索引（测试与「配置重载已带回索引」的路径用）。
 *
 * @param pet - 宠物。
 * @param index - 索引。
 */
export function setSfxIndex(pet: Pet, index: SfxIndex): void {
  indexes.set(pet.id, index);
}

/**
 * 拼一个音效素材的地址。
 *
 * `model` 带上皮肤是因为同一文件名可能在多套皮肤目录里各有一份：宿主按它先查该皮肤的目录，
 * 否则切了皮肤却还响上一套的声音。
 * `renderer` 必须带：池的资源目录是 `<池>/<渲染方式>/<皮肤>/`，宿主少了这一项就退化成 webm
 * ——layered 皮肤放进池里的音效会 404（索引里有名字、播放时 404 的那一声就是这么丢的）。
 *
 * @param pet - 宠物（提供素材根、皮肤与渲染方式）。
 * @param file - 文件名。
 * @returns 可直接 fetch / 播放的地址。
 */
export function sfxUrl(pet: Pet, file: string): string {
  const base = ROUTE_PATH + '/sound/' + encodeURIComponent(pet.assetRoot ?? pet.id) + '/' + encodeURIComponent(file);
  const query = ['renderer=' + encodeURIComponent(pet.renderer ?? 'webm')];
  const model = pet.model ?? '';
  if (model !== '') query.push('model=' + encodeURIComponent(model));
  return base + '?' + query.join('&');
}

/** 覆盖层：从基到具体（条目 → 渲染方式 → 皮肤清单 → 皮肤覆盖）。 */
function layersOf(pet: Pet, skinLayer?: SfxLayer | null): SfxLayer[] {
  const config = pet.sfx;
  const layers: SfxLayer[] = [];
  if (config !== undefined) layers.push(config);
  const byRenderer = config?.renderers?.[pet.renderer ?? 'webm'];
  if (byRenderer !== undefined) layers.push(byRenderer);
  if (skinLayer !== undefined && skinLayer !== null) layers.push(skinLayer);
  const bySkin = config?.skins?.[pet.model ?? ''];
  if (bySkin !== undefined) layers.push(bySkin);
  return layers;
}

/** 该宠物当前生效的发音计划。 */
function planOf(pet: Pet, skinLayer?: SfxLayer | null) {
  return resolveSfx({ index: indexes.get(pet.id) ?? EMPTY_INDEX, layers: layersOf(pet, skinLayer), lane: 'web' });
}

/**
 * 播一个事件槽。
 *
 * @param pet - 宠物。
 * @param slot - 事件槽。
 * @param options - `gain` 是撞击增益（碰撞槽用），`skinLayer` 是皮肤清单里的显式覆盖。
 * @returns 是否发起了播放（关掉、节流中、没有文件时为 false）。
 */
export function playPetSlot(
  pet: Pet,
  slot: SfxEventSlot,
  options?: { gain?: number; skinLayer?: SfxLayer | null },
): boolean {
  const cue = planOf(pet, options?.skinLayer).slot(slot);
  if (cue === null) return false;
  const gain = options?.gain ?? 1;
  if (gain <= 0) return false;
  return playSfx(sfxUrl(pet, cue.file), {
    volume: cue.volume * gain,
    throttleMs: cue.throttleMs,
    throttleKey: pet.id + ':' + slot,
  });
}

/**
 * 播一段动画绑定的动作音（时间线；会先清掉上一段动画排下的点）。
 *
 * @param pet - 宠物。
 * @param anim - 当前动画 / 动作 / gesture 名。
 * @param skinLayer - 皮肤清单里的显式覆盖。
 */
export function playPetAnimSfx(pet: Pet, anim: string, skinLayer?: SfxLayer | null): void {
  const cues = planOf(pet, skinLayer).anim(anim);
  if (cues.length === 0) {
    stopScheduledSfx();
    return;
  }
  scheduleSfx(
    cues.map((cue) => ({
      url: sfxUrl(pet, cue.file),
      at: cue.at,
      ...(cue.everyMs === null ? {} : { everyMs: cue.everyMs }),
      volume: cue.volume,
    })),
  );
}

/** 停掉当前动画排下的动作音（切源、冻结、卸载时调用）。 */
export function stopPetAnimSfx(): void {
  stopScheduledSfx();
}

/**
 * 播一个自定义 hook。
 *
 * @param pet - 宠物。
 * @param hook - hook 名（配置 `sfx.hooks` 或索引里自动匹配到的 `hook-<名>`）。
 * @param skinLayer - 皮肤清单里的显式覆盖。
 * @returns 是否发起了播放。
 */
export function playPetHook(pet: Pet, hook: string, skinLayer?: SfxLayer | null): boolean {
  const cue = planOf(pet, skinLayer).hook(hook);
  if (cue === null) return false;
  return playSfx(sfxUrl(pet, cue.file), {
    volume: cue.volume,
    throttleMs: cue.throttleMs,
    throttleKey: pet.id + ':hook:' + hook,
  });
}

/** 清空索引与告警状态（测试用）。@internal */
export function resetPetSfx(): void {
  indexes.clear();
  loadedKeys.clear();
  warned.clear();
}
