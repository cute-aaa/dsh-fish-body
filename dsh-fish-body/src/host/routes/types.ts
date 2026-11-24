/**
 * 路由层的依赖契约：`apply` 在挂载时构造一次，各路由模块只读消费。
 *
 * 显式依赖是这一层的全部意义——路由不再从 `apply` 的闭包里"抓"变量，
 * 于是每个领域模块都能单独读、单独改、单独测，改路由不必改装配。
 * 不负责生命周期：store 的创建与销毁归 `apply`，路由只调用。
 * @module dsh-fish-body/src/host/routes/types
 */
import type { ChatMemoryMessage } from '../chat.ts';
import type { AppearanceStore } from '../appearance.ts';
import type { ConfigPaths } from '../config.ts';
import type { RouteResult } from '../http.ts';
import type { PetImageRef } from '../image-attachment.ts';
import type { LockStore } from '../lock.ts';
import type { FileLogger } from '../log-file.ts';
import type { MenuRegistry } from '../menu.ts';
import type { PlaybackStore } from '../playback.ts';
import type { PoseStore } from '../pose.ts';
import type { SleepStore } from '../sleep.ts';
import type { SessionFishStore } from '../session-fish/store.ts';
import type { SessionFishSettingsStore } from '../session-fish/settings.ts';
import type { FishSkinDirs } from '../session-fish/skins.ts';
import type { PersonaCharacterService, PersonaSourceService } from '../persona/service.ts';
import type { SfxDirs } from '../sfx/scan.ts';
import type { PollStateStore } from '../state.ts';
import type { NativePicker } from '../helper/dialog.ts';
import type { VoiceTarget } from '../surface.ts';
import type { TodoStore } from '../todo/store.ts';
import type { UserPaths } from '../user-layout.ts';
import type { HearService } from '../voice/hear.ts';
import type { VoiceService } from '../voice/speak.ts';
import type { WorkStatusStore } from '../work-status.ts';
import type { RendererKind } from '../../shared/types.ts';

/** 一次路由调用的输入：URL 已解析，`rest` 是去掉前缀并解码后的路径。 */
export interface RouteInput {
  /** 完整请求 URL（含查询串）。 */
  readonly url: URL;
  /** 去掉 `/dsh-pet-7340/` 前缀后的剩余路径（已解码）。 */
  readonly rest: string;
  /** HTTP 方法（大写）。 */
  readonly method: string;
  /** 请求体文本；只有 PUT/POST 才有值。 */
  readonly body?: string;
  /** 调用方断开信号：挂起等待的路由据此提前收尾。 */
  readonly signal?: AbortSignal;
}

/** 碎碎念与对话共用的生成结果。 */
export type GeneratedReply =
  | { ok: true; text: string; image?: string }
  | {
      ok: false;
      reason: 'provider-missing' | 'generate-error' | 'unknown-pet' | 'unknown-image';
      message?: string;
    };

/** 宠物定位结果：命中给出所在层与条目，未命中给出可直接返回的应答。 */
export type PetLookup =
  | {
      ok: true;
      petId: string;
      entry: string;
      conf: Record<string, unknown>;
      pet: Record<string, unknown>;
    }
  | { ok: false; res: RouteResult };

/** 单个路由处理函数：未命中返回 undefined，命中返回应答。 */
export type RouteHandler = (deps: PetRouteDeps, input: RouteInput) => Promise<RouteResult | undefined>;

/**
 * 路由层需要的全部外部能力。
 *
 * 字段分三类：只读路径与配置、进程内 store、`apply` 里已有的动作函数。
 * 唯一有副作用的是 `nextExternalWorkSeq`：它推进外部写入序号并返回新值。
 */
export interface PetRouteDeps {
  /** 配置路径集（内置默认 + 用户主配置 + 文件宠物目录）。 */
  readonly configPaths: ConfigPaths;
  /** 第三方右键菜单注册表（进程内存态）。 */
  readonly menuRegistry: MenuRegistry;
  /** 轮询快照（前端 1s 轮询的唯一数据源）。 */
  readonly state: PollStateStore;
  /** 待办清单（单个 JSON 文件，读改写串行）。 */
  readonly todos: TodoStore;
  /** 工作状态联动快照。 */
  readonly workStatus: WorkStatusStore;
  /** 会话鱼状态机（新建 / 进行中 / 完成未确认的会话各一条）。 */
  readonly sessionFish: SessionFishStore;
  /** 会话鱼设置（独立 session-fish.json）。 */
  readonly sessionFishSettings: SessionFishSettingsStore;
  /** 把会话鱼快照写进轮询状态。 */
  readonly publishSessionFish: () => void;
  /** 外部写入用的固定会话 id。 */
  readonly EXTERNAL_WORK_SESSION: string;
  /** 占用锁拦截：被别的会话占着时直接给出应答。 */
  readonly surfaceBlocked: (
    cfg: Record<string, Record<string, unknown>>,
    petId: string,
    params: URLSearchParams,
  ) => RouteResult | null;
  /** 同上，按 petId 判定。 */
  readonly lockBlocked: (petId: string, params: URLSearchParams) => RouteResult | null;
  /** 用户主配置路径。 */
  readonly userConfigPath: string;
  /** 请求重载桌面 Helper：是否真的重启、如何串行与退避由桌面侧决定（调用方只表达意图）。 */
  readonly requestRestart: () => Promise<void>;
  /** 停掉桌面 Helper 进程（托盘「退出」在 DSH 宿主内的实现：不退出 DSH，只结束桌面侧）。 */
  readonly stopHelper?: (reason?: string) => void;
  /**
   * 系统选择框（helper 的 `dialog.showOpenDialog`）。
   *
   * 可选：精简测试桩不给它就等于「没有 A 通道」，`/pick-*` 直接走 PowerShell 兜底——与改造前一致。
   * 内部态 `unavailable` 由 `pick-folder` 吞掉，**不会**进入任何路由响应。
   */
  readonly nativePicker?: NativePicker;
  /** 按 `?pet=` 定位宠物；缺参/未知宠物给出可直接返回的应答。 */
  readonly requirePet: (
    params: URLSearchParams,
    cfg: () => Record<string, Record<string, unknown>>,
    opts?: { surface?: boolean },
  ) => PetLookup;
  /** 播放记录表。 */
  readonly playback: PlaybackStore;
  /** 用户数据根。 */
  readonly userRoot: string;
  /**
   * `$DSH_HOME`：数据根指针文件就写在这里（位置可改的后端）。
   *
   * 缺省由路由按宿主环境现取；测试注入一个临时目录，免得测试往真实 DSH 目录里写指针。
   */
  readonly dshHome?: string;
  /** 数据根路径表（装配期给的唯一真源；缺省时路由按 userRoot 现算，见 ./paths.ts）。 */
  readonly paths?: UserPaths;
  /** 占用锁。 */
  readonly lock: LockStore;
  /** 睡觉状态（进睡 / 醒来由 /sleep 与 /wake 驱动）。 */
  readonly sleep: SleepStore;
  /** 睡觉闸门：在睡且未持锁时拒绝并弹拒绝台词；放行回 null。 */
  readonly sleepBlocked: (petId: string, params: URLSearchParams) => RouteResult | null;
  /** 插件日志出口（文件 + 终端）。 */
  readonly log: FileLogger;
  /** 宿主上下文的最小结构：路由只用到 logger、llm 服务与当前对话的模型。 */
  readonly ctx: {
    logger?: { warn?(message: string): void };
    llm?: unknown;
    /** 当前对话的模型：人设润色与识屏都靠它选模型并走同一条候选回落链；独立模式没有这个服务。 */
    agentDefaultModel?: { currentSelection(): { provider: string; model: string } };
    /** Cordis 服务查找：取 `hmr` 等可选服务（缺失时返回 undefined）。 */
    get?: (name: string) => unknown;
  };
  /** 文件宠物目录（`pet/`）。 */
  readonly petConfigDir: string;
  /** 把最新工作状态写进轮询快照。 */
  readonly publishWorkStatus: () => void;
  /** 推进外部写入序号并返回新值（前端据此判断是否新的一拍）。 */
  readonly nextExternalWorkSeq: () => number;
  /** 表情包目录链（与 /thumb 同一套归属语义）。 */
  readonly memeDirsFor: (assetRoot: string) => string[];
  /** 音效搜索目录（池三层 / 皮肤根 / -sound / 用户共享 / 动画同目录 / 包内默认）。 */
  readonly soundDirsFor: (
    assetRoot: string,
    ext: string,
    opts?: { renderer?: RendererKind; model?: string },
  ) => SfxDirs;
  /** 共享资源池的根（`assets.pool`，默认 `<用户根>/assets/pet`）。 */
  readonly poolRoot: () => string;
  /**
   * 池根的有序表：主根在前，其后是 `assets.resourceDirs` 里的外部素材根。
   *
   * 可选：精简测试桩只给 `poolRoot`，此时按单根处理（与多根加入之前的行为一致）。
   */
  readonly poolRoots?: () => string[];
  /** 会话鱼的皮肤池目录（用户目录 + 包内动画）；缺省按 `userRoot` 现算。 */
  readonly fishSkinDirs?: () => FishSkinDirs;
  /** 用平台文件管理器打开一个目录（设置页的「打开素材文件夹」）。 */
  readonly openDir: (path: string) => void;
  /** 姿态上报存储。 */
  readonly pose: PoseStore;
  /** 外观/动作的当前状态（渲染端上报，见 `POST /appearance/report`）。 */
  readonly appearance: AppearanceStore;
  /** 软取宿主可选服务（缺失返回 undefined）。 */
  readonly optionalService: (name: string) => unknown;
  /** 用户动画目录。 */
  readonly thumbUserRoot: string;
  /** 用户表情包目录。 */
  readonly memesUserRoot: string;
  /** 刷新余额（manual 表示用户主动触发）。 */
  readonly refreshBalance: (manual?: boolean) => Promise<void>;
  /** 生成一条碎碎念；image 给了就用这张图（需在池内），缺省 = 按配置随机抽一张或纯文本。
   *  voiceTo 由带 `?surface=` 的路由传请求面；kind=whisper 时按 voiceWhisperEnabled 决定要不要念。 */
  readonly publishWhisper: (
    petId: string,
    image?: string,
    voiceTo?: VoiceTarget,
    kind?: 'whisper' | 'manual',
  ) => Promise<GeneratedReply>;
  /** 读取对话记忆文件。 */
  readonly readMemory: () => Promise<Record<string, Record<string, { messages: ChatMemoryMessage[] }>>>;
  /** 对话记忆文件路径。 */
  readonly memoryPath: string;
  /** 单次对话保留的轮数。 */
  readonly memoryRounds: (conf: Record<string, unknown>) => number;
  /** 与本机宠物对话；image 缺省 = 纯文本，数据路径与加入图片前一致。 */
  readonly chatWithPet: (petId: string, text: string, image?: PetImageRef) => Promise<GeneratedReply>;
  /** 删除该宠物的对话记忆：ts 缺省 = 清空全部，否则只删命中的轮（成对）。 */
  readonly deleteHistory: (
    petId: string,
    ts?: readonly number[],
  ) => Promise<{ ok: true; removed: number } | { ok: false; reason: 'unknown-pet'; message: string }>;
  /** 已删宠物残留的记忆桶（配置里已没有这只宠物）。 */
  readonly orphanHistory: () => Promise<{ entry: string; petId: string; messages: number; lastTs: number }[]>;
  /** 清掉所有已删宠物的历史。 */
  readonly deleteOrphans: () => Promise<{ ok: true; pets: number; messages: number }>;
  /** 用户动画目录（按扩展名）。 */
  readonly userRootFor: (ext: string) => string;
  /** 包内动画目录（按扩展名）。 */
  readonly assetRootFor: (ext: string) => string;
  /** 语音合成服务（校验、排队、缓存与上游调用都在里面）。 */
  readonly voice: VoiceService;
  /** 语音识别服务（音频转文字；宿主没启用语音输入时由它自己回 unsupported）。 */
  readonly speech: HearService;
  /** 人设来源面：来源描述 + 扫描（`/persona/sources`、`/persona/scan`）。装配期注入，路由只读。 */
  readonly persona: PersonaSourceService;
  /** 角色库面：列表 / 写入 / 应用 / 删除（`/persona/characters*`）。与 `persona` 共享同一份 store。 */
  readonly characters: PersonaCharacterService;
  /** 资源包安装根（`<数据根>/packs`）：下载/导入的素材装在这里，不进插件包。 */
  readonly packsRoot: string;
  /** 资源包清单路径（包内 `assets/packs.json`）：随代码走，声明「哪些素材可以获取」。 */
  readonly packManifestPath: string;
}
