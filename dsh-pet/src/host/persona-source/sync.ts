/**
 * 人设同步器：把人格来源投影出的正文写进主配置第一只宠物的 whisperPrompt，并监听卡片文件变化。
 * 不读 LLM、不碰渲染；失败只留痕，绝不写空人设覆盖既有值。
 * 写盘后不重启 Helper：碎碎念与对话每次生成都现读配置，改 whisperPrompt 无需重启。
 * 必须始终成立：只有 resolve 成功才写盘，not-found / invalid-card 一律跳过。
 * @module dsh-pet/src/host/persona-source/sync
 */
import { watch } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readAllConfig, readUserConfig, saveUserConfig } from '../config.ts';
import { defaultLog } from '../log-file.ts';
import type { ConfigPaths } from '../config/constants.ts';
import { personaSource } from './registry.ts';
import { BUILTIN_PERSONA_SOURCE_ID } from './types.ts';

/** 卡片变化的去抖窗口（ms）：编辑器保存会连续触发多次 change。 */
const DEBOUNCE_MS = 300;

/** 同步器的输入：路径与要同步的来源。 */
export interface PersonaSyncInput {
  /** 配置路径集（读成品配置、写用户层用）。 */
  readonly configPaths: ConfigPaths;
  /** 用户主配置路径（写 whisperPrompt 的落点）。 */
  readonly userConfigPath: string;
  /** 要同步的来源 id；缺省 = 内置 fish-soul。 */
  readonly sourceId?: string;
}

/**
 * 把投影正文写进主配置第一只宠物的 whisperPrompt。
 *
 * 走与设置页保存同一条白名单重建链路（saveUserConfig），非白名单字段从磁盘原样带回；
 * 没变化或写不了就不动文件。
 * @internal 导出供测试；生产只经 createPersonaSync 调用。
 */
export async function applyPersona(
  configPaths: ConfigPaths,
  userConfigPath: string,
  text: string,
  sourceId: string,
): Promise<void> {
  const merged = readAllConfig(configPaths);
  const rawPets: unknown = merged.main.pets;
  const mainPets = Array.isArray(rawPets) ? (rawPets as Record<string, unknown>[]) : [];
  if (mainPets.length === 0) {
    defaultLog('warn', 'dsh-pet: 人设同步跳过：主配置没有宠物');
    return;
  }
  const current = typeof mainPets[0].whisperPrompt === 'string' ? mainPets[0].whisperPrompt : '';
  if (current === text) return;
  const pets = mainPets.map((pet, index) => (index === 0 ? { ...pet, whisperPrompt: text } : pet));
  const existing = readUserConfig(configPaths);
  const clean = saveUserConfig({ pets }, existing);
  if (!clean) {
    defaultLog('warn', 'dsh-pet: 人设同步写盘失败（saveUserConfig 拒绝 pets）');
    return;
  }
  await mkdir(dirname(userConfigPath), { recursive: true });
  await writeFile(userConfigPath, JSON.stringify(clean, null, 2), 'utf8');
  defaultLog('info', `dsh-pet: 人设已同步自 ${sourceId}，${text.length} 字`);
}

/**
 * 创建人设同步器。
 *
 * @param input - 路径与来源 id。
 * @returns `start` 与 `stop`；stop 后不再监听也不写盘。
 */
export function createPersonaSync(input: PersonaSyncInput): { start(): void; stop(): void } {
  const { configPaths, userConfigPath, sourceId = BUILTIN_PERSONA_SOURCE_ID } = input;
  let watcher: ReturnType<typeof watch> | undefined;
  let debounceTimer: NodeJS.Timeout | undefined;
  let running = false;

  const syncOnce = async (): Promise<void> => {
    const source = personaSource(sourceId);
    if (!source) {
      defaultLog('warn', `dsh-pet: 人设来源未注册: ${sourceId}`);
      return;
    }
    const resolution = await source.resolve();
    if (!resolution.ok) {
      defaultLog(
        'warn',
        `dsh-pet: 人设卡同步跳过（${resolution.reason}${resolution.message ? ' ' + resolution.message : ''}）`,
      );
      return;
    }
    await applyPersona(configPaths, userConfigPath, resolution.text, sourceId);
  };

  const schedule = (): void => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void syncOnce();
    }, DEBOUNCE_MS);
    debounceTimer.unref?.();
  };

  const start = (): void => {
    if (running) return;
    running = true;
    void syncOnce();
    const source = personaSource(sourceId);
    if (!source?.watchPath) return;
    try {
      watcher = watch(source.watchPath, schedule);
      watcher.on('error', (error) => {
        defaultLog('warn', `dsh-pet: 人设卡监听出错: ${error instanceof Error ? error.message : String(error)}`);
      });
    } catch {
      defaultLog('warn', `dsh-pet: 无法监听人设卡（可能尚未放置）: ${source.watchPath}`);
    }
  };

  const stop = (): void => {
    running = false;
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    watcher?.close();
    watcher = undefined;
  };

  return { start, stop };
}
