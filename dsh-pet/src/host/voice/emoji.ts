/**
 * 播报文本里的表情清理：把「念出来没有意义」的字符去掉。
 *
 * 用在这条链上：模型回复 / 配置台词 / 碎碎念 → 合成前清洗 → GSV 或 edge。
 * 只删表情区与它们的连接件，汉字、标点、音标与普通拉丁字母都不动。
 * @module dsh-pet/src/host/voice/emoji
 */

/**
 * 这个码位是不是表情符号的一部分。
 *
 * 逐个码位判而不是写成一个字符类：变体选择符、零宽连接符与肤色修饰符放进字符类会被
 * `no-misleading-character-class` 判为可疑写法（它们确实会与相邻字符组成复合显示）。
 *
 * @param cp - Unicode 码位。
 * @returns 属于表情区、连接件、肤色修饰或区域指示符（国旗）时 true。
 */
function isEmojiCodePoint(cp: number): boolean {
  if (/\p{Extended_Pictographic}/u.test(String.fromCodePoint(cp))) return true;
  if (cp === 0xfe0f || cp === 0x200d || cp === 0x20e3) return true;
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return true; // 区域指示符：国旗由两个组成
  return cp >= 0x1f3fb && cp <= 0x1f3ff; // 肤色修饰符
}

/**
 * 去掉一段文本里的 emoji。
 *
 * 合成器读不出表情，只会把它念成「表情符号」或干脆卡一下；所以念之前先摘掉。
 * 删完留下的连续空白折成一个空格，避免出现「你好  。」这种缝。
 *
 * @param text - 要念的原文。
 * @returns 去掉表情后的文本（可能为空串，调用方据此决定要不要合成）。
 */
export function stripEmoji(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && isEmojiCodePoint(cp)) continue;
    out += ch;
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}
