/**
 * 「把一句已知文本推进气泡」——`/broadcast`（第三方投喂）与 `/screen/frame`（识屏说一句）共用。
 *
 * 从 `routes/interaction.ts` 抽出来：两条链路都需要「写 `pets.<id>.say` 叶子」这一个动作，
 * 而各自的**决策**不一样（投喂要按池校验配图、识屏的文本是模型刚生成的）。
 * 决策留在原地，落笔只有这一份——否则哪天 say 叶子多一个字段，必有一条链路漏改。
 *
 * 不读配置、不做门禁：调用方按自己的顺序过完 pet / surface / 锁 / 睡觉闸门再进来。
 * @module dsh-fish-body/src/host/broadcast-send
 */
import type { VoiceTarget } from './surface.ts';

/** say 叶子的写入形状（与 `state.writePet(petId, 'say', …)` 的消费端一一对应）。 */
export interface SayPayload {
  /** 要显示的文本（调用方已 trim 并确认非空）。 */
  readonly text: string;
  /** 显示时长（毫秒）；0 = 不显示（合法：调用方显式要求静默时用）。 */
  readonly duration: number;
  /** 是否联动动画；只有严格 false 才关。 */
  readonly anim: boolean;
  /** 配图（表情包池内规范名）。 */
  readonly image?: string;
  /** 配图（第三方自带地址）。 */
  readonly url?: string;
  /** 念在哪一端；缺省 = 不念。 */
  readonly voiceTo?: VoiceTarget;
}

/** 写库能力：只要 `writePet`（真实的 PetStateStore 即可满足）。 */
export interface SayWriter {
  writePet(petId: string, leaf: 'say', data: Record<string, unknown>): void;
}

/**
 * 把一句话写进该宠物的 say 叶子。
 *
 * @param deps - 状态写入器。
 * @param petId - 哪只宠物。
 * @param payload - 文本与三个可选修饰（配图两种形态二选一，调用方保证）。
 */
export function sendSay(deps: { readonly state: SayWriter }, petId: string, payload: SayPayload): void {
  const { text, duration, anim, image, url, voiceTo } = payload;
  // 配图两种形态由字段名区分，不靠嗅探：同时给就是调用方的错，这里以 url 优先（与投喂判定一致）。
  const pic = url !== undefined ? { url } : image !== undefined ? { image } : {};
  deps.state.writePet(petId, 'say', {
    text,
    ...pic,
    duration,
    anim,
    ...(voiceTo ? { voiceTo } : {}),
  });
}
