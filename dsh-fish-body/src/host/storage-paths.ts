/**
 * 安装形态推导：从包路径反推 profile 名（设置页拼卸载命令用）。
 *
 * 只做字符串匹配，不读盘、不算任何数据目录——数据根与缓存位置全部在 `host/user-layout` 里，
 * 删除 cache 不再需要任何「系统级缓存路径」的推导（那些目录已经搬进数据根）。
 * @module dsh-fish-body/src/host/storage-paths
 */

/**
 * 从本包路径反推 profile 名（设置页拼卸载命令用）。
 *
 * 常规安装形态是 `<$DSH_HOME>/profiles/<name>/node_modules/dsh-fish-body`；反推不出来（link: 安装到别处、
 * 或装在 profiles/node_modules 共享层）返回 undefined，由客户端退回占位符——宁可不给名字，也不猜错。
 *
 * @param packageRoot - 本包根目录。
 * @returns profile 名，或 undefined。
 */
export function profileNameFrom(packageRoot: string): string | undefined {
  const m = /[\\/]profiles[\\/]([^\\/]+)[\\/]node_modules[\\/][^\\/]+[\\/]?$/.exec(packageRoot);
  return m?.[1];
}
