/**
 * 点击音效的网页端入口：只把成品配置的开关转给共享播放器，素材地址在这里拼。
 * 播放、预热、节流、回退都在 shared/click-sfx：桌面端调同一份，免得两端各丢一次声卡冷启动。
 * 开关来自成品配置：配置没加载前保守静音，避免用户在设置页关掉后还响一声。
 * @module dsh-pet/src/client/pet/click-sound
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import { playClickSfx, setClickSfxEnabled } from '../../shared/click-sfx.ts';

/** 音效文件地址。 */
const CLICK_SOUND_URL = ROUTE_PATH + '/sound/click-duck.wav';

/**
 * 打开或关闭点击音效。
 *
 * @param enabled - 成品配置里的 `clickSoundEnabled`。
 * @param keepAlive - 成品配置里的 `clickSoundKeepAlive`：常驻预热，默认关。
 */
export function setClickSoundEnabled(enabled: boolean, keepAlive = false): void {
  setClickSfxEnabled(enabled, { url: CLICK_SOUND_URL, keepAlive });
}

/** 播放点击音效；开关关闭、节流中或音频不可用时静默返回。 */
export function playClickSound(): void {
  playClickSfx();
}
