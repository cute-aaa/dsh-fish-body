/**
 * 资源包安装编排：三种来源（清单里的 https 地址 / 本地 zip / 本地目录）收敛成同一条流水线。
 *
 * 流水线固定为四步，任何一步失败都**不留残余**：
 *   1. 落临时目录（`<packsRoot>/.tmp-<id>-<uuid>`，与包目录同卷，保证 rename 是原子的）；
 *   2. 校验：下载来源比体积 + sha256；本地来源只记录实际 sha256（用户的文件，按首次信任处理）；
 *   3. 内容非空（0 文件视为失败——空包被当成「装好」比没装更难排查）；
 *   4. 原子换名 + 写 `installed.json` 标记。
 *
 * 校验失败**不会**换下一个镜像重试：sha256 不符意味着拿到的不是清单承诺的东西，
 * 静默换源会把「有人在中间换了包」变成一次无感的成功。体积不符才换源（通常是截断）。
 *
 * `fetchImpl` 与 `extractZip` 都可注入：单测不联网、不依赖真实 zip。
 * @module dsh-fish-body/src/host/packs/install
 */
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PackEntry } from '../../shared/packs.ts';
import { isValidPackId } from '../../shared/packs.ts';
import { countFiles, hashFile, packDirOf, writeInstalled, type InstalledPack } from './state.ts';

/** 单个镜像的下载截止时间（毫秒）。素材包最大几十 MB，2 分钟足够；超时按该镜像失败处理。 */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** 安装失败的原因（wire 词汇，路由层直接透给 UI）。 */
export type InstallFailureReason =
  'bad-source' | 'download-failed' | 'checksum-mismatch' | 'extract-failed' | 'empty-pack' | 'install-failed';

/** 安装结论。 */
export type InstallResult =
  | { readonly ok: true; readonly installed: InstalledPack }
  | { readonly ok: false; readonly reason: InstallFailureReason; readonly message: string };

/** 安装所需的外部依赖（全部可注入，便于单测）。 */
export interface PackInstallDeps {
  /** 资源根（`<数据根>/packs`）。 */
  readonly packsRoot: string;
  /** 下载实现，缺省用全局 `fetch`。 */
  readonly fetchImpl?: typeof fetch;
  /** zip 解压，缺省用 `@electron-internal/extract-zip`（与 Electron 运行时同一套）。 */
  readonly extractZip?: (zipPath: string, destDir: string) => Promise<void>;
  /** 过程日志（失败原因也会走这里，便于用户回看）。 */
  readonly log?: (message: string) => void;
}

/** 默认解压实现：动态引入，避免把原生依赖拖进不下载素材的场景。 */
async function defaultExtractZip(zipPath: string, destDir: string): Promise<void> {
  const { default: extract } = await import('@electron-internal/extract-zip');
  await extract(zipPath, { dir: destDir });
}

/** 临时目录路径（与最终目录同卷、同父，rename 才是原子的）。 */
function tempDirOf(packsRoot: string, id: string): string {
  return join(packsRoot, `.tmp-${id}-${randomUUID()}`);
}

/**
 * 收尾：数文件 → 原子换名 → 写标记。失败时清掉临时目录。
 * @param deps - 安装依赖。
 * @param id - 包 id。
 * @param tempDir - 已就绪的临时目录。
 * @param record - 要写进标记的内容（`files` 以实际统计为准）。
 * @returns 安装结论。
 */
function finalize(
  deps: PackInstallDeps,
  id: string,
  tempDir: string,
  record: Pick<InstalledPack, 'id' | 'sha256' | 'bytes'>,
): InstallResult {
  const files = countFiles(tempDir);
  if (files === 0) {
    rmSync(tempDir, { recursive: true, force: true });
    return { ok: false, reason: 'empty-pack', message: '包内没有文件，已丢弃' };
  }
  const finalDir = packDirOf(deps.packsRoot, id);
  const installed: InstalledPack = { ...record, files, at: new Date().toISOString() };
  try {
    rmSync(finalDir, { recursive: true, force: true });
    mkdirSync(deps.packsRoot, { recursive: true });
    renameSync(tempDir, finalDir);
    writeInstalled(finalDir, installed);
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: 'install-failed', message };
  }
  deps.log?.(`[packs] 已安装 ${id}（${files} 个文件，${installed.bytes} 字节）`);
  return { ok: true, installed };
}

/**
 * 按清单条目安装：依次尝试 `urls`，任何一步失败都清掉临时文件。
 *
 * 体积不符 → 换下一个镜像；sha256 不符 → 立即中止（见模块头注释）。
 * @param entry - 清单条目。
 * @param deps - 安装依赖。
 * @returns 安装结论。
 */
export async function installFromUrls(entry: PackEntry, deps: PackInstallDeps): Promise<InstallResult> {
  if (!isValidPackId(entry.id)) return { ok: false, reason: 'bad-source', message: `非法的包 id：${entry.id}` };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const extract = deps.extractZip ?? defaultExtractZip;
  let lastError = '';

  for (const url of entry.urls) {
    const tempDir = tempDirOf(deps.packsRoot, entry.id);
    try {
      const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength !== entry.bytes) {
        throw new Error(`体积不符：清单 ${entry.bytes}，实得 ${buffer.byteLength}`);
      }
      mkdirSync(tempDir, { recursive: true });
      const zipPath = join(tempDir, 'pack.zip');
      writeFileSync(zipPath, buffer);
      const actual = await hashFile(zipPath);
      if (actual !== entry.sha256) {
        rmSync(tempDir, { recursive: true, force: true });
        return {
          ok: false,
          reason: 'checksum-mismatch',
          message: `sha256 不符（来源 ${url}）：清单 ${entry.sha256}，实得 ${actual}。已中止，未尝试其它镜像。`,
        };
      }
      try {
        await extract(zipPath, tempDir);
      } catch (error) {
        rmSync(tempDir, { recursive: true, force: true });
        return { ok: false, reason: 'extract-failed', message: error instanceof Error ? error.message : String(error) };
      }
      rmSync(zipPath, { force: true });
      return finalize(deps, entry.id, tempDir, { id: entry.id, sha256: entry.sha256, bytes: entry.bytes });
    } catch (error) {
      rmSync(tempDir, { recursive: true, force: true });
      lastError = `${url}：${error instanceof Error ? error.message : String(error)}`;
      deps.log?.(`[packs] 下载失败 ${lastError}`);
    }
  }
  return { ok: false, reason: 'download-failed', message: lastError || '没有可用下载地址' };
}

/**
 * 从本地 zip 安装（手动导入）。没有清单条目时，sha256 取实际值并记录——这是「用户的文件」，
 * 按首次信任处理；安装后标记里的 sha 可用于「文件被换掉」的后续检查。
 * @param id - 包 id。
 * @param zipPath - 本地 zip 绝对路径。
 * @param deps - 安装依赖。
 * @returns 安装结论。
 */
export async function installFromZip(id: string, zipPath: string, deps: PackInstallDeps): Promise<InstallResult> {
  if (!isValidPackId(id)) return { ok: false, reason: 'bad-source', message: `非法的包 id：${id}` };
  const extract = deps.extractZip ?? defaultExtractZip;
  const tempDir = tempDirOf(deps.packsRoot, id);
  try {
    const size = statSync(zipPath).size;
    const sha256 = await hashFile(zipPath);
    mkdirSync(tempDir, { recursive: true });
    await extract(zipPath, tempDir);
    return finalize(deps, id, tempDir, { id, sha256, bytes: size });
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    deps.log?.(`[packs] 解压失败 ${id}：${message}`);
    return { ok: false, reason: 'extract-failed', message };
  }
}

/**
 * 从本地目录安装（手动导入）：整棵目录复制进临时目录再原子换名。
 * @param id - 包 id。
 * @param sourceDir - 源目录绝对路径。
 * @param deps - 安装依赖。
 * @returns 安装结论。
 */
export async function installFromDir(id: string, sourceDir: string, deps: PackInstallDeps): Promise<InstallResult> {
  if (!isValidPackId(id)) return { ok: false, reason: 'bad-source', message: `非法的包 id：${id}` };
  const tempDir = tempDirOf(deps.packsRoot, id);
  try {
    mkdirSync(tempDir, { recursive: true });
    cpSync(sourceDir, tempDir, { recursive: true });
    const files = countFiles(tempDir);
    if (files === 0) {
      rmSync(tempDir, { recursive: true, force: true });
      return { ok: false, reason: 'empty-pack', message: '源目录里没有文件' };
    }
    // 目录来源没有单一「包 sha」：用「id + 文件清单摘要」占位，仅供后续判断是否被换过。
    const sha256 = await hashDirListing(tempDir);
    return finalize(deps, id, tempDir, { id, sha256, bytes: 0 });
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    deps.log?.(`[packs] 目录导入失败 ${id}：${message}`);
    return { ok: false, reason: 'install-failed', message };
  }
}

/**
 * 目录来源的「包指纹」：按相对路径 + 文件大小 + 内容哈希汇总，得到 64 位十六进制。
 *
 * 只为「这次装的和我上次记的是不是同一份」服务，不是安全边界（安全边界是下载来源的 sha256）。
 * @param dir - 目录绝对路径。
 * @returns 64 位十六进制摘要。
 */
async function hashDirListing(dir: string): Promise<string> {
  const hash = createHash('sha256');
  const walk = async (current: string, prefix: string): Promise<void> => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const abs = join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(abs, rel);
      else if (entry.isFile()) {
        hash.update(rel);
        hash.update(await hashFile(abs));
      }
    }
  };
  await walk(dir, '');
  return hash.digest('hex');
}
