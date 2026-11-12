/**
 * 插件入口：Cordis 插件，把 host 半侧的配置、路由、斜杠命令、轮询与桌面 Helper 装配到 ctx。
 * 装配顺序不能改：`getHandlePetRoute` 惰性取用（`httpRoute` 在本函数后段才创建），`startHelper` 必须最后调用。
 * @module dsh-pet/src/host/index
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
import { registerTodoReminders } from './plugin/todo-reminders.ts';
import { registerPersonaSync } from './plugin/persona-sync.ts';
import { createVoiceService } from './voice/speak.ts';
import { createHearService } from './voice/hear.ts';
import { openDirectory } from './open-folder.ts';
import { createGsvProvider } from './voice/gsv/provider.ts';
import { gsvSettingsOf } from './voice/gsv/settings.ts';
import { providerConfigPath, readProviderConfig } from './voice/gsv/store.ts';
import { registerVoiceProvider } from './voice/registry.ts';
import { TODO_FILE_NAME, TodoStore } from './todo/store.ts';
import { join } from 'node:path';
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
    log,
    configPaths,
    userConfigPath,
    thumbUserRoot,
    memeDirsFor,
    standaloneAiPolicy,
    standaloneAiBalance,
    state,
    playback,
    workStatus,
    EXTERNAL_WORK_SESSION,
    nextExternalWorkSeq,
  } = setup;
  // 本地 GSV（GPT-SoVITS api_v2）：配置在 `<userRoot>/voice-providers.json`（路由 /voice/provider-voice 写它）。
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
    'dsh-pet: gsv voice provider',
  );

  const workStatusBridge = createWorkStatusBridge({ state, workStatus, EXTERNAL_WORK_SESSION });
  const { publishWorkStatus, stopWorkStatusFlush } = workStatusBridge;
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
  const chatMemory = createChatMemory({ ctx, configPaths, log, memeDirsFor, playback, state, userRoot });
  const { lastWhisperAt, publishWhisper, publishSleepTalk, chatWithPet, getActivePetId, setActivePetId } = chatMemory;

  const balancePoll = createBalancePoll({ ctx, configPaths, getActivePetId, log, state, standaloneAiBalance });
  const { effectivePetList, balancePeriodSec, whisperPeriodSec, refreshBalance, resolveActivePetId, petDisplayName } =
    balancePoll;

  // 待办清单：一份用户级数据（不分宠物），落盘在插件数据根；提醒循环与 /todos 路由共用同一个实例。
  const todos = new TodoStore({ file: join(userRoot, TODO_FILE_NAME), log });

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
    // 「打开素材文件夹」：平台文件管理器由这里的子进程拉起，路由只给类别名
    openDir: openDirectory,
    // 语音合成：缓存落 userRoot，失败只留日志，不打断宿主
    voice: createVoiceService({
      userRoot,
      log,
      // 播报去表情（设置页开关，默认开）：合成前把文本里的表情摘掉，纯表情整句跳过。
      stripEmoji: () => readAllConfig(configPaths).main?.speakStripEmoji !== false,
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
    stopWorkStatusFlush,
  });

  // 人设同步：注册内置 fish-soul 来源并启动 watcher（改卡不重启即生效），卸载时随 effect 收尾。
  registerPersonaSync(ctx, { configPaths, userConfigPath });

  // 路由就绪后拉起桌面 Helper（Electron 缺失时仅告警，不影响 DSH 与浏览器 overlay）
  startHelper();
}
