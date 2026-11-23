/**
 * 会话鱼的浏览器侧 HTTP 客户端：读/写设置与两个用户动作。
 *
 * 一律「失败不抛」：调用方是 UI，把网络错误变成可显示的结果，比让异常冒到 React 边界更有用。
 * 路径只有一条（`ROUTE_PATH + '/session-fish'`），动作走 JSON body。
 * @module dsh-fish-body/src/client/session-fish/api
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import { readSessionFish, sessionFishSkinKindOf, type SessionFishSettings } from '../../shared/session-fish.ts';

/** 把设置体收窄成 `SessionFishSettings`；形状不对返回 null。 */
function parseSettings(raw: unknown): SessionFishSettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.enabled !== 'boolean') return null;
  // 与快照共用解析：缺省/脏字段按默认值收口，只保留已知字段。
  const snapshot = readSessionFish({ ...record, fishes: [] });
  if (snapshot === null) return null;
  return {
    enabled: snapshot.enabled,
    sizePx: snapshot.sizePx,
    maxCount: snapshot.maxCount,
    bubbleMs: snapshot.bubbleMs,
    // 空串表示「用默认皮肤」：设置草稿里保留空串，预览与浮层各自换成默认名。
    skin: typeof record.skin === 'string' && record.skin !== '' ? snapshot.skin : '',
    followPet: snapshot.followPet,
    speakEnabled: snapshot.speakEnabled,
    speakProgress: snapshot.speakProgress,
    speakTurnEnd: snapshot.speakTurnEnd,
    speakWaiting: snapshot.speakWaiting,
    progressGapMs:
      typeof record.progressGapMs === 'number' && Number.isFinite(record.progressGapMs) ? record.progressGapMs : 15_000,
  };
}

/** 设置读取结果：读不到（网络/形状）返回 null。 */
export async function loadSessionFishSettings(): Promise<SessionFishSettings | null> {
  try {
    const response = await fetch(ROUTE_PATH + '/session-fish', { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: unknown; settings?: unknown } | null;
    // 与其余只读接口同口径：成功体不带 ok:true，只有失败体带 ok:false。
    if (!body || body.ok === false) return null;
    return parseSettings(body.settings);
  } catch {
    return null;
  }
}

/** 保存结果。 */
export type SessionFishSaveResult =
  { readonly ok: true; readonly settings: SessionFishSettings } | { readonly ok: false; readonly message: string };

/**
 * 保存设置（部分字段即可，宿主会与当前值合并）。
 *
 * @param patch - 要写的字段。
 * @returns 新设置或失败原因。
 */
export async function saveSessionFishSettings(patch: Partial<SessionFishSettings>): Promise<SessionFishSaveResult> {
  try {
    const response = await fetch(ROUTE_PATH + '/session-fish', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
      message?: unknown;
      settings?: unknown;
    } | null;
    if (!response.ok || !body || body.ok === false) {
      return { ok: false, message: typeof body?.message === 'string' ? body.message : 'HTTP ' + response.status };
    }
    const settings = parseSettings(body.settings);
    return settings === null ? { ok: false, message: 'invalid settings response' } : { ok: true, settings };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** 一个可选皮肤（设置页下拉的一项）。 */
export interface SessionFishSkinOption {
  /** 皮肤 id（= 文件名，也是设置的取值）。 */
  readonly id: string;
  /** 显示标签（已去掉扩展名）。 */
  readonly label: string;
  /** 渲染方式：视频走 `<video>`，图片/动图走 `<img>`。 */
  readonly kind: 'video' | 'image';
  /** 来源：用户目录 / 包内动画。 */
  readonly source: 'user' | 'pack';
}

/** 把一条皮肤清单收窄；形状不对返回 null。 */
function parseSkinOption(raw: unknown): SessionFishSkinOption | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  if (id === '') return null;
  const kind = record.kind === 'image' || record.kind === 'video' ? record.kind : sessionFishSkinKindOf(id);
  if (kind === null) return null;
  return {
    id,
    label: typeof record.label === 'string' && record.label !== '' ? record.label : id,
    kind,
    source: record.source === 'user' ? 'user' : 'pack',
  };
}

/**
 * 读可选皮肤清单。
 *
 * @returns 清单；读不到（网络/形状）返回 null，设置页据此保留默认皮肤并提示。
 */
export async function loadSessionFishSkins(): Promise<SessionFishSkinOption[] | null> {
  try {
    const response = await fetch(ROUTE_PATH + '/session-fish/skins', { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: unknown; items?: unknown } | null;
    if (!body || body.ok === false || !Array.isArray(body.items)) return null;
    const out: SessionFishSkinOption[] = [];
    for (const item of body.items) {
      const option = parseSkinOption(item);
      if (option) out.push(option);
    }
    return out;
  } catch {
    return null;
  }
}

/** 一次用户动作：点进会话（ack）/ 关闭这条鱼。 */ export type SessionFishAction =
  | { readonly action: 'focus'; readonly sessionId: string; readonly blank?: boolean; readonly running?: boolean }
  | { readonly action: 'close'; readonly sessionId: string };

/**
 * 发一次动作；失败静默（下一次轮询会拿到权威快照）。
 *
 * @param action - focus 或 close。
 */
export async function postSessionFishAction(action: SessionFishAction): Promise<void> {
  try {
    await fetch(ROUTE_PATH + '/session-fish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(action),
    });
  } catch {
    /* 网络抖动：快照仍是权威，下一次轮询会纠正 UI */
  }
}

/**
 * 认领一条播报的出声权：宿主对每个 `(sessionId, lineSeq)` 只授予一次。
 *
 * 语音链的单槽是每个页面/窗口各一份的，网页开两个标签、或网页与桌面同时显示会话鱼时，
 * 两端会各自把同一条播报念一遍。**失败一律按放行处理**——网络抖动不该把播报静音，
 * 宁可偶尔多念一次，也不要让用户以为功能坏了。
 *
 * @param sessionId - 会话 id。
 * @param lineSeq - 该鱼的播报序号。
 * @returns 这一次是否由本端来念。
 */
export async function claimFishLine(sessionId: string, lineSeq: number): Promise<boolean> {
  try {
    const response = await fetch(ROUTE_PATH + '/session-fish/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, lineSeq }),
    });
    if (!response.ok) return true;
    const body = (await response.json()) as { ok?: unknown; granted?: unknown } | null;
    if (!body || body.ok === false) return true;
    return body.granted === true;
  } catch {
    return true;
  }
}
