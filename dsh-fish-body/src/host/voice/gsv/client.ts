/**
 * GSV 的 HTTP 客户端：探活、切权重、`/tts` 合成三件事，错误一律收敛成一句话。
 *
 * 单独一层是为了让 provider 的时序逻辑（探测缓存、权重切换缓存）能脱离网络被测试：
 * 测试注入本文件的替身即可，provider 不需要知道 fetch 的存在。
 * 不做缓存、不排队——那是 provider 与 speak 的事。
 * @module dsh-fish-body/src/host/voice/gsv/client
 */
import type { AudioClip } from '../audio.ts';
import { VoiceSynthError } from '../edge.ts';
import { toPosixPath } from './settings.ts';

/** 一次 `/tts` 的请求体（字段名照抄 api_v2，换算在 provider 里做）。 */
export interface GsvTtsRequest {
  readonly text: string;
  readonly textLang: string;
  readonly refAudioPath: string;
  readonly promptText: string;
  readonly promptLang: string;
  readonly textSplitMethod: string;
  readonly speedFactor: number;
  readonly temperature?: number;
  readonly topK?: number;
  readonly topP?: number;
  readonly seed?: number;
}

/** 三件事的接口；测试用它换成桩。 */
export interface GsvHttp {
  /** 服务在不在（api_v2 自带 `/docs`，比打一次 `/tts` 便宜得多）。 */
  probe(baseURL: string, timeoutMs: number): Promise<boolean>;
  /** 切换全局权重：`kind=gpt` 走 `/set_gpt_weights`，`sovits` 走 `/set_sovits_weights`。 */
  setWeights(baseURL: string, kind: 'gpt' | 'sovits', weightsPath: string, timeoutMs: number): Promise<void>;
  /** 合成一段 wav。 */
  tts(baseURL: string, request: GsvTtsRequest, timeoutMs: number): Promise<AudioClip>;
}

/** 错误体里能带出的最大字符数：只留够定位的那一句，别把整段栈写进日志。 */
const ERROR_PREVIEW = 160;

/** 去掉尾斜杠，避免拼出 `//tts`。 */
function trimBase(baseURL: string): string {
  return baseURL.replace(/\/+$/, '');
}

/** 从响应体里取一句错误说明（api_v2 的失败体是 `{ message }`）；取不到返回空串。 */
async function errorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    const parsed = JSON.parse(text) as { message?: unknown };
    const message = typeof parsed.message === 'string' ? parsed.message : text;
    return message.slice(0, ERROR_PREVIEW);
  } catch {
    return '';
  }
}

/**
 * 发一个 GET 并断言 2xx。
 *
 * @param url - 完整地址。
 * @param timeoutMs - 总时限。
 * @param what - 日志/异常里的动作名（`探活` / `set_gpt_weights`）。
 * @throws {VoiceSynthError} 连不上、超时或非 2xx 时。
 */
async function getOk(url: string, timeoutMs: number, what: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new VoiceSynthError(`${what} 失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.ok) return;
  const detail = await errorDetail(response);
  throw new VoiceSynthError(`${what} 返回 ${response.status}${detail ? `：${detail}` : ''}`);
}

/**
 * 让 api_v2 自己退出（`GET /control?command=exit`，服务端收到后 SIGTERM 自杀）。
 *
 * 这是「没配停止脚本」时的标准停法：官方端点、只影响本服务，不用扫端口杀进程。
 * 服务自杀时连接往往直接被重置，取不到响应——那种情况按成功算（它确实在退）。
 *
 * @param baseURL - api_v2 根地址。
 * @param timeoutMs - 等响应的时间；服务先死会更快返回。
 * @throws {VoiceSynthError} 服务明确回了非 2xx 时。
 */
export async function requestExit(baseURL: string, timeoutMs = 5_000): Promise<void> {
  try {
    const response = await fetch(`${trimBase(baseURL)}/control?command=exit`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new VoiceSynthError(`/control 返回 ${response.status}`);
  } catch (error) {
    // 连接被重置 / 提前关闭 = 进程正在退，算成功；超时与其它网络错误也按「已发出」处理，
    // 真实结果由随后的可用性探活决定（调用方会立刻重探一次）。
    if (error instanceof VoiceSynthError) throw error;
  }
}

/** 真实实现：fetch + 超时。 */
export const gsvHttp: GsvHttp = {
  async probe(baseURL, timeoutMs) {
    try {
      const response = await fetch(`${trimBase(baseURL)}/docs`, { signal: AbortSignal.timeout(timeoutMs) });
      // 404 也算「活着」：有的部署关掉了 docs，但服务本身在（探活目的只是区分「没起」与「起了」）
      return response.ok || response.status === 404;
    } catch {
      return false;
    }
  },

  async setWeights(baseURL, kind, weightsPath, timeoutMs) {
    const query = encodeURIComponent(toPosixPath(weightsPath));
    await getOk(`${trimBase(baseURL)}/set_${kind}_weights?weights_path=${query}`, timeoutMs, `set_${kind}_weights`);
  },

  async tts(baseURL, request, timeoutMs) {
    const body = {
      text: request.text,
      text_lang: request.textLang,
      ref_audio_path: request.refAudioPath,
      prompt_text: request.promptText,
      prompt_lang: request.promptLang,
      text_split_method: request.textSplitMethod,
      speed_factor: request.speedFactor,
      media_type: 'wav',
      streaming_mode: false,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.topK === undefined ? {} : { top_k: request.topK }),
      ...(request.topP === undefined ? {} : { top_p: request.topP }),
      ...(request.seed === undefined ? {} : { seed: request.seed }),
    };
    let response: Response;
    try {
      response = await fetch(`${trimBase(baseURL)}/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new VoiceSynthError(`/tts 失败：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      const detail = await errorDetail(response);
      throw new VoiceSynthError(`/tts 返回 ${response.status}${detail ? `：${detail}` : ''}`);
    }
    const data = new Uint8Array(await response.arrayBuffer());
    // 认死 RIFF/WAVE：api_v2 在 media_type=wav 时必回 wav，回别的说明它改名了（比如默认 raw），
    // 直接当成功会让浏览器拿到一段没有文件头的数据，静默不出声。
    const riff = String.fromCharCode(...data.slice(0, 4));
    const wave = String.fromCharCode(...data.slice(8, 12));
    if (riff !== 'RIFF' || wave !== 'WAVE') throw new VoiceSynthError('gsv 返回的不是 wav');
    return { data, mime: 'audio/wav' };
  },
};
