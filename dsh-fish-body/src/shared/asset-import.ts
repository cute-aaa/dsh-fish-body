/**
 * 资源导入的共享契约：设置页提交什么、宿主接受哪些类别与上限。
 *
 * 只描述请求与预算，不碰磁盘；真正的复制、冲突判定与路径安全在宿主侧。
 * 单文件上限按最常用的本机素材设置，避免一次误选把数据根写满。
 * @module dsh-fish-body/src/shared/asset-import
 */
import type { RendererKind, SfxEventSlot } from './types.ts';

/** 音频单文件上限（字节）。 */
export const ASSET_IMPORT_MAX_AUDIO_BYTES = 20 * 1024 * 1024;

/** 会话鱼单文件上限（字节）。 */
export const ASSET_IMPORT_MAX_SESSION_FISH_BYTES = 50 * 1024 * 1024;

/** 皮肤目录总上限（字节）。 */
export const ASSET_IMPORT_MAX_SKIN_BYTES = 512 * 1024 * 1024;

/** 皮肤目录文件数上限。 */
export const ASSET_IMPORT_MAX_SKIN_FILES = 5000;

/** 音频扩展名白名单（小写，含点）。 */
export const AUDIO_IMPORT_EXTS = ['.wav', '.ogg', '.mp3', '.m4a'] as const;

/** 会话鱼扩展名白名单（小写，含点）。 */
export const SESSION_FISH_IMPORT_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.webm', '.mp4'] as const;

/** 音效导入目标：共享目录、某个事件槽、某个 hook。 */
export const SFX_IMPORT_TARGETS = ['shared', 'slot', 'hook'] as const;

/** 音效导入目标。 */
export type SfxImportTarget = (typeof SFX_IMPORT_TARGETS)[number];

/** 用户可提交的资源导入请求。 */
export type AssetImportRequest =
  | {
      readonly kind: 'skin';
      readonly renderer: RendererKind;
      readonly sourcePath: string;
      readonly overwrite?: boolean;
    }
  | {
      readonly kind: 'sfx';
      readonly sourcePath: string;
      readonly target: SfxImportTarget;
      readonly slot?: SfxEventSlot;
      readonly hook?: string;
      readonly overwrite?: boolean;
    }
  | {
      readonly kind: 'session-fish';
      readonly sourcePath: string;
      readonly overwrite?: boolean;
    };

/** 一次导入的落点与体量。 */
export interface ImportedAsset {
  /** 最终落盘的绝对路径。 */
  readonly path: string;
  /** 相对当前用户根的可读路径，供 UI 展示。 */
  readonly relativePath: string;
  /** 复制了多少个文件。 */
  readonly files: number;
  /** 复制了多少字节。 */
  readonly bytes: number;
}
