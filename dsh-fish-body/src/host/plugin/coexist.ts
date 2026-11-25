/**
 * 共存检测的装配：把「DSH 根 / 家目录 / AppData」这些环境路径收敛到这里，
 * 宿主装配处只拿一个 `CoexistStore`，不必也去 import `os` 与 `path`。
 * @module dsh-fish-body/src/host/plugin/coexist
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { CoexistStore, detectCoexistPartners } from '../coexist.ts';

/** 探测并造一个共存状态（探测只做一次：环境事实不该每次请求都 stat）。 */
export function createCoexistStore(options?: {
  readonly dshHome?: string;
  readonly home?: string;
  readonly appData?: string;
  readonly mode?: 'auto' | 'full' | 'body-only';
}): CoexistStore {
  const home = options?.home ?? homedir();
  const partners = detectCoexistPartners({
    dshHome: options?.dshHome ?? resolveDshHome(),
    home,
    appData: options?.appData ?? process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
  });
  return new CoexistStore(partners, options?.mode ?? 'auto');
}
