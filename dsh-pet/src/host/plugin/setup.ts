/**
 * 宿主环境装配：日志出口、用户目录、配置路径与进程内 store。
 *
 * 只创建对象、算路径、注册可选服务，不启动任何循环，也不碰网络；
 * 需要 ctx 的两处（日志收尾 effect、petApi7340 服务）一并在这里注册。
 * 必须始终成立：日志只创建一次——复用到 standalone 挂上的 logger 时不得再建第二个。
 * @module dsh-fish-body/src/host/plugin/setup
 */
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { listBalanceProviders, registerBalanceProvider } from '../balance/index.ts';
import { listVoiceProviders, registerVoiceProvider } from '../voice/registry.ts';
import { listSpeechProviders, registerSpeechProvider } from '../voice/speech-registry.ts';
import { listChatMemoryProviders, registerChatMemoryProvider } from '../chat-memory-provider.ts';
import { listPersonaSources, registerPersonaSource } from '../persona-source/registry.ts';
import { migrateUserConfig, readAllConfig, type ConfigPaths } from '../config.ts';
import { ensureUserLayout } from '../layout.ts';
import { createFileLogger, isFileLogger, setDefaultLogger, type FileLogger, type LoggerLike } from '../log-file.ts';
import { MenuRegistry } from '../menu.ts';
import { animSubdirFor, PACKAGE_MEMES_DIR, PACKAGE_ROOT, PACKAGE_SOUND_DIR } from '../paths.ts';
import { migrateElectronRuntime, migrateLayout } from '../migrate-layout.ts';
import { setRuntimeDir, setUserRoot } from '../helper-process.ts';
import { readLocations, resolveSkinDir } from '../locations.ts';
import { userPaths, type UserPaths } from '../user-layout.ts';
import { resolveUserRoot, type RootLog } from '../user-root.ts';
import { POOL_LAYER_DIR, POOL_SOUND_DIR, isReservedAssetRoot } from '../../shared/pool.ts';
import {
  poolEntryDir,
  poolGlobalSoundDir,
  poolLayerDir,
  poolRendererSoundDir,
  resolvePoolRoot,
} from '../pool/resolve.ts';
import { poolStructureBaseOf } from '../pool/scan.ts';
import type { RendererKind } from '../../shared/types.ts';
import type { SfxDirs } from '../sfx/scan.ts';
import { PlaybackStore } from '../playback.ts';
import { resolveAsset } from '../http.ts';
import { PollStateStore } from '../state.ts';
import { WorkStatusStore } from '../work-status.ts';
import { SessionFishStore } from '../session-fish/store.ts';
import { fishSkinDirs, type FishSkinDirs } from '../session-fish/skins.ts';
import { SessionFishSettingsStore, sessionFishSettingsPath } from '../session-fish/settings.ts';
import type { StandaloneWhisperPolicy } from '../whisper-policy.ts';

/** 装配期需要的宿主上下文：只有 logger / effect / provide 三处能力。 */
export interface HostSetupContext {
  /** 宿主日志（可能已被 standalone 换成文件 logger）。 */
  readonly logger?: LoggerLike;
  /** 注册随插件卸载自动清理的副作用。 */
  effect(setup: () => (() => void) | void, label: string): void;
  /** 对外提供 Cordis 服务。 */
  provide(name: string, value: unknown): void;
}

/** 独立模式余额查询要用的服务商与密钥（由 standalone 的 standaloneAi 服务提供）。 */
export interface StandaloneBalanceAuth {
  /** 设置页选中的余额服务商 id；空串表示未选择。 */
  provider: string;
  /** 设置页保存的密钥；空串表示未保存。 */
  apiKey: string;
}

/** 装配产物：apply 后续逻辑与路由层共用的对象。 */
export interface HostSetup {
  /** $DSH_HOME：数据根指针文件写在这里（位置可改的后端）。 */
  readonly dshHome: string;
  /** 数据根是怎么选出来的：默认位置 / 指针文件 / 环境变量（设置页据此说明）。 */
  readonly rootSource: 'default' | 'pointer' | 'env';
  /** 本插件的数据根（配置与用户素材都收敛于此） */
  readonly userRoot: string;
  /** 数据根的完整路径表（唯一真源：任何模块都不得再自己拼路径字面量）。 */
  readonly paths: UserPaths;
  /** 插件日志出口（文件 + 终端） */
  readonly log: FileLogger;
  /** 配置路径集 */
  readonly configPaths: ConfigPaths;
  /** 用户主配置路径 */
  readonly userConfigPath: string;
  /** 文件宠物目录 */
  readonly petConfigDir: string;
  /** 用户动画目录 */
  readonly thumbUserRoot: string;
  /** 用户表情包目录 */
  readonly memesUserRoot: string;
  /** 表情包目录链 */
  readonly memeDirsFor: (assetRoot: string) => string[];
  /** 音效搜索目录（池三层 / 皮肤根 / -sound / 用户共享 / 动画同目录 / 包内默认），见 host/sfx/scan。 */
  readonly soundDirsFor: (
    assetRoot: string,
    ext: string,
    opts?: { renderer?: RendererKind; model?: string },
  ) => SfxDirs;
  /** 用户级共享音效目录（`<数据根>/assets/sound`）。 */
  readonly soundUserRoot: string;
  /** 共享资源池的根（`assets.pool`，默认 `<用户根>/skin`）；每次调用现读配置。 */
  readonly poolRoot: () => string;
  /** 会话鱼的皮肤池目录（用户目录 + 包内动画）。 */
  readonly fishSkinDirs: () => FishSkinDirs;
  /** 软取宿主可选服务 */
  readonly optionalService: (name: string) => unknown;
  /** 独立模式的碎碎念授权策略 */
  readonly standaloneAiPolicy: () => StandaloneWhisperPolicy | undefined;
  /** 独立模式的余额凭证；DSH 宿主里是 undefined → 余额走 currentSelection 与 credential store。 */
  readonly standaloneAiBalance: () => StandaloneBalanceAuth | undefined;
  /** 轮询快照 */
  readonly state: PollStateStore;
  /** 第三方菜单注册表 */
  readonly menuRegistry: MenuRegistry;
  /** 播放记录表 */
  readonly playback: PlaybackStore;
  /** 工作状态快照 */
  readonly workStatus: WorkStatusStore;
  /** 会话鱼状态机 */
  readonly sessionFish: SessionFishStore;
  /** 会话鱼设置（独立 session-fish.json） */
  readonly sessionFishSettings: SessionFishSettingsStore;
  /** 外部写入的固定会话 id */
  readonly EXTERNAL_WORK_SESSION: string;
  /** 推进外部写入序号 */
  readonly nextExternalWorkSeq: () => number;
}

/**
 * 创建宿主运行期对象。
 * @param ctx - 宿主上下文（apply 收到的那一个）。
 * @returns 日志、路径、store 与两个工具函数。
 */
export function createHostSetup(ctx: HostSetupContext): HostSetup {
  // 数据根：先换名（`dsh-pet` → `fish-body`）再做内层布局迁移。两件事都必须在建日志之前算完——
  // 日志文件本身也在数据根里。期间的提示先攒进 startNotes，logger 建好后再一次性写出去。
  const dshHome = resolveDshHome();
  const startNotes: string[] = [];
  const noteSink: RootLog = { info: (m) => startNotes.push(m), warn: (m) => startNotes.push(m) };
  const rootResult = resolveUserRoot({ dshHome, log: noteSink });
  const userRoot = rootResult.root;
  // 运行时 / 下载缓存 / 桌面 profile 都跟着这个根走：选根回落到旧根时它们也必须留在同一个根里。
  setUserRoot(userRoot);

  // 内层布局：把继承自 dsh-pet 的平铺目录搬进 config/ data/ cache/ runtime/ pets/ assets/。
  // 幂等——第二次启动什么都不做；任何一条搬不动都只告警，源目录原样留着。
  // `legacyRoot` 是给「两个根并存」准备的：桌面 Helper 可能先把新根建出来（它要 cache/desktop），
  // 这时数据仍在旧根里，得按同一张表搬进来，不能只认新根。
  const migration = migrateLayout({ root: userRoot, legacyRoot: rootResult.legacyRoot, log: noteSink });
  const runtimeMove = migrateElectronRuntime({ dshHome, root: userRoot, log: noteSink });

  // 位置指针：皮肤目录与运行时目录可以指到数据根之外（`config/locations.json`）。
  // 必须在算路径表之前读——皮肤目录是配置扫描的输入，晚一步就会读错目录。
  const locations = readLocations(userRoot);
  setRuntimeDir(locations.runtime);

  // 路径表：池根要等配置读出来才知道（`assets.pool`），先用默认值算一份给 logger 用。
  const pathsForLog = userPaths(userRoot, { skin: resolveSkinDir(userRoot, locations) });

  // 统一日志出口（单文件、按大小截断，见 ./log-file）：桌面版 DSH 没有控制台，ctx.logger 只写
  // stdout 等于把排障信息丢掉；base 保留终端输出。
  // standalone 已把自己的文件 logger 挂在 ctx.logger 上时必须复用，否则两个 logger 各自的缓冲
  // 与截断会写同一个文件、互相踩。
  const reusedLog = isFileLogger(ctx.logger) ? ctx.logger : undefined;

  const log =
    reusedLog ??
    createFileLogger({
      file: pathsForLog.logsFile,
      base: ctx.logger,
      debugEnabled: process.env.DSH_PET_LOG_DEBUG === '1',
    });

  // 纯模块（./config、./chat、./whisper）拿不到 ctx.logger，用这个默认出口落盘
  setDefaultLogger(log);

  // 换名 / 迁移期间攒下的提示，现在才有地方写。
  for (const note of startNotes) log.info(note);
  if (migration.failed.length > 0) {
    log.warn(
      `[fish-body] 布局迁移有 ${migration.failed.length} 项失败，源目录保持原样：${migration.failed.map((f) => f.move.from).join('、')}`,
    );
  }
  if (runtimeMove === 'failed') log.warn('[fish-body] Electron 运行时仍在旧位置，桌面模式照常可用');

  // 只在自己创建时负责收尾：复用的 logger 归 standalone/app 生命周期管，插件卸载不该把它关掉。
  if (!reusedLog) {
    ctx.effect(
      () => () => {
        void log.flush();
        log.dispose();
      },
      'fish-body: log file',
    );
  }

  /**
   * 软取宿主提供的可选服务（DSH 的 `ctx.get(name, required)` 语义：缺失返回 undefined，不抛）。
   *
   * 不能直接读 `ctx.xxx`：DSH 的 ctx 是严格 getter，读未写进 inject 的服务会抛异常而非返回 undefined
   * ——独立模式独有的 standaloneAi / shutdownApp 都没进 inject，裸读会让碎碎念 tick 每拍抛错、
   * /quit 回 500 而不是 {canQuit:false}。测试里的 fake ctx 没有 get，回落成属性读取即可。
   */
  const optionalService = (name: string): unknown => {
    const get = (ctx as { get?: (n: string, required?: boolean) => unknown }).get;
    if (typeof get === 'function') return get.call(ctx, name, false);
    return (ctx as unknown as Record<string, unknown>)[name];
  };

  /** 独立模式的碎碎念授权策略（可选能力）：DSH 宿主里是 undefined → 回落到只看 pet.whisperEnabled。 */
  const standaloneAiPolicy = (): StandaloneWhisperPolicy | undefined =>
    optionalService('standaloneAi') as StandaloneWhisperPolicy | undefined;

  /** 独立模式的余额凭证（可选能力）：DSH 宿主里是 undefined → 回落到模型服务商与 credential store。 */
  const standaloneAiBalance = (): StandaloneBalanceAuth | undefined => {
    const service = optionalService('standaloneAi') as { balanceAuth?: () => StandaloneBalanceAuth } | undefined;
    return service?.balanceAuth?.();
  };

  // 用户主配置（可编辑层）与文件宠物目录；配置读取/合并统一走 readAllConfig（./config）。
  // 主配置是 JSONC（main-config.jsonc）——与包内默认 config.jsonc 同名同格式：
  // 「同步」写进去的就是带注释的原文，扩展名如实反映内容（main-config.json 只读回落 + 启动迁移）
  const userConfigPath = pathsForLog.mainConfig;

  const legacyUserConfigPath = pathsForLog.legacyMainConfig;

  const petConfigDir = pathsForLog.skinsDir;

  // 配置路径集（readAllConfig 的唯一输入：内置默认 + 用户主配置 + 文件宠物目录）
  const configPaths: ConfigPaths = {
    defaultFile: join(PACKAGE_ROOT, 'assets', 'config.jsonc'),
    userFile: userConfigPath,
    legacyUserFile: legacyUserConfigPath,
    petDir: petConfigDir,
  };

  // 老用户一次性迁移：main-config.json → main-config.jsonc（重命名，内容一字不动；
  // 新文件已存在则不动旧文件）。失败不影响运行——读取侧对旧路径有回落。
  migrateUserConfig(configPaths, (msg) => log.info('[fish-body] ' + msg));

  // 用户动画目录（thumb 播放时优先于包内素材；webm 放 assets/animation/webm/，
  // mov（macOS 定制）放 assets/animation/mov/）
  const thumbUserRoot = pathsForLog.animationDir;

  // 用户表情包目录（碎碎念/对话配图的图片：优先于包内 assets/memes，加图不必改包）
  const memesUserRoot = pathsForLog.memesDir;

  /**
   * 表情包目录链，与动画素材（/thumb）同一套归属语义：`pets/<素材根>-memes/` 存在则只查它；
   * 否则用户目录优先、包内兜底。池（readMemePool）与路由（/pic/memes）必须走同一个函数，
   * 否则池里能选的名字路由取不到，气泡配图会图裂。
   * 素材根来自 URL 段，必须先过 resolveAsset，避免 Windows 上 %5C 解出的反斜杠逃出用户根。
   */
  const memeDirsFor = (assetRoot: string): string[] => {
    const own = resolveAsset(petConfigDir, assetRoot + '-memes');
    if (own !== undefined && existsSync(own)) return [own];
    return [memesUserRoot, PACKAGE_MEMES_DIR];
  };

  // 用户级共享音效目录：main 链在没有专属文件时也查这里（加音效不必动包）。
  const soundUserRoot = pathsForLog.soundDir;

  /**
   * 内置皮肤池的根：`assets.pool`（相对数据根或绝对路径），默认 `<数据根>/assets/pet`。
   *
   * 每次都现读配置：池根是用户随时会改的环境参数，装配期只算一次会让改完配置要重启。
   * 读配置失败按默认处理——池是可选布局，配错不该让宿主报错。
   *
   * 刻意没有「旧位置回落」：`<数据根>/skin/` 在新布局里是用户皮肤目录，
   * 再拿它当池读等于把用户的皮肤当内置素材，比池空着更糟（迁移那一步会把旧池搬到 assets/pet）。
   */
  const poolRootOf = (): string => {
    try {
      return resolvePoolRoot(userRoot, readAllConfig(configPaths).main?.assets);
    } catch {
      return resolvePoolRoot(userRoot, undefined);
    }
  };

  // 最终路径表：池根要按配置解析，所以这里是 userPaths 的第二次调用（第一次只给 logger 用）。
  const paths = userPaths(userRoot, { pool: poolRootOf(), skin: resolveSkinDir(userRoot, locations) });

  // 初始化的目录结构：布局约定的那些目录 + 池的约定目录，启动时就建出来，并给每个目录写一句备注。
  // 这样「打开文件夹」永远不用先问「要不要创建」，用户也不必先去文档里抄目录名；
  // Explorer 里点开目录就能看到它是干什么的、能不能删。
  // 失败只记一行日志：数据根在只读盘上时插件本身照常跑。
  const layout = ensureUserLayout({
    paths,
    poolLayerDirs: Object.values(POOL_LAYER_DIR),
    poolSoundDir: POOL_SOUND_DIR,
  });
  if (layout.created.length > 0) {
    log.info('[fish-body] 已初始化目录：' + layout.created.join('、'));
  }
  for (const item of layout.failed) {
    log.info('[fish-body] 目录创建失败（' + item.dir + '）：' + item.error);
  }

  /**
   * 音效搜索目录，与服务端的素材归属同一套语义，但**不独占**：
   * 音效是叠加的（池资源目录 > 池渲染兜底 > 池全局 > 皮肤自带 > 素材根 > 用户共享 > 包内默认），
   * 少一处文件就往下落，所以这里把所有可能的位置一次给全，由 host/sfx/index-build 按优先级取第一个命中。
   *
   * `opts.renderer/model` 决定池的三层指向哪个目录：池是共享的，同一份清单必须按「渲染方式 + 皮肤」定位，
   * 否则切了皮肤还在响上一套。旧布局的三处先过 resolveAsset：素材根来自 URL 段，不能拼出用户根之外的路径。
   * `assetRoot = 'pool'`（保留虚拟根）时只给池目录——旧布局挂在 pack 名下，虚拟根没有 pack。
   */
  const soundDirsFor = (
    assetRoot: string,
    ext: string,
    opts?: { renderer?: RendererKind; model?: string },
  ): SfxDirs => {
    const sub = animSubdirFor(ext);
    const renderer = opts?.renderer ?? 'webm';
    const model = opts?.model ?? '';
    const poolRoot = poolRootOf();
    const fromPool = isReservedAssetRoot(assetRoot);

    const ownSkin = fromPool ? undefined : resolveAsset(petConfigDir, assetRoot + '-skin');
    const ownSound = fromPool ? undefined : resolveAsset(petConfigDir, assetRoot + '-sound');
    const ownAnimation = fromPool ? undefined : resolveAsset(petConfigDir, assetRoot + '-animation');
    const poolWebmDir = poolLayerDir(poolRoot, 'webm');
    const poolSkinDir = poolEntryDir(poolRoot, renderer, model);
    const structureBase = poolSkinDir === undefined ? undefined : poolStructureBaseOf(poolSkinDir);

    return {
      ...(ownSkin === undefined ? {} : { skinDir: ownSkin }),
      ...(ownSound === undefined ? {} : { soundDir: ownSound }),
      // 用户共享目录只给 main 系：pet pack 是整套素材，混用会让别人的音效串到它头上。
      ...(fromPool || assetRoot !== 'main' ? {} : { userSoundDir: soundUserRoot }),
      packageSoundDir: PACKAGE_SOUND_DIR,
      animationDirs: fromPool
        ? [poolWebmDir, join(thumbUserRoot, sub), join(PACKAGE_ROOT, 'assets', sub)]
        : [
            ...(ownAnimation === undefined ? [] : [ownAnimation]),
            join(thumbUserRoot, sub),
            join(PACKAGE_ROOT, 'assets', sub),
          ],
      poolGlobalSoundDir: poolGlobalSoundDir(poolRoot),
      poolRendererSoundDir: poolRendererSoundDir(poolRoot, renderer),
      ...(renderer === 'webm' ? { poolWebmDir } : {}),
      poolSkinLayerDir: poolLayerDir(poolRoot, renderer),
      ...(poolSkinDir === undefined
        ? {}
        : {
            poolSkinDir,
            poolSkinName: basename(poolSkinDir),
            poolSkinStructures: structureBase === undefined ? [] : [structureBase],
          }),
    };
  };

  // 轮询状态（/state）：前端 1s 轮询的唯一数据源（余额 / 工作状态 / 通知 / 宠物说话）。
  // 所有写入走 state.writeSection / writePet（统一更新 counter）。
  const state = new PollStateStore();

  // 第三方右键菜单注册表：进程内存态，不落盘，重启即空。
  // 注册表写进 S 的 sections.menu；点击事件不进 S——它是触发不是状态，走 /menu/events 读取即消费。
  const menuRegistry = new MenuRegistry();

  // 对外 Cordis 服务（宿主半侧）：与页面侧的 petApi7340 同名，但分属两个容器，互不可见也互不覆盖。
  // 只暴露 register（返回注销函数，配合 ctx.effect 在卸载时自动清理）与 list（排障用）；
  // 不暴露 unregister：注销走返回值，避免任何插件都能注销别人的 provider。
  ctx.provide('petApi7340', {
    balance: {
      register: registerBalanceProvider,
      list: listBalanceProviders,
    },
    // 语音：第三方注册自己的合成实现，合成按注册顺序排成回退链、内置 edge 永远收尾（见 voice/chain.ts）。
    // 同样只给 register（返回 disposer）与 list，不给 unregister。
    voice: {
      register: registerVoiceProvider,
      list: listVoiceProviders,
    },
    // 识别：与合成对称的一槽；注册后 /voice/hear 只走它，不再看宿主自带的 speechToText。
    speech: {
      register: registerSpeechProvider,
      list: listSpeechProviders,
    },
    // 记忆：第三方注册自己的长期记忆后端（单槽）；只给 register 与 list，注销走返回值。
    memory: {
      register: registerChatMemoryProvider,
      list: listChatMemoryProviders,
    },
    // 人格来源：第三方注册自己的 dsh 人格项目人设卡读取实现（多来源并存，按 id 查）。
    persona: {
      register: registerPersonaSource,
      list: listPersonaSources,
    },
  });

  // 播放记录表（issue #122 第 3 项）：由渲染端上报驱动的状态机 + 等待者。
  // 与 S 无关：播放记录是 per-caller 资源（只有发起那次点播的调用方关心、有生命周期），
  // 塞进 1s 全局广播会让每个窗口为每个功能付流量。
  const playback = new PlaybackStore();

  // 工作状态联动快照（/work-status 端点响应，浏览器 1s 轮询）：state = 当前活动状态（null = 空闲），
  // task = 当前任务详情。state 与 task 都按会话存——全局单值会让一次任务详情跟着此后所有会话活动
  // 一直显示（issue #59）。气泡文案不在此：浏览器读配置 events.workStatusTexts。
  // 进程内内存态：重启回空闲；每次会话事件有实际状态变化才更新。
  const workStatus = new WorkStatusStore();

  // 会话鱼：设置独立落盘（session-fish.json，见 ../session-fish/settings），状态机只读设置 getter，
  // 因此设置页保存后下一次事件就用新值，不必重建 store。
  const sessionFishSettings = new SessionFishSettingsStore(sessionFishSettingsPath(userRoot), (message) =>
    log.info(message),
  );
  const sessionFish = new SessionFishStore({ settings: () => sessionFishSettings.get() });

  /** 外部写入槽：固定会话 id，最后写入者生效；不做多写者仲裁/租约/会话管理 */
  const EXTERNAL_WORK_SESSION = 'api';

  let externalWorkSeq = 0;

  /** 推进外部写入序号并返回新值：每发生一次外部写入前进一拍，前端据此判断是否新的一次写入。 */
  const nextExternalWorkSeq = (): number => (externalWorkSeq += 1);

  return {
    dshHome,
    rootSource: rootResult.source,
    userRoot,
    paths,
    log,
    configPaths,
    userConfigPath,
    petConfigDir,
    thumbUserRoot,
    memesUserRoot,
    memeDirsFor,
    soundDirsFor,
    soundUserRoot,
    poolRoot: poolRootOf,
    fishSkinDirs: () => fishSkinDirs(userRoot),
    optionalService,
    standaloneAiPolicy,
    standaloneAiBalance,
    state,
    menuRegistry,
    playback,
    workStatus,
    sessionFish,
    sessionFishSettings,
    EXTERNAL_WORK_SESSION,
    nextExternalWorkSeq,
  };
}
