/**
 * 接入配置的客户端接口：读当前 persona / memory 状态，提交局部更新。
 *
 * 服务端仍是唯一真源；失败时带回 reason 与可展示文案，不抛异常。
 * @module dsh-fish-body/src/client/settings/integrations-api
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { IntegrationsView } from '../../shared/integrations.ts';

/** 一次保存的结论。 */
export type IntegrationsSaveOutcome =
  | { readonly ok: true; readonly view: IntegrationsView }
  | { readonly ok: false; readonly reason: string; readonly message: string };

/** 读取接入配置；失败返回 null。 */
export async function loadIntegrations(): Promise<IntegrationsView | null> {
  try {
    const response = await fetch(ROUTE_PATH + '/integrations', { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: unknown; integrations?: unknown } | null;
    return body?.ok === true && body.integrations && typeof body.integrations === 'object'
      ? (body.integrations as IntegrationsView)
      : null;
  } catch {
    return null;
  }
}

/** 保存一次局部配置。 */
export async function saveIntegrations(patch: unknown): Promise<IntegrationsSaveOutcome> {
  try {
    const response = await fetch(ROUTE_PATH + '/integrations', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
      reason?: unknown;
      message?: unknown;
      integrations?: unknown;
    } | null;
    if (response.ok && body?.ok === true && body.integrations && typeof body.integrations === 'object') {
      return { ok: true, view: body.integrations as IntegrationsView };
    }
    return {
      ok: false,
      reason: typeof body?.reason === 'string' ? body.reason : 'network',
      message: typeof body?.message === 'string' ? body.message : `HTTP ${response.status}`,
    };
  } catch (error) {
    return { ok: false, reason: 'network', message: error instanceof Error ? error.message : String(error) };
  }
}
