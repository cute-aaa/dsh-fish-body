/**
 * 设置页的头像上传状态：预览用的破缓存版本号、上传中的禁用标志，以及那一下提交。
 *
 * 头像不是配置字段：上传直接落盘，改完不必再点「保存」，所以它的 busy 与保存的 busy 分开。
 * 版本号是给预览用的：同一个 URL 会被浏览器记住，不换版本号上传成功后仍是旧图。
 * owns only 这两项状态与一次上传，never 保存、宠物字段与卡片渲染。
 * @module dsh-fish-body/src/client/settings/use-avatar-upload
 */
import type { Pet } from '../../shared/types.ts';
import type { Feedback } from './feedback.ts';
import { uploadPetAvatar } from './avatar-upload.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 头像上传的状态与入口。 */
export interface AvatarUploadState {
  /** 预览地址的破缓存版本号（上传成功后换一个）。 */
  readonly version: number;
  /** 上传中：按钮禁用并换文案。 */
  readonly busy: boolean;
  /** 上传一张图片给当前宠物。 */
  upload(file: File): void;
}

/** {@link useAvatarUpload} 的输入。 */
export interface AvatarUploadOptions {
  /** 当前宠物；`null` 表示列表为空，上传是空操作。 */
  readonly pet: Pet | null;
  /** 结果就地显示（与保存反馈同一处）。 */
  readonly report: (feedback: Feedback) => void;
  /** 文案翻译。 */
  readonly t: (key: string) => string;
}

/**
 * 管理头像上传。
 *
 * @param rt - 只用到 `useState`。
 * @param options - 当前宠物、反馈回调与翻译。
 * @returns 版本号、上传中标志与提交入口。
 */
export function useAvatarUpload(
  rt: Pick<SettingsRuntime, 'useState'>,
  options: AvatarUploadOptions,
): AvatarUploadState {
  const { useState } = rt;
  const { pet, report, t } = options;
  // 初值取当前时间：第一次渲染就带版本号，预览不必等上传后才破缓存。
  const [version, setVersion] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  /** 上传归属看素材根：文件宠物是目录前缀，同一素材根的多只实例共用一张。 */
  const upload = (file: File): void => {
    if (pet === null) return;
    const assetRoot = pet.assetRoot ?? '';
    setBusy(true);
    void (async () => {
      try {
        const result = await uploadPetAvatar(assetRoot, file);
        if (!result.ok) {
          report({ kind: 'err', text: result.message });
          return;
        }
        // 换版本号让预览立刻重取，否则浏览器还拿缓存里的旧图。
        setVersion(Date.now());
        report({ kind: 'ok', text: t('avatarUploaded') });
      } catch (error) {
        report({ kind: 'err', text: error instanceof Error ? error.message : String(error) });
      } finally {
        setBusy(false);
      }
    })();
  };

  return { version, busy, upload };
}
