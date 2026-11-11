/**
 * 第三方语音实现的配置落盘：`<userRoot>/voice-providers.json`。
 *
 * 为什么不写进 `main-config.jsonc`：那一份是带大量注释的 JSONC，整份重写会把用户手写的注释与
 * 排版全丢掉；而这里存的是「本机服务地址 + 当前音色 + 素材目录」这类机器级设置，
 * 独立成一份普通 JSON 既能原子改写，换台机器时也只丢这一份。
 * 只做读写，不校验字段——解析在 ./settings.ts，取值合法性在路由里按扫描结果判。
 * @module dsh-pet/src/host/voice/gsv/store
 */
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** 配置文件名（放在插件数据根下，与 logs.txt / voice-cache 同级）。 */
export const PROVIDER_CONFIG_FILE = 'voice-providers.json';

/** 取对象；非对象当空对象。 */
function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * 配置文件路径。
 * @param userRoot - 插件数据根（`createHostSetup().userRoot`）。
 * @returns `<userRoot>/voice-providers.json`。
 */
export function providerConfigPath(userRoot: string): string {
  return join(userRoot, PROVIDER_CONFIG_FILE);
}

/**
 * 读整份 provider 配置；文件不存在或写坏都返回空对象（provider 据此报「未配置」）。
 * @param file - {@link providerConfigPath} 的结果。
 * @returns 解析后的对象（可能是 `{}`）。
 */
export function readProviderConfig(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return recordOf(parsed);
  } catch {
    return {};
  }
}

/**
 * 读一个实现的配置值（只取调用方点名的键，缺的给空串）。
 *
 * 为什么要键白名单：设置页只渲染该实现 `fields` 声明的那几项，别的键（比如以后加的）不该
 * 顺着网络回传给浏览器；这也让「未知键」在写路径上直接被拒。
 *
 * @param file - 配置文件路径。
 * @param providerId - 实现 id（`gsv`）。
 * @param keys - 要读的键（= 该实现的 `fields[].key`）。
 * @returns 键值表；缺项为空串。
 */
export function readProviderValues(file: string, providerId: string, keys: readonly string[]): Record<string, string> {
  const conf = recordOf(readProviderConfig(file)[providerId]);
  const values: Record<string, string> = {};
  for (const key of keys) {
    const value = conf[key];
    values[key] = typeof value === 'string' ? value : '';
  }
  return values;
}

/**
 * 写一个实现的多项配置（设置页「本地语音接入」表单）：空串 = 删掉该键（回落代码默认值）。
 * @param file - 配置文件路径。
 * @param providerId - 实现 id。
 * @param patch - 已校验过的键值（键必须是该实现 `fields` 里的 key）。
 */
export async function writeProviderFields(
  file: string,
  providerId: string,
  patch: Record<string, string>,
): Promise<void> {
  // 空串 = 删掉该键：设置页把「音色目录」清空，语义就是回到代码默认（而不是存一个空目录）。
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(patch)) normalized[key] = value === '' ? undefined : value;
  await writeProviderConfig(file, providerId, normalized);
}

/**
 * 只改一个实现的一项（目前只有 `voice`），其余键原样保留。
 *
 * 用「读-改-整份写」而不是追加：文件很小，且 JSON 没有原地改一行的语法；
 * 先写临时文件再改名在 Windows 上会和杀软抢锁，这里直接整份覆盖（半个文件不可用的窗口极小）。
 *
 * @param file - 配置文件路径。
 * @param providerId - 实现 id（`gsv`）。
 * @param voice - 新音色 id（已由调用方按扫描结果校验）。
 * @throws 目录建不出来或写盘失败时（由路由转成 `generate-error`）。
 */
export async function writeProviderVoice(file: string, providerId: string, voice: string): Promise<void> {
  const current = readProviderConfig(file);
  const next = { ...current, [providerId]: { ...recordOf(current[providerId]), voice } };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

/**
 * 整段写一个实现的配置（设置页保存服务地址/目录时用；路由暂只用到 {@link writeProviderVoice}）。
 * @param file - 配置文件路径。
 * @param providerId - 实现 id。
 * @param patch - 要并入的键值（`undefined` 的键会被丢弃，等于「删掉这一项」）。
 */
export async function writeProviderConfig(
  file: string,
  providerId: string,
  patch: Record<string, string | undefined>,
): Promise<void> {
  const current = readProviderConfig(file);
  const merged: Record<string, unknown> = { ...recordOf(current[providerId]) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ ...current, [providerId]: merged }, null, 2) + '\n', 'utf8');
}
