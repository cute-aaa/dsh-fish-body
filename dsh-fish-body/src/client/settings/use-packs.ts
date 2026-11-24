/**
 * 资源包状态：拉清单、装、删，以及「哪一个包正在动」。
 *
 * 状态真源在宿主（`GET /packs`）：这里不维护「我装了哪些」的本地真相，
 * 每次动作成功后重拉一次。这样即便另一路（CLI / 另一个页面）装过，
 * 刷新也能看到，而不会出现「界面说不存在、磁盘上有」。
 * @module dsh-fish-body/src/client/settings/use-packs
 */
import { installPack, listPacks, removePack, type PackView } from './packs-api.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 卡片要读的全部状态与动作。 */
export interface PacksState {
  readonly items: readonly PackView[];
  /** 正在动的包 id；空串表示没有进行中的动作。 */
  readonly busyId: string;
  /** 最近一次动作的结论文案；空串表示没有要说的。 */
  readonly message: string;
  /** 上一次结论是否是失败（决定文案颜色）。 */
  readonly failed: boolean;
  reload(): void;
  install(id: string): void;
  remove(id: string): void;
}

/**
 * 造资源包状态。
 *
 * @param rt - 设置页运行时（只取 useState / useEffect / useRef / useCallback 与翻译）。
 * @returns 状态与动作。
 */
export function usePacks(rt: SettingsRuntime): PacksState {
  const [items, setItems] = rt.useState<readonly PackView[]>([]);
  const [busyId, setBusyId] = rt.useState('');
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
    void listPacks().then((list) => {
      if (alive.current) setItems(list);
    });
  }, []);

  rt.useEffect(() => {
    reload();
  }, [reload]);

  /** 跑一次动作：置忙 → 执行 → 重拉 → 报结论。忙时忽略重复点击。 */
  const act = rt.useCallback(
    (id: string, run: () => Promise<{ ok: boolean; message?: string }>, okText: string) => {
      if (busyId !== '') return;
      setBusyId(id);
      setMessage('');
      void run()
        .then((outcome) => {
          if (!alive.current) return;
          setFailed(!outcome.ok);
          setMessage(outcome.ok ? okText : (outcome.message ?? ''));
          if (outcome.ok) reload();
        })
        .finally(() => {
          if (alive.current) setBusyId('');
        });
    },
    [busyId, reload],
  );

  const install = rt.useCallback(
    (id: string) => {
      act(id, () => installPack(id), rt.t('packsInstalled'));
    },
    [act, rt],
  );

  const remove = rt.useCallback(
    (id: string) => {
      act(id, () => removePack(id), rt.t('packsRemoved'));
    },
    [act, rt],
  );

  return { items, busyId, message, failed, reload, install, remove };
}
