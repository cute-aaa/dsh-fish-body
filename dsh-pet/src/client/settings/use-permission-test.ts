/**
 * 操作区「测试弹窗」的状态与动作：一次权限申请 + 一条测试通知，结论就地显示在按钮旁。
 *
 * 反馈与「保存」的反馈分开：申请失败要说理由与引导，而保存成功只是一句结论，混在一个位置会互相覆盖。
 * owns only 这一句反馈，never 权限本身与通知的构造（那是 `./notify-test.ts` 的纯动作）。
 * @module dsh-pet/src/client/settings/use-permission-test
 */
import type { Feedback } from './actions.ts';
import { runNotificationTest } from './notify-test.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 「测试弹窗」的状态与动作。 */
export interface PermissionTest {
  /** 上一次的结论（空文案 = 还没测过）。 */
  readonly message: Feedback;
  /** 跑一次：先拿权限，再发一条测试通知。 */
  test(): void;
}

/**
 * 管理「测试弹窗」的就地反馈。
 *
 * @param rt - 只用到 `useState` 与翻译 `t`。
 * @returns 结论与触发入口。
 */
export function usePermissionTest(rt: Pick<SettingsRuntime, 'useState' | 't'>): PermissionTest {
  const { useState, t } = rt;
  const [message, setMessage] = useState<Feedback>({ kind: '', text: '' });
  return { message, test: (): void => void runNotificationTest({ t, report: setMessage }) };
}
