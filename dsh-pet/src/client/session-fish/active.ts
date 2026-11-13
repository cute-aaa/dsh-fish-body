/**
 * 当前打开的会话：由插槽报告器写、浮层读。
 *
 * 为什么单独一份：报告器在 `conversation.input.dock`（会话作用域），浮层在 `shell.overlay`（根作用域），
 * 两者没有父子关系。这里只存一个 id 与「是否已经上报过」，不触发 React 更新。
 * @module dsh-pet/src/client/session-fish/active
 */

let activeSessionId: string | null = null;
let lastReported: string | null = null;

/**
 * 记录当前打开的会话，并回答这次是否需要向宿主上报。
 *
 * @param sessionId - 会话 id。
 * @returns 第一次见到这个会话（或换过会话）时 true；重复渲染返回 false。
 */
export function reportActiveSession(sessionId: string): boolean {
  if (lastReported === sessionId) return false;
  lastReported = sessionId;
  activeSessionId = sessionId;
  return true;
}

/** 当前打开的会话；不知道时为 null。 */
export function getActiveSession(): string | null {
  return activeSessionId;
}
