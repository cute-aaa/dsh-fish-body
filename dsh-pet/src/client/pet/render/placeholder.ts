/**
 * 未实现渲染后端的占位实现：挂一个可见的提示层，不崩、不静默黑屏。
 * layered / live2d 在真正落地前都用它兜底——右键切过去能看到「该渲染方式尚未实现」，
 * 而不是只剩一个空 stage。交互与动作一概不驱动（frontElement 返回 null，运动路径自行跳过）。
 * @module dsh-pet/src/client/pet/render/placeholder
 */
import type { Renderer, RendererMountOptions } from './types.ts';
import type { RendererKind } from '../../../shared/types.ts';

/** 占位提示的文案，按 kind 给一句人话。 */
const PLACEHOLDER_TEXT: Readonly<Record<string, string>> = {
  layered: 'layered（分层 PNG）渲染尚未实现',
  live2d: 'live2d（Cubism）渲染尚未实现',
};

/**
 * 造一个占位渲染实例。
 *
 * @param kind - 后端标识（layered / live2d）。
 * @returns 只显示提示的 Renderer；`frontElement` 恒返回 null。
 */
export function createPlaceholderRenderer(kind: RendererKind): Renderer {
  let holder: HTMLElement | null = null;
  let ready = false;

  const mount = (stage: HTMLElement, opts: RendererMountOptions): void => {
    if (holder !== null) destroy();
    const div = document.createElement('div');
    div.className = 'dsh-pet-renderer-placeholder';
    div.setAttribute('data-renderer-kind', kind);
    div.textContent = PLACEHOLDER_TEXT[kind] ?? `${kind} 渲染尚未实现`;
    div.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'font-size:14px;color:#888;pointer-events:none;box-sizing:border-box;padding:8px;text-align:center;';
    stage.appendChild(div);
    holder = div;
    ready = true;
    // 保留素材根与尺寸给后续实现扫描目录用；当前占位不读，仅确保 opts 被消费、契约完整。
    void opts;
  };

  const destroy = (): void => {
    holder?.remove();
    holder = null;
    ready = false;
  };

  return {
    kind,
    mount,
    destroy,
    playAction: () => {},
    setIdle: () => {},
    setEndedHandler: () => {},
    stopLooping: () => {},
    setFrozen: () => null,
    isFrozen: () => false,
    frontElement: () => null,
    progress: () => ({ playbackId: null, anim: '', currentTime: 0, duration: 0, paused: true, buffering: false }),
    get ready() {
      return ready;
    },
  };
}
