/**
 * 会话鱼的皮肤渲染：webm 用 `<video>`，图片/动图用 `<img>`，加载失败回落到内嵌小鱼。
 *
 * 为什么统一走 `/session-fish/skin?name=`：皮肤可能是包内动画，也可能是用户自己放进
 * `assets/session-fish/` 的 gif / png / webm，只有宿主知道该从哪个目录取；前端只认名字，
 * 不拼素材根、也不猜文件在不在（404 就回落，不阻塞其它鱼）。
 *
 * 宽高比：素材尺寸只有加载后才知道，量到就记进共享缓存并回调一次；布局按缓存里的比例算，
 * 所以第一帧用 16:9 兜底、量到真实尺寸后盒子自己长对，不必等一整轮刷新。
 * 比例与「按宽度算高度」的口径在 `shared/session-fish/aspect`（桌面端用同一份）。
 * @module dsh-fish-body/src/client/session-fish/media
 */
import type { Dispatch, SetStateAction } from 'react';
import type { jsx } from 'react/jsx-runtime';
import { ROUTE_PATH } from '../../shared/constants.ts';
import {
  sessionFishSkinKindOf,
  SESSION_FISH_SKIN_DEFAULT,
  type SessionFishSkinKind,
  type SessionFishState,
} from '../../shared/session-fish.ts';
import {
  sessionFishAspectOf,
  sessionFishHeightOf,
  rememberSessionFishAspect,
} from '../../shared/session-fish/aspect.ts';
import { renderFishSprite } from './sprite.ts';

// 比例相关的纯函数住在共享层（桌面端要用同一份）；这里转出，网页内的调用方不必改 import。
export {
  SESSION_FISH_ASPECT,
  sessionFishAspectOf,
  sessionFishHeightOf,
  rememberSessionFishAspect,
} from '../../shared/session-fish/aspect.ts';

/**
 * 皮肤地址：宿主按名字在「用户目录 → 包内」里找。
 *
 * @param skin - 皮肤 id（空串按默认皮肤处理）。
 * @returns 可直接放进 `src` 的同源地址。
 */
export function sessionFishSkinUrl(skin: string): string {
  const name = skin === '' ? SESSION_FISH_SKIN_DEFAULT : skin;
  return ROUTE_PATH + '/session-fish/skin?name=' + encodeURIComponent(name);
}

/** 媒体组件的 react 能力。 */
export interface FishMediaRuntime {
  h: typeof jsx;
  useState: <T>(init: T) => [T, Dispatch<SetStateAction<T>>];
}

/** 媒体组件的输入。 */
export interface FishMediaProps {
  /** 显示宽度（px）。 */
  readonly width: number;
  /** 皮肤 id；空串按默认皮肤。 */
  readonly skin: string;
  /** 渲染方式：调用方从快照拿（`skinKind`），缺省按扩展名现判。 */
  readonly kind?: SessionFishSkinKind;
  /** 当前档位：只影响 SVG 回落时的微动画。 */
  readonly state: SessionFishState;
  /** 量到素材尺寸时回调（浮层据此重排一次高度）。 */
  readonly onAspect?: (aspect: number) => void;
}

/**
 * 造会话鱼媒体组件。
 *
 * @param rt - 节点工厂与 `useState`（加载失败要切回落）。
 * @returns 皮肤组件；加载失败的那一条单独回落，不影响其他鱼。
 */
export function makeSessionFishMedia(rt: FishMediaRuntime) {
  const { h, useState } = rt;

  return function SessionFishMedia(props: FishMediaProps): ReturnType<typeof jsx> {
    const [failed, setFailed] = useState(false);
    const skin = props.skin === '' ? SESSION_FISH_SKIN_DEFAULT : props.skin;
    const kind = props.kind ?? sessionFishSkinKindOf(skin) ?? 'video';
    const height = sessionFishHeightOf(props.width, sessionFishAspectOf(skin));
    /** 量到尺寸：记缓存并回调一次（比例没变就不惊动上层）。 */
    const measure = (width: number, heightPx: number): void => {
      if (rememberSessionFishAspect(skin, width, heightPx)) props.onAspect?.(width / heightPx);
    };
    if (!failed) {
      const url = sessionFishSkinUrl(skin);
      if (kind === 'image') {
        return h('img', {
          className: 'dsh-session-fish__video',
          src: url,
          width: props.width,
          height,
          alt: '',
          draggable: false,
          'aria-hidden': 'true',
          onLoad: (event: { currentTarget: { naturalWidth: number; naturalHeight: number } }) =>
            measure(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight),
          onError: () => setFailed(true),
        });
      }
      return h('video', {
        className: 'dsh-session-fish__video',
        src: url,
        width: props.width,
        height,
        autoPlay: true,
        muted: true,
        loop: true,
        playsInline: true,
        preload: 'auto',
        disablePictureInPicture: true,
        draggable: false,
        tabIndex: -1,
        'aria-hidden': 'true',
        onLoadedMetadata: (event: { currentTarget: { videoWidth: number; videoHeight: number } }) =>
          measure(event.currentTarget.videoWidth, event.currentTarget.videoHeight),
        onError: () => setFailed(true),
      });
    }
    const side = Math.min(props.width, height);
    return h('span', {
      className: 'dsh-session-fish__mediaFallback',
      style: { width: props.width + 'px', height: height + 'px' },
      'aria-hidden': 'true',
      children: renderFishSprite(h, { size: side, state: props.state, still: true }),
    });
  };
}
