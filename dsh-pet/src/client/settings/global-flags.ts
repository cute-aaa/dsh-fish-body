/**
 * 五个全局开关的键名、取值形状与展示顺序——状态、卡片与保存请求体共用这一份。
 *
 * 开关被拆到两张卡里（音效那三项进「声音」，通知/托盘/锁定屏幕进「系统」），但键名与顺序
 * 只在这里定义一次：`PUT /config` 的字段名就是这些键名，多写一份映射迟早会漂。
 * @module dsh-pet/src/client/settings/global-flags
 */

/** 五个全局开关的键名，与成品配置的字段名一致。 */
export type GlobalFlagKey = 'notificationsEnabled' | 'sfxEnabled' | 'sfxKeepAlive' | 'confineToScreen' | 'trayEnabled';

/** 五个全局开关的当前值。 */
export type GlobalFlags = Record<GlobalFlagKey, boolean>;

/** 一个开关的展示定义：键名、文案键，以及它属于哪张卡（只在装配分区时用）。 */
export interface GlobalFlagDef {
  readonly key: GlobalFlagKey;
  /** 文案键（标题）；问号说明是 `<label>Hint`。 */
  readonly label: string;
  /** `audio` = 音效总闸卡；`system` = 系统与桌面卡。 */
  readonly card: 'audio' | 'system';
}

/** 展示顺序即 `PUT /config` 之外的两张卡里的排列顺序。 */
export const GLOBAL_FLAGS: readonly GlobalFlagDef[] = [
  { key: 'notificationsEnabled', label: 'notifyToggle', card: 'system' },
  { key: 'sfxEnabled', label: 'sfxToggle', card: 'audio' },
  { key: 'sfxKeepAlive', label: 'sfxKeepAliveToggle', card: 'audio' },
  { key: 'confineToScreen', label: 'confineToggle', card: 'system' },
  { key: 'trayEnabled', label: 'trayToggle', card: 'system' },
];
