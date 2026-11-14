/**
 * 设置页组件的运行时依赖：react 能力与翻译函数，由宿主在 `__ModuleLoader__` 装配时注入。
 * 浏览器半侧是单文件 bundle 形态，react 只能由宿主提供，因此组件一律经工厂接收、不直接 import。
 * 依赖只有 `h`、四个 hook 与 `t`；组件里不得再取第二个翻译源，也不得读全局 `window` 上的 react。
 * `h` 是**类型安全**的：组件那一支会逐字校验 props。`typeof jsx` 是全 `any` 的，曾放过一次
 * 「按钮接了不存在的回调、点了没反应」的真实事故（见 settings/voice-card 的注释）。
 * @module dsh-fish-body/src/client/settings/runtime
 */
import type { Dispatch, SetStateAction } from 'react';
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';

/** 一个已渲染的 jsx 元素；与 `typeof jsx` 的返回同型。 */
export type JsxElement = ReturnType<typeof jsx>;

/** 组件呼叫时的 props：组件自己声明的形状 + react 的 `key`（`key` 不进 props 类型，但调用处必须放行）。 */
export type JsxComponentProps<P> = P & { readonly key?: ReactNS.Key };

/**
 * 造节点的唯一入口。
 *
 * 两个重载是刻意分开的：
 * - **组件**走 `FunctionComponent<P>`，props 会被逐字校验——属性名写错、漏传必填字段都在这报错；
 * - **内建标签**保持宽松：`style` / `ref` / `aria-*` / `data-*` 太杂，逐个收窄只会制造噪音，
 *   而标签拼错由浏览器与测试兜住。
 */
export interface H {
  <P>(component: ReactNS.FunctionComponent<P>, props: JsxComponentProps<P>): JsxElement;
  // `props` 收 `object` 而不是 `Record<string, unknown>`：`JSX.IntrinsicElements` 的各元素属性类型
  // 没有索引签名，收窄成 Record 会把 `h('input', numberInputProps(...))` 这类正常写法判错。
  (tag: string, props?: object | null): JsxElement;
}

/** 设置页的运行时依赖；各子组件按需只取自己用到的几个。 */
export interface SettingsRuntime {
  h: H;
  useState: <T>(init: T) => [T, Dispatch<SetStateAction<T>>];
  // 用 React 命名空间类型而非 typeof：type-only import 的 hook 无法进入声明导出（TS4078）
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
  useCallback: typeof ReactNS.useCallback;
  /** 文案翻译；键取自本页字典的 `zh`。 */
  t: (key: string) => string;
}
