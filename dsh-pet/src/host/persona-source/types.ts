/**
 * 人格来源契约：把某个「dsh 人格」项目的人设卡读取并投影成一段可进 whisperPrompt 的正文。
 * 只声明形状与共享常量；注册归 ./registry，读卡与投影归 ./card-reader，同步归 ./sync。
 * @module dsh-pet/src/host/persona-source/types
 */

/** 内置人格来源 id；同步器默认用它，第三方注册别的 id 即可扩展。 */
export const BUILTIN_PERSONA_SOURCE_ID = 'fish-soul';

/** 投影结果：成功给正文，失败给结构化原因（同步器据此留痕，不伪造文案）。 */
export type PersonaResolution =
  { ok: true; text: string } | { ok: false; reason: 'not-found' | 'invalid-card'; message?: string };

/** 一个人格来源：读取并投影某个项目的人设卡。 */
export interface PersonaSource {
  /** 唯一标识；注册表按它去重。 */
  readonly id: string;
  /** 展示名，只用于排障与列表。 */
  readonly name: string;
  /**
   * 读取并投影人设卡。
   *
   * 失败不抛：返回结构化原因，让同步器能区分「卡还没放进来」与「卡坏了」。
   */
  resolve(): Promise<PersonaResolution>;
  /** 需要监听变化的卡片文件路径；纯网络来源返回 undefined（同步器只做首轮）。 */
  readonly watchPath?: string;
}
