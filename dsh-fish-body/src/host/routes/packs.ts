/**
 * 资源包路由：`GET /packs`、`POST /packs/install`、`POST /packs/remove`。
 *
 * 只做三件事：读清单并合并「装没装」、按 id 触发安装、按 id 删除。
 * 下载与校验的编排全在 `../packs/install`——路由层不碰网络、不碰 fs，
 * 也因此不会把「等下载」的时限塞进这里（见 `pick-no-timeout-guard.test.ts` 的扫描面）。
 *
 * 安装是同步等待的：大包（几十 MB）会让这个请求挂上一会儿，客户端用「进行中」状态占位。
 * 返回后清单状态才是真值——UI 不该自己推测「装好了」。
 * @module dsh-fish-body/src/host/routes/packs
 */
import { readFileSync } from 'node:fs';
import { isValidPackId, parsePackManifest, type PackEntry } from '../../shared/packs.ts';
import { installFromDir, installFromUrls, installFromZip, type PackInstallDeps } from '../packs/install.ts';
import { listInstalled, removePack, type InstalledPack } from '../packs/state.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';

/** 清单里的一条 + 本机安装状态。 */
interface PackView extends PackEntry {
  /** 已装记录；未装为 null。 */
  readonly installed: InstalledPack | null;
  /** 已装且 sha256 与清单一致（同一个包出了新版本时为 false）。 */
  readonly upToDate: boolean;
}

/** 读清单的结论：文件缺失按空清单处理（首次发布还没有素材包是正常状态）。 */
type ManifestRead =
  { readonly ok: true; readonly packs: readonly PackEntry[] } | { readonly ok: false; readonly message: string };

/**
 * 读包内清单。文件不存在 → 空清单；存在但写坏 → 失败（写坏说明有人在乱改，不能假装没有）。
 * @param deps - 路由依赖（取清单路径）。
 * @returns 清单结论。
 */
function readManifest(deps: PetRouteDeps): ManifestRead {
  let raw: string;
  try {
    raw = readFileSync(deps.packManifestPath, 'utf8');
  } catch {
    return { ok: true, packs: [] };
  }
  const parsed = parsePackManifest(raw);
  if (!parsed.ok) return { ok: false, message: `${parsed.reason}: ${parsed.message}` };
  return { ok: true, packs: parsed.manifest.packs };
}

/**
 * 把清单与已装状态合并成给 UI 的视图。
 * @param deps - 路由依赖。
 * @param packs - 清单条目。
 * @returns 视图数组。
 */
function viewOf(deps: PetRouteDeps, packs: readonly PackEntry[]): PackView[] {
  const installed = new Map(listInstalled(deps.packsRoot).map((item) => [item.id, item]));
  return packs.map((entry) => {
    const record = installed.get(entry.id) ?? null;
    return { ...entry, installed: record, upToDate: record !== null && record.sha256 === entry.sha256 };
  });
}

/** 解析 JSON 请求体；失败给出可直接返回的应答。 */
function readBody(
  body: string | undefined,
): { ok: true; value: Record<string, unknown> } | { ok: false; result: RouteResult } {
  if (body === undefined || body.trim() === '') return { ok: false, result: invalidJson('请求体不能为空') };
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, result: invalidJson('请求体必须是 JSON 对象') };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, result: invalidJson() };
  }
}

/** 资源包领域：未命中返回 undefined，命中返回应答。 */
export async function handlePacksRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { rest, method, body } = input;
  if (rest !== 'packs' && !rest.startsWith('packs/')) return undefined;

  if (rest === 'packs') {
    if (method !== 'GET') return methodNotAllowed();
    const manifest = readManifest(deps);
    if (!manifest.ok) return failResult('internal-error', `资源包清单读取失败：${manifest.message}`);
    return okResult({ ok: true, packs: viewOf(deps, manifest.packs) });
  }

  if (rest === 'packs/install') {
    if (method !== 'POST') return methodNotAllowed();
    const parsed = readBody(body);
    if (!parsed.ok) return parsed.result;
    const id = String(parsed.value.id ?? '').trim();
    if (!isValidPackId(id)) return failResult('bad-request', '包 id 非法（小写字母/数字/连字符，≤32 位）');
    const zipPath = typeof parsed.value.zipPath === 'string' ? parsed.value.zipPath.trim() : '';
    const dir = typeof parsed.value.dir === 'string' ? parsed.value.dir.trim() : '';
    // 安装层只认「资源根 + 日志函数」；宿主 logger 是对象（info/warn/error），这里收口成一行。
    const installDeps: PackInstallDeps = { packsRoot: deps.packsRoot, log: (message) => deps.log.info(message) };

    const result =
      zipPath !== ''
        ? await installFromZip(id, zipPath, installDeps)
        : dir !== ''
          ? await installFromDir(id, dir, installDeps)
          : await (async () => {
              const manifest = readManifest(deps);
              if (!manifest.ok)
                return { ok: false as const, reason: 'install-failed' as const, message: manifest.message };
              const entry = manifest.packs.find((item) => item.id === id);
              if (!entry) return { ok: false as const, reason: 'bad-source' as const, message: `清单里没有 ${id}` };
              return installFromUrls(entry, installDeps);
            })();

    if (!result.ok) return failResult('pack-install-failed', result.message);
    return okResult({ ok: true, pack: result.installed });
  }

  if (rest === 'packs/remove') {
    if (method !== 'POST') return methodNotAllowed();
    const parsed = readBody(body);
    if (!parsed.ok) return parsed.result;
    const id = String(parsed.value.id ?? '').trim();
    if (!isValidPackId(id)) return failResult('bad-request', '包 id 非法');
    if (!removePack(deps.packsRoot, id)) return failResult('not-found', `没有安装 ${id}`);
    return okResult({ ok: true, id });
  }

  // packs/* 的未知子路径：明确拒绝，别落到素材兜底去换个说法报错。
  return failResult('not-found', `未知的资源包端点：${rest}`);
}
