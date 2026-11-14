/**
 * 会话鱼的小鱼图形：内嵌 SVG，不依赖任何图片素材。
 *
 * 为什么自己画：桌宠的角色图是整张立绘，按几十像素缩下来只剩一团颜色；会话鱼要的是一眼能认出的
 * 「小鱼」轮廓，还要能按档位做很小的动作。颜色全部走 `--dsw-alias-*` 设计 token，明暗主题自动跟随。
 * 只造节点，不含状态；动画在 css.ts 里按 `.is-<state>` 驱动。
 * @module dsh-fish-body/src/client/session-fish/sprite
 */
import type { jsx } from 'react/jsx-runtime';
import type { SessionFishState } from '../../shared/session-fish.ts';

/** 节点工厂；与设置页的 `h` 同一形态。 */
type H = typeof jsx;

/** 精灵图的输入。 */
export interface FishSpriteProps {
  /** 显示边长（px）。 */
  readonly size: number;
  /** 当前档位；只影响动画类名，不改图形。 */
  readonly state?: SessionFishState;
  /** 是否作为设置页的静态预览（不做循环动画）。 */
  readonly still?: boolean;
}

/**
 * 造一条小鱼。
 *
 * @param h - 节点工厂。
 * @param props - 尺寸、档位与静态预览开关。
 * @returns `<svg>` 元素；父级负责尺寸与指针事件。
 */
export function renderFishSprite(h: H, props: FishSpriteProps): ReturnType<typeof jsx> {
  const state = props.state ?? 'idle';
  return h('svg', {
    className: 'dsh-session-fish__sprite is-' + state + (props.still === true ? ' is-still' : ''),
    viewBox: '0 0 64 64',
    width: props.size,
    height: props.size,
    role: 'img',
    'aria-hidden': 'true',
    focusable: 'false',
    children: [
      h('path', {
        key: 'tail',
        className: 'dsh-session-fish__tail',
        d: 'M44 32 L61 17 C57 26 57 38 61 47 Z',
      }),
      h('ellipse', { key: 'body', className: 'dsh-session-fish__body', cx: '27', cy: '32', rx: '20', ry: '14.5' }),
      h('path', { key: 'fin', className: 'dsh-session-fish__fin', d: 'M19 21 Q25 6 37 20 Z' }),
      h('path', {
        key: 'belly',
        className: 'dsh-session-fish__belly',
        d: 'M9 35 Q27 51 45 35 Q38 45 27 45 Q16 45 9 35 Z',
      }),
      h('circle', { key: 'eye', className: 'dsh-session-fish__eye', cx: '16', cy: '28', r: '3.4' }),
      h('circle', { key: 'pupil', className: 'dsh-session-fish__pupil', cx: '17', cy: '28', r: '1.7' }),
      h('path', { key: 'gill', className: 'dsh-session-fish__gill', d: 'M31 23 Q27.5 32 31 41' }),
    ],
  });
}
