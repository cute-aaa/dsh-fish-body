/**
 * 语音服务：校验输入、串行排队、查缓存、沿回退链合成，把结果收敛成「缓存文件 + 格式或失败原因」。
 *
 * 队列放在这里而不是路由里：并发上限是资源约束，与 HTTP 无关。串行保证同一时刻只有
 * 一条上游连接，也保证先点先响——并发合成会让顺序不可预测。
 * 合成顺序由 voice/chain.ts 决定：可用的**免费**第三方在前、内置 edge 收尾，前一环失败自动落到下一环；
 * 按量计费的实现只有被显式开启时才排到链首，失败仍旧回落免费链。
 * 落盘也在这里：合成实现只回 `{ data, mime }`（见 voice/audio.ts），扩展名与
 * `/voice/speak` 的 Content-Type 都由这一份 mime 推出来。
 * @module dsh-fish-body/src/host/voice/speak
 */
import { rename, rm, writeFile } from 'node:fs/promises';
import { audioExtOf, normalizeAudioMime } from './audio.ts';
import { cacheKey, cachePath, ensureCacheDir, findCachedClip, pruneCache } from './cache.ts';
import { voiceChainWithPreferred, type VoiceChainInput, type VoiceChainLink } from './chain.ts';
import { stripEmoji } from './emoji.ts';
import { BUILTIN_VOICE_ID, voiceProviderEntries, type VoiceProvider } from './registry.ts';
import { VoiceSynthError, synthesize, type SynthInput } from './edge.ts';
import { DEFAULT_VOICE, VOICES, isKnownVoice, type VoiceInfo } from './voices.ts';
import type { AudioClip } from './audio.ts';

/** 单次请求允许的最大文本长度（字符，按 UTF-16 计）。 */
export const MAX_TEXT_CHARS = 500;
/** 同时排队的合成上限（含正在跑的那个）；超出直接拒绝，不无限堆积。 */
export const MAX_QUEUE = 3;

/** 语速表达式：`+N%` 或 `-N%`。 */
const RATE_PATTERN = /^[+-]\d{1,3}%$/;
/** 语速下界（百分比）。 */
const RATE_MIN_PERCENT = -50;
/** 语速上界（百分比）。 */
const RATE_MAX_PERCENT = 100;
/** 内置 edge 合成的总时限（ms）：依赖自带的 15s 只是「静默」超时，每来一帧就重置，不能当总时限用。 */
const BUILTIN_TIMEOUT_MS = 28_000;
/** 排队超过这么久还没轮到就丢弃（ms）：等得比一次合成还久，客户端早已放弃，再合成只是白烧上游。 */
const STALE_WAIT_MS = BUILTIN_TIMEOUT_MS;

/** 一次合成的输入（已校验）。 */
interface SpeakInput {
  readonly text: string;
  readonly voice: string;
  readonly rate: string;
}

/** 失败原因；路由层原样映射成 `result.ts` 的 reason。 */
export type SpeakFailure = 'bad-request' | 'voice-busy' | 'generate-error';

/** 合成结果：成功时给出缓存文件绝对路径与它的 MIME（路由据此回 Content-Type）。 */
export type SpeakResult =
  { ok: true; file: string; mime: string } | { ok: false; reason: SpeakFailure; message: string };

/** 语音服务：路由层只依赖这两个方法。 */
export interface VoiceService {
  /** 合成一段文本；同一输入命中缓存时不再联网。 */
  speak(raw: unknown): Promise<SpeakResult>;
  /** 可选音色列表（与白名单同源）。 */
  listVoices(): readonly VoiceInfo[];
}

/** 解析结论：成功给已校验输入，失败给一句可直接回给调用方的说明。 */
type ParseResult = { ok: true; value: SpeakInput } | { ok: false; message: string };

/** 校验请求体；只认 `text` / `voice` / `rate` 三个字段，其余忽略。 */
function parseSpeakInput(raw: unknown): ParseResult {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return { ok: false, message: 'text is required' };
  if (text.length > MAX_TEXT_CHARS) return { ok: false, message: `text too long (max ${MAX_TEXT_CHARS} chars)` };
  const voice = body.voice === undefined ? DEFAULT_VOICE : body.voice;
  if (typeof voice !== 'string' || !isKnownVoice(voice)) {
    return { ok: false, message: `unknown voice; allowed: ${VOICES.map((item) => item.id).join(', ')}` };
  }
  const rate = body.rate === undefined ? '+0%' : body.rate;
  if (typeof rate !== 'string' || !RATE_PATTERN.test(rate)) {
    return { ok: false, message: 'rate must look like +0% or -10%' };
  }
  const percent = Number(rate.slice(1, -1));
  if (!Number.isFinite(percent) || percent < RATE_MIN_PERCENT || percent > RATE_MAX_PERCENT) {
    return { ok: false, message: `rate out of range (${RATE_MIN_PERCENT}%..+${RATE_MAX_PERCENT}%)` };
  }
  return { ok: true, value: { text, voice, rate } };
}

/** 断言用：`SpeakResult` 的构造点都经过这里，避免各处手写同一句文案。 */
function dropped(): SpeakResult {
  return { ok: false, reason: 'voice-busy', message: 'queued too long, dropped' };
}

/**
 * 这一条排队等得太久了吗。
 *
 * 等得比一次合成允许的时长还久，客户端那边早已超时放弃：再合成只是白烧上游，
 * 而且声音出来时说的已经是上一件事。
 *
 * @param queuedMs - 入队时刻。
 * @param nowMs - 轮到自己时的时刻。
 * @param waitMs - 容许的最长排队时间；缺省用 {@link STALE_WAIT_MS}，测试注入更短的值。
 * @returns 应该丢弃时为 true。
 * @internal
 */
export function isQueueStale(queuedMs: number, nowMs: number, waitMs: number = STALE_WAIT_MS): boolean {
  return nowMs - queuedMs > waitMs;
}

/** 造语音服务。 */
export function createVoiceService(options: {
  /** 用户数据根；缓存落在 `<数据根>/cache/voice/`。 */
  userRoot: string;
  /** 留痕用；不传则静默。只记字数与结果，不记正文（用户内容不进日志）。 */
  log?: { info?(message: string): void; warn?(message: string): void };
  /** 合成实现；测试注入替身，缺省走 edge 的真实实现。 */
  synthesize?: (input: SynthInput) => Promise<AudioClip>;
  /** 容许的最长排队时间（ms）；缺省 {@link STALE_WAIT_MS}，测试用它把丢弃分支逼出来。 */
  staleWaitMs?: number;
  /** 念之前要不要摘掉文本里的表情（设置页开关，默认摘）；每次合成现读。 */
  stripEmoji?: () => boolean;
  /** 用户显式开启的付费实现 id（`voice-providers.json` 里的付费开关）；每次合成现读。 */
  preferredProvider?: () => string | undefined;
}): VoiceService {
  const { userRoot, log } = options;
  const synthesizeImpl = options.synthesize ?? synthesize;
  const staleWaitMs = options.staleWaitMs ?? STALE_WAIT_MS;
  const shouldStrip = options.stripEmoji ?? ((): boolean => true);
  /** 首选来源：读配置可能抛（文件被写坏），抛了就当没开——不能让一个开关把整句话打断。 */
  const preferredId = (): string | undefined => {
    try {
      const id = options.preferredProvider?.();
      return typeof id === 'string' && id.trim() !== '' ? id.trim() : undefined;
    } catch {
      return undefined;
    }
  };
  /** 已占用的队列名额（含正在跑的那个）。 */
  let queueUsed = 0;
  /** 串行链：上一件事收尾（成功或失败）后才轮到下一件。 */
  let chain: Promise<void> = Promise.resolve();

  /** 把一次合成排进串行链；无论成败都释放名额。 */
  function enqueue(task: () => Promise<void>): Promise<void> {
    queueUsed += 1;
    const run = chain.then(task, task);
    // 链本身不能带拒绝，否则后续任务会继承同一个失败；拒绝只交给本次的调用方
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => {
      queueUsed -= 1;
    });
  }

  async function speak(raw: unknown): Promise<SpeakResult> {
    const parsed = parseSpeakInput(raw);
    if (!parsed.ok) return { ok: false, reason: 'bad-request', message: parsed.message };
    // 播报去表情：合成器读不出表情，只会念成「表情符号」或卡一下，所以念之前先摘掉。
    // 纯表情没有可念的内容：明确回 bad-request，而不是合成一段空音频。
    const text = shouldStrip() ? stripEmoji(parsed.value.text) : parsed.value.text;
    if (text === '') return { ok: false, reason: 'bad-request', message: 'text is only emoji' };
    const { voice, rate } = parsed.value;
    // 每次请求现查一次：第三方可能运行中才注册、也可能被卸载，启动快照会漏掉这两种；
    // 付费开关同理——用户随时会关掉，缓存的是配置读出来的值，不是链本身。
    const wanted = preferredId();
    const links = voiceChainWithPreferred(wanted, synthesizeImpl);
    const source = links[0]?.id ?? 'edge';
    // 开了付费实现却没排上（没配 key / 探活失败）：用户会以为在用云端，必须留痕
    if (wanted !== undefined && source !== wanted) {
      log?.warn?.(`[fish-body] voice speak: preferred ${wanted} unavailable, using free chain`);
    }
    const startedMs = Date.now();
    // 缓存按「来源 + 当前的嗓子」分开存：链里的实现与免费实现（含此刻不可用的）都探一遍——
    // 第三方临时挂掉时用同一嗓子的旧音频顶上，比换成 edge 的另一个声音更自然。
    for (const origin of cacheOrigins(links)) {
      const cached = await findCachedClip(userRoot, cacheKeyOf(origin.id, origin.timbre, text, voice, rate));
      if (cached) {
        log?.info?.(`[fish-body] voice speak: cache=hit chars=${text.length} voice=${origin.id} mime=${cached.mime}`);
        return { ok: true, file: cached.file, mime: cached.mime };
      }
    }
    if (queueUsed >= MAX_QUEUE) {
      log?.warn?.(`[fish-body] voice speak: queue full (max ${MAX_QUEUE}) chars=${text.length} voice=${source}`);
      return { ok: false, reason: 'voice-busy', message: 'voice queue is full, retry later' };
    }
    const queue: { dropped: boolean; clip: AudioClip | null; file: string; used: string } = {
      dropped: false,
      clip: null,
      file: '',
      used: source,
    };
    const queuedMs = Date.now();
    try {
      await enqueue(async () => {
        if (isQueueStale(queuedMs, Date.now(), staleWaitMs)) {
          queue.dropped = true;
          return;
        }
        const dir = await ensureCacheDir(userRoot);
        const { clip, link } = await synthesizeAlongChain(links, { text, rate, voice }, log);
        queue.clip = clip;
        queue.used = link.id;
        queue.file = await writeClip(userRoot, keyOf(link, text, voice, rate), clip);
        // 淘汰放在成功之后：失败时不该为腾地方而删掉还能用的缓存
        await pruneCache(dir);
      });
    } catch (error) {
      // 上游细节（含 URL、状态码）不外泄，只留在日志里
      log?.warn?.(
        `[fish-body] voice speak: failed chars=${text.length} voice=${source} ` +
          `ms=${Date.now() - startedMs} reason=${error instanceof VoiceSynthError ? error.message : String(error)}`,
      );
      return { ok: false, reason: 'generate-error', message: 'voice synthesis failed' };
    }
    if (queue.dropped) {
      log?.warn?.(
        `[fish-body] voice speak: dropped chars=${text.length} voice=${source} queued=${Date.now() - queuedMs}ms`,
      );
      return dropped();
    }
    // 合成成功却没拿到片段：说明实现自己吞了错误，按失败报，别回一个空文件路径
    if (queue.clip === null) {
      log?.warn?.(`[fish-body] voice speak: empty clip chars=${text.length} voice=${source}`);
      return { ok: false, reason: 'generate-error', message: 'voice synthesis failed' };
    }
    log?.info?.(
      `[fish-body] voice speak: cache=miss chars=${text.length} voice=${queue.used} ` +
        `mime=${queue.clip.mime} ms=${Date.now() - startedMs}`,
    );
    return { ok: true, file: queue.file, mime: normalizeAudioMime(queue.clip.mime) };
  }

  return { listVoices: () => VOICES, speak };
}

/** 一环的缓存键：来源 + 那一环当下的嗓子；换实现或换音色都不会命中旧音频。 */
function keyOf(link: VoiceChainLink, text: string, voice: string, rate: string): string {
  return cacheKeyOf(link.id, link.timbre, text, voice, rate);
}

/** 按「来源 + 嗓子」算缓存键：只有内置实现吃请求里的音色，第三方用自己报的指纹。 */
function cacheKeyOf(source: string, timbre: string, text: string, voice: string, rate: string): string {
  return cacheKey(source, source === BUILTIN_VOICE_ID ? voice : timbre, rate, text);
}

/**
 * 缓存要探的来源：链里的实现 + 全部免费实现（含此刻不可用的）在前，内置收尾；每条带当下嗓子指纹。
 *
 * 付费实现只在它确实排进了链时才参与：用户关掉云端之后，不该再播到它以前合成的旧音频
 * （那会让「关掉了」看起来没生效），而免费实现临时挂掉时用旧音频顶上是有价值的。
 *
 * @param links - 本次合成要用的链。
 * @returns 按「来源 + 嗓子」查缓存的顺序表。
 */
function cacheOrigins(links: readonly VoiceChainLink[]): { id: string; timbre: string }[] {
  const inChain = new Set(links.map((link) => link.id));
  const external = voiceProviderEntries()
    .filter((entry) => entry.provider.billable !== true || inChain.has(entry.provider.id))
    .map((entry) => ({ id: entry.provider.id, timbre: timbreOf(entry.provider) }));
  return [...external, { id: BUILTIN_VOICE_ID, timbre: '' }];
}

/** 取一个实现的嗓子指纹；它自己抛错只当没指纹（缓存键算不出来会让每次请求都重新合成）。 */
function timbreOf(provider: VoiceProvider): string {
  try {
    return provider.cacheTag?.() ?? '';
  } catch {
    return '';
  }
}

/**
 * 沿回退链合成：前一环失败就落到下一环，全部失败才抛。
 *
 * 失败要留痕：第三方挂掉时用户听到的是 edge 的声音，日志里必须能看出「本该是谁念的」。
 *
 * @param links - {@link voiceChain} 的结果（至少一环）。
 * @param input - 文本与语速。
 * @param log - 留痕；不传则静默。
 * @returns 成功的片段与产生的环。
 * @throws {VoiceSynthError} 链上每一环都失败时，抛最后一环的错误。
 */
async function synthesizeAlongChain(
  links: readonly VoiceChainLink[],
  input: VoiceChainInput,
  log?: { info?(message: string): void; warn?(message: string): void },
): Promise<{ clip: AudioClip; link: VoiceChainLink }> {
  let last: VoiceSynthError | null = null;
  for (const [index, link] of links.entries()) {
    try {
      const clip = await link.synthesize(input);
      if (index > 0) log?.warn?.(`[fish-body] voice speak: fell back to ${link.id} (previous link failed)`);
      return { clip, link };
    } catch (error) {
      last = error instanceof VoiceSynthError ? error : new VoiceSynthError(String(error));
      log?.warn?.(`[fish-body] voice speak: link ${link.id} failed: ${last.message}`);
    }
  }
  throw last ?? new VoiceSynthError('voice chain is empty');
}

/**
 * 把一次合成的产出落进缓存：先写 `<target>.part` 再改名。
 *
 * `target` 一旦出现就是完整文件，中途失败不会留下半截音频被缓存命中逻辑当成有效文件。
 *
 * @param userRoot - 用户数据根。
 * @param key - 缓存键。
 * @param clip - 音频字节与 MIME。
 * @returns 最终文件路径。
 * @throws {VoiceSynthError} MIME 不受支持、字节为空或写盘失败时。
 */
async function writeClip(userRoot: string, key: string, clip: AudioClip): Promise<string> {
  const ext = audioExtOf(clip.mime);
  if (ext === undefined) throw new VoiceSynthError('unsupported audio mime: ' + clip.mime);
  if (clip.data.length === 0) throw new VoiceSynthError('empty audio returned');
  const target = cachePath(userRoot, key, ext);
  const staging = `${target}.part`;
  try {
    await writeFile(staging, clip.data);
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { force: true }).catch(() => undefined);
    throw new VoiceSynthError(error instanceof Error ? error.message : String(error));
  }
  return target;
}
