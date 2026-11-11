/**
 * 语音领域：`/voice/speak` 合成、`/voice/hear` 识别与 `/voice/voices` 音色列表。
 *
 * 校验、排队与缓存都在语音服务里；这里只判定方法与 JSON，并把结论映射成路由应答。
 * 契约见 openapi.yaml，本模块不重复描述字段。
 * @module dsh-pet/src/host/routes/voice
 */
import type { RouteResult } from '../http.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';
import { voiceProviderStatuses } from '../voice/registry.ts';
import { providerConfigPath, writeProviderVoice } from '../voice/gsv/store.ts';

/** 语音领域：未命中返回 undefined，命中返回应答。 */
export async function handleVoiceRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { body, method, rest, signal } = input;

  if (rest === 'voice/voices') {
    if (method !== 'GET') return methodNotAllowed();
    // providers 是「谁在念、能不能用、要配什么、能念哪些音色」的声明式清单：设置页据此生成控件（T3.6），
    // 也让排障能看出「注册了却没轮上」。链序在这里就是数组顺序（第三方在前，内置 edge 收尾）。
    return okResult({ ok: true, voices: deps.voice.listVoices(), providers: voiceProviderStatuses() });
  }

  // 切第三方实现的音色：只改 `<userRoot>/voice-providers.json`，不动主配置（那份带注释，整份重写会丢）。
  // 校验按「该实现当下扫到的音色清单」来判——写一个扫不到的 id，下次合成就只能用旧嗓子或直接落到 edge。
  if (rest === 'voice/provider-voice') {
    if (method !== 'POST') return methodNotAllowed();
    let parsed: { provider?: unknown; voice?: unknown };
    try {
      parsed = JSON.parse(body ?? 'null') as { provider?: unknown; voice?: unknown };
    } catch {
      return invalidJson();
    }
    const providerId = typeof parsed.provider === 'string' ? parsed.provider.trim() : '';
    const voiceId = typeof parsed.voice === 'string' ? parsed.voice.trim() : '';
    if (!providerId) return failResult('bad-request', 'provider 必填');
    if (!voiceId) return failResult('bad-request', 'voice 必填');
    const status = voiceProviderStatuses().find((item) => item.id === providerId);
    if (!status) return failResult('provider-missing', `没有这个语音实现：${providerId}`);
    if (status.builtin) return failResult('bad-request', '内置实现的音色请用 voiceName 设置');
    if (!status.voices.some((item) => item.id === voiceId)) {
      return failResult('bad-request', `未知音色：${voiceId}`);
    }
    try {
      await writeProviderVoice(providerConfigPath(deps.userRoot), providerId, voiceId);
    } catch (error) {
      return failResult('generate-error', error instanceof Error ? error.message : String(error));
    }
    return okResult({ ok: true, provider: providerId, voice: voiceId, providers: voiceProviderStatuses() });
  }

  if (rest === 'voice/speak') {
    if (method !== 'POST') return methodNotAllowed();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? 'null');
    } catch {
      return invalidJson();
    }
    const result = await deps.voice.speak(parsed);
    if (!result.ok) return failResult(result.reason, result.message);
    // Content-Type 跟着合成产出的 mime 走（edge → audio/mpeg，GSV 这类本地实现 → audio/wav）
    return { kind: 'file', file: result.file, contentType: result.mime };
  }

  // 与 /voice/speak 反向：音频进、文字出。格式由宿主 provider 校验，这里只转发结论。
  if (rest === 'voice/hear') {
    if (method !== 'POST') return methodNotAllowed();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? 'null');
    } catch {
      return invalidJson();
    }
    const result = await deps.speech.hear(parsed, signal);
    if (!result.ok) return failResult(result.reason, result.message);
    return okResult({ ok: true, text: result.text });
  }

  return undefined;
}
