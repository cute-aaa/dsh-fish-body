/**
 * 共享资源池（内置皮肤，`<数据根>/assets/pet/`）的目录约定：池根名、渲染方式子目录与保留虚拟素材根。
 *
 * 只放「池长什么样」的名字表：不读盘、不拼绝对路径——池根的解析与枚举归 host/pool。
 * 必须始终成立：{@link POOL_ASSET_ROOT} 是本方案里的保留字，不能与任何 pack 名重合；
 * 宿主读取侧（跳过 `skin/pool-config.*`）与写端（拒绝 `entry=pool`）各拦一次。
 * @module dsh-fish-body/src/shared/pool
 */
import type { RendererKind } from './types.ts';

/** 池在 URL / 配置里的虚拟素材根（保留字，不能作 pack 名）。 */
export const POOL_ASSET_ROOT = 'pool';

/**
 * `assets.pool` 的默认值（相对数据根）。
 *
 * 池是**内置皮肤**：跟着包内素材走，放在 `assets/` 下；用户自己的皮肤是数据根顶层的 `skin/`。
 */
export const POOL_DEFAULT_DIR = 'assets/pet';

/**
 * 池根的历史默认值：`skin` 是 dsh-pet 时代的平铺目录，`assets/skin` 是本插件上一版的默认值。
 *
 * 为什么必须列出来：`saveUserConfig` 会把成品里的默认值原样写进用户主配置，升级后那份文件里
 * 仍写着旧路径；不做归一，用户的池会指向一个已经被改名腾空的目录（读起来就是「皮肤全没了」）。
 */
export const POOL_LEGACY_DIRS: readonly string[] = ['skin', 'assets/skin'];

/** 渲染方式在池里的子目录名。 */
export const POOL_LAYER_DIR: Readonly<Record<RendererKind, string>> = {
  layered: 'layered',
  live2d: 'live2d',
  webm: 'webm',
};

/** 音效子目录名：渲染方式兜底音效（`<池>/<渲染方式>/sound/`）与全局音效（`<池>/sound/`）共用这个名字。 */
export const POOL_SOUND_DIR = 'sound';

/**
 * 这个素材根是不是池的保留虚拟根。
 *
 * 只用于「素材根」判定（URL 段、目录前缀）；宠物 id / 条目 key 的叫法不受限制——
 * `isValidPetId('pool')` 仍然为真，被拦的是 `pet/pool-*` 这套素材目录前缀。
 *
 * @param value - 待判定的素材根。
 * @returns 是池根时返回 true。
 */
export function isReservedAssetRoot(value: string): boolean {
  return value === POOL_ASSET_ROOT;
}
