/**
 * 用户数据根的目录布局：全插件唯一的路径表，以及初始化 / 展示用的分组清单。
 *
 * 布局分成四类，各自的存在理由不同：
 * - `config/` + `data/` = 用户的东西（设置、记忆、待办）；
 * - `runtime/` = 运行时（Electron），跟缓存分开存放；
 * - `cache/` = 缓存（语音合成结果、安装包、桌面窗口 profile），内容随时可以重新生成；
 * - `skin/` + `assets/` = 素材：`skin/` 是用户自己的皮肤（每种一套 `<名>-*` 文件与目录），
 *   `assets/` 是随包 / 共享的素材，其中 `assets/pet/` 是内置皮肤池。
 *
 * 只做路径推导与静态清单，不读盘、不建目录、不判断存在性（存在性归 routes/config/meta-layout 与 layout.ts）。
 * 必须始终成立：任何模块都不得再自己 `join(userRoot, 'main-animation')`——路径字面量只写在这一份表里，
 * 否则设置页显示的树、启动时建的目录、真正写盘的位置会三处漂移。
 * @module dsh-fish-body/src/host/user-layout
 */
import { join } from 'node:path';

import { POOL_SOUND_DIR } from '../shared/pool.ts';

/** 素材组里动画的子目录名（与 `animSubdirFor` 的返回值一致：webm / mov）。 */
const DEFAULT_ANIM_SUBDIRS: readonly string[] = ['webm', 'mov'];

/** 角色库目录名（`<数据根>/data/persona-characters`，一角色一个 `<id>.json`）。 */
export const PERSONA_CHARACTERS_DIR = 'persona-characters';

/** 布局分组的稳定键：设置页的树按它取文案，初始化按它写文件夹备注。 */
export type LayoutKey =
  | 'config'
  | 'data'
  | 'cache'
  | 'runtime'
  | 'skin'
  | 'assets'
  | 'assets.animation'
  | 'assets.sound'
  | 'assets.memes'
  | 'assets.pet'
  | 'assets.sessionFish'
  | 'logs';

/**
 * 用户数据根的完整路径表。
 *
 * 全部是绝对路径；构造时只拼字符串，不碰磁盘。
 */
export interface UserPaths {
  /** 数据根（默认 `<DSH_HOME>/fish-body`，可用指针文件或环境变量指向别处）。 */
  readonly root: string;
  /** 设置目录：主配置 / 会话鱼设置 / 语音接入 / 位置指针。 */
  readonly configDir: string;
  /** 用户主配置（JSONC，可手改；「同步」写它的原文）。 */
  readonly mainConfig: string;
  /** 旧扩展名的主配置（`main-config.json`）：只读回落 + 启动迁移。 */
  readonly legacyMainConfig: string;
  /** 会话鱼设置（独立文件：整份重写不会碰主配置的注释）。 */
  readonly sessionFish: string;
  /** 本地语音接入配置。 */
  readonly voiceProviders: string;
  /** 外部 persona / memory 接入配置。 */
  readonly integrations: string;
  /** 位置指针（皮肤目录 / 运行时目录可改到数据根之外，记在这里）。 */
  readonly locations: string;
  /** 数据目录：对话记忆与待办。 */
  readonly dataDir: string;
  /** 对话记忆。 */
  readonly memory: string;
  /** 待办清单。 */
  readonly todos: string;
  /** 缓存根（语音合成结果 / 安装包 / 桌面窗口 profile 都在这下面）。 */
  readonly cacheDir: string;
  /** 语音合成缓存。 */
  readonly voiceCacheDir: string;
  /** Electron 安装包下载缓存（@electron/get 的 cacheRoot）。 */
  readonly downloadCacheDir: string;
  /** 桌面窗口的 Chromium profile（Electron 的 userData）。 */
  readonly desktopCacheDir: string;
  /** 运行时根。 */
  readonly runtimeDir: string;
  /** Electron 运行时默认落地目录（`locations.runtime` 可把它指到别处）。 */
  readonly electronDir: string;
  /** 用户皮肤目录（`<名>-config.json` + `<名>-animation/` 这一套）；`locations.skin` 可改位置。 */
  readonly skinsDir: string;
  /** 素材根。 */
  readonly assetsDir: string;
  /** 用户动画目录（main 的动画；下面按扩展名再分子目录）。 */
  readonly animationDir: string;
  /** 用户级共享音效目录（无前缀文件名对所有宠物生效）。 */
  readonly soundDir: string;
  /** 用户级表情包目录。 */
  readonly memesDir: string;
  /** 内置皮肤池的默认根（`assets.pool` 未配时的默认值）。 */
  readonly poolDir: string;
  /** 会话鱼皮肤目录。 */
  readonly fishSkinDir: string;
  /** 统一日志文件。 */
  readonly logsFile: string;
}

/** 构造路径表的选项。 */
export interface UserLayoutOptions {
  /** `assets.pool` 的解析结果（绝对路径）；缺省用 {@link UserPaths.poolDir}。 */
  readonly pool?: string;
  /** 用户皮肤目录的解析结果（`locations.skin`，绝对路径）；缺省 `<根>/skin`。 */
  readonly skin?: string;
}

/**
 * 拼出数据根的完整路径表。
 *
 * @param root - 数据根（默认 `<DSH_HOME>/fish-body`）。
 * @param options - 池根 / 皮肤目录覆盖等可选参数。
 * @returns 路径表；所有字段都是绝对路径。
 */
export function userPaths(root: string, options: UserLayoutOptions = {}): UserPaths {
  const configDir = join(root, 'config');
  const dataDir = join(root, 'data');
  const cacheDir = join(root, 'cache');
  const runtimeDir = join(root, 'runtime');
  const assetsDir = join(root, 'assets');
  return {
    root,
    configDir,
    mainConfig: join(configDir, 'main-config.jsonc'),
    legacyMainConfig: join(configDir, 'main-config.json'),
    sessionFish: join(configDir, 'session-fish.json'),
    voiceProviders: join(configDir, 'voice-providers.json'),
    integrations: join(configDir, 'integrations.json'),
    locations: join(configDir, 'locations.json'),
    dataDir,
    memory: join(dataDir, 'memory.json'),
    todos: join(dataDir, 'todos.json'),
    cacheDir,
    voiceCacheDir: join(cacheDir, 'voice'),
    downloadCacheDir: join(cacheDir, 'download'),
    desktopCacheDir: join(cacheDir, 'desktop'),
    runtimeDir,
    electronDir: join(runtimeDir, 'electron'),
    skinsDir: options.skin ?? join(root, 'skin'),
    assetsDir,
    animationDir: join(assetsDir, 'animation'),
    soundDir: join(assetsDir, 'sound'),
    memesDir: join(assetsDir, 'memes'),
    poolDir: options.pool ?? join(assetsDir, 'pet'),
    fishSkinDir: join(assetsDir, 'session-fish'),
    logsFile: join(root, 'logs.txt'),
  };
}

/** 启动时要建出来的目录（浅层在前，去重）。 */
export interface LayoutDirInput {
  readonly paths: UserPaths;
  /** 动画子目录名；缺省 `webm` 与 `mov`。 */
  readonly animSubdirs?: readonly string[];
  /** 用户皮肤目录下的渲染方式子目录名（缺省取 `shared/pool` 的约定）。 */
  readonly skinLayerDirs?: readonly string[];
  /** 用户皮肤目录下的音效子目录名（缺省 `sound`）。 */
  readonly skinSoundDir?: string;
}

/**
 * 启动时要建出来的全部目录（不含文件）。
 *
 * 顺序是「浅层在前」：根 → 六个分组 → 各自的约定子目录。只列目录，不列文件——
 * 空文件会参与读取分支，空目录不会（池对空目录与不存在同义）。
 *
 * **只有 `skin/`（用户皮肤，按渲染方式分类）建这三类子目录**：内置池根（`assets/pet/`）是
 * 扁平存放的（一套皮肤一个子目录 / 平铺 `.webm`），里头的 `layered/`、`live2d/`、`webm/`、`sound/`
 * 一概不建——建出来等于替用户决定「内置皮肤也得按渲染方式分类」，还会把这个根判定成池布局，
 * 反过来让真正扁平放进去的皮肤扫不到（见 host/pool/roots 的 layoutOf）。
 *
 * @param input - 路径表与可选子目录名。
 * @returns 目录绝对路径，去重后按创建顺序排列。
 */
export function layoutDirs(input: LayoutDirInput): string[] {
  const { paths } = input;
  const animSubdirs = input.animSubdirs ?? DEFAULT_ANIM_SUBDIRS;
  const skinLayers = input.skinLayerDirs ?? [];
  const skinSound = input.skinSoundDir ?? POOL_SOUND_DIR;
  const out: string[] = [
    paths.root,
    paths.configDir,
    paths.dataDir,
    join(paths.dataDir, PERSONA_CHARACTERS_DIR),
    paths.cacheDir,
    paths.voiceCacheDir,
    paths.downloadCacheDir,
    paths.desktopCacheDir,
    paths.runtimeDir,
    paths.electronDir,
    paths.skinsDir,
    // 用户皮肤按渲染方式分三类目录：放进去就能在设置页选到（内置池是回落，见 poolRoots）。
    ...skinLayers.map((layer) => join(paths.skinsDir, layer)),
    // 皮肤自带的音效（`<名>-sound/` 之外的共享一层）：与渲染方式目录同级。
    join(paths.skinsDir, skinSound),
    paths.assetsDir,
    paths.animationDir,
    ...animSubdirs.map((sub) => join(paths.animationDir, sub)),
    paths.soundDir,
    paths.memesDir,
    paths.fishSkinDir,
    paths.poolDir,
  ];
  return [...new Set(out)];
}

/**
 * 文件夹备注（写进 Windows `desktop.ini` 的 `InfoTip`）：一段话说明这个目录是干什么的。
 *
 * 措辞刻意只描述**存了什么**，不写「可以删 / 删了没影响」：那类判断换个场景就不成立
 * （语音缓存在断网时可复用，安装包缓存在镜像抽风时能救急），用户自己看着办比断言更诚实。
 */
export type LayoutNotes = Readonly<Record<LayoutKey, string>>;

/** 目录 → 一句话说明（宿主侧只有中文：它是磁盘上的备注，跟着目录走，不跟界面语言走）。 */
export const LAYOUT_NOTES: LayoutNotes = {
  config: '设置：主配置 / 会话鱼 / 语音接入。',
  data: '对话记忆与待办。',
  cache: '缓存：语音合成结果、Electron 安装包、桌面窗口 profile。',
  runtime: '运行时：Electron 桌面窗口用。',
  skin: '用户皮肤：每种一套 <名>-config.json + <名>-animation/ + <名>-sound/ + <名>-memes/；子目录按渲染方式分（layered / live2d / webm / sound）。',
  assets: '素材：动画、音效、表情、内置皮肤、会话鱼皮肤。所有宠物共用。',
  'assets.animation': 'main 宠物的动画（webm / mov）；文件名就是动作名。',
  'assets.sound': '用户级音效：click.wav 这类无前缀文件对所有宠物生效。',
  'assets.memes': '用户级表情包图片；加图不必改包。',
  'assets.pet':
    '内置皮肤（扁平存放）：一套皮肤一个子目录（manifest.json / *.model3.json），平铺的 .webm 也认；同名时优先用 skin/ 里的。',
  'assets.sessionFish': '会话鱼皮肤：图片 / 动图 / 视频放进来，设置页点「重新扫描」即可选中。',
  logs: '运行日志（1 MB 上限，写满只留最新 512 KB）；反馈问题时附上它。',
};

/** 数据根自己的备注：一眼看出这个目录归谁、里面有什么。 */
export const ROOT_NOTE =
  'dsh-fish-body 数据根：config（设置）/ data（记忆待办）/ cache（缓存）/ runtime（Electron）/ skin（用户皮肤）/ assets（素材与内置皮肤）。';

/**
 * 目录 → 备注文案（初始化目录时逐个写进 `desktop.ini`）。
 *
 * 皮肤目录与池根都可能被指到数据根之外：仍然写备注——它们是插件逻辑上拥有的目录，
 * 用户从设置页点「打开」看到的就是它们。
 *
 * @param paths - 路径表。
 * @returns 目录绝对路径到说明的映射（顺序无关）。
 */
export function layoutNotes(paths: UserPaths): ReadonlyMap<string, string> {
  return new Map<string, string>([
    [paths.root, ROOT_NOTE],
    [paths.configDir, LAYOUT_NOTES.config],
    [paths.dataDir, LAYOUT_NOTES.data],
    [join(paths.dataDir, PERSONA_CHARACTERS_DIR), '人设角色库：一个角色一个 <id>.json，可直接拷走或整目录删除。'],
    [paths.cacheDir, LAYOUT_NOTES.cache],
    [paths.voiceCacheDir, '语音合成缓存：文本对应的音频文件。'],
    [paths.downloadCacheDir, 'Electron 安装包下载缓存：已下好的 zip 与校验文件。'],
    [paths.desktopCacheDir, '桌面窗口的 Chromium profile：窗口位置/缩放与会话鱼位置。'],
    [paths.runtimeDir, LAYOUT_NOTES.runtime],
    [paths.electronDir, 'Electron 运行时（约 350 MB）：桌面窗口的可执行文件。'],
    [paths.skinsDir, LAYOUT_NOTES.skin],
    [paths.assetsDir, LAYOUT_NOTES.assets],
    [paths.animationDir, LAYOUT_NOTES['assets.animation']],
    [paths.soundDir, LAYOUT_NOTES['assets.sound']],
    [paths.memesDir, LAYOUT_NOTES['assets.memes']],
    [paths.poolDir, LAYOUT_NOTES['assets.pet']],
    [paths.fishSkinDir, LAYOUT_NOTES['assets.sessionFish']],
  ]);
}
