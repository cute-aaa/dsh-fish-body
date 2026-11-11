/**
 * 插件自重启（`POST /plugin-restart`）：让宿主重新组合本插件，改完宿主代码不必重启整个 profile。
 *
 * 有 HMR 时走 `hmr.runExclusive(() => hmr.reconcileProfile())`——重新组合会替换「已加载文件变过」的插件，
 * 包括 link 进来的包（本插件就是 link 的），所以 `pnpm build` 之后点这一项即可生效；没有 HMR 时进程内
 * 换不掉已加载的 ESM，只重启桌面 Helper，并在响应里如实说明。
 * 必须先回响应再触发：重新组合会把本插件的路由一起拆掉，等回调会把应答丢掉；成败只进日志。
 * @module dsh-pet/src/host/routes/plugin-restart
 */
import { type RouteResult } from '../http.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import { methodNotAllowed, okResult } from './result.ts';

/** HMR 服务面上用到的两项（Cordis 侧没有本地类型，按需收窄）。 */
interface HmrService {
  /** 重新组合必须在这条事务队列里跑：HMR 自己也是从队列里调它的。 */
  runExclusive?: <T>(operation: () => Promise<T>) => Promise<T>;
  reconcileProfile?: (requiredIds?: string[]) => Promise<unknown>;
}

/** 重新组合的结论（reconcileProfile 的返回；取用到的字段）。 */
interface ReconcileOutcome {
  readonly pending?: readonly unknown[];
  readonly restartReason?: string;
}

/** 触发前等一小会儿，让 HTTP 应答先发出去（重新组合会拆掉本插件的路由）。 */
const RESTART_DELAY_MS = 150;

/**
 * 重新组合本插件。
 *
 * @param deps - 路由依赖；只用到 `ctx`（取 HMR 服务）、`log`（成败落盘）与 `requestRestart`（无 HMR 的退路）。
 * @param input - 已切好的 rest / method。
 * @returns 匹配本端点时的应答；不是本端点返回 `undefined` 交给后面的处理器。
 */
export async function handlePluginRestart(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  if (input.rest !== 'plugin-restart') return undefined;
  if (input.method !== 'POST') return methodNotAllowed();
  const hmr = deps.ctx.get?.('hmr') as HmrService | undefined;
  const usable = hmr !== undefined && typeof hmr.reconcileProfile === 'function';
  deps.log.info('[dsh-pet] 插件重启请求 mode=' + (usable ? 'hmr' : 'helper'));
  if (!usable || hmr === undefined) {
    void deps.requestRestart();
    return okResult({ ok: true, mode: 'helper' });
  }
  const service = hmr;
  const timer = setTimeout(() => {
    // 事务里的动作必须延后到 runExclusive 内部才调用：HMR 用 AsyncLocalStorage 判「在不在队列里」，
    // 先把 promise 造出来再包进去，等于在队列外执行，必然被拒。
    const reconcile = (): Promise<unknown> => service.reconcileProfile?.() ?? Promise.resolve(undefined);
    const task = service.runExclusive === undefined ? reconcile() : service.runExclusive(reconcile);
    void task.then(
      (outcome) => deps.log.info('[dsh-pet] 插件重启完成 ' + describe(outcome)),
      (error: unknown) =>
        deps.log.error('[dsh-pet] 插件重启失败：' + (error instanceof Error ? error.message : String(error))),
    );
  }, RESTART_DELAY_MS);
  // 不拖住进程退出：这次重启是为正在跑的宿主服务的，没人在等它。
  timer.unref?.();
  return okResult({ ok: true, mode: 'hmr' });
}

/** 把重新组合的结论压成一行日志：哪些模块换了、要不要重启进程。 */
function describe(outcome: unknown): string {
  if (!outcome || typeof outcome !== 'object') return 'outcome=unknown';
  const { pending, restartReason } = outcome as ReconcileOutcome;
  const swapped = Array.isArray(pending) ? pending.length : 0;
  return 'swapped=' + swapped + (restartReason === undefined ? '' : ' restartReason=' + restartReason);
}
