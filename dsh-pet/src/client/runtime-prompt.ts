/**
 * 「需要 Electron 运行时」弹窗（浏览器半侧，挂在 `shell.overlay`）。
 *
 * 为什么需要它：桌面窗口起不来时，用户看到的只是「桌宠没出来」——日志在文件里，控制台对桌面版不存在。
 * 宿主在这种情况下会自动开始下载（行为不倒退），并置一条提示；这个组件把那条提示变成一句人话 +
 * 一个进度 + 一条退路（「我本机已经有一份，指给你」）。
 *
 * 判定全部来自宿主（`GET /desktop/runtime` 的 `prompt` / `wanted`），客户端不自己猜「该不该弹」：
 * 只在网页里用宠物的人，宿主的 `wanted` 是 false，这里永远什么都不渲染。
 * 弹窗自带样式（见 ../runtime-prompt-css），不依赖设置页是否打开过。
 * @module dsh-fish-body/src/client/runtime-prompt
 */
import type { FunctionComponent } from 'react';
import { injectRuntimePromptCss } from './runtime-prompt-css.ts';
import { pickFolder } from './settings/layout-api.ts';
import type { RuntimeSnapshot } from './settings/config/http.ts';
import { fetchRuntime, saveRuntimeDir, startRuntimeDownload } from './settings/runtime-api.ts';
import type { SettingsRuntime } from './settings/runtime.ts';

/** 轮询间隔：下载是分钟级的，5s 足够让进度条动起来，又不至于把状态接口打爆。 */
const POLL_MS = 5000;

/** 提示里的一句话从哪来：缺失 / 消失 / 失败，三种语气各不相同。 */
export type PromptReason = 'missing' | 'deleted' | 'failed';

/**
 * 现在该不该让弹窗出现。
 *
 * 纯函数，单测直接钉住四种组合：要不要人管、装没装、是不是已经下好、这一条提示是不是被按掉过。
 *
 * @param snapshot - 宿主快照。
 * @param dismissedSince - 用户按掉的那条提示的时间戳（按掉新的会重新弹）。
 * @returns 该弹时为 true。
 */
export function shouldPrompt(snapshot: RuntimeSnapshot | undefined, dismissedSince: number | undefined): boolean {
  if (snapshot === undefined) return false;
  if (snapshot.prompt?.needed !== true) return false;
  if (snapshot.runtime?.installed === true) return false;
  const since = snapshot.prompt.since;
  if (dismissedSince !== undefined && since !== undefined && since <= dismissedSince) return false;
  return true;
}

/** 百分比：总长为 0 时按 0 处理（不猜、不显示 NaN）。 */
function percentOf(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

/** 字节 → `123 MB`。 */
function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.max(0.1, mb).toFixed(1) + ' MB';
}

/** 镜像 → 主机名（完整 URL 太长）。 */
function hostOf(mirror: string | undefined): string {
  if (mirror === undefined) return '';
  try {
    return new URL(mirror).host;
  } catch {
    return mirror;
  }
}

/**
 * 造弹窗组件。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 挂在 overlay 上的零尺寸组件（没有提示时返回 null）。
 */
export function makeRuntimePrompt(rt: SettingsRuntime): FunctionComponent {
  const { h, t, useEffect, useRef, useState } = rt;
  injectRuntimePromptCss();

  return function RuntimePrompt() {
    const [snapshot, setSnapshot] = useState<RuntimeSnapshot | undefined>(undefined);
    const [dismissedSince, setDismissedSince] = useState<number | undefined>(undefined);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // 只自动起一次：轮询每次都调 POST 会让「用户不想下」变成无休止的重试。
    const kicked = useRef(false);

    useEffect(() => {
      let alive = true;
      const tick = (): void => {
        if (typeof document !== 'undefined' && document.hidden) return;
        void fetchRuntime().then((next) => {
          if (!alive || next === undefined) return;
          setSnapshot(next);
        });
      };
      tick();
      const timer = setInterval(tick, POLL_MS);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, []);

    const needed = shouldPrompt(snapshot, dismissedSince);
    const downloading = snapshot?.download?.active === true;

    // 宿主置了提示但下载没在跑（例如用户手删了 runtime/，宿主还没被唤醒）：替它踢一脚。
    // 「自动下载」是既有行为，这里只保证它看得见、且只自动一次。
    useEffect(() => {
      if (!needed || downloading || busy || kicked.current) return;
      kicked.current = true;
      void startRuntimeDownload().then((outcome) => {
        if (outcome.snapshot !== undefined) setSnapshot(outcome.snapshot);
      });
    }, [needed, downloading, busy]);

    if (!needed) return null;

    const reason: PromptReason = snapshot?.prompt?.reason ?? 'missing';
    const body = [
      reason === 'failed'
        ? t('fsRuntimeNeedFailed').replace('{reason}', snapshot?.download?.error ?? '')
        : reason === 'deleted'
          ? t('fsRuntimeNeedDeleted')
          : t('fsRuntimeNeedBody'),
    ].join(' ');

    const percent = percentOf(snapshot?.download?.doneBytes ?? 0, snapshot?.download?.totalBytes ?? 0);
    const mirrorHost = hostOf(snapshot?.download?.mirror);

    const pick = (): void => {
      setBusy(true);
      setError(null);
      void pickFolder(t('fsRuntimePick')).then((picked) => {
        if (picked.kind === 'cancelled') {
          setBusy(false);
          return;
        }
        if (picked.kind === 'unsupported') {
          setBusy(false);
          setError(picked.message);
          return;
        }
        void saveRuntimeDir(picked.path).then((outcome) => {
          setBusy(false);
          if (outcome.kind === 'ok') {
            if (outcome.snapshot !== undefined) setSnapshot(outcome.snapshot);
            return;
          }
          setError(outcome.kind === 'no-electron' ? outcome.message : t('fsLocationFailed').replace('{reason}', ''));
        });
      });
    };

    const retry = (): void => {
      setBusy(true);
      kicked.current = true;
      void startRuntimeDownload().then((outcome) => {
        setBusy(false);
        if (outcome.snapshot !== undefined) setSnapshot(outcome.snapshot);
      });
    };

    return h('div', {
      className: 'dsh-pet-rp__mask',
      children: h('div', {
        className: 'dsh-pet-rp',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('fsRuntimeNeedTitle'),
        children: [
          h('div', { key: 't', className: 'dsh-pet-rp__title', children: t('fsRuntimeNeedTitle') }),
          h('div', { key: 'b', className: 'dsh-pet-rp__body', children: body }),
          downloading
            ? h('div', {
                key: 'bar',
                className: 'dsh-pet-rp__bar',
                role: 'progressbar',
                'aria-valuenow': percent,
                'aria-valuemin': 0,
                'aria-valuemax': 100,
                children: h('div', {
                  className: 'dsh-pet-rp__fill',
                  style: { transform: 'scaleX(' + String(percent / 100) + ')' },
                }),
              })
            : null,
          downloading
            ? h('div', {
                key: 'meta',
                className: 'dsh-pet-rp__meta',
                children:
                  humanBytes(snapshot?.download?.doneBytes ?? 0) +
                  ' / ' +
                  humanBytes(snapshot?.download?.totalBytes ?? 0) +
                  ' · ' +
                  percent +
                  '%' +
                  (mirrorHost === '' ? '' : ' · ' + t('fsRuntimeMirror').replace('{host}', mirrorHost)),
              })
            : null,
          error === null ? null : h('div', { key: 'err', className: 'dsh-pet-rp__meta', children: error }),
          h('div', {
            key: 'acts',
            className: 'dsh-pet-rp__acts',
            children: [
              reason === 'failed'
                ? h('button', {
                    key: 'r',
                    type: 'button',
                    className: 'dsh-pet-rp__btn is-primary',
                    disabled: busy,
                    onClick: retry,
                    children: t('fsRuntimeRetry'),
                  })
                : null,
              h('button', {
                key: 'p',
                type: 'button',
                className: 'dsh-pet-rp__btn',
                disabled: busy,
                onClick: pick,
                children: t('fsRuntimePick'),
              }),
              h('button', {
                key: 'k',
                type: 'button',
                className: 'dsh-pet-rp__btn',
                onClick: () => setDismissedSince(snapshot?.prompt?.since ?? Date.now()),
                children: t('fsRuntimeNeedKnow'),
              }),
            ],
          }),
        ],
      }),
    });
  };
}
