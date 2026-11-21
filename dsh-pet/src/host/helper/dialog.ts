/**
 * 宿主侧的「系统选择框」客户端：把 `/pick-file`、`/pick-folder` 的意图转成一次
 * `POST <helper 回调基址>/pick`，再把 helper 的三态归一成宿主自己的结局。
 *
 * 传输层用 `node:http`：回调基址恒为 `http://127.0.0.1:<随机端口>`，而这条路**没有**「等响应头多久
 * 算超时」这回事——人的思考时间不是失败。不变量：本模块不产生任何计时器，唯一的中止来源是调用方的
 * `signal`；连接真断了仍由连接类错误立刻暴露（见 {@link isConnectionError}）。
 *
 * `unavailable` 与 `aborted` 是内部态，绝不进路由响应：前者是「这次回落 PowerShell」的信号（由
 * `pick-folder.ts` 吞掉），后者表示调用方已经走了（变成 `{kind:'none'}`）。协议另一端见 `bridge.ts`。
 * @module dsh-fish-body/src/host/helper/dialog
 */
import { request as httpRequest } from 'node:http';

/** 一次系统选择框的请求（与 helper `POST /pick` 的请求体同形，`signal` 除外）。 */
export interface NativePickerRequest {
  /** `file` = 选文件，`folder` = 选目录。 */
  readonly kind: 'file' | 'folder';
  /** 对话框标题（helper 在 Windows 上原样当窗口标题）。 */
  readonly title: string;
  /** 初始目录；不给就交给系统「上次目录」。 */
  readonly start?: string;
  /** 允许的扩展名（含点，`kind:'file'` 时有效）。 */
  readonly extensions?: readonly string[];
  /**
   * 调用方（页面 / 那条 HTTP 请求）断开时用它中止等待。
   *
   * 只用于中止这次请求，不会出现在请求体里（`AbortSignal` 不可序列化，helper 侧也没有超时可变）。
   */
  readonly signal?: AbortSignal;
}

/**
 * 选择框的结论。
 *
 * 三个对外态与 `PickFolderResult` 一一对应；`unavailable` / `aborted` 是内部态——
 * 前者决定「要不要回落 B」，后者表示「调用方已经走了，什么都不用回」。
 */
export type NativePickerOutcome =
  | { readonly kind: 'picked'; readonly path: string }
  | { readonly kind: 'cancelled' }
  /** 已经确定弹不出来（忙 / 通道中断 / helper 明确不支持）：**不再**回落 B，否则会连弹两个框。 */
  | { readonly kind: 'unsupported'; readonly message: string }
  /** 这条通道不可用（没接线 / 连不上 / 老 helper）：调用方回落 PowerShell。 */
  | { readonly kind: 'unavailable' }
  /** 调用方的 `signal` 触发了中止：不要写响应，也不要回落。 */
  | { readonly kind: 'aborted' };

/** 宿主拿到的系统选择框能力。 */
export type NativePicker = (req: NativePickerRequest) => Promise<NativePickerOutcome>;

/**
 * 忙（helper 里已经开着一个框）：不回落 B，否则会同时/连续弹两个框。
 *
 * 文案是**可操作**的：告诉用户下一步做什么（关掉那个框），而不是只陈述「忙」。
 */
export const PICK_DIALOG_BUSY_MESSAGE = '另一个选择框还开着，请先关掉已打开的选择框再点';

/**
 * 老 helper 仍在限时：新宿主不再传 `timeoutMs`，但升级后没重启的 helper 会按自己的 3 分钟兜底回
 * `reason:'timeout'`。这条提示指向唯一有效的解脱动作（重启插件让 helper 一起重启）。
 */
export const PICK_DIALOG_STALE_HELPER_MESSAGE = 'helper 版本较旧仍在限时；请重启插件后再试，或直接填写路径';

/**
 * 连接中途断了但 helper 进程还活着：框**可能还在屏幕上**，回落 B 会再弹一个。
 *
 * 所以这里只给提示、不回落。真正「helper 已死」的情况走 `unavailable`（框随进程一起消失，回落安全）。
 */
export const PICK_DIALOG_CHANNEL_LOST_MESSAGE = '选择框通道中断，请直接填写路径';

/** helper 明确说了「弹不出来」但没给原因时的兜底文案。 */
export const PICK_DIALOG_UNSUPPORTED_MESSAGE = '系统选择框不可用，请直接填写路径';

/**
 * 连接类错误码：这些都代表「helper 这条通道这次断了」，要不要回落由 `isPeerAlive` 决定。
 *
 * 注入的传输替身可能只抛一个光秃秃的 `TypeError`，真正的原因挂在 `error.cause.code` 上，
 * 所以错误链两边都要看。
 */
const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENOTFOUND', 'EPIPE']);

/**
 * 「客户端自己等累了」的错误码/错误名：它们不是关于 helper 的任何事实。
 *
 * 生产路径产生不出它们（`node:http` 没有响应头/响应体计时器）；留着是为了让注入的传输实现
 * 即便把这类错误抛进来，也守得住「时间不判失败」。
 *
 * `TimeoutError` 是 `AbortSignal.timeout(ms)` 到期时投出的 `DOMException.name`（也是本仓
 * `voice/**`、`vision.ts` 那类「给请求加时限」写法的产物）。它**必须**归到这一族：一旦被当成
 * 「调用方中止」，路由会回 `{kind:'none'}`、一个字节都不写，用户看到的是「点了没反应」。
 */
const WAITING_TIMEOUT_CODES = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const WAITING_TIMEOUT_NAMES = new Set(['HeadersTimeoutError', 'BodyTimeoutError', 'TimeoutError']);

/** 只属于「调用方真的中止了」的错误码（`node:http` 的 `AbortError.errno`）。 */
const ABORT_ERROR_CODES = new Set(['ABORT_ERR']);

/**
 * 一条错误链上的三族事实：字符串 `code` 集合、`name` 集合、链上是否出现过 `TypeError`。
 *
 * 为什么是**集合**而不是「链上第一个 code」：旧实现 `codeOf` 只取第一个字符串 code，于是
 * 「外层 `ERR_UNEXPECTED`、内层 `ECONNRESET`」这种真实可达的包裹形状被认成「无关错误」→
 * `unavailable` → 回落 B → 而 helper 还活着、框可能还在屏幕上，用户看到的是第二个框。
 *
 * `code` 只收**字符串**：`DOMException.code` 是数字（中止是 23），按数字认族会认错；
 * 这类错误靠 `names.has('AbortError')` 兜。
 */
export interface ErrorFacts {
  /** 整条链上的字符串 `code`（去重）。 */
  readonly codes: ReadonlySet<string>;
  /** 整条链上的 `name`（去重，含 `TypeError` / `TimeoutError` / `AbortError` 这些）。 */
  readonly names: ReadonlySet<string>;
  /** 链上任一节点是 `TypeError`（保持 `isConnectionError` 原有的宽口径）。 */
  readonly isTypeError: boolean;
}

/**
 * 一次遍历整条 `cause` 链，收集三族判定要用的全部事实。
 *
 * `seen` 防环：注入的传输替身完全可能造出自引用/环状 `cause`，遍历不能因此死循环。
 *
 * @param error - 传输实现抛出的任何东西（可以不是 `Error`）。
 * @returns 三族判定的输入；非对象输入返回三个空/`false`。
 */
export function errorFactsOf(error: unknown): ErrorFacts {
  const codes = new Set<string>();
  const names = new Set<string>();
  let isTypeError = false;
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const node = current as { code?: unknown; name?: unknown; cause?: unknown };
    if (typeof node.code === 'string') codes.add(node.code);
    if (typeof node.name === 'string') names.add(node.name);
    if (current instanceof TypeError) isTypeError = true;
    current = node.cause;
  }
  return { codes, names, isTypeError };
}

/**
 * 两个集合有没有交集（`Set` 没有原生 intersects）。
 *
 * @param left - 候选事实集合。
 * @param right - 某一族的取值集合。
 * @returns 至少有一个共同值则 `true`。
 */
function intersects<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  for (const value of right) if (left.has(value)) return true;
  return false;
}

/**
 * 是不是被调用方的 `signal` 打断——**只认真正的中止信号**。
 *
 * `node:http` 在 abort 时投给 `error` 事件的是 `AbortError`（`errno: 'ABORT_ERR'`），
 * 而别的实现可能给 `DOMException`——它不算 `Error` 的实例，所以不能只靠 instanceof；
 * 反过来，`DOMException` 的形状也意味着「`name` 是这个值」不等于「这是中止」。
 *
 * 整条链都看：外层被 `Error` 包一层、内层才是 `AbortError` 的形状（`ECONNRESET` 外套
 * `AbortError`）应当按中止收尾，而不是被连接族抢走。
 *
 * 为什么**不**收 `TimeoutError`（review P2-1）：`AbortSignal.timeout(ms)` 到期投的就是
 * `name:'TimeoutError'`。把它算成 abort，这条错误就会变成 `aborted` → 路由回 `{kind:'none'}` →
 * `http-route.ts` 一个字节都不写 → 用户看到「点了没反应」。时限类错误要走
 * {@link isWaitingTimeout}（不判失败、继续等），不是「调用方已经走了」。
 *
 * @param facts - {@link errorFactsOf} 的结果。
 * @returns 是否要按「调用方中止」收尾。
 */
function isAbortError(facts: ErrorFacts): boolean {
  return facts.names.has('AbortError') || intersects(facts.codes, ABORT_ERROR_CODES);
}

/**
 * 是不是连接层失败（连不上 / 断开 / 域名解析不到）。
 *
 * 集合相交而不是「首个 code」：外层无关 code 不能盖住内层的 `ECONNRESET`。
 * `isTypeError` 这条宽口径保留——注入的传输替身常常只抛一个光秃秃的 `TypeError('fetch failed')`。
 *
 * @param facts - {@link errorFactsOf} 的结果。
 * @returns 是否按连接事实处理。
 */
function isConnectionError(facts: ErrorFacts): boolean {
  return facts.isTypeError || intersects(facts.codes, CONNECTION_ERROR_CODES);
}

/**
 * 是不是「等待类超时」（响应头/响应体计时器到点），而不是连接事实。
 *
 * 两种形状都要认：`code`（`node:http`/undici 风格）与 `name`（`HeadersTimeoutError` 一类），
 * 整条链上都算。
 *
 * **连接反条件（层二）**：同一条链上若也出现连接类 code，就**不算**等待类——交给
 * {@link isConnectionError}。理由是这个形状真实可达：「等响应头时对端 RST」会同时带来
 * `UND_ERR_HEADERS_TIMEOUT`（外层）与 `ECONNRESET`（内层 `cause`）。把它算成等待类就会进
 * `pendingUntilAborted(req.signal)`，没有 `signal` 时**永不落定** → 路由一个字节都不写 →
 * 用户看到「点了没反应」——正是本轮要消灭的那个症状。语义上也说得通：连接事实比「客户端自己
 * 等累了」更硬。
 *
 * 反条件只消费 `codes`、不看 `isTypeError`：所以「纯 `TypeError`、链上没有任何连接 code」仍是
 * 等待类（既有三条 `TimeoutError` 形状用例保持绿），「带连接 code 的混合链」才翻到连接类。
 *
 * @param facts - {@link errorFactsOf} 的结果。
 * @returns 是否要「继续等、不判失败」。
 */
function isWaitingTimeout(facts: ErrorFacts): boolean {
  if (intersects(facts.codes, CONNECTION_ERROR_CODES)) return false;
  return intersects(facts.codes, WAITING_TIMEOUT_CODES) || intersects(facts.names, WAITING_TIMEOUT_NAMES);
}

/**
 * 一直等到调用方中止：**不**自己判任何结论。
 *
 * 等待类超时进入这里之后，唯一出口是 `signal` 的 abort；没有 `signal` 时永不落定
 * （等待无上限＝用户还在想，而不是失败）。
 *
 * @param signal - 调用方的中止信号；缺省表示没人能取消，那就一直等。
 * @returns `aborted`（中止时），或一个永不落定的 Promise。
 */
function pendingUntilAborted(signal: AbortSignal | undefined): Promise<NativePickerOutcome> {
  if (signal === undefined) return new Promise<NativePickerOutcome>(() => undefined);
  if (signal.aborted) return Promise.resolve({ kind: 'aborted' });
  return new Promise<NativePickerOutcome>((resolve) => {
    signal.addEventListener('abort', () => resolve({ kind: 'aborted' }), { once: true });
  });
}

/**
 * 回调基址归一：`callbackBase()` 给的是 origin，但历史/手写的值可能是 `…/respond`。
 *
 * @param raw - 原始基址（可为空串）。
 * @returns 干净的 origin；空串表示「还不知道 helper 在哪」。
 */
export function normalizeCallbackBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  return trimmed.endsWith('/respond') ? trimmed.slice(0, -'/respond'.length) : trimmed;
}

/**
 * helper 的应答 → 宿主结局。
 *
 * @param payload - 解析后的 JSON（可能不是对象）。
 * @returns 归一结论；看不懂的形状按 `unsupported`（此时 helper 已经回过话，不能再去弹第二个框）。
 */
function outcomeOf(payload: unknown): NativePickerOutcome {
  if (!payload || typeof payload !== 'object') return { kind: 'unsupported', message: PICK_DIALOG_UNSUPPORTED_MESSAGE };
  const entry = payload as Record<string, unknown>;
  if (entry.ok === true) {
    if (entry.kind === 'cancelled') return { kind: 'cancelled' };
    if (entry.kind === 'picked' && typeof entry.path === 'string' && entry.path !== '') {
      return { kind: 'picked', path: entry.path };
    }
    return { kind: 'unsupported', message: PICK_DIALOG_UNSUPPORTED_MESSAGE };
  }
  // `timeout` 只可能来自**老 helper**（新宿主不再传 timeoutMs，新 helper 也没有超时了）：不回落，给可操作提示。
  if (entry.reason === 'timeout') return { kind: 'unsupported', message: PICK_DIALOG_STALE_HELPER_MESSAGE };
  if (entry.reason === 'busy') return { kind: 'unsupported', message: PICK_DIALOG_BUSY_MESSAGE };
  const message =
    typeof entry.message === 'string' && entry.message !== '' ? entry.message : PICK_DIALOG_UNSUPPORTED_MESSAGE;
  return { kind: 'unsupported', message };
}

/** 一次 `/pick` 请求的输入：头已定、body 已序列化，只等传输层发出去。 */
export interface HelperRequestInit {
  /** `/pick` 只有这一个方法。 */
  readonly method: 'POST';
  /** 请求头（至少含 `content-type`）；`content-length` 由实现补。 */
  readonly headers: Readonly<Record<string, string>>;
  /** 已序列化的 JSON 请求体（不含 `signal`）。 */
  readonly body: string;
  /** 调用方中止；实现只把它挂到请求上，不自己造计时器。 */
  readonly signal?: AbortSignal;
}

/**
 * 一次 `/pick` 的传输实现：把 `(url, init)` 变成同形 `Response`。
 *
 * 为什么返回 `Response`：协议映射（`!response.ok` → `unavailable`、`response.json()` → 三态）
 * 与传输层解耦——测试只替换「对端是谁」，映射逻辑一行不用改。
 */
export type HelperRequestImpl = (url: string, init: HelperRequestInit) => Promise<Response>;

/** `Response` 允许「空 body」的状态：对它们传 body 会抛。 */
const NULL_BODY_STATUS = new Set([204, 205, 304]);

/**
 * 把 `(status, 文本)` 包成同形 `Response`。
 *
 * `Response` 只接受 200..599：helper 协议里出现不了的状态统一按 500 归入「这回用不了」，
 * 而不是让构造异常冒出去被当成连接类错误去问 `isPeerAlive`。
 */
function responseOf(status: number, text: string): Response {
  const safe = status >= 200 && status <= 599 ? status : 500;
  return NULL_BODY_STATUS.has(safe) ? new Response(null, { status: safe }) : new Response(text, { status: safe });
}

/**
 * 生产用的传输实现：`node:http`，每请求一条新连接，不设任何超时。
 *
 * `agent: false` 让每次请求各用一个默认 `Agent`：默认 `keepAlive` 为 false，请求头因此带
 * `connection: close`。helper 每次启动端口都变，复用连接只会换来 stale socket 类伪故障。
 */
const defaultHelperRequest: HelperRequestImpl = (url, init) =>
  new Promise<Response>((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }
    if (target.protocol !== 'http:') {
      // 回调基址是本机明文 http；别的协议属未知情况，交给调用处的 `unavailable` 兜底。
      reject(new Error(`unsupported helper callback protocol: ${target.protocol}`));
      return;
    }
    const body = Buffer.from(init.body, 'utf8');
    const req = httpRequest(
      target,
      {
        method: init.method,
        headers: { ...init.headers, 'content-length': String(body.byteLength) },
        agent: false,
        ...(init.signal === undefined ? {} : { signal: init.signal }),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => resolve(responseOf(res.statusCode ?? 0, Buffer.concat(chunks).toString('utf8'))));
      },
    );
    // 单一 reject 出口：连接中断（ECONNRESET / EPIPE…）与 abort 都从 req 的 error 事件出来。
    req.on('error', reject);
    try {
      req.end(body);
    } catch (error) {
      reject(error);
    }
  });

/** `createHelperDialog` 的输入。 */
export interface HelperDialogOptions {
  /** helper 本地回调基址（origin，不带 `/pick`）；空串表示还不知道，直接 `unavailable`。 */
  readonly endpoint: () => string;
  /**
   * helper 进程当前是否还活着（由 `spawn.ts` 注入 `helper.isAlive()`）。
   *
   * 用来把「连接类失败」分成两种：helper 死了 → 框随进程消失，回落 B 安全；helper 活着 →
   * 框可能还在屏幕上，回落会叠框，只能给提示。
   *
   * 不注入 = 一律按「已经死了」处理（回落 B，功能不丢）。
   */
  readonly isPeerAlive?: () => boolean;
  /**
   * 注入的传输实现（测试用）；缺省 = 生产用的 `node:http` 实现。
   *
   * 换它等于换「对端是谁」，协议映射不跟着变。
   */
  readonly requestImpl?: HelperRequestImpl;
}

/**
 * 造一个「经 helper 弹系统选择框」的客户端。
 *
 * @param options - 基址来源、对端存活探测与可注入的传输实现。
 * @returns `NativePicker`：永不抛错（失败都映射成结局之一），调用方可以放心 await。
 */
export function createHelperDialog(options: HelperDialogOptions): NativePicker {
  const post = options.requestImpl ?? defaultHelperRequest;

  return async function pick(req: NativePickerRequest): Promise<NativePickerOutcome> {
    const base = normalizeCallbackBase(options.endpoint());
    // 还没收到过 helper 的任何协议行 → 不知道端口，别浪费一次必然失败的往返。
    if (base === '') return { kind: 'unavailable' };

    // 请求体**不含** signal（不可序列化）也不含 timeoutMs（helper 侧已无超时）。
    const body = JSON.stringify({
      kind: req.kind,
      title: req.title,
      ...(req.start === undefined ? {} : { start: req.start }),
      ...(req.extensions === undefined ? {} : { extensions: req.extensions }),
    });

    try {
      const response = await post(base + '/pick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        ...(req.signal === undefined ? {} : { signal: req.signal }),
      });
      // 404（老 helper）/ 501（没注入 dialog）/ 5xx：这条通道这次用不了，回落 B。
      if (!response.ok) return { kind: 'unavailable' };
      const payload = (await response.json().catch(() => null)) as unknown;
      return outcomeOf(payload);
    } catch (error) {
      // 三族判定共用一次遍历的结果。判序**一字不动**：abort → waiting → connection → unavailable。
      // 为什么等待类仍在连接类之前：这类错误常常同时是 `TypeError`（`TypeError('fetch failed')`
      // 包着 `HeadersTimeoutError`），顺序一换就会被当成连接中断去问 `isPeerAlive`。
      const facts = errorFactsOf(error);
      // 调用方断开（页面关掉 / 请求断开）：不写响应、不回落，交给路由回 `{kind:'none'}`。
      // 只认真正的 abort（`AbortError` / `ABORT_ERR`）；`TimeoutError` 不在这里，落到下一支继续等。
      if (isAbortError(facts)) return { kind: 'aborted' };
      // 等待类超时不是关于 helper 的事实（只是「客户端自己等累了」）：不判失败、不回落——回落会叠第二个框。
      // 混合链（同时带连接类 code）已在 `isWaitingTimeout` 里被反条件挡掉，走下一支。
      if (isWaitingTimeout(facts)) return pendingUntilAborted(req.signal);
      if (isConnectionError(facts)) {
        // 连接中途断了，但要先问一句「helper 还活着吗」：活着说明框可能还在屏幕上，回落就是叠框。
        if (options.isPeerAlive?.() === true) return { kind: 'unsupported', message: PICK_DIALOG_CHANNEL_LOST_MESSAGE };
        return { kind: 'unavailable' };
      }
      return { kind: 'unavailable' };
    }
  };
}
