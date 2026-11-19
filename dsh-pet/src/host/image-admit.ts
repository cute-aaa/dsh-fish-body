/**
 * 图片入参的准入：校验形状 → 交给宿主附件服务落盘 → 拿回引用。
 *
 * 对话（`/chat`）与识屏（`/screen/frame`）共用这一条路径：两处都需要「base64 → 附件服务 →
 * 可发给模型」的同一套动作，各写一份必然在字节上限、错误码与独立模式降级上分叉。
 *
 * 必须始终成立：**落盘**由宿主附件服务做（`optionalService('attachments')`）——
 * 图片会进 `$DSH_HOME/attachments` 的对象存储，受宿主的附件保留策略约束。
 * 独立模式没有这个服务 → 明确不可用，不做假存储。
 * @module dsh-fish-body/src/host/image-admit
 */
import { parseImageAttachment, type PetImageRef, type PetImageSink } from './image-attachment.ts';
import type { RouteResult } from './http.ts';
import { failResult } from './routes/result.ts';

/** 准入结论；`ref` 缺省表示这次请求没带图。 */
export type ImageAdmission =
  { readonly ok: true; readonly ref?: PetImageRef } | { readonly ok: false; readonly res: RouteResult };

/** 准入只需要「软取服务」这一个能力。 */
export interface ImageAdmitDeps {
  /** 软取宿主可选服务（`attachments`）。 */
  readonly optionalService: (name: string) => unknown;
}

/**
 * 校验图片入参并交给宿主附件服务落盘。
 *
 * @param deps - 路由依赖（附件服务经 optionalService 软取，不进 inject）。
 * @param raw - 请求体里的 `attachment` 原始值；`undefined` 表示没传图。
 * @returns 已落盘的图片引用，或可直接返回的失败应答。
 */
export async function admitPetImage(deps: ImageAdmitDeps, raw: unknown): Promise<ImageAdmission> {
  if (raw === undefined) return { ok: true };
  const parsed = parseImageAttachment(raw);
  if (!parsed.ok) return { ok: false, res: failResult('bad-request', parsed.message) };
  const sink = deps.optionalService('attachments') as PetImageSink | undefined;
  // 独立模式没有附件服务：图片能力直接不可用，不做假存储（契约见 API.md）
  if (typeof sink?.saveImages !== 'function') {
    return { ok: false, res: failResult('bad-request', '当前模式不支持图片（缺少附件服务）') };
  }
  const maxBytes = sink.imageLimits?.maxImageBytes;
  if (maxBytes !== undefined && parsed.bytes.length > maxBytes) {
    return { ok: false, res: failResult('bad-request', `图片过大（上限 ${maxBytes} 字节，请压缩或降低分辨率）`) };
  }
  try {
    const [ref] = await sink.saveImages([{ data: parsed.bytes, mediaType: parsed.mediaType }]);
    if (ref === undefined) return { ok: false, res: failResult('generate-error', '附件服务未返回图片引用') };
    return { ok: true, ref };
  } catch (e) {
    // 存储失败不是调用方的参数问题：回 generate-error，避免被当成 bad-request 而排错方向
    return { ok: false, res: failResult('generate-error', e instanceof Error ? e.message : String(e)) };
  }
}
