/**
 * 识屏循环（渲染端）：定期问宿主「这一拍拍不拍」，拍就把帧交上去。
 *
 * 为什么节奏在渲染端而不是主进程：宿主推不动 Helper（Windows 上 Electron 主进程收不到 piped
 * stdin），所以只能是 Helper 主动问。问题也简单——一句 `GET /screen/tick`，宿主按配置、忙闲、
 * 静默时段与间隔回答，判定逻辑全在宿主（host/screen/policy.ts），这里不做任何决策。
 *
 * 开关关着就**完全不启动**：省掉每 5 秒一次的桥请求。代价是开开关要重启 Helper——保存设置本来
 * 就会重启它（宿主 syncDesktop），所以用户感知不到。
 *
 * 必须始终成立：黑图**不上传**（判黑在主进程，见 main/capture.js），失败只打一行日志，
 * 绝不弹气泡——识屏是背景行为，出错时安静是它的一部分。
 * @module dsh-fish-body/runtime/electron-helper/sprite/screen
 */
'use strict';

(function () {
  /** 轮询节拍：宿主那边还有间隔门，这里只是「问一句」的成本。 */
  const SCREEN_TICK_MS = 5000;

  /** 缩到长边多少：与主进程的识屏路径一致（1:1 兜底路径自己算缩放时用）。 */
  const FALLBACK_MAX_EDGE = 1280;

  /** 每只宠物只跑一份循环（重启渲染端会重置这个标记）。 */
  let started = false;
  let petId = '';
  let timer = null;
  let busy = false;

  /** 带 `?pet=` 的路由地址。 */
  function routeUrl(path) {
    return BASE + path + '?pet=' + encodeURIComponent(petId);
  }

  /**
   * 问宿主这一拍拍不拍。
   *
   * @returns 宿主的结论（`{capture, reason}`）；请求失败按「不拍」处理，下一拍再问。
   */
  async function askTick() {
    try {
      const res = await fetch(routeUrl('/screen/tick'));
      const body = res.ok ? await res.json() : null;
      if (!body || body.ok !== true) return { capture: false, reason: 'unavailable' };
      return body;
    } catch {
      return { capture: false, reason: 'unreachable' };
    }
  }

  /**
   * 兜底取帧：`getDisplayMedia` 直接拿原生分辨率画面。
   *
   * 只在主路径报 `black-frame` 时用。`desktopCapturer` 的缩略图在 4K/150% 与部分虚拟显示器下
   * 可能全黑，而视频轨是真正的屏幕合成输出，不吃那条路径。主进程已经注册了
   * `setDisplayMediaRequestHandler`（自动选第一块屏），所以这里不需要用户点选。
   *
   * @returns 与主进程同形的结果；不可用/取不到时 `{ok:false, reason}`。
   */
  async function grabViaDisplayMedia() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      return { ok: false, reason: 'unsupported' };
    }
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      // 首帧就绪：requestVideoFrameCallback 比等 loadeddata 更贴「画面已经在了」
      await new Promise((resolve) => {
        if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(() => resolve());
        else setTimeout(resolve, 200);
      });
      const w = video.videoWidth || 0;
      const h = video.videoHeight || 0;
      if (!(w > 0) || !(h > 0)) return { ok: false, reason: 'no-frame' };
      const scale = Math.min(1, FALLBACK_MAX_EDGE / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
      if (!data) return { ok: false, reason: 'encode-failed' };
      return {
        ok: true,
        attachment: { mediaType: 'image/jpeg', data },
        width: canvas.width,
        height: canvas.height,
        bytes: Math.floor((data.length * 3) / 4),
      };
    } catch (e) {
      return { ok: false, reason: 'display-media-failed: ' + String((e && e.message) || e) };
    } finally {
      // 立刻停轨：不留常驻录制（系统录制指示灯 / 隐私角标跟着一起消失）
      if (stream) for (const track of stream.getTracks()) track.stop();
    }
  }

  /**
   * 抓一帧：主进程路径优先，黑图时走 `getDisplayMedia` 兜底。
   *
   * @returns `{ok:true, attachment, ...}` 或 `{ok:false, reason}`。
   */
  async function grabFrame() {
    const bridge = window.petBridge;
    if (!bridge || typeof bridge.captureScreenFrame !== 'function') return { ok: false, reason: 'unsupported' };
    const shot = await bridge.captureScreenFrame();
    if (shot && shot.ok === true) return shot;
    const reason = shot && shot.reason ? shot.reason : 'unknown';
    if (reason !== 'black-frame') return { ok: false, reason };
    const fallback = await grabViaDisplayMedia();
    if (fallback.ok === true) console.info('[fish-body] 识屏：主路径判黑图，已用 getDisplayMedia 兜底取帧');
    return fallback;
  }

  /**
   * 把一帧交给宿主（宿主负责生成那句废话并弹气泡）。
   *
   * @param shot - grabFrame 的结论。
   * @returns `{ok:true, text}` 或 `{ok:false, reason}`（手动入口据此给反馈）。
   */
  async function uploadFrame(shot) {
    try {
      const res = await fetch(routeUrl('/screen/frame'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attachment: shot.attachment, width: shot.width, height: shot.height }),
      });
      const body = res.ok ? await res.json() : null;
      if (body && body.ok === true) {
        // 一行成功日志：排查黑图/缩放时，这里能直接看到「取到的是多大、几倍缩放」
        console.info(
          '[fish-body] 识屏已上传 ' + shot.width + '×' + shot.height + ' scale=' + (shot.scaleFactor || '?'),
        );
        return { ok: true, text: typeof body.text === 'string' ? body.text : '' };
      }
      const message = String((body && (body.message || body.reason)) || res.status);
      console.info('[fish-body] 识屏没有结论：' + message);
      return { ok: false, reason: message };
    } catch (e) {
      const message = String((e && e.message) || e);
      console.info('[fish-body] 识屏上传失败：' + message);
      return { ok: false, reason: message };
    }
  }

  /**
   * 立刻拍一帧并交上去（右键「看一眼屏幕」用）：不经过 `/screen/tick`，所以不受间隔与空闲门限制。
   *
   * @returns uploadFrame 的结论（失败时带原因，菜单只打日志、不弹提示）。
   */
  async function snapNow() {
    const shot = await grabFrame();
    if (shot.ok !== true) {
      console.info('[fish-body] 看一眼屏幕跳过：' + String(shot.reason || 'unknown'));
      return { ok: false, reason: String(shot.reason || 'unknown') };
    }
    return uploadFrame(shot);
  }

  /** 一拍：问 → 抓 → 交。全程不外抛，出错静默（下一拍照旧）。 */
  async function step() {
    if (busy) return;
    busy = true;
    try {
      const plan = await askTick();
      if (plan.capture !== true) return;
      const shot = await grabFrame();
      if (shot.ok !== true) {
        console.info('[fish-body] 识屏跳过：' + String(shot.reason || 'unknown'));
        return;
      }
      await uploadFrame(shot);
    } catch (e) {
      console.info('[fish-body] 识屏异常：' + String((e && e.message) || e));
    } finally {
      busy = false;
    }
  }

  /**
   * 启动识屏循环（每只宠物一份，重复调用无副作用）。
   *
   * @param pet - 拍平后的宠物配置（只用到 `id` 与 `screen.readEnabled`）。
   */
  function startScreenWatch(pet) {
    if (started) return;
    const screen = pet && pet.screen;
    if (!screen || screen.readEnabled !== true) return;
    if (!window.petBridge || typeof window.petBridge.captureScreenFrame !== 'function') return;
    started = true;
    petId = String(pet.id || '').trim();
    if (!petId) return;
    const loop = () => {
      void step().finally(() => {
        timer = setTimeout(loop, SCREEN_TICK_MS);
      });
    };
    timer = setTimeout(loop, SCREEN_TICK_MS);
    console.info('[fish-body] 识屏已启动 pet=' + petId + ' 间隔=' + screen.intervalSec + 's');
  }

  /** 停掉循环（窗口销毁 / 测试用）。 */
  function stopScreenWatch() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    started = false;
  }

  window.dshScreenWatch = { start: startScreenWatch, stop: stopScreenWatch, captureNow: grabFrame, snapNow };
})();
