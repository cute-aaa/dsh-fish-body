/**
 * 设置页素材导入动作：选文件/目录、提交宿主、把结果合并成一条反馈。
 *
 * 每个动作只做一次导入；成功后由调用方重新扫描自己的资源清单。
 * @module dsh-fish-body/src/client/settings/use-asset-imports
 */
import { AUDIO_IMPORT_EXTS, SESSION_FISH_IMPORT_EXTS } from '../../shared/asset-import.ts';
import type { RendererKind, SfxEventSlot } from '../../shared/types.ts';
import { importAssetRequest } from './asset-import-api.ts';
import type { Feedback } from './feedback.ts';
import { pickFile, pickFolder, type PickOutcome } from './layout-api.ts';
import { petBridge } from './bridge.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 素材导入状态与动作。 */
export interface AssetImportsState {
  /** 正在进行的动作键；空串表示空闲。 */
  readonly busy: string;
  importSkin(renderer: RendererKind): Promise<boolean>;
  importSfxSlot(slot: SfxEventSlot): Promise<boolean>;
  importSharedSfx(): Promise<boolean>;
  importHookSfx(name: string): Promise<boolean>;
  importSessionFish(): Promise<boolean>;
}

/** 精简渲染 / 旧测试没有导入能力时的空动作。 */
export const NO_ASSET_IMPORTS: AssetImportsState = {
  busy: '',
  importSkin: async () => false,
  importSfxSlot: async () => false,
  importSharedSfx: async () => false,
  importHookSfx: async () => false,
  importSessionFish: async () => false,
};

/** 选文件/目录的取消与失败统一处理。 */
function picked(outcome: PickOutcome): string | null {
  return outcome.kind === 'picked' ? outcome.path : null;
}

/** 造素材导入动作。 */
export function useAssetImports(
  rt: Pick<SettingsRuntime, 'useState' | 't'>,
  report: (feedback: Feedback) => void,
): AssetImportsState {
  const { useState, t } = rt;
  const [busy, setBusy] = useState('');

  const run = async (key: string, action: () => Promise<boolean>): Promise<boolean> => {
    if (busy !== '') return false;
    setBusy(key);
    try {
      return await action();
    } finally {
      setBusy('');
    }
  };

  const finish = (ok: boolean, importedPath?: string): boolean => {
    if (ok && importedPath !== undefined) {
      report({ kind: 'ok', text: t('assetImportDone').replace('{path}', importedPath) });
    }
    return ok;
  };

  const importSkin = (renderer: RendererKind): Promise<boolean> =>
    run('skin:' + renderer, async () => {
      const source =
        renderer === 'webm'
          ? picked(await pickFile(t('assetImportPickSkin'), ['.webm']))
          : picked(await pickFolder(t('assetImportPickSkin')));
      if (source === null) return false;
      const outcome = await importAssetRequest({ kind: 'skin', renderer, sourcePath: source });
      if (!outcome.ok) {
        report({ kind: 'err', text: outcome.message });
        return false;
      }
      return finish(true, outcome.imported.relativePath);
    });

  const importSfx = (target: 'shared' | 'slot' | 'hook', slot?: SfxEventSlot, hook?: string): Promise<boolean> =>
    run('sfx:' + target + ':' + (slot ?? hook ?? ''), async () => {
      const source = picked(await pickFile(t('assetImportPickAudio'), AUDIO_IMPORT_EXTS));
      if (source === null) return false;
      const pet = petBridge.current[0];
      if (target === 'slot' && pet === undefined) {
        report({ kind: 'err', text: t('assetImportNoPet') });
        return false;
      }
      const outcome = await importAssetRequest(
        {
          kind: 'sfx',
          sourcePath: source,
          target,
          ...(slot === undefined ? {} : { slot }),
          ...(hook === undefined ? {} : { hook }),
        },
        target === 'slot' ? pet?.id : undefined,
      );
      if (!outcome.ok) {
        report({ kind: 'err', text: outcome.message });
        return false;
      }
      return finish(true, outcome.imported.relativePath);
    });

  const importSessionFish = (): Promise<boolean> =>
    run('session-fish', async () => {
      const source = picked(await pickFile(t('assetImportPickSessionFish'), SESSION_FISH_IMPORT_EXTS));
      if (source === null) return false;
      const outcome = await importAssetRequest({ kind: 'session-fish', sourcePath: source });
      if (!outcome.ok) {
        report({ kind: 'err', text: outcome.message });
        return false;
      }
      return finish(true, outcome.imported.relativePath);
    });

  return {
    busy,
    importSkin,
    importSfxSlot: (slot) => importSfx('slot', slot),
    importSharedSfx: () => importSfx('shared'),
    importHookSfx: (name) => importSfx('hook', undefined, name),
    importSessionFish,
  };
}
