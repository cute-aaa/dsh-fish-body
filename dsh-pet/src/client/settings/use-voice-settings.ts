/**
 * 设置页语音分区的全部状态：六个随「保存」写入的字段，加上远端音色清单与本地语音接入（GSV）。
 *
 * 两种写入语义混在这一个分区里，边界写在类型上而不是注释里：`enabled/name/volume/whisper/todo/notify`
 * 只改本地、随「保存」整包写；音色切换、接入配置与启停都**立即落盘**（写 voice-providers.json，
 * 不重启 Helper、不重建窗口），所以它们各有自己的 busy 与反馈，不参与「保存」。
 * 轮询与启停的超时是这一块独立的失败模式：30s 探活保可用态、90s 兜底放开「启动」、启停后按轮次补拉清单。
 * owns only 语音分区的编辑态、轮询节奏与提交入口，never 保存、加载与其它分区字段；
 * 请求的构造与解析在 `./voice-api.ts`（读失败回 `null`、写失败抛错，这里只决定怎么显示）。
 * @module dsh-pet/src/client/settings/use-voice-settings
 */
import { readVoiceProviders, switchableProviders, type VoiceProviderView } from '../../shared/voice-providers.ts';
import type { MainConfigPatch } from './config/index.ts';
import type { VoiceOption } from './picker/voice-picker.ts';
import type { SettingsRuntime } from './runtime.ts';
import { fetchProviderConfig, fetchVoices, postJson, readStringRecord } from './voice-api.ts';

/** 语音分区的状态与回调。 */
export interface VoiceSettings {
  /** 手动播报开关（右键 / 斜杠命令 / 对话回复）。 */
  readonly enabled: boolean;
  /** 内置实现的音色 id；本地音色可用时它只是回落值。 */
  readonly name: string;
  /** 播报音量系数（0–1）。 */
  readonly volume: number;
  /** 周期碎碎念播报。 */
  readonly whisper: boolean;
  /** 待办提醒播报。 */
  readonly todo: boolean;
  /** 工作状态播报。 */
  readonly notify: boolean;
  /** 内置实现的音色清单；拉不到就是空数组，下拉只显示当前值。 */
  readonly voices: readonly VoiceOption[];
  /** 第一个「有音色可切」的实现（今天只有 GSV）；没有就不出这一格。 */
  readonly local: VoiceProviderView | undefined;
  /** 声明了接入配置项的实现（内置 edge 没有）；可用与否都显示。 */
  readonly form: VoiceProviderView | undefined;
  /** 接入配置的草稿值（保存前不落盘）。 */
  readonly draft: Readonly<Record<string, string>>;
  /** 接入配置保存中。 */
  readonly draftBusy: boolean;
  /** 接入配置上一次保存的结论。 */
  readonly draftMessage: string;
  /** 本地音色切换中。 */
  readonly voiceBusy: boolean;
  /** 启停请求进行中。 */
  readonly processBusy: boolean;
  /** 启停结论（失败带 `!` 前缀）。 */
  readonly processMessage: string;
  /** 刚发过启动、还在等服务起来。 */
  readonly starting: boolean;
  /** 改手动播报开关。 */
  setEnabled(value: boolean): void;
  /** 改内置音色。 */
  setName(value: string): void;
  /** 改播放音量。 */
  setVolume(value: number): void;
  /** 改周期碎碎念播报。 */
  setWhisper(value: boolean): void;
  /** 改待办提醒播报。 */
  setTodo(value: boolean): void;
  /** 改工作状态播报。 */
  setNotify(value: boolean): void;
  /** 改一个接入配置草稿值。 */
  setDraftField(key: string, value: string): void;
  /** 提交接入配置。 */
  saveProvider(providerId: string, draft: Readonly<Record<string, string>>): void;
  /** 跑启动 / 停止脚本。 */
  runProcess(providerId: string, action: 'start' | 'stop'): void;
  /** 切本地音色（立即落盘）。 */
  changeProviderVoice(providerId: string, voice: string): void;
  /** 用成品配置覆盖六个随保存写入的字段。 */
  apply(patch: MainConfigPatch): void;
}

/** 探活间隔：服务可能被用户自己的脚本启停，「启动 / 停止」的可用态不能停在开页那一刻。 */
const PROBE_INTERVAL_MS = 30_000;
/** 启动兜底：脚本存在但服务起不来时也要放开「启动」，否则只能刷新页面重试。 */
const START_GUARD_MS = 90_000;
/** 启停后补拉的轮次间隔：服务要几十秒才稳，单次刷新看不到变化。 */
const POLL_STEP_MS = 5_000;
/** 第一轮补拉的延迟：脚本刚发出去，立刻探活必然还是不可用。 */
const POLL_FIRST_DELAY_MS = 3_000;

/** 取错误文案；非 Error 也能落到一句可读的话。 */
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * 挑出要单列「本地音色」那一格的实现。
 *
 * @param providers - 已解析的实现列表。
 * @returns 第一个能切音色的实现；没有则 `undefined`。
 */
export function localProviderOf(providers: readonly VoiceProviderView[]): VoiceProviderView | undefined {
  return switchableProviders(providers)[0];
}

/**
 * 挑出要渲染接入表单的实现。
 *
 * @param providers - 已解析的实现列表。
 * @returns 第一个声明了 `fields` 且非内置的实现；没有则 `undefined`。
 */
export function providerFormOf(providers: readonly VoiceProviderView[]): VoiceProviderView | undefined {
  return providers.find((item) => !item.builtin && item.fields.length > 0);
}

/**
 * 管理语音分区的表单状态与 `/voice/*` 的读写。
 *
 * @param rt - 用到 `useState`、`useEffect`、`useCallback` 与翻译 `t`。
 * @returns 当前值、远端清单与四个提交入口。
 */
export function useVoiceSettings(
  rt: Pick<SettingsRuntime, 'useState' | 'useEffect' | 'useCallback' | 't'>,
): VoiceSettings {
  const { useState, useEffect, useCallback, t } = rt;
  // 六个随「保存」整包写入的字段：初值都是内置默认，加载成功后由成品值覆盖。
  const [enabled, setEnabled] = useState(false);
  const [name, setName] = useState('zh-CN-XiaoyiNeural');
  const [volume, setVolume] = useState(1);
  const [whisper, setWhisper] = useState(false);
  const [todo, setTodo] = useState(false);
  const [notify, setNotify] = useState(false);
  // 远端：内置音色清单、第三方实现列表与各自的进行中/反馈。
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [providers, setProviders] = useState<VoiceProviderView[]>([]);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const [processBusy, setProcessBusy] = useState(false);
  const [processMessage, setProcessMessage] = useState('');
  const [starting, setStarting] = useState(false);

  // 一份新列表就到手就刷新；服务真的起来了就解除「启动中」，按钮立刻翻成「停止」可点。
  const adoptProviders = useCallback((raw: unknown): void => {
    const next = readVoiceProviders(raw);
    setProviders(next);
    if (next.some((item) => item.id === 'gsv' && item.available)) setStarting(false);
  }, []);

  // 开页拉一次：内置音色清单给下拉，第三方实现给本地音色格与接入表单。
  useEffect(() => {
    let alive = true;
    void fetchVoices().then((body) => {
      if (!alive || body === null) return;
      if (Array.isArray(body.voices)) setVoices(body.voices);
      adoptProviders(body.providers);
      const form = providerFormOf(readVoiceProviders(body.providers));
      if (form === undefined) return;
      void fetchProviderConfig(form.id).then((values) => {
        if (alive && values !== null) setDraft(values);
      });
    });
    return () => {
      alive = false;
    };
  }, [adoptProviders]);

  // 页面开着时定时对一次可用性：服务可能被外部脚本启停，两个按钮的可用态必须跟着真实状态走。
  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchVoices().then((body) => {
        if (body !== null) adoptProviders(body.providers);
      });
    }, PROBE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [adoptProviders]);

  // 启停后的补拉：服务要几十秒才稳，按轮次重试而不是一次性刷新。
  const pollProviders = useCallback(
    (times: number): void => {
      let left = times;
      const tick = (): void => {
        if (left <= 0) return;
        left -= 1;
        void fetchVoices()
          .then((body) => {
            if (body !== null) adoptProviders(body.providers);
          })
          .finally(() => {
            if (left > 0) window.setTimeout(tick, POLL_STEP_MS);
          });
      };
      window.setTimeout(tick, POLL_FIRST_DELAY_MS);
    },
    [adoptProviders],
  );

  // 切本地音色：立即落盘，「换嗓子」不是表单里的一份配置。
  const changeProviderVoice = useCallback((providerId: string, voice: string): void => {
    setVoiceBusy(true);
    void postJson('/voice/provider-voice', { provider: providerId, voice }, 'voice/provider-voice 被拒')
      .then((body) => setProviders(readVoiceProviders(body.providers)))
      .catch(() => undefined)
      .finally(() => setVoiceBusy(false));
  }, []);

  // 保存接入配置：失败原因就地显示在卡里，不弹窗。
  const saveProvider = useCallback(
    (providerId: string, patch: Readonly<Record<string, string>>): void => {
      setDraftBusy(true);
      setDraftMessage('');
      void postJson('/voice/provider-config', { provider: providerId, patch }, '保存被拒')
        .then((body) => {
          if (body.providers) setProviders(readVoiceProviders(body.providers));
          const values = readStringRecord(body.values);
          if (values !== null) setDraft(values);
          setDraftMessage(t('voiceProviderSaved'));
        })
        .catch((error: unknown) => setDraftMessage('!' + messageOf(error)))
        .finally(() => setDraftBusy(false));
    },
    [t],
  );

  // 启停：把用户填的脚本交给宿主执行，宿主只负责跑脚本（见 /voice/provider-process）。
  const runProcess = useCallback(
    (providerId: string, action: 'start' | 'stop'): void => {
      setProcessBusy(true);
      setProcessMessage('');
      void postJson('/voice/provider-process', { provider: providerId, action }, '脚本执行失败')
        .then(() => {
          setProcessMessage(action === 'start' ? t('voiceProviderStarted') : t('voiceProviderStopped'));
          if (action === 'start') {
            setStarting(true);
            // 兜底：脚本存在但服务起不来时也要放开「启动」。
            window.setTimeout(() => setStarting(false), START_GUARD_MS);
          }
          pollProviders(action === 'start' ? 12 : 3);
        })
        .catch((error: unknown) => setProcessMessage('!' + messageOf(error)))
        .finally(() => setProcessBusy(false));
    },
    [pollProviders, t],
  );

  // 只有 setState，跨渲染稳定：放进设置页 applyConfig 的依赖里不会让配置反复重拉。
  const apply = useCallback((patch: MainConfigPatch): void => {
    if (patch.voiceEnabled !== undefined) setEnabled(patch.voiceEnabled);
    if (patch.voiceName !== undefined) setName(patch.voiceName);
    if (patch.voiceVolume !== undefined) setVolume(patch.voiceVolume);
    if (patch.voiceWhisperEnabled !== undefined) setWhisper(patch.voiceWhisperEnabled);
    if (patch.voiceTodoEnabled !== undefined) setTodo(patch.voiceTodoEnabled);
    if (patch.voiceNotifyEnabled !== undefined) setNotify(patch.voiceNotifyEnabled);
  }, []);

  const setDraftField = useCallback((key: string, value: string): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  return {
    enabled,
    name,
    volume,
    whisper,
    todo,
    notify,
    voices,
    local: localProviderOf(providers),
    form: providerFormOf(providers),
    draft,
    draftBusy,
    draftMessage,
    voiceBusy,
    processBusy,
    processMessage,
    starting,
    setEnabled,
    setName,
    setVolume,
    setWhisper,
    setTodo,
    setNotify,
    setDraftField,
    saveProvider,
    runProcess,
    changeProviderVoice,
    apply,
  };
}
