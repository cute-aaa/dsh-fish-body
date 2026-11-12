/**
 * 音效子系统的常量与类型再出口。
 *
 * 类型定义在 shared/types（与 config.jsonc 同构的唯一类型模型处），避免 `types ↔ sfx` 双向 import；
 * 本模块只放「音效领域自己的」取值表。
 * @module dsh-pet/src/shared/sfx/types
 */
import type { SfxEventSlot } from '../types.ts';

/** 槽位全集（顺序即设置页展示顺序）；新增槽位时与 shared/types 的 {@link SfxEventSlot} 一起改。 */
export const SFX_EVENT_SLOTS: readonly SfxEventSlot[] = [
  'click',
  'throw',
  'floor',
  'wall',
  'ceiling',
  'pet',
  'sleepStart',
  'sleepEnd',
];

/** 槽位缺省节流窗口（毫秒）：点击最密，碰撞次之，睡眠与 hook 不节流。 */
export const SLOT_DEFAULT_THROTTLE_MS: Readonly<Record<SfxEventSlot, number>> = {
  click: 100,
  throw: 80,
  floor: 60,
  wall: 60,
  ceiling: 60,
  pet: 80,
  sleepStart: 0,
  sleepEnd: 0,
};

/** 分项音量的缺省值：不额外压低，响度只由总音量与撞击增益决定。 */
export const DEFAULT_CUE_VOLUME = 1;

/** 音频扩展名白名单（宿主扫描与路由共用；顺序即同优先级内的偏好）。 */
export const SFX_AUDIO_EXTS: readonly string[] = ['.wav', '.ogg', '.mp3', '.m4a'];

/**
 * hook 名的合法形状：字母数字与 `_`/`-`，1–64 字符。
 *
 * 宿主 `/sfx/<名字>` 路由、配置写叶子与设置页表单共用这一份口径，
 * 免得「设置页收得下、路由却回 bad-request」。
 */
export const SFX_HOOK_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
