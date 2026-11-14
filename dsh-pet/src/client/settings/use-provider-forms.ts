/**
 * 第三方语音实现的**表单状态**：接入配置的草稿、密钥在场情况、保存与启停的进行中/反馈。
 *
 * 与 `use-voice-settings` 分开的理由：那一半管的是「随保存写入主配置的几个开关」，
 * 这一半管的是「立即落盘的接入配置」。两种写入语义混在一个 hook 里，读代码的人分不清
 * 「改了这项要不要点保存」，而卡片本来就分成两张。
 *
 * 状态按 providerId 分桶（`drafts[gsv].baseURL`）：同时注册两个实现（本地 GSV + 云端骨架）时，
 * 一张卡的重置不会碰到另一张。密钥只保存「配没配」，值从不进浏览器。
 * @module dsh-fish-body/src/client/settings/use-provider-forms
 */
import { switchableProviders, type VoiceProviderView } from '../../shared/voice-providers.ts';
import type { SettingsRuntime } from './runtime.ts';
import { fetchProviderConfig, postJson, readBooleanRecord, readStringRecord } from './voice-api.ts';

/** 启动兜底：脚本存在但服务起不来时也要放开「启动」，否则只能刷新页面重试。 */
const START_GUARD_MS = 90_000;

/** 取错误文案；非 Error 也能落到一句可读的话。 */
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 按实现分桶的一份值。 */
type ByProvider<T> = Readonly<Record<string, T>>;

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
 * 挑出要渲染接入表单的实现（可以有多个：本地 GSV 与云端骨架各自一张卡）。
 *
 * @param providers - 已解析的实现列表。
 * @returns 声明了 `fields` 的非内置实现，按注册顺序。
 */
export function providerFormsOf(providers: readonly VoiceProviderView[]): VoiceProviderView[] {
  return providers.filter((item) => !item.builtin && item.fields.length > 0);
}

/** 一个实现的一张接入卡需要的东西。 */
export interface ProviderFormState {
  /** 卡里的草稿值（键 = `fields[].key`）。 */
  readonly values: Readonly<Record<string, string>>;
  /** 密钥字段配没配（键 = 密钥字段的 key）。 */
  readonly secrets: Readonly<Record<string, boolean>>;
  /** 保存中。 */
  readonly busy: boolean;
  /** 上一次保存的结论（失败带 `!` 前缀）。 */
  readonly message: string;
  /** 启停请求进行中。 */
  readonly processBusy: boolean;
  /** 启停结论（失败带 `!` 前缀）。 */
  readonly processMessage: string;
  /** 刚发过启动、还在等服务起来。 */
  readonly starting: boolean;
}

/** 表单状态与四个提交入口。 */
export interface ProviderForms {
  /** 按实现取一张卡的状态；没加载过时给一份空状态（不渲染成 undefined）。 */
  readonly stateOf: (providerId: string) => ProviderFormState;
  /** 本地音色切换中（只有一份：同一时刻只可能切一个嗓子）。 */
  readonly voiceBusy: boolean;
  /** 改一个草稿值。 */
  readonly setDraftField: (providerId: string, key: string, value: string) => void;
  /** 提交草稿；`clear` 是要从凭据库删掉的密钥键。 */
  readonly saveProvider: (
    providerId: string,
    patch: Readonly<Record<string, string>>,
    clear?: readonly string[],
  ) => void;
  /** 删掉一项密钥（立即落盘：值不在草稿里，没法跟「保存」一起提交）。 */
  readonly clearSecret: (providerId: string, key: string) => void;
  /** 跑启动 / 停止脚本。 */
  readonly runProcess: (providerId: string, action: 'start' | 'stop') => void;
  /** 切本地音色（立即落盘）。 */
  readonly changeProviderVoice: (providerId: string, voice: string) => void;
}

/** 空状态：没加载过或实现刚被注册时报这一份。 */
const EMPTY_FORM_STATE: ProviderFormState = {
  values: {},
  secrets: {},
  busy: false,
  message: '',
  processBusy: false,
  processMessage: '',
  starting: false,
};

/**
 * 管理接入配置的草稿、密钥与启停状态。
 *
 * @param rt - 用到 `useState`、`useEffect`、`useCallback`、`useRef` 与翻译。
 * @param providers - 当前的实现列表（由 `use-voice-settings` 的探活维护）。
 * @param refresh - 启停后重新探活（服务要几十秒才起来，节奏由调用方决定）。
 * @returns 每张卡的状态与四个提交入口。
 */
export function useProviderForms(
  rt: Pick<SettingsRuntime, 'useState' | 'useEffect' | 'useCallback' | 'useRef' | 't'>,
  providers: readonly VoiceProviderView[],
  refresh: (times: number) => void,
): ProviderForms {
  const { useState, useEffect, useCallback, useRef, t } = rt;
  const [drafts, setDrafts] = useState<ByProvider<Record<string, string>>>({});
  const [secrets, setSecrets] = useState<ByProvider<Record<string, boolean>>>({});
  const [busy, setBusy] = useState<ByProvider<boolean>>({});
  const [messages, setMessages] = useState<ByProvider<string>>({});
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [processBusy, setProcessBusy] = useState<ByProvider<boolean>>({});
  const [processMessages, setProcessMessages] = useState<ByProvider<string>>({});
  const [starting, setStarting] = useState<ByProvider<boolean>>({});
  // 已拉过配置的实现：探活每 30s 换一份新数组，不能每次重拉（会覆盖用户正在改的草稿）。
  const loaded = useRef<Set<string>>(new Set());

  const forms = providerFormsOf(providers);
  // 依赖用 id 串：探活回来的数组每次都是新的，用数组本身当依赖会让 effect 每 30s 白跑一次。
  const formIds = forms.map((form) => form.id).join(',');

  useEffect(() => {
    for (const form of forms) {
      if (loaded.current.has(form.id)) continue;
      loaded.current.add(form.id);
      void fetchProviderConfig(form.id).then((conf) => {
        if (conf === null) return;
        setDrafts((current) => ({ ...current, [form.id]: conf.values }));
        setSecrets((current) => ({ ...current, [form.id]: conf.secrets }));
      });
    }
    // forms 每次渲染都是新数组，但 formIds 只在实现集合变化时变；effect 体内只读 forms 的当下快照。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 见上一行
  }, [formIds]);

  // 服务真的起来了就解除「启动中」，按钮立刻翻成「停止」可点。
  const availableKey = providers
    .filter((item) => item.available)
    .map((item) => item.id)
    .join(',');
  useEffect(() => {
    if (availableKey === '') return;
    setStarting((current) => {
      const next = { ...current };
      let touched = false;
      for (const id of availableKey.split(',')) {
        if (next[id] === true) {
          delete next[id];
          touched = true;
        }
      }
      return touched ? next : current;
    });
  }, [availableKey]);

  const setDraftField = useCallback((providerId: string, key: string, value: string): void => {
    setDrafts((current) => ({ ...current, [providerId]: { ...(current[providerId] ?? {}), [key]: value } }));
  }, []);

  const saveProvider = useCallback(
    (providerId: string, patch: Readonly<Record<string, string>>, clear: readonly string[] = []): void => {
      setBusy((current) => ({ ...current, [providerId]: true }));
      setMessages((current) => ({ ...current, [providerId]: '' }));
      const body = clear.length > 0 ? { provider: providerId, patch, clear } : { provider: providerId, patch };
      void postJson('/voice/provider-config', body, '保存被拒')
        .then((result) => {
          const values = readStringRecord(result.values);
          if (values !== null) setDrafts((current) => ({ ...current, [providerId]: values }));
          setSecrets((current) => ({ ...current, [providerId]: readBooleanRecord(result.secrets) }));
          setMessages((current) => ({ ...current, [providerId]: t('voiceProviderSaved') }));
        })
        .catch((error: unknown) => setMessages((current) => ({ ...current, [providerId]: '!' + messageOf(error) })))
        .finally(() => setBusy((current) => ({ ...current, [providerId]: false })));
    },
    [t],
  );

  // 密钥没有「草稿」可言（值从不回传），所以清除只能立刻落盘；patch 给空对象表示不改普通项。
  const clearSecret = useCallback(
    (providerId: string, key: string): void => {
      saveProvider(providerId, {}, [key]);
    },
    [saveProvider],
  );

  const runProcess = useCallback(
    (providerId: string, action: 'start' | 'stop'): void => {
      setProcessBusy((current) => ({ ...current, [providerId]: true }));
      setProcessMessages((current) => ({ ...current, [providerId]: '' }));
      void postJson('/voice/provider-process', { provider: providerId, action }, '脚本执行失败')
        .then(() => {
          setProcessMessages((current) => ({
            ...current,
            [providerId]: action === 'start' ? t('voiceProviderStarted') : t('voiceProviderStopped'),
          }));
          if (action === 'start') {
            setStarting((current) => ({ ...current, [providerId]: true }));
            // 兜底：脚本存在但服务起不来时也要放开「启动」。
            window.setTimeout(() => setStarting((current) => ({ ...current, [providerId]: false })), START_GUARD_MS);
          }
          refresh(action === 'start' ? 12 : 3);
        })
        .catch((error: unknown) =>
          setProcessMessages((current) => ({ ...current, [providerId]: '!' + messageOf(error) })),
        )
        .finally(() => setProcessBusy((current) => ({ ...current, [providerId]: false })));
    },
    [refresh, t],
  );

  // 切本地音色：立即落盘，「换嗓子」不是表单里的一份配置。
  const changeProviderVoice = useCallback((providerId: string, voice: string): void => {
    setVoiceBusy(true);
    void postJson('/voice/provider-voice', { provider: providerId, voice }, 'voice/provider-voice 被拒')
      .catch(() => undefined)
      .finally(() => setVoiceBusy(false));
  }, []);

  const stateOf = useCallback(
    (providerId: string): ProviderFormState => ({
      values: drafts[providerId] ?? EMPTY_FORM_STATE.values,
      secrets: secrets[providerId] ?? EMPTY_FORM_STATE.secrets,
      busy: busy[providerId] ?? false,
      message: messages[providerId] ?? '',
      processBusy: processBusy[providerId] ?? false,
      processMessage: processMessages[providerId] ?? '',
      starting: starting[providerId] ?? false,
    }),
    [drafts, secrets, busy, messages, processBusy, processMessages, starting],
  );

  return { stateOf, voiceBusy, setDraftField, saveProvider, clearSecret, runProcess, changeProviderVoice };
}
