/**
 * 设置页的全局开关状态：系统通知、音效总闸（含常驻预热与总音量）、锁定在当前屏幕、系统托盘。
 *
 * 开关都只改本地状态、随「保存」整包写入——即时写盘会重启桌面 Helper、重建全部桌面宠物窗口。
 * 通知开关比其余几个多一步：开启时借用户手势申请权限，所以「键名 → setter」的查表也放在这里，
 * 卡片只回传键名，权限申请不外泄到卡片里。
 * owns only 这几个布尔值与通知权限申请，never 保存、加载与其它分区字段。
 * @module dsh-pet/src/client/settings/use-global-settings
 */
import { requestNotificationPermission } from '../notify.ts';
import type { MainConfigPatch } from './config/index.ts';
import type { GlobalFlagKey, GlobalFlags } from './global-flags.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 全局分区的状态与回调。 */
export interface GlobalSettings {
  /** 五个开关的当前值（键名即成品配置字段名）。 */
  readonly values: GlobalFlags;
  /** 音效总音量（0–1）；与语音音量各管各的。 */
  readonly sfxVolume: number;
  /** 切一个开关；通知开关会顺带申请权限。 */
  setFlag(key: GlobalFlagKey, value: boolean): void;
  /** 改音效总音量（0–1，前端已夹取）。 */
  setSfxVolume(value: number): void;
  /** 用成品配置覆盖能信的字段。 */
  apply(patch: MainConfigPatch): void;
}

/**
 * 管理五个全局开关。
 *
 * @param rt - 只用到 `useState` 与 `useCallback`。
 * @returns 当前值与改值入口。
 */
export function useGlobalSettings(rt: Pick<SettingsRuntime, 'useState' | 'useCallback'>): GlobalSettings {
  const { useState, useCallback } = rt;
  // 初值都是内置默认：加载成功后由成品值覆盖，未就绪期间整页只读，存不出去。
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [sfxEnabled, setSfxEnabled] = useState(true);
  const [sfxKeepAlive, setSfxKeepAlive] = useState(true);
  const [confineToScreen, setConfineToScreen] = useState(false);
  const [trayEnabled, setTrayEnabled] = useState(true);
  const [sfxVolume, setSfxVolume] = useState(0.5);

  // 键名到 setter 的映射只写一遍，避免长 switch；通知开关的权限申请走同一条入口。
  const setFlag = useCallback(
    (key: GlobalFlagKey, value: boolean): void => {
      if (key !== 'notificationsEnabled') {
        if (key === 'sfxEnabled') setSfxEnabled(value);
        else if (key === 'sfxKeepAlive') setSfxKeepAlive(value);
        else if (key === 'confineToScreen') setConfineToScreen(value);
        else setTrayEnabled(value);
        return;
      }
      setNotificationsEnabled(value);
      // 只在开启时申请：无手势的自动申请可能被浏览器静默压制。
      if (value) void requestNotificationPermission();
    },
    [setSfxEnabled, setSfxKeepAlive, setConfineToScreen, setNotificationsEnabled, setTrayEnabled],
  );

  // 只有 setState，跨渲染稳定：放进设置页 applyConfig 的依赖里不会让配置反复重拉。
  const apply = useCallback((patch: MainConfigPatch): void => {
    if (patch.notificationsEnabled !== undefined) setNotificationsEnabled(patch.notificationsEnabled);
    if (patch.sfxEnabled !== undefined) setSfxEnabled(patch.sfxEnabled);
    if (patch.sfxKeepAlive !== undefined) setSfxKeepAlive(patch.sfxKeepAlive);
    if (patch.confineToScreen !== undefined) setConfineToScreen(patch.confineToScreen);
    if (patch.trayEnabled !== undefined) setTrayEnabled(patch.trayEnabled);
    if (patch.sfxVolume !== undefined) setSfxVolume(patch.sfxVolume);
  }, []);

  return {
    values: { notificationsEnabled, sfxEnabled, sfxKeepAlive, confineToScreen, trayEnabled },
    sfxVolume,
    setFlag,
    setSfxVolume,
    apply,
  };
}
