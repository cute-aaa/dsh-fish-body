/**
 * 资源包的客户端接口：列清单、装、删。
 *
 * 与设置页其它请求同一套口径——**不抛**：拿不到就回空数组或失败结论，卡片决定显示什么。
 * 安装是同步等待的（宿主在请求里下载并校验），所以调用方要自己把按钮置为「进行中」。
 * @module dsh-fish-body/src/client/settings/packs-api
 */
import { ROUTE_PATH } from '../../shared/constants.ts';

/** 清单里的一条 + 本机安装状态（与宿主 `GET /packs` 的形状一致）。 */
export interface PackView {
  readonly id: string;
  readonly kind: 'fonts' | 'memes' | 'anims' | 'cubism';
  readonly label: string;
  readonly license: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly files: number;
  readonly note?: string;
  /** 已装记录；未装为 null。 */
  readonly installed: { readonly files: number; readonly at: string } | null;
  /** 已装且 sha256 与清单一致。 */
  readonly upToDate: boolean;
}

/** 一次动作的结论：成功或一句可直接显示的话。 */
export type PackOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** 把宿主返回的一条收成视图；形状不对就丢弃这一条（宁可少一行，也不渲染半条）。 */
function asPack(value: unknown): PackView | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const kinds = ['fonts', 'memes', 'anims', 'cubism'];
  if (typeof raw.id !== 'string' || typeof raw.kind !== 'string' || !kinds.includes(raw.kind)) return undefined;
  if (typeof raw.label !== 'string' || typeof raw.license !== 'string') return undefined;
  if (typeof raw.bytes !== 'number' || typeof raw.files !== 'number') return undefined;
  const installedRaw = raw.installed;
  const installed =
    installedRaw && typeof installedRaw === 'object'
      ? {
          files: Number((installedRaw as Record<string, unknown>).files) || 0,
          at: String((installedRaw as Record<string, unknown>).at ?? ''),
        }
      : null;
  return {
    id: raw.id,
    kind: raw.kind as PackView['kind'],
    label: raw.label,
    license: raw.license,
    bytes: raw.bytes,
    sha256: typeof raw.sha256 === 'string' ? raw.sha256 : '',
    files: raw.files,
    note: typeof raw.note === 'string' ? raw.note : undefined,
    installed,
    upToDate: raw.upToDate === true,
  };
}

/**
 * 拉一次清单。
 * @returns 视图数组；请求失败或形状不对时为空数组（卡片显示「暂无可用素材包」）。
 */
export async function listPacks(): Promise<PackView[]> {
  try {
    const response = await fetch(ROUTE_PATH + '/packs');
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const packs = (body as { packs?: unknown } | null)?.packs;
    if (!Array.isArray(packs)) return [];
    return packs.map(asPack).filter((item): item is PackView => item !== undefined);
  } catch {
    return [];
  }
}

/**
 * 按 id 安装（走清单里的下载地址）。
 * @param id - 包 id。
 * @returns 结论；失败时 `message` 直接来自宿主（含「sha256 不符」这类具体原因）。
 */
export async function installPack(id: string): Promise<PackOutcome> {
  return post('/packs/install', { id });
}

/**
 * 从本地 zip 或目录安装一个已登记的资源包。
 *
 * @param id - 清单里的包 id。
 * @param source - 本地 zip 文件或目录的绝对路径。
 * @returns 结论；校验与落点全由宿主决定。
 */
export async function installPackFrom(
  id: string,
  source: { readonly kind: 'zip' | 'dir'; readonly path: string },
): Promise<PackOutcome> {
  return post('/packs/install', source.kind === 'zip' ? { id, zipPath: source.path } : { id, dir: source.path });
}

/**
 * 删除一个已安装的包。
 * @param id - 包 id。
 * @returns 结论。
 */
export async function removePack(id: string): Promise<PackOutcome> {
  return post('/packs/remove', { id });
}

/** 发一次 POST，把宿主的失败实体收成一句话。 */
async function post(path: string, payload: unknown): Promise<PackOutcome> {
  try {
    const response = await fetch(ROUTE_PATH + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };
    const body: unknown = await response.json();
    const record = body as { ok?: unknown; message?: unknown } | null;
    if (record?.ok === true) return { ok: true };
    return { ok: false, message: typeof record?.message === 'string' ? record.message : '安装失败' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
