/**
 * 语音领域：`/voice/speak` 合成、`/voice/hear` 识别与 `/voice/voices` 音色列表。
 *
 * 校验、排队与缓存都在语音服务里；这里只判定方法与 JSON，并把结论映射成路由应答。
 * 契约见 openapi.yaml，本模块不重复描述字段。
 * @module dsh-fish-body/src/host/routes/voice
 */
import type { RouteResult } from '../http.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';
import { voiceProviderOf, voiceProviderStatuses } from '../voice/registry.ts';
import { readUserConfig } from '../config.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  providerConfigPath,
  readProviderConfig,
  readProviderValues,
  writeProviderFields,
  writeProviderVoice,
} from '../voice/gsv/store.ts';
import { gsvSettingsOf } from '../voice/gsv/settings.ts';
import { startLogPath, startService, stopService } from '../voice/gsv/process.ts';
import { requestExit } from '../voice/gsv/client.ts';

/** 单个配置项的长度上限（字符）：路径与 URL 都远短于这个，超了基本是粘错内容。 */
const MAX_CONFIG_VALUE_CHARS = 512;

/**
 * 没有停止脚本时的停法：让 api_v2 自己退出。
 * @param baseURL - GSV 服务地址。
 * @returns 已发出退出请求 / 失败原因。
 */
async function stopByControl(baseURL: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await requestExit(baseURL);
    return { ok: true, message: '未配停止脚本，已请求服务自行退出' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

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

  // 第三方实现的接入配置（GSV 的服务地址与音色/权重目录）：设置页按 `fields` 生成表单，读写这一段。
  // 存在 `<userRoot>/voice-providers.json`，不碰主配置（那份带注释，整份重写会丢）。
  // provider 两种给法都认：GET 用 query，POST 用请求体（也会回落到 query，方便 curl 手测）。
  if (rest === 'voice/provider-config') {
    if (method !== 'GET' && method !== 'POST') return methodNotAllowed();
    let parsed: { provider?: unknown; patch?: unknown } = {};
    if (method === 'POST') {
      try {
        parsed = JSON.parse(body ?? 'null') as { provider?: unknown; patch?: unknown };
      } catch {
        return invalidJson();
      }
    }
    const queryId = (input.url.searchParams.get('provider') ?? '').trim();
    const bodyId = typeof parsed.provider === 'string' ? parsed.provider.trim() : '';
    const providerId = bodyId || queryId;
    const status = providerId ? voiceProviderStatuses().find((item) => item.id === providerId) : undefined;
    if (!status) return failResult('provider-missing', `没有这个语音实现：${providerId || '(空)'}`);
    if (status.builtin) return failResult('bad-request', '内置实现没有接入配置');
    const file = providerConfigPath(deps.userRoot);
    const keys = status.fields.map((field) => field.key);
    if (method === 'GET') {
      return okResult({ ok: true, provider: status.id, values: readProviderValues(file, status.id, keys) });
    }
    const patchRaw = parsed.patch;
    if (patchRaw === undefined || patchRaw === null) return failResult('bad-request', 'patch 必填');
    if (typeof patchRaw !== 'object' || Array.isArray(patchRaw)) {
      return failResult('bad-request', 'patch 必须是对象');
    }
    const patch: Record<string, string> = {};
    for (const [key, value] of Object.entries(patchRaw as Record<string, unknown>)) {
      // 只认该实现声明过的键：多写的键静默丢弃会让设置页以为保存成功，所以直接拒。
      if (!keys.includes(key)) return failResult('bad-request', `未知配置项：${key}`);
      if (typeof value !== 'string') return failResult('bad-request', `${key} 必须是字符串`);
      const trimmed = value.trim();
      if (trimmed.length > MAX_CONFIG_VALUE_CHARS) {
        return failResult('bad-request', `${key} 太长（上限 ${MAX_CONFIG_VALUE_CHARS} 字符）`);
      }
      // baseURL 只收 http(s)：写个别的东西进去，探活会一直失败而界面看不出原因。
      if (key === 'baseURL' && trimmed !== '' && !/^https?:\/\//i.test(trimmed)) {
        return failResult('bad-request', 'baseURL 必须以 http:// 或 https:// 开头');
      }
      patch[key] = trimmed;
    }
    if (Object.keys(patch).length === 0) return failResult('bad-request', 'patch 是空的');
    try {
      await writeProviderFields(file, status.id, patch);
    } catch (error) {
      return failResult('generate-error', error instanceof Error ? error.message : String(error));
    }
    // 配置变了要立刻重扫：设置页拿这份新状态刷新音色下拉，不用等 provider 的 15s 软过期。
    return okResult({
      ok: true,
      provider: status.id,
      values: readProviderValues(file, status.id, keys),
      providers: voiceProviderStatuses(),
    });
  }

  // 播放音量（全局 0–1）：托盘「音量」子菜单写的就是它。写用户主配置后广播 config，
  // **不重启桌面 Helper**——拖一次音量重建全部窗口不可接受（与 /pet-display 那类写入不同）。
  if (rest === 'voice/volume') {
    if (method !== 'POST') return methodNotAllowed();
    let parsed: { volume?: unknown };
    try {
      parsed = JSON.parse(body ?? 'null') as { volume?: unknown };
    } catch {
      return invalidJson();
    }
    const volume = parsed.volume;
    if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) {
      return failResult('bad-request', 'volume 必须是 0–1 的有限数');
    }
    const existing = readUserConfig(deps.configPaths) ?? {};
    try {
      await mkdir(dirname(deps.userConfigPath), { recursive: true });
      await writeFile(
        deps.userConfigPath,
        JSON.stringify({ ...existing, voiceVolume: volume }, null, 2) + '\n',
        'utf8',
      );
    } catch (error) {
      return failResult('generate-error', error instanceof Error ? error.message : String(error));
    }
    // 广播 config：网页端据此重读 /config 并刷新播放增益（setVoiceConfig），当前播放中的那段不受影响。
    deps.state.writeSection('config', {});
    return okResult({ ok: true, volume });
  }

  // 第三方实现的启停（设置页「启动 / 停止」按钮）：只跑用户填的脚本，不猜进程树。
  // 启动立刻返回（服务加载几十秒，由 20s 的探活把可用性翻过来）；停止最多等 20s。
  // 启动的输出写进 <userRoot>/logs/gsv/<provider>-start.log：不建控制台，也就没有「窗口被关掉、
  // 服务变孤儿且 stdout 失效」那种事故（见 gsv/process.ts 模块头）。
  if (rest === 'voice/provider-process') {
    if (method !== 'POST') return methodNotAllowed();
    let parsed: { provider?: unknown; action?: unknown };
    try {
      parsed = JSON.parse(body ?? 'null') as { provider?: unknown; action?: unknown };
    } catch {
      return invalidJson();
    }
    const providerId = typeof parsed.provider === 'string' ? parsed.provider.trim() : '';
    const action = typeof parsed.action === 'string' ? parsed.action.trim() : '';
    const status = providerId ? voiceProviderStatuses().find((item) => item.id === providerId) : undefined;
    if (!status) return failResult('provider-missing', `没有这个语音实现：${providerId || '(空)'}`);
    if (status.builtin) return failResult('bad-request', '内置实现没有进程可启停');
    if (providerId !== 'gsv') return failResult('unsupported', `实现 ${providerId} 未提供启停脚本`);
    if (action !== 'start' && action !== 'stop') return failResult('bad-request', 'action 只能是 start 或 stop');
    const settings = gsvSettingsOf(readProviderConfig(providerConfigPath(deps.userRoot)));
    // 停止优先用用户脚本；没配就走 api_v2 的标准 `/control?command=exit`（让服务自己退）。
    const result =
      action === 'start'
        ? startService(settings.startScript, startLogPath(deps.userRoot, providerId))
        : settings.stopScript
          ? await stopService(settings.stopScript)
          : await stopByControl(settings.baseURL);
    if (!result.ok) return failResult('bad-request', result.message ?? '脚本执行失败');
    // 停完立刻重探一次：不主动探的话，缓存结论最多还会「在线」20 秒，按钮状态看起来像没生效。
    // 启动不探——服务要加载几十秒，现在探只会把结论钉在「不可用」，由后台重探翻牌即可。
    if (action === 'stop') void voiceProviderOf(providerId)?.refresh?.();
    return okResult({ ok: true, provider: providerId, action, ...(result.message ? { message: result.message } : {}) });
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
