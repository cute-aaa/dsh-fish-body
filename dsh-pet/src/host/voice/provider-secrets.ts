/**
 * 第三方语音实现的**密钥字段**：值走 DSH 凭据库（`ctx.credentials`），不进 `voice-providers.json`。
 *
 * 为什么必须分开：配置文件会被备份、会被贴进 issue、会被 `desktop.ini` 旁边的目录树展示；
 * 一个云端语音的 API Key 写在那里，等于把账单交给读日志的人。而 DSH 的凭据库正是为这件事存在的
 * （`credentials set` 可写、`resolve` 按次读、`describe` 只回「配没配」）。
 *
 * 为什么是「结构化探测」而不是直接 `ctx.credentials.set`：独立模式（`lib/standalone.js`）只提供
 * `resolve` 的替身，没有写入能力。三个方法不全时返回 `null`，路由据此让密钥字段报 `unsupported`，
 * 而不是抛一个用户看不懂的 `TypeError`。
 * @module dsh-fish-body/src/host/voice/provider-secrets
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import type { VoiceField } from './registry.ts';

/** 凭据库里的一项「配没配」（`describe` 的结论，绝不含值）。 */
export interface SecretPresence {
  readonly configured: boolean;
}

/**
 * 宿主凭据服务的**最小可用面**。
 *
 * 只包这三个方法：`resolve` 是合成时读值用的，但密钥由实现自己按次读（`cacheTag` 之外不该缓存），
 * 设置页这条路径只需要「配没配 / 写 / 删」。
 */
export interface ProviderSecretSeam {
  /** 这一项配了吗（只回存在性）。 */
  configured(ref: string): Promise<boolean>;
  /** 写入非空值（覆盖旧值）。 */
  save(ref: string, value: string): Promise<void>;
  /** 删除（不存在算成功）。 */
  remove(ref: string): Promise<void>;
}

/**
 * 从宿主服务里取出可用的凭据面。
 *
 * @param raw - `optionalService('credentials')` 的结果（独立模式是个只有 `resolve` 的替身）。
 * @returns 三个方法齐全时的适配器；否则 `null`（调用方据此报 `unsupported`）。
 */
export function providerSecretSeamOf(raw: unknown): ProviderSecretSeam | null {
  if (raw === null || typeof raw !== 'object') return null;
  const service = raw as {
    describe?: unknown;
    set?: unknown;
    unset?: unknown;
  };
  if (
    typeof service.describe !== 'function' ||
    typeof service.set !== 'function' ||
    typeof service.unset !== 'function'
  ) {
    return null;
  }
  const seam = service as {
    describe(ref: ReturnType<typeof credentialRef>): Promise<{ configured?: boolean } | undefined>;
    set(ref: ReturnType<typeof credentialRef>, value: string): Promise<void>;
    unset(ref: ReturnType<typeof credentialRef>): Promise<void>;
  };
  return {
    configured: async (ref) => {
      const info = await seam.describe(credentialRef(ref));
      return info?.configured === true;
    },
    save: async (ref, value) => {
      await seam.set(credentialRef(ref), value);
    },
    remove: async (ref) => {
      await seam.unset(credentialRef(ref));
    },
  };
}

/**
 * 一个实现里哪些字段是密钥。
 *
 * @param fields - 该实现声明的配置项。
 * @returns `kind === 'password'` 且声明了 `credentialRef` 的字段。
 */
export function secretFieldsOf(fields: readonly VoiceField[]): VoiceField[] {
  return fields.filter((field) => field.kind === 'password' && (field.credentialRef ?? '') !== '');
}

/**
 * 读每一项密钥的在场情况。
 *
 * @param seam - 凭据面。
 * @param fields - 该实现的配置项声明。
 * @returns `{ apiKey: true }` 这样的表；没有密钥字段或都读不出来时是空对象（单项失败只当「未配」）。
 */
export async function readSecretPresence(
  seam: ProviderSecretSeam,
  fields: readonly VoiceField[],
): Promise<Record<string, boolean>> {
  const state: Record<string, boolean> = {};
  for (const field of secretFieldsOf(fields)) {
    const ref = field.credentialRef ?? '';
    try {
      state[field.key] = await seam.configured(ref);
    } catch {
      // 凭据库偶发读失败不该让整张表单打不开：显示「未配」，用户重填一次即可
      state[field.key] = false;
    }
  }
  return state;
}

/** 写密钥的结论：真写了几项、删了几项（路由回给设置页做提示）。 */
export interface SecretWriteResult {
  readonly saved: string[];
  readonly cleared: string[];
}

/**
 * 写入 / 清除密钥字段。
 *
 * 语义分成两条路，避免「留空」被误解：`patch` 里非空的密钥值才写；要删必须显式放进 `clear`。
 * 这样设置页把已配的密钥显示成空框（值从不回传）时，用户点保存不会被顺手清掉。
 *
 * @param seam - 凭据面。
 * @param fields - 该实现的配置项声明（`clear` 里的键必须是其中之一）。
 * @param patch - 本次提交的键值（只取密钥字段，其余键由调用方处理）。
 * @param clear - 要清除的键（可以缺省）。
 * @returns 实际写入与清除的字段键。
 * @throws 凭据库写入失败时（由路由转成 `generate-error`）。
 */
export async function writeSecretFields(
  seam: ProviderSecretSeam,
  fields: readonly VoiceField[],
  patch: Readonly<Record<string, string>>,
  clear: readonly string[] = [],
): Promise<SecretWriteResult> {
  const secrets = new Map(secretFieldsOf(fields).map((field) => [field.key, field.credentialRef ?? '']));
  const saved: string[] = [];
  const cleared: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const ref = secrets.get(key);
    // 空串 = 「没改」而不是「删掉」：值不回传，设置页本来就只能给空框
    if (ref === undefined || value === '') continue;
    await seam.save(ref, value);
    saved.push(key);
  }
  for (const key of clear) {
    const ref = secrets.get(key);
    if (ref === undefined) continue;
    await seam.remove(ref);
    cleared.push(key);
  }
  return { saved, cleared };
}
