/**
 * 会话鱼皮肤的纯逻辑：把宿主给的清单分成内置 / 我的、算出当前项文案、判断选中项是否已失效。
 *
 * 从 `fish-tab` 里抽出来的唯一原因：这三件事都能脱离 React 断言，混在组件里只能靠整页渲染去验。
 * 皮肤清单是只读的（`GET /session-fish/skins`），列表里没有的皮肤不可能是当前值——
 * 文件被删掉后那一项显示成「已失效」，但不会挡住保存。
 * @module dsh-fish-body/src/client/settings/fish-skins
 */
import { SESSION_FISH_SKIN_DEFAULT } from '../../shared/session-fish.ts';
import type { SessionFishSkinOption } from '../session-fish/api.ts';

/** 分组后的皮肤清单与当前项。 */
export interface FishSkinView {
  /** 插件自带的皮肤。 */
  readonly pack: readonly SessionFishSkinOption[];
  /** 用户自己放进皮肤目录的。 */
  readonly user: readonly SessionFishSkinOption[];
  /** 当前生效项的名字；清单里找不到时回落到皮肤 id 本身。 */
  readonly currentLabel: string;
  /** 选中的皮肤已经不在清单里（文件被删 / 改名）。 */
  readonly missing: boolean;
}

/**
 * 按来源分组，并算出当前项。
 *
 * @param known - 宿主返回的皮肤清单（`null` = 还没拉回来）。
 * @param chosen - 草稿里选的皮肤 id（空串 = 用默认皮肤）。
 * @param effective - 实际生效的皮肤 id（已把空串解析成默认）。
 * @returns 分组、当前项文案与失效标志。
 */
export function fishSkinView(
  known: readonly SessionFishSkinOption[] | null,
  chosen: string,
  effective: string,
): FishSkinView {
  const list = known ?? [];
  return {
    pack: list.filter((item) => item.source === 'pack'),
    user: list.filter((item) => item.source === 'user'),
    currentLabel: list.find((item) => item.id === effective)?.label ?? effective,
    // 清单还没到时不能判失效：否则刚打开这一页就闪一句「文件已失效」。
    missing: chosen !== '' && known !== null && !list.some((item) => item.id === chosen),
  };
}

/**
 * 默认皮肤的名字：提示里要写明「留空会落到哪个动画」，避免空下拉的含义靠猜。
 *
 * @returns 默认皮肤 id。
 */
export const DEFAULT_FISH_SKIN = SESSION_FISH_SKIN_DEFAULT;
