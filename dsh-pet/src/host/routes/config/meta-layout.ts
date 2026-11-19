/**
 * 设置页「文件与目录」那张卡的树：把路径表摊成一条可渲染的扁平节点列表。
 *
 * 为什么扁平 + `depth` 而不是嵌套：渲染端只需要按 depth 画 `├─ / └─`，不需要递归组件，
 * 服务端也不用担心客户端把结构猜错——顺序即展示顺序，树形是画出来的，不是算出来的。
 *
 * 只读盘判存在性（`exists`），不建目录、不写文件。节点上不再带「能不能删」这类徽标：
 * 那句话换个场景就未必成立，界面上改由客户端按 `key` 取一句「这个目录存什么」（见 `client/settings/tree-notes`）。
 * @module dsh-fish-body/src/host/routes/config/meta-layout
 */
import { existsSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { GlobalFolderTarget } from '../../../shared/folders.ts';
import type { UserPaths } from '../../user-layout.ts';
import { PERSONA_CHARACTERS_DIR } from '../../user-layout.ts';
import { PACKAGE_MEMES_DIR, PACKAGE_ROOT, PACKAGE_SOUND_DIR } from '../../paths.ts';

/** 树里的一个节点。 */
export interface MetaNode {
  /** 稳定键：客户端按它取说明文案，不翻译也不拼接。 */
  readonly key: string;
  /** 展示用的相对路径（相对数据根；皮肤/池根在根外时给绝对路径）。 */
  readonly rel: string;
  /** 这一行自己的名字（目录名或文件名）；树形靠缩进表达层级，不必每行重复父路径。 */
  readonly name: string;
  /** 绝对路径。 */
  readonly path: string;
  /** 目录 / 文件 / 包内只读。 */
  readonly kind: 'dir' | 'file' | 'pkg';
  /** 缩进层级：0 = 数据根本身。 */
  readonly depth: number;
  /** 此刻是否存在。 */
  readonly exists: boolean;
  /** 可打开的目录类别（文件与包内只读没有）。 */
  readonly open?: GlobalFolderTarget;
}

/** 生成节点所需的输入。 */
export interface MetaLayoutInput {
  /** 数据根路径表（池根已按 `assets.pool` 解析、皮肤目录已按 `locations.skin` 解析）。 */
  readonly paths: UserPaths;
}

/**
 * 展示用的相对路径：根内的给相对路径（分隔符统一成 `/`），根外的给绝对路径。
 *
 * @param root - 数据根。
 * @param target - 目标路径。
 * @returns 展示用路径。
 */
export function displayRel(root: string, target: string): string {
  const rel = relative(root, target);
  if (rel === '') return '.';
  return rel.startsWith('..') ? target : rel.split('\\').join('/');
}

/**
 * 造整棵树。
 *
 * 文件行只放用户真正会去手动改/备份的那几个：设置三件套、记忆与待办、日志。
 * 素材文件不逐条列——那是几百个文件名，列出来只会把「目录在哪」这件事淹掉。
 *
 * @param input - 路径表。
 * @returns 扁平节点列表（顺序即展示顺序）。
 */
export function layoutNodes(input: MetaLayoutInput): MetaNode[] {
  const { paths } = input;
  const rel = (target: string): string => displayRel(paths.root, target);
  const dir = (key: string, target: string, depth: number, open?: GlobalFolderTarget): MetaNode => ({
    key,
    rel: rel(target),
    name: basename(target),
    path: target,
    kind: 'dir',
    depth,
    exists: existsSync(target),
    ...(open === undefined ? {} : { open }),
  });
  const file = (key: string, target: string, depth: number): MetaNode => ({
    key,
    rel: rel(target),
    name: basename(target),
    path: target,
    kind: 'file',
    depth,
    exists: existsSync(target),
  });

  return [
    // 根节点显示目录名（`fish-body/`），不显示 `.`：树上第一行就该是「这是哪个目录」。
    { ...dir('root', paths.root, 0, 'root'), rel: basename(paths.root) + '/' },
    dir('config', paths.configDir, 1, 'config'),
    file('config.main', paths.mainConfig, 2),
    file('config.sessionFish', paths.sessionFish, 2),
    file('config.voiceProviders', paths.voiceProviders, 2),
    dir('data', paths.dataDir, 1, 'data'),
    file('data.memory', paths.memory, 2),
    file('data.todos', paths.todos, 2),
    // 角色库：`data/persona-characters/`（一角色一个 json）；说明文案走 tree-notes 的
    // `fsDesc.data.personaCharacters`。
    dir('data.personaCharacters', join(paths.dataDir, PERSONA_CHARACTERS_DIR), 2),
    dir('cache', paths.cacheDir, 1, 'cache'),
    dir('cache.voice', paths.voiceCacheDir, 2),
    dir('cache.download', paths.downloadCacheDir, 2),
    dir('cache.desktop', paths.desktopCacheDir, 2),
    dir('runtime', paths.runtimeDir, 1, 'runtime'),
    dir('runtime.electron', paths.electronDir, 2, 'runtime'),
    // 用户皮肤（`skin/`）排在素材前面：它是用户自己的东西，素材是随包 / 共享的。
    dir('skin', paths.skinsDir, 1, 'skin-root'),
    dir('assets', paths.assetsDir, 1, 'assets'),
    dir('assets.animation', paths.animationDir, 2),
    dir('assets.sound', paths.soundDir, 2),
    dir('assets.memes', paths.memesDir, 2),
    dir('assets.pet', paths.poolDir, 2, 'pool-root'),
    dir('assets.sessionFish', paths.fishSkinDir, 2, 'fish-skin'),
    file('logs', paths.logsFile, 1),
  ];
}

/**
 * 包内只读参考：默认配置（完整示例）与随包素材。
 *
 * 单独一组而不是塞进树里：它们在插件包里，不在数据根下，混进树会让「哪个是我的、哪个别动」变糊。
 *
 * @returns 只读节点列表。
 */
export function readonlyNodes(): MetaNode[] {
  const node = (key: string, path: string, kind: 'dir' | 'file'): MetaNode => ({
    key,
    rel: path,
    name: basename(path),
    path,
    kind,
    depth: 0,
    exists: existsSync(path),
  });
  return [
    node('pkg.config', join(PACKAGE_ROOT, 'assets', 'config.jsonc'), 'file'),
    node('pkg.sound', PACKAGE_SOUND_DIR, 'dir'),
    node('pkg.memes', PACKAGE_MEMES_DIR, 'dir'),
  ];
}
