/**
 * 会话鱼路由：设置读写、「点进 / 关闭」两种用户动作、皮肤池与播报出声权。
 *
 * 单段路径（`/session-fish`）承载三种方法，是为了同时满足两件事：`check-openapi` 只按一级段
 * 比对文档与实现，且浏览器与设置页都不需要记更多路径。动作走 JSON body，不用查询串——
 * 会话 id 可能含 `&` 一类字符，放进 body 才不会被编码细节绊住。
 * 子路径只放「需要独立语义」的三件事：皮肤清单、皮肤字节、以及跨面唯一一次的出声权（`/claim`）。
 * @module dsh-pet/src/host/routes/session-fish
 */
import type { RouteResult } from '../http.ts';
import { MIME } from '../http.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult, payloadTooLarge } from './result.ts';
import { fishSkinDirs, listFishSkins, resolveFishSkin, type FishSkinDirs } from '../session-fish/skins.ts';
import { isSessionFishSkinName, SESSION_FISH_SKIN_DEFAULT } from '../../shared/session-fish.ts';

/** 请求体上限：几个字段 + 会话 id，8KB 足够；超出按协议错误拒绝。 */
const MAX_BODY_BYTES = 8 * 1024;
/** 会话 id 上限（DSH 的 id 很短，留足余量即可）。 */
const MAX_SESSION_ID_LENGTH = 200;

/** 解析后的用户动作。 */
type FishAction =
  | { readonly action: 'focus'; readonly sessionId: string; readonly blank: boolean; readonly running: boolean }
  | { readonly action: 'close'; readonly sessionId: string };

/** 解析失败的人话原因。 */
type ActionParse =
  { readonly ok: true; readonly action: FishAction } | { readonly ok: false; readonly message: string };

/** 取对象；非对象返回 undefined。 */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** 校验会话 id：非空字符串、长度受限。 */
function parseSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  if (id === '' || id.length > MAX_SESSION_ID_LENGTH) return undefined;
  return id;
}

/** 解析 POST body。 */
function parseAction(raw: unknown): ActionParse {
  const body = recordOf(raw);
  if (!body) return { ok: false, message: 'body must be a JSON object' };
  const action = body.action;
  if (action !== 'focus' && action !== 'close') return { ok: false, message: 'action must be focus or close' };
  const sessionId = parseSessionId(body.sessionId);
  if (sessionId === undefined) {
    return { ok: false, message: `sessionId must be a non-empty string (max ${MAX_SESSION_ID_LENGTH})` };
  }
  if (action === 'close') return { ok: true, action: { action: 'close', sessionId } };
  for (const key of ['blank', 'running']) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') {
      return { ok: false, message: `${key} must be a boolean` };
    }
  }
  return {
    ok: true,
    action: { action: 'focus', sessionId, blank: body.blank === true, running: body.running === true },
  };
}

/** 会话鱼领域：未命中返回 undefined，命中返回应答。 */
export async function handleSessionFishRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { method, rest, body } = input;
  // 两条皮肤只读端点先匹配：它们都是 `/session-fish` 的子路径，落到下面那条精确匹配就取不到了。
  if (rest === 'session-fish/skins') return listSkins(deps, input);
  if (rest === 'session-fish/skin') return sendSkin(deps, input);
  if (rest === 'session-fish/claim') return claimSpeak(deps, input);
  // 先按一级段精确匹配（分发器按 rest 串行尝试各领域处理器）。
  const isSessionFishRoute = rest === 'session-fish';
  if (!isSessionFishRoute) return undefined;
  const { sessionFish, sessionFishSettings, publishSessionFish } = deps;

  if (method === 'GET') return okResult({ settings: sessionFishSettings.get() });
  if (method !== 'PUT' && method !== 'POST') return methodNotAllowed();

  if (Buffer.byteLength(body ?? '', 'utf8') > MAX_BODY_BYTES) return payloadTooLarge('session-fish body too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body ?? '');
  } catch {
    return invalidJson();
  }

  if (method === 'PUT') {
    const updated = await sessionFishSettings.update(parsed);
    if (!updated.ok) {
      return updated.kind === 'invalid'
        ? failResult('bad-request', updated.message)
        : failResult('settings-write-failed', updated.message);
    }
    // 关掉总开关时把现有鱼一并撤掉：快照里 enabled=false 且 fishes=[]，页面立即收起浮层。
    if (!updated.settings.enabled) sessionFish.clearAll();
    publishSessionFish();
    return okResult({ settings: updated.settings });
  }

  const result = parseAction(parsed);
  if (!result.ok) return failResult('bad-request', result.message);
  const changed =
    result.action.action === 'focus'
      ? sessionFish.focus(result.action.sessionId, {
          blank: result.action.blank,
          running: result.action.running,
        })
      : sessionFish.close(result.action.sessionId);
  if (changed) publishSessionFish();
  return okResult({ changed });
}

/**
 * 皮肤池目录：优先取装配层注入的那份（测试与小规模部署可以换目录），否则按用户根现算。
 *
 * @param deps - 路由依赖。
 * @returns 用户目录 + 包内动画目录。
 */
function skinDirsOf(deps: PetRouteDeps): FishSkinDirs {
  return typeof deps.fishSkinDirs === 'function' ? deps.fishSkinDirs() : fishSkinDirs(deps.userRoot);
} /**
 * 列可选皮肤：用户目录在前、包内动画在后（同名以用户为准）。
 *
 * 只回清单不回字节：设置页只要一个下拉，皮肤本身走 `/session-fish/skin`，
 * 让图片/动图/视频共用同一条取文件通道。
 *
 * @param deps - 路由依赖（只用 `userRoot`）。
 * @param input - 请求（只接受 GET）。
 * @returns 清单应答。
 */
function listSkins(deps: PetRouteDeps, input: RouteInput): RouteResult {
  if (input.method !== 'GET') return methodNotAllowed();
  return okResult({ items: listFishSkins(skinDirsOf(deps)), defaultSkin: SESSION_FISH_SKIN_DEFAULT });
}

/**
 * 下发一份皮肤文件。
 *
 * 名字先过 `isSessionFishSkinName`（不合法 → 400，与「文件不存在」区分开），
 * 再由 `resolveFishSkin` 在池内解析并校验越界；不存在回 404 文本，
 * 让浏览器的 `<img>` / `<video>` 走 `onError` 回落到内嵌小鱼，而不是把 JSON 当图片解码。
 *
 * @param deps - 路由依赖（只用 `userRoot`）。
 * @param input - 请求（只接受 GET，`?name=` 指定皮肤）。
 * @returns 文件应答或 400/404 文本。
 */
function sendSkin(deps: PetRouteDeps, input: RouteInput): RouteResult {
  if (input.method !== 'GET') return methodNotAllowed();
  const name = (input.url.searchParams.get('name') ?? '').trim();
  if (name === '')
    return { kind: 'text', status: 400, body: 'dsh-pet: expected /dsh-pet-7340/session-fish/skin?name=<file>' };
  if (!isSessionFishSkinName(name)) {
    return { kind: 'text', status: 400, body: 'dsh-pet: invalid fish skin name' };
  }
  const file = resolveFishSkin(skinDirsOf(deps), name);
  if (file === undefined) return { kind: 'text', status: 404, body: 'dsh-pet: fish skin not found' };
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  return { kind: 'file', file, contentType: MIME[ext] ?? 'application/octet-stream' };
}

/**
 * 认领一条会话鱼播报的出声权（每个 `(sessionId, lineSeq)` 只授予一次）。
 *
 * 为什么需要这条：语音链的单槽是每个页面/窗口各一份的，网页开两个标签、或网页与桌面同时显示
 * 会话鱼时，两端会把同一条播报各念一遍。宿主是两端唯一的共同点，由它裁决「谁念」。
 * 客户端在请求失败时一律按放行处理——网络抖动不该把播报静音。
 *
 * @param deps - 路由依赖（只用 `sessionFish`）。
 * @param input - 请求（只接受 POST，body `{ sessionId, lineSeq }`）。
 * @returns `{ granted }`；形状非法 400，方法不对 405。
 */
async function claimSpeak(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult> {
  if (input.method !== 'POST') return methodNotAllowed();
  if (Buffer.byteLength(input.body ?? '', 'utf8') > MAX_BODY_BYTES)
    return payloadTooLarge('session-fish body too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body ?? '');
  } catch {
    return invalidJson();
  }
  const body = recordOf(parsed);
  if (!body) return failResult('bad-request', 'body must be a JSON object');
  const sessionId = parseSessionId(body.sessionId);
  if (sessionId === undefined) {
    return failResult('bad-request', `sessionId must be a non-empty string (max ${MAX_SESSION_ID_LENGTH})`);
  }
  const lineSeq = body.lineSeq;
  if (typeof lineSeq !== 'number' || !Number.isFinite(lineSeq) || lineSeq <= 0) {
    return failResult('bad-request', 'lineSeq must be a positive number');
  }
  return okResult({ granted: deps.sessionFish.claimLine(sessionId, lineSeq) });
}
