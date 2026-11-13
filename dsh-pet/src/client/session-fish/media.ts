/**
 * 会话鱼的皮肤渲染：webm 用 `<video>`，图片/动图用 `<img>`，加载失败回落到内嵌小鱼。
 *
 * 为什么统一走 `/session-fish/skin?name=`：皮肤可能是包内动画，也可能是用户自己放进
 * `session-fish-skin/` 的 gif / png / webm，只有宿主知道该从哪个目录取；前端只认名字，
 * 不拼素材根、也不猜文件在不在（404 就回落，不阻塞其它鱼）。
 *
 * 宽高比：素材尺寸只有加载后才知道，量到就记进模块级缓存并回调一次；布局按缓存里的比例算，
 * 所以第一帧用 16:9 兜底、量到真实尺寸后盒子自己长对，不必等一整轮刷新。
 * @module dsh-pet/src/client/session-fish/media
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
import { renderFishSprite } from './sprite.ts';

/** 默认宽高比（素材 640×360）：量到真实尺寸前按它排。 */
export const SESSION_FISH_ASPECT = 16 / 9;

/** 高度相对宽度的允许区间：太扁或太长的图都不会把鱼群挤成一列。 */
const HEIGHT_RATIO_MIN = 0.5;
const HEIGHT_RATIO_MAX = 2;

/** 皮肤 id → 量到的宽高比；没有记录时用默认值。 */
const aspectCache = new Map<string, number>();

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

/**
 * 读某个皮肤已知的宽高比。
 *
 * @param skin - 皮肤 id。
 * @returns 宽 / 高；没量过时 {@link SESSION_FISH_ASPECT}。
 */
export function sessionFishAspectOf(skin: string): number {
  const known = aspectCache.get(skin);
  return known === undefined ? SESSION_FISH_ASPECT : known;
}

/**
 * 记一个皮肤的宽高比（量到合法尺寸才记）。
 *
 * @param skin - 皮肤 id。
 * @param width - 素材宽（px）。
 * @param height - 素材高（px）。
 * @returns 与已知比例相比是否变了（调用方据此决定要不要重排一次）。
 */
export function rememberSessionFishAspect(skin: string, width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  const aspect = width / height;
  const before = aspectCache.get(skin);
  if (before !== undefined && Math.abs(before - aspect) < 0.01) return false;
  aspectCache.set(skin, aspect);
  return true;
}

/**
 * 按宽度与宽高比算显示高度。
 *
 * @param widthPx - 显示宽度（px）。
 * @param aspect - 宽 / 高；缺省用默认比例。
 * @returns 夹在 `[0.5×宽, 2×宽]` 内的高度（px）。
 */
export function sessionFishHeightOf(widthPx: number, aspect: number = SESSION_FISH_ASPECT): number {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : SESSION_FISH_ASPECT;
  const ratio = Math.min(HEIGHT_RATIO_MAX, Math.max(HEIGHT_RATIO_MIN, 1 / safeAspect));
  return Math.max(1, Math.round(widthPx * ratio));
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
