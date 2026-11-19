/**
 * 设置页「AI 润色」数据层：请求一次 → 出预览 → 用户点「应用」才写草稿。
 *
 * 服务端零写盘（`POST /persona/polish` 只回文本），所以这里的 `apply()` 也只是把预览交给外壳的
 * `onChange({ whisperPrompt })`；`cancel()` 清预览、**不调用 onChange**——正文一个字都不变（验收 10）。
 * owns only 一次润色往返与预览开关，never 保存、模型选择与按钮可用性。
 * @module dsh-fish-body/src/client/settings/use-persona-polish
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { Feedback } from './feedback.ts';
import type { SettingsRuntime } from './runtime.ts';

/** {@link usePersonaPolish} 的依赖。 */
export interface PersonaPolishDeps {
  readonly petId: string;
  readonly report: (feedback: Feedback) => void;
  /** 应用预览：只改草稿里的 `whisperPrompt`，与底部栏保存一起落盘。 */
  readonly onChange: (patch: { whisperPrompt: string }) => void;
}

/** 状态与动作。 */
export interface PersonaPolishState {
  /** 预览文本；`null` = 没有待应用的润色。 */
  readonly preview: string | null;
  readonly busy: boolean;
  /** 请求润色（空文本不发请求）。 */
  polish(text: string): Promise<void>;
  /** 把预览写进草稿。 */
  apply(): void;
  /** 丢弃预览（不发请求、不写草稿）。 */
  cancel(): void;
}

/**
 * 润色数据层。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @param deps - 当前实例、反馈出口与草稿回写。
 * @returns 预览与三个动作。
 */
export function usePersonaPolish(
  rt: Pick<SettingsRuntime, 'useState' | 't'>,
  deps: PersonaPolishDeps,
): PersonaPolishState {
  const { useState, t } = rt;
  const { petId, report, onChange } = deps;
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const polish = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed === '') {
      report({ kind: 'err', text: t('personaPolishEmpty') });
      return;
    }
    setBusy(true);
    try {
      let body: Record<string, unknown> | null = null;
      try {
        const response = await fetch(ROUTE_PATH + '/persona/polish', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pet: petId, text }),
        });
        if (response.ok) body = (await response.json()) as Record<string, unknown>;
      } catch {
        body = null;
      }
      if (body === null || body.ok !== true) {
        report({ kind: 'err', text: String(body?.message ?? t('personaPolishFailed')) });
        return;
      }
      const next = typeof body.text === 'string' ? body.text : '';
      if (next === '') {
        report({ kind: 'err', text: t('personaPolishFailed') });
        return;
      }
      setPreview(next);
    } finally {
      setBusy(false);
    }
  };

  const apply = (): void => {
    if (preview === null) return;
    onChange({ whisperPrompt: preview });
    setPreview(null);
    report({ kind: 'ok', text: t('personaPolishApplied') });
  };

  const cancel = (): void => {
    // 只清预览：不发请求、不动草稿
    setPreview(null);
  };

  return { preview, busy, polish, apply, cancel };
}
