/**
 * 页面打开时一次性拉取的宿主数据：落盘位置清单（`/config/meta`）与候选模型清单（`/models`）。
 *
 * 两个请求互不依赖、失败都不阻塞表单：缺 meta 只影响两张路径卡，缺候选清单只影响下拉框。
 * 候选清单多一个 `reloadCatalog`：它失败时过去只写一句「刷新页面可重试」，而整页刷新会把
 * 六个分区连同未保存的改动一起丢掉——对话分区自己能重拉，就不该让用户去刷整页。
 * 落盘位置不提供重拉：那棵树本来就以重启后的宿主为准（搬迁完成本来就要重启）。
 * 顺带把「组件已卸载」的判断留在 hook 里，避免请求回来往死掉的组件上写状态。
 * @module dsh-fish-body/src/client/settings/use-remote-data
 */
import { type ConfigMeta, loadMeta, loadModelCatalog } from './config/index.ts';
import type { ModelCatalogGroup } from './picker/index.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 一次性拉取的结果。 */
export interface RemoteData {
  /** 路径与存储清单；`null` = 还没拿到或读取失败。 */
  paths: ConfigMeta | null;
  /** 候选模型清单；`null` = 还没拉到或拉取失败。 */
  catalog: ModelCatalogGroup[] | null;
  /** 候选清单拉取失败（下拉框要显示一行提示）。 */
  catalogFailed: boolean;
  /** 候选清单正在拉取：卡头的「重新拉取」据此禁用。 */
  catalogLoading: boolean;
  /** 重新拉取候选清单（失败后不必刷整页）。 */
  reloadCatalog(): void;
}

/**
 * 拉取元信息与候选清单。
 *
 * @param rt - 只用到 `useState`、`useEffect`、`useRef` 与 `useCallback`。
 * @returns 四个只读结果与一个重拉入口。
 */
export function useRemoteData(
  rt: Pick<SettingsRuntime, 'useState' | 'useEffect' | 'useRef' | 'useCallback'>,
): RemoteData {
  const { useState, useEffect, useRef, useCallback } = rt;
  const [paths, setPaths] = useState<ConfigMeta | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogGroup[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  // 组件是否还在：首次拉取与「重新拉取」共用同一个判断，卸载后一律不写状态。
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void loadMeta().then((meta) => {
      if (alive.current) setPaths(meta);
    });
  }, []);

  /** 拉一次候选清单：同时是首次拉取与「重新拉取」的实现，差别只在谁调它。 */
  const loadCatalog = useCallback((): void => {
    setCatalogLoading(true);
    setCatalogFailed(false);
    void loadModelCatalog().then((groups) => {
      if (!alive.current) return;
      setCatalogLoading(false);
      if (groups === null) setCatalogFailed(true);
      else setCatalog(groups);
    });
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  return { paths, catalog, catalogFailed, catalogLoading, reloadCatalog: loadCatalog };
}
