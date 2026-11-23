/**
 * 当前会话上报器：注册进 `conversation.input.dock`，零渲染，只把「用户点进了哪条会话」告诉宿主。
 *
 * 为什么要一个组件：客户端没有「当前选中会话」的公开服务；这个插槽是会话作用域的，注入回调能拿到
 * sessionId，正好是权威信号。只有会话真正切换时才发请求（模块级去重），避免每次重渲染都打一次。
 * @module dsh-fish-body/src/client/session-fish/reporter
 */
import type { DependencyList, EffectCallback } from 'react';
import type { jsx } from 'react/jsx-runtime';
import { reportActiveSession } from './active.ts';
import { postSessionFishAction } from './api.ts';
import { listSnapshot, type SessionFishLayerDeps } from './layer.ts';

/** 上报器的 react 能力。 */
export interface SessionFishReporterRuntime {
  useEffect: (effect: EffectCallback, deps?: DependencyList) => void;
}

/** 插槽注入给组件的 props（只需会话 id）。 */
export interface SessionFishReporterProps {
  readonly sessionId?: string;
}

/**
 * 造上报器组件。
 *
 * @param rt - 注入的 `useEffect`。
 * @param deps - 会话列表（取 blank / running 判据）。
 * @returns 永远返回 null 的组件。
 */
export function makeSessionFishReporter(rt: SessionFishReporterRuntime, deps: SessionFishLayerDeps) {
  const { useEffect } = rt;

  return function SessionFishReporter(props: SessionFishReporterProps): ReturnType<typeof jsx> | null {
    const sessionId = props.sessionId;
    useEffect(() => {
      if (typeof sessionId !== 'string' || sessionId === '') return;
      if (!reportActiveSession(sessionId)) return;
      const row = listSnapshot(deps.sessions)?.byId?.[sessionId];
      void postSessionFishAction({
        action: 'focus',
        sessionId,
        blank: row?.blank === true,
        running: row?.running === true,
      });
    }, [sessionId]);
    return null;
  };
}
