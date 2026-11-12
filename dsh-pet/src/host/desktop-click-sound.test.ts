/**
 * 桌面 Helper 的点击音效接线（runtime/electron-helper/sprite.js）：
 * 开关只认成品配置 main.clickSoundEnabled 的布尔 true，其余一律静音；放行时委托给共享播放器。
 * 播放器本身（预热、节流、回退）由 shared/click-sfx.test.ts 覆盖。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const sprite = readFileSync(new URL('../../runtime/electron-helper/sprite.js', import.meta.url), 'utf8');

/**
 * 在 vm 里跑 sprite.js，注入一只假 PetShared。
 *
 * @param enabled - 成品配置里的 `clickSoundEnabled`。
 * @returns 点击入口与共享播放器的调用计数。
 */
function fixture(enabled: boolean | undefined) {
  const calls = { play: 0 };
  const config: { clickSoundEnabled: boolean | undefined } = { clickSoundEnabled: enabled };
  const controls = runInNewContext(sprite + '\n({ play: playClickSound })', {
    BASE: 'dsh-pet-bridge://dsh-pet/dsh-pet-7340',
    ORIGIN: 'http://127.0.0.1:3080',
    config,
    S: {
      playClickSfx: () => {
        calls.play += 1;
        return true;
      },
    },
    console: { info: () => undefined },
    navigator: { platform: 'Win32' },
    Date: { now: () => 1000 },
  }) as { play(): void };
  return { ...controls, calls, config };
}

test('开关打开：点击委托给共享播放器', () => {
  const audio = fixture(true);
  audio.play();
  assert.equal(audio.calls.play, 1);
});

test('开关关闭或缺失：一律静音', () => {
  const off = fixture(false);
  off.play();
  assert.equal(off.calls.play, 0);
  const absent = fixture(undefined);
  absent.play();
  assert.equal(absent.calls.play, 0);
});

test('配置从静音改成打开：之后点击立刻生效', () => {
  const audio = fixture(undefined);
  audio.play();
  audio.config.clickSoundEnabled = true;
  audio.play();
  assert.equal(audio.calls.play, 1);
});
