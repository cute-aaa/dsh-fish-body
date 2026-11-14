/**
 * 位置变更：`GET/POST /layout/location`（数据根与用户皮肤目录搬到别处）、`GET /layout/size`
 * （搬之前先数清有多少）与 `POST /pick-folder`（原生选目录）。
 *
 * 为什么是异步 + 轮询：搬一个几百 MB 的数据根要几十秒，一次 HTTP 请求挂着不合适（代理与浏览器都会先超时）。
 * POST 只负责把它跑起来，GET 返回进度；搬完的落点（指针文件 / `locations.json`）由本模块写。
 *
 * 换根**不在进程内热切**：日志文件、store、路由依赖在装配期就已经绑死在旧根上，
 * 半路换根只会得到一个「一半读旧、一半写新」的插件。所以成功之后只置 `needsRestart`，
 * 由界面调 `/plugin-restart` 重来一遍——那是唯一可靠的路径。
 * @module dsh-fish-body/src/host/routes/layout
 */
import { existsSync, statSync } from 'node:fs';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { patchLocations, resolveSkinDir, writeRootPointer } from '../locations.ts';
import { checkMoveTarget, dirSize, moveTree, type MoveProgress } from '../move-tree.ts';
import { pickFolder } from '../pick-folder.ts';
import { pathsOf } from './paths.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, methodNotAllowed, okResult } from './result.ts';

/** 可改位置的两项。 */
export type MovableLocation = 'root' | 'skin';

/** 一次搬迁的对外状态（`GET /layout/location` 的响应体）。 */
export interface MoveState {
  /** 是否正在搬。 */
  readonly busy: boolean;
  /** 正在搬哪一项。 */
  readonly which?: MovableLocation;
  /** 阶段：复制中 / 收尾（删旧位置）。 */
  readonly phase: 'copying' | 'cleaning';
  /** 已复制字节 / 总字节。 */
  readonly copiedBytes: number;
  readonly totalBytes: number;
  /** 已复制文件数 / 总文件数。 */
  readonly copiedFiles: number;
  readonly totalFiles: number;
  /** 正在处理的相对路径。 */
  readonly current: string;
  /** 失败原因（非空表示上一次没搬成，旧位置仍在）。 */
  readonly error?: string;
  /** 搬成功但需要重启插件才生效。 */
  readonly needsRestart: boolean;
  /** 上次成功的目标路径（界面据此显示「已移动到」）。 */
  readonly movedTo?: string;
}

/** 进程内只有一次搬迁：两个按钮同时点会互相覆盖目标，没有第二种合理语义。 */
let state: MoveState = {
  busy: false,
  phase: 'copying',
  copiedBytes: 0,
  totalBytes: 0,
  copiedFiles: 0,
  totalFiles: 0,
  current: '',
  needsRestart: false,
};

/**
 * 读当前搬迁状态。
 *
 * @returns 状态快照。
 */
export function moveState(): MoveState {
  return state;
}

/** 测试用：把状态清回初始（避免用例之间互相影响）。@internal */
export function resetMoveState(): void {
  state = {
    busy: false,
    phase: 'copying',
    copiedBytes: 0,
    totalBytes: 0,
    copiedFiles: 0,
    totalFiles: 0,
    current: '',
    needsRestart: false,
  };
}

/**
 * 读请求体里的字段。
 *
 * 路由层给的 `body` 是**原始文本**（HTTP 那层不做解析），所以这里要自己 JSON.parse；
 * 解析失败按空对象处理，让下面的「缺 which / 缺路径」分支给出统一的 bad-request。
 */
function bodyOf(body: unknown): { which?: string; path?: string; title?: string; start?: string } {
  const raw: Record<string, unknown> =
    typeof body === 'string'
      ? ((): Record<string, unknown> => {
          try {
            const parsed: unknown = JSON.parse(body);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : {};
          } catch {
            return {};
          }
        })()
      : body && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  return { which: text(raw.which), path: text(raw.path), title: text(raw.title), start: text(raw.start) };
}

/**
 * 搬一项位置（同步执行，调用方在后台跑它）。
 *
 * @param deps - 路由依赖（取路径表与 dshHome）。
 * @param which - 搬哪一项。
 * @param target - 目标绝对路径。
 * @returns 失败原因；成功时 `undefined`。
 */
function runMove(deps: PetRouteDeps, which: MovableLocation, target: string): string | undefined {
  const paths = pathsOf(deps);
  const from = which === 'root' ? paths.root : paths.skinsDir;
  const invalid = checkMoveTarget(from, target);
  if (invalid !== undefined) return invalid;
  if (!existsSync(from)) return '当前位置不存在：' + from;

  state = {
    busy: true,
    which,
    phase: 'copying',
    copiedBytes: 0,
    totalBytes: 0,
    copiedFiles: 0,
    totalFiles: 0,
    current: '',
    needsRestart: false,
  };
  const onProgress = (progress: MoveProgress): void => {
    state = { ...state, ...progress, phase: progress.copiedFiles >= progress.totalFiles ? 'cleaning' : 'copying' };
  };
  const result = moveTree(from, target, { onProgress });
  if (!result.ok) {
    state = { ...state, busy: false, error: result.message };
    return result.message;
  }
  try {
    if (which === 'root') {
      writeRootPointer(deps.dshHome ?? resolveDshHome(), target);
    } else {
      // 指回默认位置时删掉覆盖，别在 locations.json 里留一条「等于默认值」的冗余记录。
      const fallback = resolveSkinDir(paths.root, {});
      patchLocations(paths.root, { skin: target === fallback ? null : target });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    state = { ...state, busy: false, error: '内容已搬到新位置，但写入位置指针失败：' + reason };
    return reason;
  }
  state = { ...state, busy: false, needsRestart: true, movedTo: target, phase: 'cleaning', current: '' };
  return undefined;
}

/**
 * 位置变更领域：未命中返回 undefined，命中返回应答。
 */
export async function handleLayoutRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { rest, method } = input;

  // 「这次要搬多少」：界面在让用户选目录之前先问一次，好把文件数与体积讲清楚。
  // 只读扫描，不建目录、不写文件；扫不动就如实回失败，界面隐藏数量那一行。
  if (rest === 'layout/size') {
    if (method !== 'GET') return methodNotAllowed();
    const which = input.url.searchParams.get('which');
    if (which !== 'root' && which !== 'skin') return failResult('bad-request', 'which 只能是 root / skin');
    const paths = pathsOf(deps);
    const target = which === 'root' ? paths.root : paths.skinsDir;
    try {
      const size = dirSize(target);
      return okResult({ ok: true, which, path: target, ...size });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return failResult('generate-error', '统计目录大小失败：' + reason);
    }
  }

  if (rest === 'layout/location') {
    if (method === 'GET') {
      const paths = pathsOf(deps);
      return okResult({ ...state, root: paths.root, skin: paths.skinsDir });
    }
    if (method !== 'POST') return methodNotAllowed();
    if (state.busy) return failResult('busy', '上一次搬迁还没完成');
    const { which, path } = bodyOf(input.body);
    if (which !== 'root' && which !== 'skin') return failResult('bad-request', 'which 只能是 root / skin');
    if (path === undefined) return failResult('bad-request', '缺少目标路径');
    const target = path;
    // 目标必须是绝对路径，且不能指向一个已存在的文件。
    if (!/^([a-zA-Z]:[\\/]|[\\/])/.test(target)) return failResult('bad-request', '目标必须是绝对路径');
    try {
      if (existsSync(target) && !statSync(target).isDirectory()) {
        return failResult('bad-request', '目标已存在且不是目录：' + target);
      }
    } catch {
      /* 取不到状态就交给 moveTree 报错 */
    }
    // 不 await：搬迁要几十秒，界面靠 GET 轮询进度。
    state = { ...state, busy: true, which, phase: 'copying', error: undefined, needsRestart: false };
    setImmediate(() => {
      const failure = runMove(deps, which, target);
      if (failure !== undefined) deps.log.warn(`[fish-body] 位置变更失败（${which} → ${target}）：${failure}`);
      else deps.log.info(`[fish-body] 位置变更完成（${which} → ${target}），重启插件后生效`);
    });
    return okResult({ started: true, ...state });
  }

  if (rest === 'pick-folder') {
    if (method !== 'POST') return methodNotAllowed();
    const { title, start } = bodyOf(input.body);
    const picked = await pickFolder({
      ...(title === undefined ? {} : { title }),
      ...(start === undefined ? {} : { start }),
    });
    if (picked.kind === 'picked') return okResult({ ok: true, path: picked.path });
    if (picked.kind === 'cancelled') return okResult({ ok: false, reason: 'cancelled' });
    return okResult({ ok: false, reason: 'unsupported', message: picked.message });
  }

  return undefined;
}
