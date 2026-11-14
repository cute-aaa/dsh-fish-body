/**
 * 内置人格来源：dsh-fish-soul 的人设卡（$DSH_HOME/fish-soul/persona.json）。
 * 只把「读卡」接到 ./card-reader，并把卡片路径暴露给同步器做监听。
 * @module dsh-fish-body/src/host/persona-source/fish-soul
 */
import { join } from 'node:path';
import { readCardFile } from './card-reader.ts';
import { BUILTIN_PERSONA_SOURCE_ID, type PersonaSource } from './types.ts';

/**
 * 创建 fish-soul 人格来源。
 *
 * @param dshHome - DSH 数据根（resolveDshHome 的结果）。
 * @returns 来源实现；卡片路径 = <dshHome>/fish-soul/persona.json。
 */
export function createFishSoulSource(dshHome: string): PersonaSource {
  const watchPath = join(dshHome, 'fish-soul', 'persona.json');
  return {
    id: BUILTIN_PERSONA_SOURCE_ID,
    name: 'dsh-fish-soul',
    watchPath,
    resolve: () => readCardFile(watchPath),
  };
}
