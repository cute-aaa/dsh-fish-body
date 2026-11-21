/**
 * 插件入口：Cordis 插件，把 host 半侧的配置、路由、斜杠命令、轮询与桌面 Helper 装配到 ctx。
 * 装配顺序不能改：`getHandlePetRoute` 惰性取用（`httpRoute` 在本函数后段才创建），`startHelper` 必须最后调用。
 * @module dsh-fish-body/src/host/index
 */
import { createHostSetup } from './plugin/setup.ts';
import { readAllConfig } from './config.ts';
import { createHttpRoute, registerHttpRoute } from './plugin/http-route.ts';
import { registerLifecycle } from './plugin/lifecycle.ts';
import { registerChatCommand } from './plugin/command-chat.ts';
import { registerPetCommand } from './plugin/command-pet.ts';
import { registerLoops } from './plugin/loops.ts';
import { registerBalanceCommand } from './plugin/command-balance.ts';
import { registerSessionWatch } from './plugin/session-watch.ts';
import { createDesktopHelper } from './plugin/desktop-helper.ts';
import { createBalancePoll } from './plugin/balance-poll.ts';
import { createChatMemory } from './plugin/chat-memory.ts';
import { createSessionNotify } from './plugin/session-notify.ts';
import { createPetLookup } from './plugin/pet-lookup.ts';
import { createDownloadReport } from './plugin/download-report.ts';
import { createWorkStatusBridge } from './plugin/work-status-bridge.ts';
import { createSessionFishBridge, registerSessionFish } from './plugin/session-fish.ts';
import { registerTodoReminders } from './plugin/todo-reminders.ts';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { registerPersonaSync } from './plugin/persona-sync.ts';
import { createVoiceService } from './voice/speak.ts';
import { createHearService } from './voice/hear.ts';
import { openDirectory } from './open-folder.ts';
import { createGsvProvider } from './voice/gsv/provider.ts';
import {
  createCloudKeyReader,
  createCloudProvider,
  CLOUD_PROVIDER_ID,
  cloudConfigured,
  cloudSettingsOf,
} from './voice/cloud/provider.ts';
import { gsvSettingsOf } from './voice/gsv/settings.ts';
import { providerConfigPath, readProviderConfig, readProviderValues } from './voice/gsv/store.ts';
import { registerVoiceProvider } from './voice/registry.ts';
import { TodoStore } from './todo/store.ts';
import type { PetRouteDeps } from './routes/types.ts';

/** 插件行 id（与 cordis.patch.yml 一致） */
export const name = 'pet';
/** 需要注入的服务：webServer（路由）+ agentDefaultModel（当前服务商）+ credentials（凭证）+ llm（对话模型调用）+ commands（/balance 斜杠命令）+ connection（桌面 Helper「打开 AI 设置」用的已鉴权站点 URL） */
export const inject = ['webServer', 'agentDefaultModel', 'credentials', 'llm', 'commands', 'connection'];

/** 宿主插件主体：注册 `/dsh-pet-7340` 前缀路由与斜杠命令（/balance /pet /chat）；ctx 暂用 any（peer 类型包本地不可解析）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH 注入的 ctx（webServer/locale 等 service 无静态类型）
export function apply(ctx: any): void {
  const setup = createHostSetup(ctx);
  const {
    userRoot,
    paths,
    log,
    configPaths,
    thumbUserRoot,
    memeDirsFor,
    standaloneAiPolicy,
    standaloneAiBalance,
    state,
    playback,
    workStatus,
    sessionFish,
    EXTERNAL_WORK_SESSION,
    nextExternalWorkSeq,
  } = setup;
  // 本地 GSV（GPT-SoVITS api_v2）：配置在 `<userRoot>/config/voice-providers.json`（路由 /voice/provider-voice 写它）。
  // 注册后即成为回退链的第一环；服务没起或没配时 availability 为假，链自动落到内置 edge，不报错也不静默。
  const gsv = createGsvProvider({
    settings: () => gsvSettingsOf(readProviderConfig(providerConfigPath(userRoot))),
    log,
  });
  const unregisterGsv = registerVoiceProvider(gsv);
  ctx.effect(
    () => () => {
      unregisterGsv();
      gsv.dispose();
    },
    'fish-body: gsv voice provider',
  );
  // 云端 TTS（DeepSeek，按量计费）：**不进自动回退链**——链只收不花钱的实现（见 voice/chain.ts）。
  // 只有用户在设置页打开「使用云端语音」时，speak 才把它排到链首；它自己失败则回落免费链。
  // 注册顺序排在 GSV 之后：免费实现优先于付费实现，是这条链路的基本取向。
  // 密钥读取按最终生效预设选引用：只有 deepseek 预设（含老配置 protocol: 'deepseek'）会复用宿主的
  // DEEPSEEK_API_KEY，其余预设只认云端自己那把（见 voice/cloud/provider.ts 的 cloudKeyRefs）；
  // 逻辑搬进被测模块，这里只递宿主凭据服务。
  const readCloudKey = createCloudKeyReader(setup.optionalService('credentials'));
  const cloud = createCloudProvider({
    settings: () => cloudSettingsOf(readProviderConfig(providerConfigPath(userRoot))),
    readKey: readCloudKey,
    log,
  });
  const unregisterCloud = registerVoiceProvider(cloud);
  ctx.effect(() => () => unregisterCloud(), 'fish-body: cloud voice provider');
  // 探活只判配置齐全，不发请求（TTS 没有免费 ping）；结果供 availability() 同步读
  void cloud.refresh?.();

  const workStatusBridge = createWorkStatusBridge({ state, workStatus, EXTERNAL_WORK_SESSION });
  const { publishWorkStatus, stopWorkStatusFlush } = workStatusBridge;
  // 会话鱼：状态机在 setup（与 workStatus 同级），这里只建「快照 → /state」桥。
  const sessionFishBridge = createSessionFishBridge({ state, store: sessionFish });
  const { publishSessionFish } = sessionFishBridge;
  const downloadReport = createDownloadReport({
    EXTERNAL_WORK_SESSION,
    nextExternalWorkSeq,
    publishWorkStatus,
    workStatus,
  });
  const { reportDownload, stopDownloadSlotTimer } = downloadReport;
  const petLookup = createPetLookup({ state, configPaths });
  const { lock, sleep, sleepRefusalText } = petLookup;
  const sessionNotify = createSessionNotify({ ctx, publishWorkStatus, state, workStatus });
  const {
    pushNotifyFrame,
    turnFlags,
    terminalTimers,
    lastTodoText,
    lastReplyText,
    toolsInFlight,
    cancelTerminalCleanup,
    scheduleTerminalCleanup,
    notifyActivityTimers,
    scheduleCompletionNotify,
  } = sessionNotify;
  const chatMemory = createChatMemory({
    ctx,
    configPaths,
    log,
    memeDirsFor,
    playback,
    poolRoots: setup.poolRoots,
    state,
    userRoot,
  });
  const { lastWhisperAt, publishWhisper, publishSleepTalk, chatWithPet, getActivePetId, setActivePetId } = chatMemory;

  const balancePoll = createBalancePoll({ ctx, configPaths, getActivePetId, log, state, standaloneAiBalance });
  const { effectivePetList, balancePeriodSec, whisperPeriodSec, refreshBalance, resolveActivePetId, petDisplayName } =
    balancePoll;

  // 待办清单：一份用户级数据（不分宠物），落盘在插件数据根；提醒循环与 /todos 路由共用同一个实例。
  const todos = new TodoStore({ file: paths.todos, log });

  const desktopHelper = createDesktopHelper({
    ctx,
    configPaths,
    effectivePetList,
    log,
    reportDownload,
    thumbUserRoot,
    // 惰性取用：handlePetRoute 在下方装配，Helper 只在启动/收请求时才真正调用它
    getHandlePetRoute: () => httpRoute.handlePetRoute,
  });
  const { startHelper, stopHelper, markDisposed } = desktopHelper;

  const deps: PetRouteDeps = {
    ...setup,
    ...petLookup,
    ...workStatusBridge,
    ...chatMemory,
    ...balancePoll,
    ...desktopHelper,
    ...sessionNotify,
    ctx,
    todos,
    publishSessionFish,
    // 「打开素材文件夹」：平台文件管理器由这里的子进程拉起，路由只给类别名
    openDir: openDirectory,
    // 语音合成：缓存落 userRoot，失败只留日志，不打断宿主
    voice: createVoiceService({
      userRoot,
      log,
      // 播报去表情（设置页开关，默认开）：合成前把文本里的表情摘掉，纯表情整句跳过。
      stripEmoji: () => readAllConfig(configPaths).main?.speakStripEmoji !== false,
      // 付费语音的总开关：开了才把云端排到链首（每次合成现读，关掉立刻生效）
      preferredProvider: () => {
        try {
          const values = readProviderValues(providerConfigPath(userRoot), CLOUD_PROVIDER_ID, ['useCloud']);
          return cloudConfigured(cloudSettingsOf({ cloud: values })) ? CLOUD_PROVIDER_ID : undefined;
        } catch {
          return undefined;
        }
      },
    }),
    // 语音识别：能力来自宿主（DSH 的 speechToText），没启用时服务自己在调用时回 unsupported
    speech: createHearService({ speechToText: () => setup.optionalService('speechToText') }),
  };
  const httpRoute = createHttpRoute(deps);
  registerHttpRoute(ctx, httpRoute.handlePetRoute);

  registerSessionWatch({
    ctx,
    cancelTerminalCleanup,
    lastTodoText,
    lastReplyText,
    notifyActivityTimers,
    publishWorkStatus,
    pushNotifyFrame,
    scheduleCompletionNotify,
    scheduleTerminalCleanup,
    terminalTimers,
    toolsInFlight,
    turnFlags,
    workStatus,
  });

  // 会话鱼：与工作状态同一个事件源，但独立维护 turn 上下文（plan 等待 / goal 中间轮 / 完成确认）。
  // 放在 registerSessionWatch 之后：同一事件先让工作状态记账，这里只读事件本身，顺序不影响结果。
  const { stopSessionFishTimers } = registerSessionFish({ ctx, store: sessionFish, publishSessionFish });

  registerBalanceCommand({ ctx, effectivePetList, refreshBalance, sleep, sleepRefusalText });

  registerLoops({
    ctx,
    balancePeriodSec,
    configPaths,
    lastWhisperAt,
    lock,
    log,
    publishWhisper,
    publishSleepTalk,
    refreshBalance,
    sleep,
    standaloneAiPolicy,
    whisperPeriodSec,
  });

  registerPetCommand({ ctx, effectivePetList, petDisplayName, resolveActivePetId, setActivePetId });

  registerChatCommand({ ctx, chatWithPet, log, publishWhisper, resolveActivePetId, sleep, sleepRefusalText });

  // 待办提醒：随插件生命周期起停；锁被第三方持有时由 pickReminderSpeaker 跳过该宠物。
  // 播报开关现读现用：改配置后下一次提醒即生效，不必重启。
  registerTodoReminders({
    ctx,
    effectivePetList,
    isVoiceTodoEnabled: () => readAllConfig(configPaths).main?.voiceTodoEnabled === true,
    lock,
    log,
    sleep,
    state,
    todos,
    waiterCount: () => state.waiterCount(),
  });

  registerLifecycle({
    ctx,
    lock,
    markDisposed,
    playback,
    state,
    stopDownloadSlotTimer,
    stopHelper,
    stopSessionFishTimers,
    stopWorkStatusFlush,
  });

  // 人设同步：注册内置 fish-soul 来源并启动 watcher（改卡不重启即生效），卸载时随 effect 收尾。
  registerPersonaSync(ctx, [userRoot, resolveDshHome()]);

  // 路由就绪后拉起桌面 Helper（Electron 缺失时仅告警，不影响 DSH 与浏览器 overlay）
  startHelper();
}
