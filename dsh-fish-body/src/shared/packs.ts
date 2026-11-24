/**
 * 资源包清单契约（共享层）：插件据此知道「哪些素材可以按需获取」。
 *
 * 三件事必须一起成立，否则「运行期获取」就成了后门：
 *   1. 清单随代码走（`assets/packs.json`），**素材本身不进包**；
 *   2. 每个包都声明 `sha256` 与 `bytes`，安装前强校验，不匹配就丢弃；
 *   3. 下载地址只收 https，且允许多镜像（国内直连 GitHub 常失败）。
 *
 * 这里只做解析与校验，不碰磁盘、不发请求——安装流程在宿主侧的 `host/packs/**`。
 * @module dsh-fish-body/src/shared/packs
 */
import { z } from 'zod';

/** 资源包种类：决定装到哪个目录、由谁消费。 */
export const PACK_KINDS = ['fonts', 'memes', 'anims', 'cubism'] as const;

/** 资源包种类。 */
export type PackKind = (typeof PACK_KINDS)[number];

/** 一个可获取的资源包。 */
export interface PackEntry {
  /** 包标识（小写字母/数字/连字符，最长 32）：同时是安装目录名。 */
  readonly id: string;
  readonly kind: PackKind;
  /** 设置页展示名（中文即可）。 */
  readonly label: string;
  /** 许可标识（如 `OFL-1.1` / `CC-BY-4.0` / `Live2D-Proprietary`）：下载前就要让用户看见。 */
  readonly license: string;
  /** 压缩包字节数：用于进度与「下载完先比大小」这道廉价预检。 */
  readonly bytes: number;
  /** 压缩包 sha256（小写十六进制 64 位）：唯一可信的完整性凭据。 */
  readonly sha256: string;
  /** 下载地址（按顺序尝试，全部 https）。 */
  readonly urls: readonly string[];
  /** 包内文件数（解压后核对，防止空包被当成装好）。 */
  readonly files: number;
  /** 可选说明：安装位置、是否可商用、需要什么前置条件。 */
  readonly note?: string;
}

/** 清单根：`schema` 是版本号，将来形状变化时据此拒绝旧文件而不是猜。 */
export interface PackManifest {
  readonly schema: 1;
  readonly packs: readonly PackEntry[];
}

/** 包 id 白名单：同时充当目录名，必须是安全字符。 */
const PACK_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** sha256 十六进制（小写）。 */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** 单个包的形状校验。 */
export const packEntrySchema = z.object({
  id: z.string().regex(PACK_ID, '包 id 只能是小写字母/数字/连字符，且不超过 32 位'),
  kind: z.enum(PACK_KINDS),
  label: z.string().min(1).max(80),
  license: z.string().min(1).max(120),
  bytes: z.number().int().positive().max(4_000_000_000),
  sha256: z.string().regex(SHA256_HEX, 'sha256 必须是 64 位小写十六进制'),
  // 不用 z.string().url()：zod 4 起 url 校验移到了 z.url()，这里只要 https 前缀，regex 更稳。
  urls: z
    .array(z.string().regex(/^https:\/\//, '下载地址必须是 https'))
    .min(1)
    .max(8),
  files: z.number().int().positive().max(200_000),
  note: z.string().max(400).optional(),
});

/** 清单整体形状：最多 64 个包（超过说明设计跑偏了）。 */
export const packManifestSchema = z.object({
  schema: z.literal(1),
  packs: z.array(packEntrySchema).max(64),
});

/** 解析清单的结论：失败要带上原因，供 UI 直接显示，不要抛异常。 */
export type ManifestParse =
  | { readonly ok: true; readonly manifest: PackManifest }
  | { readonly ok: false; readonly reason: 'invalid-json' | 'invalid-shape'; readonly message: string };

/**
 * 把 `<数据根>` 或包内读到的文本解析成清单。
 * @param raw - 清单原文（严格 JSON，不允许注释：注释会让人以为能改，但哈希与体积对不上就装不上）。
 * @returns 解析结论；形状不对时给出第一条问题的路径。
 */
export function parsePackManifest(raw: string): ManifestParse {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: 'invalid-json', message: error instanceof Error ? error.message : String(error) };
  }
  const parsed = packManifestSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path?.length ? first.path.join('.') : '(root)';
    return { ok: false, reason: 'invalid-shape', message: `${path}: ${first?.message ?? '形状不合法'}` };
  }
  return { ok: true, manifest: parsed.data as PackManifest };
}

/**
 * 判断一个字符串能否当包 id 用（也是安装目录名）。
 * @param value - 待判断的 id。
 * @returns 合法为 true。
 */
export function isValidPackId(value: string): boolean {
  return PACK_ID.test(value);
}

/**
 * 判断一个字符串是否是形状合格的 sha256。
 * @param value - 待判断的十六进制串。
 * @returns 合法为 true。
 */
export function isSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value);
}
