/**
 * 接入配置状态：拉取一次，保存成功后用服务端回包推进视图。
 *
 * 不维护路径真值的第二份副本；设置页只把当前视图交给角色卡与兼容卡。
 * @module dsh-fish-body/src/client/settings/use-integrations
 */
import { loadIntegrations, saveIntegrations, type IntegrationsSaveOutcome } from './integrations-api.ts';
import type { IntegrationsView } from '../../shared/integrations.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 接入配置状态与动作。 */
export interface IntegrationsState {
  readonly view: IntegrationsView | null;
  readonly busy: boolean;
  readonly message: string;
  readonly failed: boolean;
  reload(): void;
  savePersona(path: string | null, approveExternal: boolean): Promise<IntegrationsSaveOutcome>;
  saveMemory(
    mode: 'auto' | 'custom',
    customDir: string | null,
    approveExternal: boolean,
  ): Promise<IntegrationsSaveOutcome>;
}

/** 精简渲染 / 旧测试没有接入宿主时的零状态；不产生任何写请求。 */
export const NO_INTEGRATIONS: IntegrationsState = {
  view: null,
  busy: false,
  message: '',
  failed: false,
  reload: () => undefined,
  savePersona: async () => ({ ok: false, reason: 'unsupported', message: '' }),
  saveMemory: async () => ({ ok: false, reason: 'unsupported', message: '' }),
};

/** 造接入配置状态。 */
export function useIntegrations(rt: SettingsRuntime): IntegrationsState {
  const [view, setView] = rt.useState<IntegrationsView | null>(null);
  const [busy, setBusy] = rt.useState(false);
  const [message, setMessage] = rt.useState('');
  const [failed, setFailed] = rt.useState(false);
  const alive = rt.useRef(true);

  rt.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = rt.useCallback(() => {
    void loadIntegrations().then((next) => {
      if (alive.current) setView(next);
    });
  }, []);

  rt.useEffect(() => {
    reload();
  }, [reload]);

  const save = rt.useCallback(
    async (patch: unknown): Promise<IntegrationsSaveOutcome> => {
      if (busy) return { ok: false, reason: 'busy', message: '正在保存接入配置' };
      setBusy(true);
      setMessage('');
      try {
        const outcome = await saveIntegrations(patch);
        if (!alive.current) return outcome;
        setFailed(!outcome.ok);
        setMessage(outcome.ok ? '' : outcome.message);
        if (outcome.ok) setView(outcome.view);
        return outcome;
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [busy],
  );

  const savePersona = rt.useCallback(
    (path: string | null, approveExternal: boolean) =>
      save({
        persona: {
          customPath: path,
          ...(approveExternal ? { approvedExternal: true } : {}),
        },
      }),
    [save],
  );

  const saveMemory = rt.useCallback(
    (mode: 'auto' | 'custom', customDir: string | null, approveExternal: boolean) =>
      save({
        memory: {
          mode,
          customDir,
          ...(approveExternal ? { approvedExternal: true } : {}),
        },
      }),
    [save],
  );

  return { view, busy, message, failed, reload, savePersona, saveMemory };
}
