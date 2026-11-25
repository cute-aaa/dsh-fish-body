/**
 * 用户素材导入：把选中的文件/目录原子复制到数据根，并做路径、类型与体量校验。
 *
 * 目的地永远由宿主按类别算好；源路径只读，目录导入拒绝符号链接，避免把树外的内容带进来。
 * @module dsh-fish-body/src/host/assets-import/import
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import type { Stats } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path';
import {
  ASSET_IMPORT_MAX_AUDIO_BYTES,
  ASSET_IMPORT_MAX_SESSION_FISH_BYTES,
  ASSET_IMPORT_MAX_SKIN_BYTES,
  ASSET_IMPORT_MAX_SKIN_FILES,
  AUDIO_IMPORT_EXTS,
  SESSION_FISH_IMPORT_EXTS,
  type AssetImportRequest,
  type ImportedAsset,
} from '../../shared/asset-import.ts';
import { buildSfxIndex } from '../sfx/index-build.ts';
import { sfxPathsOf } from '../sfx/paths.ts';
import { readSfxSources, skinIdOfModel } from '../sfx/scan.ts';
import type { RendererKind, SfxEventSlot } from '../../shared/types.ts';

/** 导入上下文；路径全部由装配根给出。 */
export interface AssetImportContext {
  readonly userRoot: string;
  readonly skinsDir: string;
  readonly sessionFishDir: string;
  readonly sharedSoundDir: string;
  /** 按素材根取音效目录集；仅 slot 导入需要。 */
  readonly soundDirsFor: (
    assetRoot: string,
    ext: string,
    opts?: { renderer?: RendererKind; model?: string },
  ) => Parameters<typeof readSfxSources>[0];
  /** 日志出口；测试可省略。 */
  readonly log?: { info?(message: string): void };
}

/** 声音槽导入需要当前宠物的上下文。 */
export interface SlotImportPet {
  readonly assetRoot: string;
  readonly renderer: RendererKind;
  readonly model: string;
}

/** 导入失败原因。 */
export interface AssetImportFailure {
  readonly ok: false;
  readonly reason:
    'bad-request' | 'import-conflict' | 'import-too-large' | 'import-unsupported' | 'settings-write-failed';
  readonly message: string;
}

/** 导入结论。 */
export type AssetImportResult = { readonly ok: true; readonly imported: ImportedAsset } | AssetImportFailure;

/** 把错误收成一句可展示的话。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 源路径必须是绝对路径且真实存在；返回 realpath 与 stat。 */
function sourceOf(raw: string): { ok: true; path: string; stat: Stats } | AssetImportFailure {
  const value = raw.trim();
  if (value === '') return { ok: false, reason: 'bad-request', message: 'sourcePath 必填' };
  if (!isAbsolute(value)) return { ok: false, reason: 'bad-request', message: 'sourcePath 必须是绝对路径' };
  try {
    const path = realpathSync(value);
    return { ok: true, path, stat: statSync(path) };
  } catch {
    return { ok: false, reason: 'bad-request', message: 'sourcePath 不存在或无法读取' };
  }
}

/** 目标已存在且未允许覆盖。 */
function conflict(target: string): AssetImportFailure {
  return { ok: false, reason: 'import-conflict', message: `目标已存在：${target}` };
}

/** 文件扩展名是否在允许集合内。 */
function hasExt(name: string, exts: readonly string[]): boolean {
  return (exts as readonly string[]).includes(extname(name).toLowerCase());
}

/**
 * 递归盘点目录，拒绝符号链接并累计体量。
 *
 * @param dir - 已 realpath 的源目录。
 * @returns 文件数与字节数；超限或遇到符号链接时失败。
 */
function measureDir(dir: string): { ok: true; files: number; bytes: number } | AssetImportFailure {
  let files = 0;
  let bytes = 0;
  const walk = (current: string): AssetImportFailure | undefined => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      return { ok: false, reason: 'settings-write-failed', message: `读取源目录失败：${errorText(error)}` };
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        return { ok: false, reason: 'import-unsupported', message: '皮肤目录里不允许符号链接' };
      }
      if (entry.isDirectory()) {
        const nested = walk(path);
        if (nested !== undefined) return nested;
        continue;
      }
      if (!entry.isFile()) continue;
      files += 1;
      try {
        bytes += lstatSync(path).size;
      } catch (error) {
        return { ok: false, reason: 'settings-write-failed', message: `读取文件失败：${errorText(error)}` };
      }
      if (files > ASSET_IMPORT_MAX_SKIN_FILES) {
        return { ok: false, reason: 'import-too-large', message: `皮肤文件数超过 ${ASSET_IMPORT_MAX_SKIN_FILES}` };
      }
      if (bytes > ASSET_IMPORT_MAX_SKIN_BYTES) {
        return {
          ok: false,
          reason: 'import-too-large',
          message: `皮肤目录超过 ${Math.round(ASSET_IMPORT_MAX_SKIN_BYTES / 1024 / 1024)} MiB`,
        };
      }
    }
    return undefined;
  };
  const failed = walk(dir);
  return failed ?? { ok: true, files, bytes };
}

/** 把文件复制到目标；同目录临时文件 + rename，目标冲突由调用方先判。 */
function copyFileAtomically(source: string, target: string, overwrite: boolean): void {
  if (existsSync(target) && !overwrite) throw new Error('conflict');
  mkdirSync(dirname(target), { recursive: true });
  const temp = target + '.tmp-' + process.pid + '-' + Date.now();
  const backup = target + '.bak-' + process.pid + '-' + Date.now();
  try {
    copyFileSync(source, temp);
    if (existsSync(target)) {
      if (!overwrite) throw new Error('conflict');
      renameSync(target, backup);
    }
    renameSync(temp, target);
    rmSync(backup, { force: true });
  } catch (error) {
    rmSync(temp, { force: true });
    if (existsSync(backup) && !existsSync(target)) renameSync(backup, target);
    throw error;
  }
}

/** 把目录复制到目标；目录用 rename 原子落位，失败时恢复旧目录。 */
function copyDirAtomically(source: string, target: string, overwrite: boolean): void {
  if (existsSync(target) && !overwrite) throw new Error('conflict');
  mkdirSync(dirname(target), { recursive: true });
  const temp = target + '.tmp-' + process.pid + '-' + Date.now();
  const backup = target + '.bak-' + process.pid + '-' + Date.now();
  try {
    cpDirectory(source, temp);
    if (existsSync(target)) {
      if (!overwrite) throw new Error('conflict');
      renameSync(target, backup);
    }
    renameSync(temp, target);
    rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    if (existsSync(backup) && !existsSync(target)) renameSync(backup, target);
    throw error;
  }
}

/** 复制目录内容；源已在 measureDir 里拒绝符号链接。 */
function cpDirectory(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) cpDirectory(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

/** 文件体量检查。 */
function checkFileSize(size: number, limit: number, label: string): AssetImportFailure | undefined {
  return size <= limit
    ? undefined
    : { ok: false, reason: 'import-too-large', message: `${label}超过 ${Math.round(limit / 1024 / 1024)} MiB` };
}

/** 落点展示路径：根内给相对路径，根外保留绝对路径。 */
function displayPathOf(userRoot: string, target: string): string {
  const rel = relative(userRoot, target);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? target : rel;
}

/** 导入皮肤：layered/live2d 是目录，webm 是单个文件。 */
function importSkin(
  request: Extract<AssetImportRequest, { kind: 'skin' }>,
  ctx: AssetImportContext,
): AssetImportResult {
  const source = sourceOf(request.sourcePath);
  if (!source.ok) return source;
  if (request.renderer === 'webm') {
    if (!source.stat.isFile() || !hasExt(source.path, ['.webm'])) {
      return { ok: false, reason: 'import-unsupported', message: 'webm 皮肤只能导入 .webm 文件' };
    }
    const target = join(ctx.skinsDir, 'webm', basename(source.path));
    if (existsSync(target) && request.overwrite !== true) return conflict(target);
    try {
      copyFileAtomically(source.path, target, request.overwrite === true);
    } catch (error) {
      return {
        ok: false,
        reason: errorText(error) === 'conflict' ? 'import-conflict' : 'settings-write-failed',
        message: errorText(error),
      };
    }
    return {
      ok: true,
      imported: { path: target, relativePath: displayPathOf(ctx.userRoot, target), files: 1, bytes: source.stat.size },
    };
  }

  if (!source.stat.isDirectory()) {
    return { ok: false, reason: 'import-unsupported', message: 'layered / live2d 皮肤需要选择目录' };
  }
  const measured = measureDir(source.path);
  if (!measured.ok) return measured;
  const files = readdirSync(source.path).map((name) => name.toLowerCase());
  const valid =
    request.renderer === 'layered'
      ? files.includes('manifest.json')
      : readdirSync(source.path, { recursive: true }).some((name) =>
          String(name).toLowerCase().endsWith('.model3.json'),
        );
  if (!valid) {
    return {
      ok: false,
      reason: 'import-unsupported',
      message: request.renderer === 'layered' ? '目录里没有 manifest.json' : '目录里没有 *.model3.json',
    };
  }
  const id = basename(source.path);
  const target = join(ctx.skinsDir, request.renderer, id);
  if (existsSync(target) && request.overwrite !== true) return conflict(target);
  try {
    copyDirAtomically(source.path, target, request.overwrite === true);
  } catch (error) {
    return {
      ok: false,
      reason: errorText(error) === 'conflict' ? 'import-conflict' : 'settings-write-failed',
      message: errorText(error),
    };
  }
  return {
    ok: true,
    imported: {
      path: target,
      relativePath: displayPathOf(ctx.userRoot, target),
      files: measured.files,
      bytes: measured.bytes,
    },
  };
}

/** 找事件槽的落点；优先使用宿主当前建议，其次替换当前命中的文件。 */
function slotTarget(
  ctx: AssetImportContext,
  pet: SlotImportPet,
  slot: SfxEventSlot,
  nextExt: string,
): string | AssetImportFailure {
  const dirs = ctx.soundDirsFor(pet.assetRoot, '.webm', { model: pet.model, renderer: pet.renderer });
  const sources = readSfxSources(dirs);
  const index = buildSfxIndex({
    model: skinIdOfModel(pet.model),
    poolSkinName: dirs.poolSkinName,
    poolSkinStructures: dirs.poolSkinStructures,
    renderer: pet.renderer,
    sources,
  });
  const landed = sfxPathsOf({
    dirs,
    index,
    model: skinIdOfModel(pet.model),
    renderer: pet.renderer,
    userRoot: ctx.userRoot,
  });
  const suggestion = landed.suggestions[slot];
  const current = suggestion?.absolute ?? landed.paths[slot];
  if (current !== undefined) {
    const currentExt = extname(current);
    return join(dirname(current), basename(current, currentExt) + nextExt);
  }
  return { ok: false, reason: 'import-unsupported', message: '当前皮肤没有可写的音效落点，请先选择皮肤或模型' };
}

/** 导入音效并返回落点。 */
function importSfx(
  request: Extract<AssetImportRequest, { kind: 'sfx' }>,
  ctx: AssetImportContext,
  pet: SlotImportPet | undefined,
): AssetImportResult {
  const source = sourceOf(request.sourcePath);
  if (!source.ok) return source;
  if (!source.stat.isFile() || !hasExt(source.path, AUDIO_IMPORT_EXTS)) {
    return { ok: false, reason: 'import-unsupported', message: '音效只支持 wav / ogg / mp3 / m4a' };
  }
  const tooLarge = checkFileSize(source.stat.size, ASSET_IMPORT_MAX_AUDIO_BYTES, '音效文件');
  if (tooLarge !== undefined) return tooLarge;

  let target: string;
  if (request.target === 'shared') {
    target = join(ctx.sharedSoundDir, basename(source.path));
  } else if (request.target === 'hook') {
    const name = (request.hook ?? '').trim();
    if (name === '') return { ok: false, reason: 'bad-request', message: 'hook 名称必填' };
    target = join(ctx.sharedSoundDir, 'hook-' + name + extname(source.path).toLowerCase());
  } else {
    if (pet === undefined) return { ok: false, reason: 'bad-request', message: '槽位导入需要指定宠物' };
    if (request.slot === undefined) return { ok: false, reason: 'bad-request', message: 'slot 必填' };
    const resolved = slotTarget(ctx, pet, request.slot, extname(source.path).toLowerCase());
    if (typeof resolved !== 'string') return resolved;
    target = resolved;
  }
  if (existsSync(target) && request.overwrite !== true) return conflict(target);
  try {
    copyFileAtomically(source.path, target, request.overwrite === true);
  } catch (error) {
    return {
      ok: false,
      reason: errorText(error) === 'conflict' ? 'import-conflict' : 'settings-write-failed',
      message: errorText(error),
    };
  }
  return {
    ok: true,
    imported: {
      path: target,
      relativePath: displayPathOf(ctx.userRoot, target),
      files: 1,
      bytes: source.stat.size,
    },
  };
}

/** 导入会话鱼皮肤。 */
function importSessionFish(
  request: Extract<AssetImportRequest, { kind: 'session-fish' }>,
  ctx: AssetImportContext,
): AssetImportResult {
  const source = sourceOf(request.sourcePath);
  if (!source.ok) return source;
  if (!source.stat.isFile() || !hasExt(source.path, SESSION_FISH_IMPORT_EXTS)) {
    return { ok: false, reason: 'import-unsupported', message: '会话鱼只支持图片、GIF、webm、mp4' };
  }
  const tooLarge = checkFileSize(source.stat.size, ASSET_IMPORT_MAX_SESSION_FISH_BYTES, '会话鱼文件');
  if (tooLarge !== undefined) return tooLarge;
  const target = join(ctx.sessionFishDir, basename(source.path));
  if (existsSync(target) && request.overwrite !== true) return conflict(target);
  try {
    copyFileAtomically(source.path, target, request.overwrite === true);
  } catch (error) {
    return {
      ok: false,
      reason: errorText(error) === 'conflict' ? 'import-conflict' : 'settings-write-failed',
      message: errorText(error),
    };
  }
  return {
    ok: true,
    imported: { path: target, relativePath: displayPathOf(ctx.userRoot, target), files: 1, bytes: source.stat.size },
  };
}

/**
 * 执行一次资源导入。
 *
 * @param request - 已通过 schema 的请求。
 * @param ctx - 用户根与固定落点目录。
 * @param pet - slot 导入所需的当前宠物；其他类别可省略。
 * @returns 导入结论；失败不抛异常。
 */
export function importAsset(
  request: AssetImportRequest,
  ctx: AssetImportContext,
  pet?: SlotImportPet,
): AssetImportResult {
  try {
    const result =
      request.kind === 'skin'
        ? importSkin(request, ctx)
        : request.kind === 'sfx'
          ? importSfx(request, ctx, pet)
          : importSessionFish(request, ctx);
    if (result.ok) ctx.log?.info?.('[fish-body] 已导入素材：' + result.imported.relativePath);
    return result;
  } catch (error) {
    return { ok: false, reason: 'settings-write-failed', message: errorText(error) };
  }
}
