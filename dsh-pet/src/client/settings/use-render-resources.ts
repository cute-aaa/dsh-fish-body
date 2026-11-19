/**
 * 设置页「渲染资源」数据层：按当前选中宠物的素材根拉 `GET /skin/{root}/resources`。
 *
 * 服务端不加缓存（池读取器一请求一实例），所以「重新扫描」就是再发一次 GET。
 * 失败不抛：保留上一份清单（有的话）并报一条 Feedback，卡片照常渲染。
 * owns only 三桶清单与重新扫描，never 渲染方式/模型的写回（那是草稿 + 底部栏的事）。
 * @module dsh-fish-body/src/client/settings/use-render-resources
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { Feedback } from './feedback.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 一个桶（与 `GET /skin/{root}/resources` 同形）。 */
export interface RenderBucketView {
  readonly status: 'ok' | 'empty' | 'missing';
  readonly dir: string;
  readonly count: number;
  readonly items: readonly { id: string; label: string; source: 'pack' | 'pool' }[];
  readonly expect: readonly string[];
  readonly missingFiles: readonly string[];
}

/** 三桶清单。 */
export interface RenderResourcesView {
  readonly root: string;
  readonly renderers: {
    readonly layered: RenderBucketView;
    readonly live2d: RenderBucketView;
    readonly webm: RenderBucketView;
  };
}

/** {@link useRenderResources} 的依赖。 */
export interface RenderResourcesDeps {
  /** 当前选中宠物的素材根；缺省按 `main`。 */
  readonly assetRoot?: string;
  readonly report?: (feedback: Feedback) => void;
}

/** 状态与动作。 */
export interface RenderResourcesState {
  readonly resources: RenderResourcesView | null;
  readonly busy: boolean;
  /** 重新扫描（重发一次 GET）。 */
  reload(): void;
}

/**
 * 渲染资源清单。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @param deps - 素材根与反馈出口。
 * @returns 清单、进行中标志与重新扫描。
 */
export function useRenderResources(
  rt: Pick<SettingsRuntime, 'useState' | 'useEffect' | 't'>,
  deps: RenderResourcesDeps,
): RenderResourcesState {
  const { useState, useEffect, t } = rt;
  const assetRoot = deps.assetRoot === undefined || deps.assetRoot === '' ? 'main' : deps.assetRoot;
  const [resources, setResources] = useState<RenderResourcesView | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setBusy(true);
    void (async () => {
      try {
        const response = await fetch(ROUTE_PATH + '/skin/' + encodeURIComponent(assetRoot) + '/resources', {
          signal: controller.signal,
        });
        if (!alive) return;
        if (!response.ok) {
          deps.report?.({ kind: 'err', text: t('renderRescanFailed') });
          return;
        }
        const body = (await response.json()) as RenderResourcesView;
        // 形状不对就当没读到：卡片会按「没有清单」渲染，绝不把坏数据塞进渲染路径。
        const renderers = body?.renderers;
        if (renderers === undefined || renderers === null) {
          if (alive) deps.report?.({ kind: 'err', text: t('renderRescanFailed') });
          return;
        }
        if (alive) setResources(body);
      } catch {
        if (alive) deps.report?.({ kind: 'err', text: t('renderRescanFailed') });
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
    // report / t 由装配根保证稳定；进依赖会让每次渲染都重扫一次池。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetRoot, tick]);

  return { resources, busy, reload: () => setTick((value) => value + 1) };
}
