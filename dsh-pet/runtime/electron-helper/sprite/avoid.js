/**
 * 避让循环（渲染端）：把主进程推来的「前台窗口行」判成「藏 / 不藏」，再让主进程执行。
 *
 * 为什么判定在渲染端：前台行的解析与滞回状态机都写在 `src/shared/`（`S.parseForegroundLine`
 * / `S.avoidWantHide` / `S.advanceAvoid`），那份代码同时被浏览器端复用；主进程是纯 JS，
 * 拿不到 TypeScript 的共享实现，照抄一份必然两边漂移。于是分工是：
 *   主进程 = 采集（PowerShell）+ 显示器矩形 + hide/showInactive；
 *   渲染端 = 解析 + 判定 + 节拍（本文件）。
 *
 * 开关关着就完全不启动（连 `pet:avoid-config` 都不发）：主进程一条 PowerShell 都不起。
 * 必须始终成立：只翻「避让自己」的那一层（主进程按窗口 id 记账），绝不覆盖托盘的手动隐藏。
 * @module dsh-fish-body/runtime/electron-helper/sprite/avoid
 */
'use strict';

(function () {
  /** 上报宿主的节流（毫秒）：前台快照只是给设置页看的，不必每拍都写一次。 */
  const REPORT_INTERVAL_MS = 5000;

  /** 每只宠物一份状态（窗口只有一个 sprite，但保持与其它循环一致的写法）。 */
  let started = false;
  let petId = '';
  let phase = 'idle';
  let sinceMs = 0;
  let hidden = false;
  let lastReportAt = 0;
  let lastReportKey = '';

  /** 带 `?pet=` 的路由地址。 */
  function routeUrl(path) {
    return BASE + path + '?pet=' + encodeURIComponent(petId);
  }

  /**
   * 把判定结果报给宿主（设置页据此显示「当前前台：chrome（未触发）」）。
   *
   * @param snapshot - 解析出来的前台快照（可能为 null）。
   * @param reason - 触发原因。
   */
  function report(snapshot, reason) {
    const now = Date.now();
    const key = (snapshot ? snapshot.app + '|' + snapshot.title : '') + '|' + (hidden ? 'hide' : 'show') + '|' + reason;
    if (key === lastReportKey && now - lastReportAt < REPORT_INTERVAL_MS) return;
    lastReportKey = key;
    lastReportAt = now;
    const body = JSON.stringify({
      kind: 'foreground',
      app: snapshot ? snapshot.app : '',
      title: snapshot ? snapshot.title : '',
      decision: hidden ? 'hide' : 'show',
      reason,
    });
    fetch(routeUrl('/screen/event'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }).catch(() => {
      /* 上报失败不影响本地避让：那是给设置页看的状态，不是判定输入 */
    });
  }

  /**
   * 启动避让循环（重复调用无副作用；两个开关都关着时直接不启动）。
   *
   * @param pet - 拍平后的宠物配置（读 `screen` 段）。
   */
  function startAvoidWatch(pet) {
    if (started) return;
    const cfg = pet && pet.screen;
    if (!cfg) return;
    if (cfg.avoidFullscreen !== true && cfg.avoidAppsEnabled !== true) return;
    const bridge = window.petBridge;
    if (!bridge || typeof bridge.onForeground !== 'function' || typeof bridge.setAvoidHidden !== 'function') return;
    petId = String(pet.id || '').trim();
    if (!petId) return;
    started = true;
    bridge.setAvoidConfig({ enabled: true, pollMs: cfg.avoidPollMs });
    bridge.onForeground((msg) => {
      if (!msg || typeof msg !== 'object') return;
      const snapshot = S.parseForegroundLine(msg.line);
      const monitor = msg.monitor && msg.monitor.bounds ? msg.monitor : null;
      if (!monitor) return;
      const wanted = S.avoidWantHide({
        snapshot,
        ownPid: Number(msg.ownPid) || 0,
        monitor: { bounds: monitor.bounds, workArea: monitor.workArea },
        fullscreenEnabled: cfg.avoidFullscreen === true,
        maximizeEnabled: cfg.avoidMaximize === true,
        appsEnabled: cfg.avoidAppsEnabled === true,
        apps: Array.isArray(cfg.avoidApps) ? cfg.avoidApps : [],
      });
      const next = S.advanceAvoid({
        phase,
        sinceMs,
        nowMs: performance.now(),
        wantHide: wanted.wantHide,
        delayMs: cfg.avoidDelayMs,
        restoreMs: cfg.avoidRestoreMs,
      });
      phase = next.phase;
      sinceMs = next.sinceMs;
      if (next.hide !== hidden) {
        hidden = next.hide;
        bridge.setAvoidHidden(hidden);
        // 一行状态日志：这是背景行为，出问题时只能靠它确认「到底躲了没有、什么时候回来的」
        console.info('[fish-body] 避让' + (hidden ? '隐藏' : '恢复') + ' pet=' + petId + ' 原因=' + (wanted.reason || '—'));
      }
      report(snapshot, wanted.reason);
    });
    console.info('[fish-body] 避让已启动 pet=' + petId + ' 节拍=' + cfg.avoidPollMs + 'ms');
  }

  window.dshAvoidWatch = { start: startAvoidWatch };
})();
