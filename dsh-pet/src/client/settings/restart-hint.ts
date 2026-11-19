/**
 * 「这条改动要不要重建桌面窗口 / 重启插件才生效」的唯一判定表。
 *
 * 为什么需要它：这部分设置在网页端改完**看不出任何变化**——它们的生效路径是桌面窗口
 * （渲染实例、皮肤 / 模型、显示位置、窗口尺寸、宠物数量、托盘、锁定屏幕、宠物固定），
 * 由宿主在保存后重建桌面 Helper 才真正落地。没有提示时，用户只会以为「保存没成功」。
 *
 * 判定挂的是 `dirty.ts` 产出的**改动路径**（`pets.0.renderer` 这种快照位置），不是控件：路径来自
 * 「基线 vs 表单」的深比较，卡片以后加字段、换排版都不会让提示漏掉或错位。反过来说，任何新增的
 * 需要重建窗口的字段都必须在这里登记一条——这是本表的唯一职责，也是它值得单独成文件的原因。
 *
 * 不在表里、也刻意不提示的：三个对话开关（配图 / 动作联动）在宿主生成时现读、音效 / 语音 / 物理 /
 * 字体在网页端即时生效、快捷键保存后立刻按新键判定。给它们加「需重启」只会训练用户忽略提示。
 * owns only 判定，never 提示的渲染与重启实现。
 * @module dsh-fish-body/src/client/settings/restart-hint
 */

/**
 * 整条命中即算的路径。
 *
 * - `pets`：加 / 删宠物时 `diffSnapshot` 只报聚合路径（位置会整体错位，逐项没有意义）；
 * - 其余三项是扁平全局开关，整条路径就是它们的快照位置。
 */
const EXACT_PATHS: ReadonlySet<string> = new Set([
  'pets',
  'global.confineToScreen',
  'global.trayEnabled',
  'global.notificationsEnabled',
]);

/**
 * 逐只宠物的字段：这些都决定桌面窗口怎么建，改完要重建窗口才看得见。
 *
 * `sizes` 允许再带一层渲染方式（`pets.0.sizes.live2d`），所以尾巴用通配。
 */
const PET_FIELD = /^pets\.\d+\.(?:renderer|model|display|size|sizePercent|fixedEnabled|sizes(?:\..+)?)$/;

/**
 * 一条改动路径是否属于「需重建桌面窗口 / 重启插件」。
 *
 * @param path - `diffSnapshot` 给出的改动路径（`pets.0.renderer` / `global.trayEnabled` …）。
 * @returns 需要重启才生效时为 `true`。
 */
export function needsRestart(path: string): boolean {
  return EXACT_PATHS.has(path) || PET_FIELD.test(path);
}

/**
 * 一组改动里有多少条属于「需重启才生效」。
 *
 * @param paths - 未保存（或刚保存）的改动路径集合。
 * @returns 命中的条数；集合天然去重，同一条路径数多少次都只算一处。
 */
export function restartHintCount(paths: ReadonlySet<string>): number {
  let count = 0;
  for (const path of paths) if (needsRestart(path)) count += 1;
  return count;
}
