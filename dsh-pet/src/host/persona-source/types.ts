/**
 * 人格来源契约：把某个「dsh 人格」项目的人设卡读取并投影成一段可进 whisperPrompt 的正文。
 * 只声明形状与共享常量；注册归 ./registry，读卡与投影归 ./card-reader，批量扫描归 ./card-file。
 *
 * 扩展原则：新成员**全部可选**——第三方已注册的「只有 id/name/resolve」实现零改动即可继续工作；
 * {@link PersonaSource.resolve} 的签名一字不改，`scan` / `probe` 只加能力、不替换入口。
 * @module dsh-fish-body/src/host/persona-source/types
 */
import type { CharaCardData } from './card-reader.ts';

/** 内置人格来源 id；同步器默认用它，第三方注册别的 id 即可扩展。 */
export const BUILTIN_PERSONA_SOURCE_ID = 'fish-soul';

/** 投影结果：成功给正文与角色名（导入语义，名字一并覆盖），失败给结构化原因。 */
export type PersonaResolution =
  { ok: true; text: string; name: string } | { ok: false; reason: 'not-found' | 'invalid-card'; message?: string };

/** 来源形态：缺省按 `soul-card` 处理（老实现只有 id/name/resolve）。 */
export type PersonaSourceKind = 'soul-card' | 'custom' | 'editor';

/** 调用方显式指定的路径（scan / probe 的请求参数；**不来自**宠物配置）。 */
export interface PersonaSourceOptions {
  /** 只对可指路的来源有意义；缺省 = 来源自带的约定目录。 */
  readonly path?: string;
}

/** 可用性探测结果：未安装时 `path` 是「期望放素材的位置」，已安装时是实际命中路径。 */
export interface PersonaSourceAvailability {
  readonly installed: boolean;
  /** 设置页只展示、不拼路径——路径由宿主给出，客户端一拼就会在池根/DSH 根变化后说谎。 */
  readonly path: string;
}

/** 扫描出来的一个角色：正文是投影结果（可直接进 whisperPrompt），元信息进角色记录。 */
export interface PersonaScannedCharacter {
  readonly name: string;
  /** 已投影的正文（`projectCard` 的结果、占位符已替换）。 */
  readonly text: string;
  /** 该角色来自哪个文件（进角色记录的 source.path）。 */
  readonly path: string;
  /** 卡片的 8 字段；来源只能给出正文时缺省（落库走「正文进 description」的降级路径）。 */
  readonly data?: CharaCardData;
}

/** 读到但用不了的文件：坏卡 / 空正文 / 超上限。前端逐条展示，不静默丢。 */
export interface PersonaScanSkip {
  readonly path: string;
  readonly reason: 'invalid-card' | 'empty' | 'too-large';
}

/** 一次扫描的全部产出。 */
export interface PersonaScanResult {
  readonly characters: readonly PersonaScannedCharacter[];
  readonly skipped: readonly PersonaScanSkip[];
}

/** 一个人格来源：读取并投影某个项目的人设卡。 */
export interface PersonaSource {
  /** 唯一标识；注册表按它去重。 */
  readonly id: string;
  /** 展示名，只用于排障与列表。 */
  readonly name: string;
  /** 来源形态；缺省 'soul-card'。 */
  readonly kind?: PersonaSourceKind;
  /**
   * 可用性探测：只读盘、不抛（异常由注册表收敛成「未安装」）。
   *
   * 缺省实现 = `watchPath` 存在与否。
   */
  probe?(options?: PersonaSourceOptions): Promise<PersonaSourceAvailability>;
  /**
   * 扫描来源里的角色。
   *
   * **没有 scan 的来源不参与「选中即导入」**（内置人设编辑就是这种）。
   */
  scan?(options?: PersonaSourceOptions): Promise<PersonaScanResult>;
  /**
   * 读取并投影人设卡。
   *
   * 失败不抛：返回结构化原因，让调用方区分「卡还没放进来」与「卡坏了」。
   */
  resolve(): Promise<PersonaResolution>;
  /** 需要监听变化的卡片文件路径；纯网络来源返回 undefined。 */
  readonly watchPath?: string;
  /** false = 这个来源没有可扫描的产物（内置编辑）。缺省 true。 */
  readonly syncable?: boolean;
}
