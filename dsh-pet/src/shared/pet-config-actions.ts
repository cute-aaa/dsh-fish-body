/**
 * 「改这只宠物的配置」的五个写入口，两端共用一份：请求形状、失败判据与回执解析都只写一次。
 *
 * 为什么值得共用：网页端（`client/pet/menu-actions.ts`）与桌面端（`runtime/electron-helper/sprite/menu.js`）
 * 原先各写一遍同样的 `fetch(BASE + '/pet-xxx')`，只有「失败怎么提示」不同——那种重复最容易漂移
 * （一处改了端点名、另一处忘了改，表现是某一端某菜单静默失效）。这里把**HTTP 契约**收成一份，
 * 两端只保留各自的后续动作：网页端把成品聚合交给容器重渲染，桌面端等宿主重启窗口。
 *
 * 不负责：菜单树、文案、可用性判断（那些在 `menu/` 里）；也不重试——这些写入都由宿主写盘并触发
 * 重启，重试只会加重重启竞争。
 * @module dsh-pet/src/shared/pet-config-actions
 */
import { type PetDisplay, type RendererKind } from './types.ts';

/** 一次改配置的意图；`kind` 决定端点与请求体。 */
export type PetConfigIntent =
  | { readonly kind: 'display'; readonly display: PetDisplay }
  | { readonly kind: 'renderer'; readonly renderer: RendererKind }
  | { readonly kind: 'model'; readonly model: string }
  | { readonly kind: 'size'; readonly size?: number }
  | { readonly kind: 'provider-voice'; readonly provider: string; readonly voice: string };

/** 写配置的结论：失败带一句人话，成功时按端点带上成品聚合或 provider 状态。 */
export interface PetConfigResult {
  readonly ok: boolean;
  /** 失败原因（HTTP 状态 / 宿主回的 message）。 */
  readonly message?: string;
  /** `pet-*` 端点回的成品聚合（网页端拿它重渲染；桌面端忽略）。 */
  readonly merged?: Record<string, Record<string, unknown>>;
  /** `provider-voice` 回的 providers 段（菜单就地更新勾选）。 */
  readonly providers?: unknown;
}

/** 意图 → 端点与请求体；`provider-voice` 不带宠物 id（它是全局嗓子，与哪只宠物无关）。 */
function requestOf(petId: string, intent: PetConfigIntent): { path: string; body: Record<string, unknown> } {
  switch (intent.kind) {
    case 'display':
      return { path: '/pet-display', body: { id: petId, display: intent.display } };
    case 'renderer':
      return { path: '/pet-renderer', body: { id: petId, renderer: intent.renderer } };
    case 'model':
      return { path: '/pet-model', body: { id: petId, model: intent.model } };
    case 'size':
      // undefined 是合法输入：语义是「删掉这个渲染方式的覆盖」，所以显式写 null。
      return { path: '/pet-size', body: { id: petId, size: intent.size === undefined ? null : intent.size } };
    case 'provider-voice':
      return { path: '/voice/provider-voice', body: { provider: intent.provider, voice: intent.voice } };
  }
}

/**
 * 提交一次改配置请求。
 *
 * @param baseUrl - 插件路由根（网页端是 `/dsh-pet-7340`，桌面端是绝对地址）。
 * @param petId - 宠物 id；`provider-voice` 会忽略它。
 * @param intent - 改什么。
 * @returns 结论；网络异常也收敛成 `{ ok: false, message }`，不抛给调用方（这些动作都在菜单回调里）。
 */
export async function postPetConfig(baseUrl: string, petId: string, intent: PetConfigIntent): Promise<PetConfigResult> {
  const { path, body } = requestOf(petId, intent);
  try {
    const response = await fetch(baseUrl.replace(/\/+$/, '') + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };
    const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!parsed) return { ok: false, message: '响应不是 JSON' };
    // 业务失败是 200 + { ok: false, reason }：只看状态码会把失败体当成品聚合。
    if (parsed.ok === false) {
      const message = typeof parsed.message === 'string' ? parsed.message : String(parsed.reason ?? '');
      return { ok: false, message };
    }
    if (intent.kind === 'provider-voice') return { ok: true, providers: parsed.providers };
    return { ok: true, merged: parsed as Record<string, Record<string, unknown>> };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
