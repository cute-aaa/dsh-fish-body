/**
 * 资源导入请求 schema：宿主边界只接受判别联合中的三类请求。
 * @module dsh-fish-body/src/host/assets-import/request
 */
import { z } from 'zod';
import { RENDERERS } from '../../shared/config.ts';
import { SFX_EVENT_SLOTS } from '../../shared/sfx/types.ts';
import { SFX_IMPORT_TARGETS, type AssetImportRequest } from '../../shared/asset-import.ts';

/** 请求 schema：未知键拒绝，防止把宿主当任意复制器。 */
export const assetImportRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('skin'),
      renderer: z.string().min(1),
      sourcePath: z.string().min(1).max(4096),
      overwrite: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('sfx'),
      sourcePath: z.string().min(1).max(4096),
      target: z.enum(SFX_IMPORT_TARGETS),
      slot: z.string().min(1).optional(),
      hook: z.string().min(1).max(64).optional(),
      overwrite: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('session-fish'),
      sourcePath: z.string().min(1).max(4096),
      overwrite: z.boolean().optional(),
    })
    .strict(),
]);

/**
 * 解析并收窄资源导入请求。
 *
 * @param value - 请求体 JSON。
 * @returns 合法请求；类别成员不合法时返回 `undefined`。
 */
export function parseAssetImportRequest(value: unknown): AssetImportRequest | undefined {
  const parsed = assetImportRequestSchema.safeParse(value);
  if (!parsed.success) return undefined;
  if (parsed.data.kind === 'skin') {
    if (!(RENDERERS as readonly string[]).includes(parsed.data.renderer)) return undefined;
    return parsed.data as AssetImportRequest;
  }
  if (parsed.data.kind === 'sfx' && parsed.data.slot !== undefined) {
    if (!(SFX_EVENT_SLOTS as readonly string[]).includes(parsed.data.slot)) return undefined;
  }
  return parsed.data as AssetImportRequest;
}
