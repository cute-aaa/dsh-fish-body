/**
 * 资源导入客户端：把一次设置页请求发给 `/assets/import`。
 *
 * 只传源路径和类别；资料落点与路径安全由宿主决定。
 * @module dsh-fish-body/src/client/settings/asset-import-api
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { AssetImportRequest, ImportedAsset } from '../../shared/asset-import.ts';

/** 一次导入的结论。 */
export type AssetImportOutcome =
  | { readonly ok: true; readonly imported: ImportedAsset }
  | { readonly ok: false; readonly reason: string; readonly message: string };

/**
 * 提交资源导入。
 *
 * @param request - 已验证的导入请求。
 * @param petId - slot 音效导入需要的宠物；其他类别可省略。
 * @returns 落点或失败文案。
 */
export async function importAssetRequest(request: AssetImportRequest, petId?: string): Promise<AssetImportOutcome> {
  try {
    const query = petId === undefined ? '' : '?pet=' + encodeURIComponent(petId);
    const response = await fetch(ROUTE_PATH + '/assets/import' + query, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
      reason?: unknown;
      message?: unknown;
      imported?: unknown;
    } | null;
    if (response.ok && body?.ok === true && body.imported && typeof body.imported === 'object') {
      return { ok: true, imported: body.imported as ImportedAsset };
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
