/**
 * 识屏路由：`/screen/tick`（这一拍拍不拍）、`/screen/frame`（交一帧上去）、
 * `/screen/request`（手动拍一张）、`/screen/state`（设置页看状态）。
 *
 * 为什么是「Helper 来问」而不是「宿主命令 Helper」：Windows 上 Electron 主进程收不到 piped
 * stdin（见 helper/bridge.ts），宿主没有任何办法把指令推进 Helper 进程。于是节奏只能反过来——
 * Helper 定期问一句「现在拍吗」，宿主按配置与当前忙闲回答。
 *
 * 不决定截图怎么截（归 runtime/electron-helper/main/capture.js），不决定话怎么说（归 host/vision）。
 * @module dsh-fish-body/src/host/routes/screen
 */
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { readAllConfig } from '../config.ts';
import { agentIdleForMs } from '../agent-activity.ts';
import { sendSay } from '../broadcast-send.ts';
import { admitPetImage } from '../image-admit.ts';
import { parseImageAttachment } from '../image-attachment.ts';
import { configuredModel } from '../model-selection.ts';
import { composeSystemPrompt, petPersona } from '../persona.ts';
import { screenConfigOf } from '../../shared/screen-config.ts';
import { decideScreenTick, minuteOfDayOf } from '../screen/policy.ts';
import { screenState } from '../screen/state.ts';
import { describeScreen } from '../vision.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';

/** 调试图文件名：只在 `?debug=1` 时写，验证截屏链路用（不参与识屏）。 */
const DEBUG_FRAME_NAME = 'screen-frame.jpg';

/** 识屏那句话在气泡上挂多久（毫秒）：与投喂的缺省一致，够读完不被挡。 */
const SAY_DURATION_MS = 10_000;

/**
 * 处理 `/screen/*` 四个端点。
 *
 * @param deps - 路由依赖（配置路径、宠物定位、用户根）。
 * @param input - 路由输入（`rest` 已切好）。
 * @returns 应答；不是 `/screen` 领域时 undefined。
 */
export async function handleScreenRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { rest, method, url, body } = input;
  if (!rest.startsWith('screen/')) return undefined;

  // 四个端点都要先知道是哪只宠物：配置是按条目读的（种类文件可覆盖），落点写进它的气泡。
  // surface 不开：识屏与显示在哪一端无关（网页端没有截屏能力，那是 Helper 侧的事）。
  const who = deps.requirePet(url.searchParams, () => readAllConfig(deps.configPaths), {});
  if (!who.ok) return who.res;
  const screen = screenConfigOf(who.conf);

  if (rest === 'screen/tick') {
    if (method !== 'GET') return methodNotAllowed();
    const manual = screenState.manualPending();
    const now = Date.now();
    const decision = decideScreenTick({
      screen,
      manual,
      // 目前忙闲全部由「距上次会话事件多久」表达（见 agent-activity）；这里不重复判一遍。
      busy: false,
      idleForMs: agentIdleForMs(now),
      lastMs: screenState.snapshot().lastMs,
      nowMs: now,
      minuteOfDay: minuteOfDayOf(new Date(now)),
    });
    // 手动请求只有真的拍下去才算消费掉：这一拍被别的门挡住（关着）时保留，开关一开就能拍。
    if (decision.capture && manual && decision.reason === 'manual') screenState.consumeManual();
    return okResult({ ok: true, capture: decision.capture, reason: decision.reason, petId: who.petId });
  }

  if (rest === 'screen/request') {
    if (method !== 'POST') return methodNotAllowed();
    // 总开关关着时直接说清楚：设置页按钮与右键菜单据此置灰，不必让用户等下一拍才发现没反应。
    if (!screen.readEnabled) return failResult('unsupported', '识屏开关没打开（设置 → 系统 → 看屏幕与避让）');
    screenState.requestManual();
    return okResult({ ok: true, petId: who.petId, pending: true });
  }

  if (rest === 'screen/state') {
    if (method !== 'GET') return methodNotAllowed();
    const snap = screenState.snapshot();
    return okResult({
      ok: true,
      petId: who.petId,
      screen,
      ...snap,
    });
  }

  if (rest === 'screen/event') {
    if (method !== 'POST') return methodNotAllowed();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? 'null');
    } catch {
      return invalidJson();
    }
    const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    if (o.kind !== 'foreground') return failResult('bad-request', 'kind 只支持 foreground');
    // 只存最近一帧：这是给设置页显示「当前前台是谁、要不要躲」用的，不是审计日志。
    // 字段截断是为了不把整整一行标题塞进 /state 的响应（也不让超大标题撑爆状态）。
    screenState.noteForeground({
      app: typeof o.app === 'string' ? o.app.trim().slice(0, 120) : '',
      title: typeof o.title === 'string' ? o.title.slice(0, 200) : '',
      decision: o.decision === 'hide' ? 'hide' : 'show',
      reason: typeof o.reason === 'string' ? o.reason.slice(0, 32) : '',
      atMs: Date.now(),
    });
    return okResult({ ok: true });
  }

  if (rest === 'screen/frame') {
    if (method !== 'POST') return methodNotAllowed();
    if (!screen.readEnabled) return failResult('unsupported', '识屏开关没打开');
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? 'null');
    } catch {
      return invalidJson();
    }
    const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    const parsedImage = parseImageAttachment(o.attachment);
    if (!parsedImage.ok) return failResult('bad-request', parsedImage.message);
    const now = Date.now();
    screenState.noteCaptured(now);
    // 调试图：只有显式 `?debug=1` 或宿主带 `DSH_PET_SCREEN_DEBUG=1` 起来时才落盘一份
    // （正常链路画面进附件服务，不额外留证），用来验证「4K/150% 是不是黑图」。
    // 环境变量这一路是给实机排查用的：Helper 侧不知道自己该不该留证，只能由宿主统一开关。
    const wantDebug = url.searchParams.get('debug') === '1' || process.env.DSH_PET_SCREEN_DEBUG === '1';
    if (wantDebug) {
      try {
        await writeFile(join(deps.userRoot, DEBUG_FRAME_NAME), parsedImage.bytes);
      } catch (e) {
        return failResult('generate-error', '调试图写不出去：' + (e instanceof Error ? e.message : String(e)));
      }
    }
    // 门禁放在读图之前：锁着 / 没配附件服务时不该先花一次读图的钱，再告诉调用方「没成」。
    const blocked = deps.lockBlocked(who.petId, url.searchParams);
    if (blocked) return blocked;
    const admitted = await admitPetImage(deps, o.attachment);
    if (!admitted.ok) return admitted.res;
    if (admitted.ref === undefined) return failResult('bad-request', 'attachment 必填');
    const vision = await describeScreen(
      { llm: deps.ctx.llm, agentDefaultModel: deps.ctx.agentDefaultModel },
      {
        system: composeSystemPrompt({
          prompt: petPersona(who.conf, who.pet),
          id: who.petId,
          name: String(who.pet.name ?? who.petId),
          now: new Date(now),
        }),
        image: admitted.ref,
        preferred: configuredModel(who.conf, 'whisperModel'),
      },
    );
    if (!vision.ok) {
      // 失败也要留痕：这是背景行为，用户只会看到「没说话」，日志是唯一现场。
      screenState.noteResult({ atMs: now, ok: false, reason: vision.reason, message: vision.message });
      deps.log.warn?.(`fish-body: 识屏生成失败（${vision.reason}）：${vision.message ?? ''}`);
      return failResult(vision.reason, vision.message ?? '识屏生成失败');
    }
    // 只出气泡、不念：识屏是背景观察，念出来会和碎碎念抢音频，也白白多一次 TTS 计费。
    sendSay(deps, who.petId, { text: vision.text, duration: SAY_DURATION_MS, anim: true });
    screenState.noteResult({ atMs: now, ok: true, text: vision.text });
    return okResult({
      ok: true,
      petId: who.petId,
      text: vision.text,
      bytes: parsedImage.bytes.byteLength,
      mediaType: parsedImage.mediaType,
      atMs: now,
      ...(wantDebug ? { debugFile: DEBUG_FRAME_NAME } : {}),
    });
  }

  return undefined;
}
