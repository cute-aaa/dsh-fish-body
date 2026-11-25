/**
 * 人设来源装配：把六个来源挂进注册表，卸载时全部反注册。
 *
 * 来源只是「去哪里找卡片」：`fish-soul` / `dsh-soul` / `dsh-rofm` / `dsh-suzu-memory` 用同一份卡片工厂，
 * `custom` 只吃 `POST /persona/scan` 的 `path` 参数（不读宠物配置），`editor` 表示「不用角色、正文自己写」。
 * 2026-11-19 口径变更：来源绑定 + watcher 的旧同步机制整体退场，这里不再建 watcher。
 * @module dsh-fish-body/src/host/plugin/persona-sync
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { createCardFileSource } from '../persona-source/card-file.ts';
import { createCoopanionSource } from '../persona-source/coopanion-source.ts';
import { createSurfcoreSource } from '../persona-source/surfcore-source.ts';
import { resolveCardPathInput } from '../persona-source/path-guard.ts';
import { BUILTIN_PERSONA_SOURCE_ID, type PersonaSource } from '../persona-source/types.ts';
import { registerPersonaSource } from '../persona-source/registry.ts';

/** 装配期需要的宿主上下文（只取 effect）。 */
export interface PersonaSyncContext {
  effect(setup: () => (() => void) | void, label: string): void;
}

/**
 * 随包内置的 soul 项目：id → 约定目录名与展示名。
 *
 * **只留真正产人格的两个**：
 * - `fish-soul` —— 单卡 `persona.json`（SillyTavern v2）
 * - `dsh-soul` —— `SOUL.md` / `IDENTITY.md` / `AGENTS.md` 那族 Markdown（含 `dsh-soul-md` 的单文件写法）
 *
 * `dsh-rofm` 与 `dsh-suzu-memory` **不再注册成人格来源**：它们是记忆插件（前者把上下文归档到 `memory/`，
 * 后者管会话记忆与压缩设置），本就不产人设——注册成人格源只会让用户在设置页看到一个永远 0 角色的来源，
 * 分不清是「没装」还是「不支持」。它们改挂记忆通道（见 `plugin/external-memory.ts`）。
 */
const SOUL_PROJECTS: readonly { id: string; name: string }[] = [
  { id: BUILTIN_PERSONA_SOURCE_ID, name: 'dsh-fish-soul' },
  { id: 'dsh-soul', name: 'dsh-soul' },
];

/**
 * 自定义路径来源：没有约定目录，只认 `options.path`。
 *
 * 用同一个卡片工厂实现扫描（文件 = 1 个角色，目录 = 按约定规则扫一层），
 * 但 `probe` 必须自己写：工厂的缺省目录对它是无意义的。
 *
 * @param dshHome - DSH 数据根（只用来给工厂一个永远不用的占位目录）。
 * @returns 只在显式路径下可用的来源。
 */
function createCustomSource(dshHome: string, allowedRoots: readonly string[]): PersonaSource {
  const scanner = createCardFileSource({
    id: 'custom',
    name: '自定义路径',
    dir: join(dshHome, 'custom-persona'),
    kind: 'custom',
  });
  return {
    id: 'custom',
    name: '自定义路径',
    kind: 'custom',
    probe: async (options) => {
      const explicit = (options?.path ?? '').trim();
      if (explicit === '') return { installed: false, path: '' };
      // 与 service.scan 同一份闸门：相对路径 / 根外路径一律当「不可用」，绝不按 cwd 去读。
      const guard = resolveCardPathInput(explicit, allowedRoots);
      return guard.ok ? { installed: true, path: guard.path } : { installed: false, path: '' };
    },
    scan: (options) => scanner.scan?.(options) ?? Promise.resolve({ characters: [], skipped: [] }),
    resolve: () => scanner.resolve(),
  };
}

/**
 * 内置人设编辑：不是「一个来源」，而是「不使用任何角色」。
 *
 * 没有 `scan`，因此不进扫描下拉；恒可用，对 UI 的意义是把角色卡的「已应用角色」清空。
 */
const EDITOR_SOURCE: PersonaSource = {
  id: 'editor',
  name: '内置人设编辑',
  kind: 'editor',
  syncable: false,
  probe: async () => ({ installed: true, path: '' }),
  resolve: async () => ({ ok: false, reason: 'not-found' }),
};

/** 注册全部来源；卸载时反注册（注册表是模块级单例，漏了它插件一重载就撞 id 重复）。 */
export function registerPersonaSync(ctx: PersonaSyncContext, allowedRoots: readonly string[] = []): void {
  const dshHome = resolveDshHome();
  const home = homedir();
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const disposers = [
    ...SOUL_PROJECTS.map((project) =>
      registerPersonaSource(
        createCardFileSource({ id: project.id, name: project.name, dir: join(dshHome, project.id) }),
      ),
    ),
    // 主流外部项目：各自读自己的真实布局，不塞进通用目录约定里——
    // surfcore 的角色目录带 `character.json` 自述路径，Coopanion 的工作区由 Electron 运行时决定。
    registerPersonaSource(createSurfcoreSource({ dshHome })),
    registerPersonaSource(createCoopanionSource({ dshHome, home, appData })),
    registerPersonaSource(createCustomSource(dshHome, allowedRoots)),
    registerPersonaSource(EDITOR_SOURCE),
  ];
  ctx.effect(
    () => () => {
      for (const dispose of disposers) dispose();
    },
    'fish-body: persona sources',
  );
}
