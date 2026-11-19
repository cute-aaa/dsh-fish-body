/**
 * 人设角色库的记录形状：8 个卡片字段 + 身份与来源元信息。
 *
 * 只声明类型，不读盘不写盘；存储归 ./store，id 规则归 ./ids，应用归 ./apply。
 * 必须始终成立：**记录里不存正文**——正文每次由 `projectCard(record)` 现算，
 * 否则「字段改了但正文没改」会出现两份互相漂移的真相。
 * @module dsh-fish-body/src/host/persona/characters/types
 */
import type { CharaCardData } from '../../persona-source/card-reader.ts';

/** 角色来源：谁把它带进来的（扫描的卡 / 自定义路径 / 内置编辑 / 文档导入）。 */
export interface CharacterSource {
  /** `custom-text` = 来源只给了正文、没有结构化字段（落库时的降级路径）。 */
  readonly kind: 'soul-card' | 'custom' | 'editor' | 'document' | 'custom-text';
  /** 来源 id（`fish-soul` / `custom` / `import` …）。 */
  readonly id: string;
  /** 来源文件（文档导入时是文件名列表拼串；来源没有文件时为空串）。 */
  readonly path: string;
}

/** 角色库里的一个角色（一角色一个 `<id>.json`）。 */
export interface CharacterRecord extends CharaCardData {
  /** 角色 id：`slug(name)` 归一化的结果，直接当文件名用。 */
  readonly id: string;
  readonly source: CharacterSource;
  /** 导入时间（ISO 8601）。 */
  readonly importedAt: string;
  /** `sha1(projectCard(record))` 前 12 位：重复导入的判定依据。 */
  readonly fingerprint: string;
}

/** 被宠物引用的引用者（删除保护的回执）。 */
export interface PetRef {
  readonly pet: string;
  readonly entry: string;
}

/** 应用角色的结果（一次写盘；`unchanged` 表示三个键都已经是目标值）。 */
export type ApplyOutcome =
  | { status: 'applied'; petId: string; characterId: string; chars: number; wroteName: boolean }
  | { status: 'unchanged'; petId: string; characterId: string }
  | { status: 'skipped'; reason: 'readonly-entry' }
  | { status: 'failed'; reason: 'unknown-pet' | 'unknown-character' | 'write-failed' };
