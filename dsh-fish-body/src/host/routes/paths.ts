/**
 * 路由层取「数据根路径表」的唯一入口。
 *
 * `PetRouteDeps.paths` 是可选的：装配路径（createHostSetup）总会给；但测试与独立模式里很多替身只给了
 * `userRoot`，这时按 `userPaths(userRoot)` 现算一份，语义与装配期一致（默认池根）。
 * 有了这一层，路由代码不必到处判空，也不会各自拼路径字面量。
 * @module dsh-fish-body/src/host/routes/paths
 */
import { userPaths, type UserPaths } from '../user-layout.ts';
import type { PetRouteDeps } from './types.ts';

/**
 * 取路径表：优先用装配期给的那份（池根已按 `assets.pool` 解析），否则按 `userRoot` 现算。
 *
 * @param deps - 路由依赖。
 * @returns 数据根路径表。
 */
export function pathsOf(deps: PetRouteDeps): UserPaths {
  return deps.paths ?? userPaths(deps.userRoot);
}
