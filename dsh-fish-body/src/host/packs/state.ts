/**
 * 资源包的磁盘状态：装在哪儿、装没装、怎么删。
 *
 * 布局（全部在用户数据根下，**不进插件包**）：
 *   `<数据根>/packs/<包id>/`            解压后的文件
 *   `<数据根>/packs/<包id>/installed.json`  安装标记（sha256 / 字节数 / 时间）
 *
 * 标记文件是「装好了」的唯一判据——目录存在但缺标记，说明上次装在解压中途断了，
 * 一律按未安装处理，重装时整个目录重来（解压不完整比没装更糟）。
 *
 * 本模块只碰磁盘、不做网络与校验策略：校验在 `verify.ts`，编排在 `install.ts`。
 * @module dsh-fish-body/src/host/packs/state
 */
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { createReadStream } from 'node:fs';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidPackId, isSha256Hex } from '../../shared/packs.ts';

/** 资源根目录名（`<数据根>/packs`）。 */
export const PACKS_DIR_NAME = 'packs';

/** 安装标记文件名。 */
export const INSTALLED_MARKER = 'installed.json';

/** 解压临时目录前缀（`install.ts` 的 `.tmp-<id>-<uuid>`，与这里共用一套命名）。 */
export const TEMP_DIR_PREFIX = '.tmp-';

/** 一条已安装记录（即标记文件的内容）。 */
export interface InstalledPack {
  readonly id: string;
  /** 安装时的包 sha256（来自清单，用于判断「同一个包出了新版本」）。 */
  readonly sha256: string;
  readonly bytes: number;
  readonly files: number;
  /** 安装完成时间（ISO 8601）。 */
  readonly at: string;
}

/**
 * 资源根：`<数据根>/packs`。
 * @param userRoot - 用户数据根。
 * @returns 资源根绝对路径。
 */
export function packsRootOf(userRoot: string): string {
  return join(userRoot, PACKS_DIR_NAME);
}

/**
 * 某个包的安装目录。
 * @param packsRoot - 资源根。
 * @param id - 包 id（必须已通过 {@link isValidPackId}）。
 * @returns 安装目录绝对路径。
 */
export function packDirOf(packsRoot: string, id: string): string {
  // id 会变成目录名：这里再挡一次，避免调用方漏校验时把 `../x` 拼进来。
  if (!isValidPackId(id)) throw new Error(`非法的包 id：${id}`);
  return join(packsRoot, id);
}

/**
 * 清掉上次被强制终止留下的解压临时目录。
 *
 * `install.ts` 把包解压到 `<packsRoot>/.tmp-<id>-<uuid>/` 再原子换名，正常收尾会自己删掉；
 * 但进程被强杀（关窗口、任务管理器结束、断电）时这一步不会执行，残留的空目录会一直堆在资源根里。
 * 它们不会被当成已装包（没有标记文件），只是脏。
 *
 * 只删 `.tmp-` 开头的**目录**：同名前缀的文件不归本模块管，删不掉就留着下次再来（不抛异常）。
 * @param packsRoot - 资源根。
 * @returns 实际删掉的目录名（按磁盘顺序），便于日志区分「清过」与「本来就干净」。
 */
export function sweepTempDirs(packsRoot: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(packsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TEMP_DIR_PREFIX)) continue;
    try {
      rmSync(join(packsRoot, entry.name), { recursive: true, force: true });
      removed.push(entry.name);
    } catch {
      // 占用中 / 权限不足：留着，下次启动再来；这里不该让宿主启动失败。
    }
  }
  return removed;
}

/**
 * 读一条安装标记。
 * @param packsRoot - 资源根。
 * @param id - 包 id。
 * @returns 形状合法的标记；缺失或写坏一律 undefined（按未安装处理）。
 */
export function readInstalled(packsRoot: string, id: string): InstalledPack | undefined {
  if (!isValidPackId(id)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(join(packDirOf(packsRoot, id), INSTALLED_MARKER), 'utf8');
  } catch {
    return undefined;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null) return undefined;
  const value = data as Record<string, unknown>;
  if (value.id !== id) return undefined;
  if (typeof value.sha256 !== 'string' || !isSha256Hex(value.sha256)) return undefined;
  if (typeof value.bytes !== 'number' || !Number.isFinite(value.bytes) || value.bytes <= 0) return undefined;
  if (typeof value.files !== 'number' || !Number.isFinite(value.files) || value.files <= 0) return undefined;
  if (typeof value.at !== 'string' || value.at === '') return undefined;
  return { id, sha256: value.sha256, bytes: value.bytes, files: value.files, at: value.at };
}

/**
 * 列出资源根下所有「装好了」的包。
 *
 * 只看标记文件，不扫内容：半装状态的目录会被自然跳过。
 * @param packsRoot - 资源根。
 * @returns 已安装记录（按 id 升序）。
 */
export function listInstalled(packsRoot: string): InstalledPack[] {
  let entries: string[];
  try {
    entries = readdirSync(packsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return entries
    .map((id) => readInstalled(packsRoot, id))
    .filter((item): item is InstalledPack => item !== undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * 写安装标记（原子：先写临时文件再改名，避免断电留下半个 JSON）。
 * @param packDir - 包安装目录（必须已解压完成）。
 * @param record - 记录内容。
 */
export function writeInstalled(packDir: string, record: InstalledPack): void {
  mkdirSync(packDir, { recursive: true });
  const target = join(packDir, INSTALLED_MARKER);
  const temp = target + '.tmp';
  writeFileSync(temp, JSON.stringify(record, null, 2) + '\n', 'utf8');
  renameSync(temp, target);
}

/**
 * 删掉一个包（连同目录）。标记与会话状态一并消失，下次按未安装处理。
 * @param packsRoot - 资源根。
 * @param id - 包 id。
 * @returns 原本存在并已删除为 true；本来就没有为 false。
 */
export function removePack(packsRoot: string, id: string): boolean {
  if (!isValidPackId(id)) return false;
  const dir = packDirOf(packsRoot, id);
  try {
    statSync(dir);
  } catch {
    return false;
  }
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * 计算文件 sha256（流式，几十 MB 的动画包也不会把整包读进内存）。
 * @param file - 文件绝对路径。
 * @returns 小写十六进制 sha256。
 */
export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('error', reject);
    hash.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * 统计目录下的文件总数（不跟随符号链接，只数普通文件）。
 * @param dir - 目录绝对路径。
 * @returns 文件数；目录不存在时为 0。
 */
export function countFiles(dir: string): number {
  let total = 0;
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) total += countFiles(join(dir, entry.name));
    else if (entry.isFile()) total += 1;
  }
  return total;
}
