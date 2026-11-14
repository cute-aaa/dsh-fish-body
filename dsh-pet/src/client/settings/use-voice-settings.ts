/**
 * 设置页语音分区的全部状态：七个随「保存」写入的字段，加上远端音色清单与第三方实现的接入卡。
 *
 * 两种写入语义混在这一个分区里，边界写在类型上而不是注释里：`enabled/name/volume/whisper/todo/notify/stripEmoji`
 * 只改本地、随「保存」整包写；音色切换、接入配置与启停都**立即落盘**（写 `voice-providers.json` 或
 * DSH 凭据库，不重启 Helper、不重建窗口），所以它们各有自己的 busy 与反馈，不参与「保存」。
 * 后者整块交给 `use-provider-forms`（按 providerId 分桶的草稿、密钥与启停状态），这里只负责
 * 「谁在注册」的探活与本地音色格。
 * 轮询与启停的超时是这一块独立的失败模式：30s 探活保可用态、90s 兜底放开「启动」、启停后按轮次补拉清单。
 * owns only 语音分区的编辑态、轮询节奏与提交入口，never 保存、加载与其它分区字段；
 * 请求的构造与解析在 `./voice-api.ts`（读失败回 `null`、写失败抛错，这里只决定怎么显示）。
 * @module dsh-fish-body/src/client/settings/use-voice-settings
 */
import { readVoiceProviders, type VoiceProviderView } from '../../shared/voice-providers.ts';
import { speakText, type SpeakPhase } from '../../shared/voice.ts';
import type { MainConfigPatch } from './config/index.ts';
import type { VoiceOption } from './picker/voice-picker.ts';
import type { VoicePreviewProps } from './voice-card.ts';
import type { SettingsRuntime } from './runtime.ts';
import { fetchVoices } from './voice-api.ts';
import {
  localProviderOf,
  providerFormsOf,
  useProviderForms,
  type ProviderFormState,
  type ProviderForms,
} from './use-provider-forms.ts';

/** 语音分区的状态与回调。 */
export interface VoiceSettings {
  /** 试听：用当前选中的音色与音量合成一句示例。 */
  readonly preview: VoicePreviewProps;
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
  /** 念之前去掉文本里的表情符号（只影响播报出的声音，不影响识别结果与气泡）。 */
  readonly stripEmoji: boolean;
  /** 内置实现的音色清单；拉不到就是空数组，下拉只显示当前值。 */
  readonly voices: readonly VoiceOption[];
  /** 第一个「有音色可切」的实现（今天只有 GSV）；没有就不出这一格。 */
  readonly local: VoiceProviderView | undefined;
  /** 声明了接入配置项的实现（内置 edge 没有）；本地 GSV 与云端骨架各一张卡。 */
  readonly forms: readonly VoiceProviderView[];
  /** 按实现取一张接入卡的状态（草稿、密钥在场、保存与启停反馈）。 */
  readonly formState: (providerId: string) => ProviderFormState;
  /** 本地音色切换中。 */
  readonly voiceBusy: boolean;
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
  /** 改「播报去表情」。 */
  setStripEmoji(value: boolean): void;
  /** 改一个接入配置草稿值。 */
  readonly setDraftField: ProviderForms['setDraftField'];
  /** 提交接入配置。 */
  readonly saveProvider: ProviderForms['saveProvider'];
  /** 清除一项已保存的密钥。 */
  readonly clearSecret: ProviderForms['clearSecret'];
  /** 跑启动 / 停止脚本。 */
  readonly runProcess: ProviderForms['runProcess'];
  /** 切本地音色（立即落盘）。 */
  readonly changeProviderVoice: ProviderForms['changeProviderVoice'];
  /** 用成品配置覆盖七个随保存写入的字段。 */
  apply(patch: MainConfigPatch): void;
}

/** 探活间隔：服务可能被用户自己的脚本启停，「启动 / 停止」的可用态不能停在开页那一刻。 */
const PROBE_INTERVAL_MS = 30_000;
/** 启停后补拉的轮次间隔：服务要几十秒才稳，单次刷新看不到变化。 */
const POLL_STEP_MS = 5_000;
/** 第一轮补拉的延迟：脚本刚发出去，立刻探活必然还是不可用。 */
const POLL_FIRST_DELAY_MS = 3_000;

/**
 * 试听的示例台词。
 *
 * 固定一句而不是让用户填：试听要能横向比较音色，台词一变就没法比；也不走模型，点一下就响。
 * 用中文是因为内置四个 edge 音色全是中文嗓子；本地实现（GSV）读同一句也无妨，反正只为听音色。
 */
const VOICE_PREVIEW_TEXT = '你好呀，我是你的桌宠，随便说一句给你听。';

// 试听的形状只定义一处（voice-card.ts）：h(...) 不做 props 类型检查，
// 名字漂了不会报错、只会得到一个点了没反应的按钮——所以两边必须共用同一个类型。

/**
 * 管理语音分区的表单状态与 `/voice/*` 的读写。
 *
 * @param rt - 用到 `useState`、`useEffect`、`useCallback`、`useRef` 与翻译 `t`。
 * @returns 当前值、远端清单与各提交入口。
 */
export function useVoiceSettings(
  rt: Pick<SettingsRuntime, 'useState' | 'useEffect' | 'useCallback' | 'useRef' | 't'>,
): VoiceSettings {
  const { useState, useEffect, useCallback, t } = rt;
  // 七个随「保存」整包写入的字段：初值都是内置默认，加载成功后由成品值覆盖。
  const [enabled, setEnabled] = useState(false);
  const [name, setName] = useState('zh-CN-XiaoyiNeural');
  const [volume, setVolume] = useState(1);
  const [whisper, setWhisper] = useState(false);
  const [todo, setTodo] = useState(false);
  const [notify, setNotify] = useState(false);
  const [stripEmoji, setStripEmoji] = useState(true);
  // 远端：内置音色清单与第三方实现列表。
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [providers, setProviders] = useState<VoiceProviderView[]>([]);
  // 试听：与真实播报同一条播放链路（合成 → 预热 → 播放），所以它验的就是用户会听到的东西。
  const [previewPhase, setPreviewPhase] = useState<SpeakPhase>('idle');
  const [previewMessage, setPreviewMessage] = useState('');

  // 一份新列表就到手就刷新（可用性由它翻牌，「启动中」的解除也在 use-provider-forms 里）。
  const adoptProviders = useCallback((raw: unknown): void => {
    setProviders(readVoiceProviders(raw));
  }, []);

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

  const forms = useProviderForms(rt, providers, pollProviders);

  // 开页拉一次：内置音色清单给下拉，第三方实现给本地音色格与接入卡。
  useEffect(() => {
    let alive = true;
    void fetchVoices().then((body) => {
      if (!alive || body === null) return;
      if (Array.isArray(body.voices)) setVoices(body.voices);
      adoptProviders(body.providers);
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

  const testPreview = useCallback((): void => {
    setPreviewMessage('');
    speakText(
      VOICE_PREVIEW_TEXT,
      (phase) => {
        setPreviewPhase(phase);
        // 失败原因就地显示在按钮旁：这一格最可能就是「服务没起 / 没网」。
        setPreviewMessage(phase === 'failed' ? t('voicePreviewFailed') : '');
      },
      // 用还没保存的那一格：试听要跟着当前选择走，否则改了音色点试听却还是旧嗓子。
      { voice: name, volume },
    );
  }, [name, volume, t]);

  // 只有 setState，跨渲染稳定：放进设置页 applyConfig 的依赖里不会让配置反复重拉。
  const apply = useCallback((patch: MainConfigPatch): void => {
    if (patch.voiceEnabled !== undefined) setEnabled(patch.voiceEnabled);
    if (patch.voiceName !== undefined) setName(patch.voiceName);
    if (patch.voiceVolume !== undefined) setVolume(patch.voiceVolume);
    if (patch.voiceWhisperEnabled !== undefined) setWhisper(patch.voiceWhisperEnabled);
    if (patch.voiceTodoEnabled !== undefined) setTodo(patch.voiceTodoEnabled);
    if (patch.voiceNotifyEnabled !== undefined) setNotify(patch.voiceNotifyEnabled);
    if (patch.speakStripEmoji !== undefined) setStripEmoji(patch.speakStripEmoji);
  }, []);

  return {
    preview: { phase: previewPhase, message: previewMessage, test: testPreview },
    enabled,
    name,
    volume,
    whisper,
    todo,
    notify,
    stripEmoji,
    voices,
    local: localProviderOf(providers),
    forms: providerFormsOf(providers),
    formState: forms.stateOf,
    voiceBusy: forms.voiceBusy,
    setEnabled,
    setName,
    setVolume,
    setWhisper,
    setTodo,
    setNotify,
    setStripEmoji,
    setDraftField: forms.setDraftField,
    saveProvider: forms.saveProvider,
    clearSecret: forms.clearSecret,
    runProcess: forms.runProcess,
    changeProviderVoice: forms.changeProviderVoice,
    apply,
  };
}
