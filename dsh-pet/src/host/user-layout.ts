/**
 * 用户数据根的目录布局：全插件唯一的路径表，以及初始化 / 展示用的分组清单。
 *
 * 布局刻意分成四类，删一类不影响另一类：
 * - `config/` + `data/` = 用户的东西（设置、记忆、待办），删了等于重置；
 * - `runtime/` = 需要下载的运行时（Electron），删了要重新下载；
 * - `cache/` = 唯一允许随手删的目录（语音缓存、安装包缓存、桌面窗口 profile），删了会自动重建；
 * - `pets/` + `assets/` = 素材，删了宠物还在、只是没东西可放。
 *
 * 只做路径推导与静态清单，不读盘、不建目录、不判断存在性（存在性归 routes/config/meta-layout 与 layout.ts）。
 * 必须始终成立：任何模块都不得再自己 `join(userRoot, 'main-animation')`——路径字面量只写在这一份表里，
 * 否则设置页显示的树、启动时建的目录、真正写盘的位置会三处漂移。
 * @module dsh-fish-body/src/host/user-layout
 */
import { join } from 'node:path';

/** 素材组里动画的子目录名（与 `animSubdirFor` 的返回值一致：webm / mov）。 */
const DEFAULT_ANIM_SUBDIRS: readonly string[] = ['webm', 'mov'];

/** 布局分组的稳定键：设置页的树按它取文案，初始化按它写文件夹备注。 */
export type LayoutKey =
  | 'config'
  | 'data'
  | 'cache'
  | 'runtime'
  | 'pets'
  | 'assets'
  | 'assets.animation'
  | 'assets.sound'
  | 'assets.memes'
  | 'assets.skin'
  | 'assets.sessionFish'
  | 'logs';

/**
 * 用户数据根的完整路径表。
 *
 * 全部是绝对路径；构造时只拼字符串，不碰磁盘。
 */
export interface UserPaths {
  /** 数据根（`<DSH_HOME>/fish-body`）。 */
  readonly root: string;
  /** 设置目录：主配置 / 会话鱼设置 / 语音接入。 */
  readonly configDir: string;
  /** 用户主配置（JSONC，可手改；「同步」写它的原文）。 */
  readonly mainConfig: string;
  /** 旧扩展名的主配置（`main-config.json`）：只读回落 + 启动迁移。 */
  readonly legacyMainConfig: string;
  /** 会话鱼设置（独立文件：整份重写不会碰主配置的注释）。 */
  readonly sessionFish: string;
  /** 本地语音接入配置。 */
  readonly voiceProviders: string;
  /** 数据目录：对话记忆与待办。 */
  readonly dataDir: string;
  /** 对话记忆。 */
  readonly memory: string;
  /** 待办清单。 */
  readonly todos: string;
  /** 缓存根（唯一允许随手删的目录）。 */
  readonly cacheDir: string;
  /** 语音合成缓存。 */
  readonly voiceCacheDir: string;
  /** Electron 安装包下载缓存（@electron/get 的 cacheRoot）。 */
  readonly downloadCacheDir: string;
  /** 桌面窗口的 Chromium profile（Electron 的 userData）。 */
  readonly desktopCacheDir: string;
  /** 运行时根（需要下载的东西放这里，不属于缓存）。 */
  readonly runtimeDir: string;
  /** Electron 运行时落地目录。 */
  readonly electronDir: string;
  /** 文件宠物目录（`<名>-config.json` + `<名>-animation/` 这一套）。 */
  readonly petsDir: string;
  /** 素材根。 */
  readonly assetsDir: string;
  /** 用户动画目录（main 的动画；下面按扩展名再分子目录）。 */
  readonly animationDir: string;
  /** 用户级共享音效目录（无前缀文件名对所有宠物生效）。 */
  readonly soundDir: string;
  /** 用户级表情包目录。 */
  readonly memesDir: string;
  /** 共享资源池的默认根（`assets.pool` 未配时的默认值）。 */
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
}

/**
 * 拼出数据根的完整路径表。
 *
 * @param root - 数据根（`<DSH_HOME>/fish-body`）。
 * @param options - 池根覆盖等可选参数。
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
    dataDir,
    memory: join(dataDir, 'memory.json'),
    todos: join(dataDir, 'todos.json'),
    cacheDir,
    voiceCacheDir: join(cacheDir, 'voice'),
    downloadCacheDir: join(cacheDir, 'download'),
    desktopCacheDir: join(cacheDir, 'desktop'),
    runtimeDir,
    electronDir: join(runtimeDir, 'electron'),
    petsDir: join(root, 'pets'),
    assetsDir,
    animationDir: join(assetsDir, 'animation'),
    soundDir: join(assetsDir, 'sound'),
    memesDir: join(assetsDir, 'memes'),
    poolDir: options.pool ?? join(assetsDir, 'skin'),
    fishSkinDir: join(assetsDir, 'session-fish'),
    logsFile: join(root, 'logs.txt'),
  };
}

/** 启动时要建出来的目录（浅层在前，去重）。 */
export interface LayoutDirInput {
  readonly paths: UserPaths;
  /** 动画子目录名；缺省 `webm` 与 `mov`。 */
  readonly animSubdirs?: readonly string[];
  /** 池的三个渲染方式层目录名（缺省取 `shared/pool` 的约定）。 */
  readonly poolLayerDirs?: readonly string[];
  /** 池的音效子目录名（缺省 `sound`）；渲染方式兜底音效与全局音效同用这一个名字。 */
  readonly poolSoundDir?: string;
}

/**
 * 启动时要建出来的全部目录（不含文件）。
 *
 * 顺序是「浅层在前」：根 → 六个分组 → 各自的约定子目录。只列目录，不列文件——
 * 空文件会参与读取分支，空目录不会（池对空目录与不存在同义）。
 *
 * @param input - 路径表与可选子目录名。
 * @returns 目录绝对路径，去重后按创建顺序排列。
 */
export function layoutDirs(input: LayoutDirInput): string[] {
  const { paths } = input;
  const animSubdirs = input.animSubdirs ?? DEFAULT_ANIM_SUBDIRS;
  const poolLayers = input.poolLayerDirs ?? [];
  const poolSound = input.poolSoundDir ?? 'sound';
  const out: string[] = [
    paths.root,
    paths.configDir,
    paths.dataDir,
    paths.cacheDir,
    paths.voiceCacheDir,
    paths.downloadCacheDir,
    paths.desktopCacheDir,
    paths.runtimeDir,
    paths.electronDir,
    paths.petsDir,
    paths.assetsDir,
    paths.animationDir,
    ...animSubdirs.map((sub) => join(paths.animationDir, sub)),
    paths.soundDir,
    paths.memesDir,
    paths.fishSkinDir,
    paths.poolDir,
    ...poolLayers.map((layer) => join(paths.poolDir, layer)),
    ...poolLayers.map((layer) => join(paths.poolDir, layer, poolSound)),
    join(paths.poolDir, poolSound),
  ];
  return [...new Set(out)];
}

/** 文件夹备注（写进 Windows `desktop.ini` 的 `InfoTip`）：一段话说明这个目录是干什么的、能不能删。 */
export type LayoutNotes = Readonly<Record<LayoutKey, string>>;

/**
 * 目录 → 一句话说明。
 *
 * 宿主侧只维护中文：它是**磁盘上的备注**，跟着目录走，不跟界面语言走——为了这句备注在 8 种界面语言里
 * 各写一份、再在 Explorer 里按语言切换，维护成本远大于收益。界面里的树用客户端字典（同一套键名）。
 */
export const LAYOUT_NOTES: LayoutNotes = {
  config: '设置：主配置 / 会话鱼 / 语音接入。删掉会丢设置。',
  data: '对话记忆与待办。删掉会丢聊天记录和待办。',
  cache: '可随意删除：语音缓存、安装包缓存、桌面窗口缓存。删了会自动重建或重下，不影响设置。',
  runtime: '运行时（Electron 桌面窗口用）。不属于缓存：删掉 cache 不会影响它，删它要重新下载。',
  pets: '文件宠物：每种一套 <名>-config.json + <名>-animation/ + <名>-sound/ + <名>-memes/。',
  assets: '素材：动画、音效、表情、皮肤池、会话鱼皮肤。所有宠物共用。',
  'assets.animation': 'main 宠物的动画（webm / mov）；文件名就是动作名。',
  'assets.sound': '用户级音效：click.wav 这类无前缀文件对所有宠物生效。',
  'assets.memes': '用户级表情包图片；加图不必改包。',
  'assets.skin': '共享皮肤池（layered / live2d / webm / sound）；所有宠物共用一份。',
  'assets.sessionFish': '会话鱼皮肤：图片 / 动图 / 视频放进来，设置页点「重新扫描」即可选中。',
  logs: '运行日志（1 MB 上限，写满只留最新 512 KB）；反馈问题时附上它。',
};

/** 数据根自己的备注：一眼看出这个目录归谁、里面有什么。 */
export const ROOT_NOTE =
  'dsh-fish-body 数据根：config（设置）/ data（记忆待办）/ runtime（Electron）/ cache（可随手删）/ pets / assets 全在这里。';

/**
 * 目录 → 备注文案（初始化目录时逐个写进 `desktop.ini`）。
 *
 * 池根可能被 `assets.pool` 指到数据根之外：仍然写备注——它是插件逻辑上拥有的目录，
 * 用户从设置页点「打开」看到的就是它。
 *
 * @param paths - 路径表。
 * @returns 目录绝对路径到说明的映射（顺序无关）。
 */
export function layoutNotes(paths: UserPaths): ReadonlyMap<string, string> {
  return new Map<string, string>([
    [paths.root, ROOT_NOTE],
    [paths.configDir, LAYOUT_NOTES.config],
    [paths.dataDir, LAYOUT_NOTES.data],
    [paths.cacheDir, LAYOUT_NOTES.cache],
    [paths.voiceCacheDir, '语音合成缓存：删了下次说话重新合成，不影响设置。'],
    [paths.downloadCacheDir, 'Electron 安装包下载缓存：删了下次需要下载运行时再下一遍。'],
    [paths.desktopCacheDir, '桌面窗口的 Chromium profile：删了窗口状态（位置/缩放）与会话鱼位置重置。'],
    [paths.runtimeDir, LAYOUT_NOTES.runtime],
    [paths.electronDir, 'Electron 运行时（约 350 MB）：删了桌面模式要重新下载；删除 cache/ 不影响这里。'],
    [paths.petsDir, LAYOUT_NOTES.pets],
    [paths.assetsDir, LAYOUT_NOTES.assets],
    [paths.animationDir, LAYOUT_NOTES['assets.animation']],
    [paths.soundDir, LAYOUT_NOTES['assets.sound']],
    [paths.memesDir, LAYOUT_NOTES['assets.memes']],
    [paths.poolDir, LAYOUT_NOTES['assets.skin']],
    [paths.fishSkinDir, LAYOUT_NOTES['assets.sessionFish']],
  ]);
}
