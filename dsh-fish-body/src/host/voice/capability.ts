/**
 * 「它知道自己有什么嗓子」——给 system 提示词补一段**能力声明**。
 *
 * 为什么要有这一段：桌宠自己不说话的时候并不知道本机装了哪些语音实现，被问「你有几个声音 /
 * 你是用什么嗓子说话的」只能现编（`docs/待验证项.md` V1 实测就是瞎编）。提示词里给它一份
 * 由**运行时状态**现算的清单，它才能答对，也才不会承诺「我换个音色给你听」这种做不到的事。
 *
 * 三条边界，缺一条就会把话说错：
 * 1. **只说当前事实**：实现可用性、当前音色、各开关状态，全部来自 `/voice/voices` 同源的状态；
 * 2. **说清它改不了**：切音色/开关都是用户在设置里做的，模型没有通道；
 * 3. **不可用的不吹**：装了但没连上的实现只报「没连上」，不许当成能用。
 *
 * 纯函数：不读配置、不探测服务，入参由调用方（`plugin/chat-memory.ts`）从现成状态里取。
 * @module dsh-fish-body/src/host/voice/capability
 */
import { DEFAULT_VOICE, VOICES } from './voices.ts';
import type { VoiceProviderStatus } from './registry.ts';

/** 拼这一段所需的运行时事实。 */
export interface VoiceCapabilityInput {
  /** 与 `/voice/voices` 同源的实现状态（第三方在前、内置 edge 收尾）。 */
  readonly providers?: readonly VoiceProviderStatus[];
  /** 内置 edge 当前音色 id（配置里的 `voiceName`，不合法时调用方应已回落到默认）。 */
  readonly edgeVoice?: string;
  /** 对话回复 / 手动点播是否会念（配置 `voiceEnabled`）。 */
  readonly replyVoiceOn?: boolean;
  /** 周期与手动点的碎碎念是否会念（配置 `voiceWhisperEnabled`）。 */
  readonly whisperVoiceOn?: boolean;
}

/** 一段最多列几个音色（提示词预算；多出来的用「等 N 个」带过）。 */
const MAX_VOICES = 6;

/** 一个可用实现里能真念出来的音色名。 */
function usableVoices(status: VoiceProviderStatus): readonly string[] {
  return status.voices.filter((voice) => voice.available !== false).map((voice) => voice.name);
}

/** 内置 edge 当前音色的展示名。 */
function edgeVoiceName(id: string | undefined): string {
  const want = typeof id === 'string' && id !== '' ? id : DEFAULT_VOICE;
  const hit = VOICES.find((voice) => voice.id === want);
  return hit === undefined ? want : `${hit.name}（${hit.id}）`;
}

/** 实现内部某个音色 id 的展示名（找不到就用 id 本身）。 */
function voiceNameOf(status: VoiceProviderStatus, id: string): string {
  return status.voices.find((voice) => voice.id === id)?.name ?? id;
}

/**
 * 拼出「你的声音」这一段。
 *
 * @param input - 运行时事实；省略 `providers` 时只报内置 edge（等价于「只有在线语音」）。
 * @returns 一段中文声明；**任何情况下都有内容**（内置 edge 恒可用），不会返回 undefined。
 */
export function voiceCapabilityNote(input: VoiceCapabilityInput = {}): string {
  const providers = input.providers ?? [];
  const available = providers.filter((provider) => provider.builtin !== true && provider.available);
  const blocked = providers.filter((provider) => provider.builtin !== true && !provider.available);

  const said: string[] = [`你现在说话的嗓子是 edge 在线语音 · ${edgeVoiceName(input.edgeVoice)}`];
  for (const provider of available) {
    const voices = usableVoices(provider);
    const current = provider.voice === '' ? '' : `，当前「${voiceNameOf(provider, provider.voice)}」`;
    if (voices.length === 0) {
      said.push(`${provider.name}也接了（音色暂时列不出来${current}）`);
      continue;
    }
    const shown = voices.slice(0, MAX_VOICES).join('、');
    const more = voices.length > MAX_VOICES ? ` 等 ${voices.length} 个` : '';
    said.push(`${provider.name}也接了：${shown}${more}${current}`);
  }
  for (const provider of blocked) {
    const why = provider.reason === undefined || provider.reason === '' ? '没连上' : provider.reason;
    said.push(`${provider.name}装了但此刻用不了（${why}）`);
  }

  const lines = ['【你的声音】' + said.join('；') + '。'];
  lines.push('你换不了嗓子：音色、要不要念都由用户在「设置 → 声音」里定，你手上没有这个开关');
  const speakOff: string[] = [];
  if (input.replyVoiceOn === false) speakOff.push('对话回复');
  if (input.whisperVoiceOn === false) speakOff.push('碎碎念');
  if (speakOff.length === 2) {
    lines.push('【此刻】语音总开关是关的：你不会自动出声，只有用户点喇叭时才会响。');
  } else if (speakOff.length === 1) {
    lines.push(`【此刻】${speakOff[0]}现在不念（设置里单独关着），别处照常。`);
  }
  lines.push('被问到声音时只按上面这些回答，不要编造别的音色名，也不要答应「换一个声音给你听」。');
  return lines.join('\n');
}
