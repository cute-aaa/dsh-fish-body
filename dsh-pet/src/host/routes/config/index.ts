/**
 * 配置读取与元信息：GET /config 的合并成品、GET /config/meta 的路径清单，以及四个写端点的分发。
 *
 * 写入分居 ./save（用户层 PUT / 同步 POST）、./display（单宠显示位置）、./renderer（单宠渲染方式）、
 * ./model（单宠皮肤/模型）、./size（单宠某渲染方式的大小）、./click-through（单宠鼠标穿透）与
 * ./entry（整条目实例）：读路径零副作用，写路径要重建白名单、落盘并（除穿透外）重启 Helper，
 * 七者的失败模式与改动原因都不同。
 * 不校验配置形状（归 ../../config）；依赖由 PetRouteDeps 显式传入，模块内不读全局、不建状态。
 * @module dsh-fish-body/src/host/routes/config/index
 */
import { readAllConfig } from '../../config.ts';
import { type RouteResult } from '../../http.ts';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../../paths.ts';
import { profileNameFrom } from '../../storage-paths.ts';
import { electronRuntimeStatus } from '../../helper-process.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
import { failResult, okResult } from '../result.ts';
import { pathsOf } from '../paths.ts';
import { layoutNodes, readonlyNodes } from './meta-layout.ts';
import { saveConfigRoute } from './save.ts';
import { setPetDisplay } from './display.ts';
import { setPetRenderer } from './renderer.ts';
import { setPetModel } from './model.ts';
import { setPetSize } from './size.ts';
import { setPetClickThrough } from './click-through.ts';
import { savePetLayer } from './entry.ts';

/** 内容配置领域：未命中返回 undefined，命中返回应答。 */
export async function handleConfigRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  // 成品配置：GET 读合并成品，其余方法交给写入路径（PUT 保存 / POST 同步默认 / 其它 405）
  if (input.rest === 'config') {
    return input.method === 'GET' ? getConfig(deps) : saveConfigRoute(deps, input);
  }
  // 单只宠物的显示位置（桌面端右键「关闭桌面显示」→ POST /pet-display）
  if (input.rest === 'pet-display') return setPetDisplay(deps, input);
  // 单只宠物的渲染方式（右键「渲染方式」子菜单 → POST /pet-renderer）
  if (input.rest === 'pet-renderer') return setPetRenderer(deps, input);
  // 单只宠物的皮肤/模型（右键「模型」子菜单 → POST /pet-model）
  if (input.rest === 'pet-model') return setPetModel(deps, input);
  // 单只宠物某个渲染方式下的画框宽度（右键「大小」子菜单 → POST /pet-size）
  if (input.rest === 'pet-size') return setPetSize(deps, input);
  // 单只宠物的鼠标穿透（设置页勾选框 → POST /pet-click-through）
  if (input.rest === 'pet-click-through') return setPetClickThrough(deps, input);
  // 整个种类层的实例写回（设置页改文件宠物的配置 → POST /pet-config）
  if (input.rest === 'pet-config') return savePetLayer(deps, input);
  // 文件与目录卡：数据根、目录树、只读参考、运行时状态（设置页「系统 → 文件与目录」）
  if (input.rest === 'config/meta') return getMeta(deps);
  return undefined;
}

/** 合并成品：唯一配置入口，浏览器 / 桌面 / 设置页直接消费，无需任何校验或兜底。 */
function getConfig(deps: PetRouteDeps): RouteResult {
  try {
    // 动态配置必须杀缓存（与 /state 同口径）：消费端会「发现配置版本变化 → 重拉 /config」，
    // 这一次 GET 若命中缓存就会拿回旧配置，那套机制直接失效。
    return okResult(readAllConfig(deps.configPaths), { 'cache-control': 'no-cache, no-store' });
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
}

/**
 * 文件与目录卡的数据源：一个数据根、一棵树、一组包内只读参考、运行时状态。
 *
 * 树在服务端生成：路径字面量只存在于 `host/user-layout`，客户端只负责画 `├─`。
 * 池根每次现取（用户随时会改 `assets.pool`），所以覆盖 `paths.poolDir` 再摊平。
 */
function getMeta(deps: PetRouteDeps): RouteResult {
  const paths = pathsOf(deps);
  const pool = typeof deps.poolRoot === 'function' ? deps.poolRoot() : paths.poolDir;
  const withPool = paths.poolDir === pool ? paths : { ...paths, poolDir: pool };
  return okResult({
    // 数据根与它的树：设置页那张卡的全部内容。
    root: paths.root,
    layout: layoutNodes({ paths: withPool }),
    readonly: readonlyNodes(),
    // 运行时（Electron）：有没有装、什么版本——那一行要显示状态与「下载」按钮。
    runtime: electronRuntimeStatus(),
    // 兼容字段（老前端与只读脚本还在读）：路径本身不重复出现在新卡片里。
    user: paths.mainConfig,
    default: join(PACKAGE_ROOT, 'assets', 'config.jsonc'),
    animations: paths.animationDir,
    memes: paths.memesDir,
    pool,
    todos: paths.todos,
    logs: deps.log.file,
    // profile 名（拼卸载命令 dsh plugin --profile <名> remove dsh-fish-body；反推不出时为空串）
    profile: profileNameFrom(PACKAGE_ROOT) ?? '',
    package: PACKAGE_ROOT,
  });
}
