/**
 * 设置页的一处反馈：文案与是否错误。
 *
 * 单独成一个模块是因为它被写路径、卡片、按钮与若干 hook 一起依赖；放在任何一个组件文件里，
 * 都会让「只为了要一个类型」的模块去 import 一整个组件。
 * @module dsh-pet/src/client/settings/feedback
 */

/** 一处反馈；`text` 为空表示没有可显示的内容。 */
export interface Feedback {
  /** 结论类别：`ok` 绿字、`err` 红字、空串不显示。 */
  readonly kind: 'ok' | 'err' | '';
  /** 已翻译的文案。 */
  readonly text: string;
}

/** 空反馈：初值与「清掉上一次结论」共用同一份。 */
export const NO_FEEDBACK: Feedback = { kind: '', text: '' };
