/**
 * 宿主侧的音频目录扫描：把「素材根下可能放音效的几个目录」读成一份可解析的清单。
 *
 * 只读目录、不判定优先级（归 ./index-build），不碰 HTTP。目录不存在一律当作空，
 * 所以「一个音效文件都没有」与「目录还没建」走同一条路径，调用方不必分支。
 * @module dsh-pet/src/host/sfx/scan
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SFX_AUDIO_EXTS } from '../../shared/sfx/types.ts';

/** 扫描需要的目录（缺省的目录不存在或不适用）。 */
export interface SfxDirs {
  /** 皮肤目录根 `pet/<素材根>-skin/`；皮肤自己的音频放在它的一级子目录里。 */
  readonly skinDir?: string;
  /** 素材根自有声音目录 `pet/<素材根>-sound/`。 */
  readonly soundDir?: string;
  /** 用户级共享声音目录 `<用户根>/main-sound/`（仅 main 链有）。 */
  readonly userSoundDir?: string;
  /** 包内默认声音目录 `assets/sound/`。 */
  readonly packageSoundDir: string;
  /** 动画素材目录（动作音与动画同名同目录时用它），按优先级排列。 */
  readonly animationDirs: readonly string[];
}

/** 扫出来的原始文件清单：每个来源只列文件名（basename），顺序不影响结果。 */
export interface SfxSources {
  /** 已知皮肤 id（不含根布局的空串），供文件名前缀剥离。 */
  readonly skins: readonly string[];
  /** 皮肤目录内的音频：键 `''` = 根布局（皮肤目录本身就是一套皮肤）。 */
  readonly bySkin: Readonly<Record<string, readonly string[]>>;
  /** `-sound/` 里的文件名。 */
  readonly sound: readonly string[];
  /** `<用户根>/main-sound/` 里的文件名。 */
  readonly user: readonly string[];
  /** 动画目录里的文件名（动作音）。 */
  readonly animation: readonly string[];
  /** 包内默认目录里的文件名。 */
  readonly packaged: readonly string[];
}

/** 空清单：目录都读不到时的结果。 */
export const EMPTY_SOURCES: SfxSources = {
  animation: [],
  bySkin: {},
  packaged: [],
  skins: [],
  sound: [],
  user: [],
};

/** 忽略的文件名：`index.json` 之类不是音频，读不到也不该报警。 */
const IGNORED = new Set(['index', 'index.json']);

/**
 * `pets[].model` → 音效归属的皮肤目录名。
 *
 * layered 直接就是子目录名；live2d 的 model 是 `.model3.json` 的相对路径，音效按它所在的目录算
 * （模型摆在自己那层目录里是常见布局）。根下模型 → 空串（= 根布局）。
 *
 * @param model - `pets[].model` 原值。
 * @returns 皮肤 id；`''` = 根布局 / 没有皮肤。
 */
export function skinIdOfModel(model: string | undefined | null): string {
  const raw = (model ?? '').trim().replace(/\\/g, '/');
  if (raw === '') return '';
  const cut = raw.lastIndexOf('/');
  const last = cut < 0 ? raw : raw.slice(cut + 1);
  // 指到具体文件（live2d 的 .model3.json）：皮肤是它所在的目录；根下模型 → 空串。
  if (/\.json$/i.test(last)) return cut < 0 ? '' : raw.slice(0, cut);
  return raw;
}

/**
 * `pets[].model` 能不能当路径片段用：不许绝对路径、不许 `..`、不许反斜杠。
 *
 * 与 `isValidPetId` 的区别：这里要放行 `a/b/model.model3.json` 这种带层级的模型路径。
 *
 * @param model - 待校验值。
 * @returns 合法返回 true。
 */
export function isValidModelPath(model: string): boolean {
  if (model === '') return true;
  if (model.length > 260) return false;
  if (model.startsWith('/') || model.includes('\\')) return false;
  if (model.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return false;
  return true;
}

/**
 * 按扩展名白名单列目录里的音频文件名。
 *
 * @param dir - 目录；不存在或读不了时返回空数组。
 * @returns 文件名（basename，含扩展名），排序稳定。
 */
export function listAudio(dir: string | undefined): string[] {
  if (dir === undefined || dir === '') return [];
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (IGNORED.has(name)) continue;
    const lower = name.toLowerCase();
    const dot = lower.lastIndexOf('.');
    if (dot <= 0) continue;
    if (!SFX_AUDIO_EXTS.includes(lower.slice(dot))) continue;
    out.push(name);
  }
  // 同优先级内按扩展名偏好排序（wav 优先），再按名字，保证结果稳定可测。
  return out.sort((a, b) => {
    const ea = SFX_AUDIO_EXTS.indexOf(a.slice(a.lastIndexOf('.')).toLowerCase());
    const eb = SFX_AUDIO_EXTS.indexOf(b.slice(b.lastIndexOf('.')).toLowerCase());
    return ea - eb || a.localeCompare(b);
  });
}

/**
 * 列皮肤目录下的一级子目录名（= 皮肤 id）。
 *
 * @param skinDir - `pet/<素材根>-skin/`；不存在时返回空数组。
 * @returns 子目录名，排序稳定。
 */
export function listSkinIds(skinDir: string | undefined): string[] {
  if (skinDir === undefined || skinDir === '') return [];
  try {
    return readdirSync(skinDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * 读一遍全部音效目录。
 *
 * @param dirs - 各目录。
 * @returns 文件名清单；任何目录读失败都退化成空。
 */
export function readSfxSources(dirs: SfxDirs): SfxSources {
  const skinIds = listSkinIds(dirs.skinDir);
  const bySkin: Record<string, string[]> = {};
  if (dirs.skinDir !== undefined) {
    const rootFiles = listAudio(dirs.skinDir);
    if (rootFiles.length > 0) bySkin[''] = rootFiles;
    for (const skin of skinIds) {
      const files = listAudio(join(dirs.skinDir, skin));
      if (files.length > 0) bySkin[skin] = files;
    }
  }
  return {
    animation: dirs.animationDirs.flatMap((dir) => listAudio(dir)),
    bySkin,
    packaged: listAudio(dirs.packageSoundDir),
    skins: skinIds,
    sound: listAudio(dirs.soundDir),
    user: listAudio(dirs.userSoundDir),
  };
}
