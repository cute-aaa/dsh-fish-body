/**
 * 人设同步装配：把内置 fish-soul 来源挂进注册表，启动同步器并在卸载时收尾。
 * @module dsh-pet/src/host/plugin/persona-sync
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { createFishSoulSource } from '../persona-source/fish-soul.ts';
import { registerPersonaSource } from '../persona-source/registry.ts';
import { createPersonaSync } from '../persona-source/sync.ts';
import type { ConfigPaths } from '../config/constants.ts';

/** 装配期需要的宿主上下文（只取 effect）。 */
export interface PersonaSyncContext {
  effect(setup: () => (() => void) | void, label: string): void;
}

/** 人设同步装配的输入。 */
export interface PersonaSyncDeps {
  configPaths: ConfigPaths;
  userConfigPath: string;
}

/** 注册内置来源并启动同步；卸载时停止监听并注销来源。 */
export function registerPersonaSync(ctx: PersonaSyncContext, deps: PersonaSyncDeps): void {
  const unregister = registerPersonaSource(createFishSoulSource(resolveDshHome()));
  const sync = createPersonaSync(deps);
  sync.start();
  // 注销来源必须随插件卸载一起做：注册表是模块级单例，漏了它插件一重载就撞 id 重复
  // （disable → enable、HMR、测试里连续 apply 都会踩到）。
  ctx.effect(
    () => () => {
      sync.stop();
      unregister();
    },
    'dsh-pet: persona sync',
  );
}
