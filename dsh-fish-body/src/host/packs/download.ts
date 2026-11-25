/**
 * 资源包下载：`fetch` 失败时，用系统代理 + curl 兜底。
 *
 * 为什么需要这一层：Node 的 `fetch`（undici）**不读系统代理**，只认 `HTTPS_PROXY` 环境变量。
 * 而 Windows 用户的代理通常只配在「Internet 选项」里（注册表 `ProxyServer`），于是
 * `Invoke-WebRequest` / 浏览器能下、宿主进程的 `fetch` 直接 `UND_ERR_CONNECT_TIMEOUT`——
 * 用户看到的是「点下载没反应」。这是实测到的故障，不是理论风险。
 *
 * 三条边界：
 * 1. **只做兜底**：先试 `fetch`（快、可注入、单测不联网），失败且**确实知道代理**时才用 curl；
 * 2. **代理只从环境或注册表读**，不从清单/URL 里拿——下载地址是第三方可控数据，不该决定走哪条网络；
 * 3. **curl 不存在就当没有兜底**：`spawnSync` 报错一律按失败处理，把原始 fetch 错误一起报出去。
 * @module dsh-fish-body/src/host/packs/download
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

/** 一个 HTTP 代理地址（SOCKS 不支持：curl 的 `-x` 对 socks 需要不同写法，且我们没实测过）。 */
export interface ProxySpec {
  readonly host: string;
  readonly port: number;
}

/** 下载结论。 */
export type ProxyDownloadResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** 运行 curl 的注入点（测试不真的起进程）。 */
export type CurlRunner = (args: readonly string[]) => { readonly status: number | null; readonly stderr: string };

/**
 * 解析 `http://host:port` / `host:port` 形式的代理值。
 *
 * @param raw - 环境变量里的原文。
 * @returns 规范化的代理；认不出或是 socks 时 undefined。
 */
export function parseProxy(raw: string | undefined): ProxySpec | undefined {
  const value = (raw ?? '').trim();
  if (value === '') return undefined;
  // socks 代理 curl 用 `-x socks5://…` 也能走，但 `http(s)_proxy` 里出现 socks 时语义模糊，不猜
  if (/^socks/i.test(value)) return undefined;
  const withoutScheme = value.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const [hostPart, portPart] = withoutScheme.split(':');
  const host = (hostPart ?? '').trim();
  const port = Number((portPart ?? '').trim());
  if (host === '' || !Number.isFinite(port) || port <= 0 || port > 65535) return undefined;
  return { host, port };
}

/** 从环境变量里取代理（大小写两种写法都认，与 curl / npm 的习惯一致）。 */
function proxyFromEnv(env: Record<string, string | undefined>): ProxySpec | undefined {
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
    const parsed = parseProxy(env[key]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

/** 读 Windows「Internet 选项」里的代理（`reg query` 一行，失败就当没有）。 */
function proxyFromRegistry(): ProxySpec | undefined {
  const run = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], {
    encoding: 'utf8',
  });
  if (run.status !== 0 || typeof run.stdout !== 'string') return undefined;
  const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(run.stdout);
  if (!enabled) return undefined;
  const hit = /ProxyServer\s+REG_SZ\s+(\S+)/i.exec(run.stdout);
  // `ProxyServer` 可能是 `host:port` 或 `http=host:port;https=host:port`：只认单一形态，分协议的不猜
  return parseProxy(hit?.[1]);
}

/**
 * 取本机代理。
 *
 * @param options.env - 环境变量表（测试注入）；缺省 `process.env`。
 * @param options.platform - 平台（测试注入）；缺省 `process.platform`。
 * @param options.readRegistry - 注册表读取（测试注入）；缺省读 Windows 注册表。
 * @returns 代理；没有 / 认不出时 undefined。
 */
export function proxyOf(options?: {
  readonly env?: Record<string, string | undefined>;
  readonly platform?: string;
  readonly readRegistry?: () => ProxySpec | undefined;
}): ProxySpec | undefined {
  const env = options?.env ?? process.env;
  const fromEnv = proxyFromEnv(env);
  if (fromEnv !== undefined) return fromEnv;
  const platform = options?.platform ?? process.platform;
  if (platform !== 'win32') return undefined;
  const read = options?.readRegistry ?? proxyFromRegistry;
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** 默认的 curl 执行器。 */
const runCurlDefault: CurlRunner = (args) => {
  const run = spawnSync('curl', [...args], { encoding: 'utf8', windowsHide: true });
  return { status: run.status, stderr: typeof run.stderr === 'string' ? run.stderr : '' };
};

/**
 * 经代理把 URL 下载到文件（curl `-x` + 跟随重定向 + 失败即非零退出）。
 *
 * **判失败用「停滞」而不是「总时长」**：54 MB 的包走代理常要几分钟，卡死总时长会把
 * 「慢但在下载」判成失败（实测：120 秒只下到 39.7/56.9 MB 就被掐掉）。所以用
 * `--speed-time 60 --speed-limit 10240`（60 秒内平均低于 10 KB/s 才算卡住），
 * 另加一个 1 小时的 `--max-time` 只是防永久挂起。
 *
 * @param url - 下载地址。
 * @param dest - 目标文件路径（父目录必须已存在）。
 * @param proxy - 代理。
 * @param options.runCurl - curl 执行器（测试注入）。
 * @returns 结论；失败时 `message` 带 curl 的 stderr 尾部。
 */
export async function downloadViaProxy(
  url: string,
  dest: string,
  proxy: ProxySpec,
  options?: { readonly runCurl?: CurlRunner },
): Promise<ProxyDownloadResult> {
  const runCurl = options?.runCurl ?? runCurlDefault;
  const args = [
    '--silent',
    '--show-error',
    '--location',
    '--fail',
    // 停滞判定（慢不算失败、卡住才算）
    '--speed-time',
    '60',
    '--speed-limit',
    '10240',
    // 兜底上限：防永久挂起（正常包几分钟内就能下完）
    '--max-time',
    '3600',
    '--proxy',
    proxy.host + ':' + String(proxy.port),
    '--output',
    dest,
    url,
  ];
  let result: { readonly status: number | null; readonly stderr: string };
  try {
    result = runCurl(args);
  } catch (error) {
    return { ok: false, message: 'curl 无法执行：' + (error instanceof Error ? error.message : String(error)) };
  }
  if (result.status !== 0) {
    const tail = result.stderr.trim().split('\n').slice(-2).join(' ');
    return { ok: false, message: 'curl 退出码 ' + String(result.status) + (tail === '' ? '' : '：' + tail) };
  }
  // curl 退出 0 但文件不存在 / 为空：一样算失败（--fail 只管 HTTP 状态，不管落盘）
  if (!existsSync(dest) || statSync(dest).size === 0) {
    return { ok: false, message: 'curl 报告成功但文件为空' };
  }
  return { ok: true };
}
