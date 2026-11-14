/**
 * 装配动作词表：把「皮肤清单手势 id」与「webm 动画池动作名」统一折成 layered rig 能做的六种装配。
 *
 * 浏览器（`render/layered.ts`）与桌面 Helper（`layered-core.js` → `PetLayered.assemblyActionOf`）共用这一份：
 * 两端各写一套的话，点击同一只宠物会在一端有反应、另一端没有。
 * @module dsh-fish-body/src/client/pet/render/layered/gestures
 */

/** rig 支持的装配动作。 */
export type AssemblyAction = 'blink' | 'wag' | 'hop' | 'talk' | 'mouth' | 'jelly';

/** 皮肤清单声明的手势 id → 装配动作（`interaction.regions[].gesture` / `menu` 用的词汇）。 */
const GESTURE_KINDS: Record<string, AssemblyAction> = {
  pat: 'jelly',
  poke: 'hop',
  tailpet: 'wag',
  wag: 'wag',
  tail: 'wag',
  hop: 'hop',
  jump: 'hop',
  blink: 'blink',
  talk: 'talk',
  speak: 'talk',
  mouth: 'mouth',
  jelly: 'jelly',
};

/** webm 动画池的动作名关键词 → 装配动作（按顺序匹配，先中先得）。 */
const NAME_RULES: ReadonlyArray<readonly [RegExp, AssemblyAction]> = [
  [/blink|眨/, 'blink'],
  [/wag|tail|摇尾|甩尾/, 'wag'],
  [/hop|jump|跳|跃/, 'hop'],
  [/talk|say|speak|说|碎碎念|对话|聊/, 'talk'],
  [/mouth|张嘴|嘴|吃/, 'mouth'],
  [/pat|poke|摸|戳|点击|回应|click|tap/, 'jelly'],
  [/余额|钱/, 'jelly'],
  [/工作状态|busy|work/, 'blink'],
];

/**
 * 动作名 → 装配动作。
 *
 * 先认皮肤清单的手势 id，再回落到 webm 池的动作名关键词：layered 没有逐帧素材，
 * 动画池里的名字只有「说 / 摸 / 跳 / 余额」这几类语义值得翻译，其余保持待机循环。
 *
 * @param name - 动画名或手势 id。
 * @returns 装配动作；没有对应语义时返回 `null`。
 */
export function assemblyActionOf(name: string): AssemblyAction | null {
  const key = name.trim().toLowerCase();
  const direct = GESTURE_KINDS[key];
  if (direct !== undefined) return direct;
  for (const [pattern, action] of NAME_RULES) {
    if (pattern.test(key)) return action;
  }
  return null;
}
