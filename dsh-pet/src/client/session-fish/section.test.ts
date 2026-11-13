/**
 * 会话鱼设置分区：真实 React 静态渲染（无 DOM、无网络）。
 *
 * 用假 hooks 直接把「已加载完设置」这一帧渲出来，钉住三件事：表单不抛、关键控件都在、
 * 保存按钮可用。加载态与副作用不在本文件覆盖（那是浏览器行为，交给页面验收）。
 * @module dsh-pet/src/client/session-fish/section.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { jsx } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Dispatch, SetStateAction } from 'react';
import { makeSessionFishSection, type SessionFishSectionRuntime } from './section.ts';
import { DEFAULT_SESSION_FISH_SETTINGS } from '../../shared/session-fish.ts';

/** 依次返回：草稿设置、其余状态用各自的初始值（皮肤清单 = null）；渲染期间不需要真实更新。 */
function fakeRuntime(): SessionFishSectionRuntime {
  let calls = 0;
  const noop = (): void => {};
  const useState = <T>(initial: T): [T, Dispatch<SetStateAction<T>>] => {
    calls += 1;
    if (calls === 1) return [DEFAULT_SESSION_FISH_SETTINGS as unknown as T, noop];
    return [initial, noop];
  };
  return {
    // 生产环境的 h 就是 jsx（见 client/app.ts 的 require），这里用同一个函数。
    h: jsx,
    useState,
    useEffect: () => {},
    t: (key) => key,
  };
}

describe('SessionFishSection 渲染', () => {
  test('已加载设置：控件与保存按钮都出现，且不抛错', () => {
    const Section = makeSessionFishSection(fakeRuntime());
    const html = renderToStaticMarkup(jsx(Section, {}));
    assert.match(html, /dsh-pet-cfg__card/);
    assert.match(html, /dsh-session-fish-preview/);
    assert.match(html, /<video/, '预览用 webm 小动画，而不是内嵌 SVG');
    assert.match(html, /session-fish\/skin\?name=%E5%86%99%E4%BB%A3%E7%A0%81\.webm/, '预览走皮肤端点');
    assert.match(html, /type="checkbox"/, '总开关与三类播报都是勾选框');
    assert.match(html, /type="range"/, '鱼尺寸有滑块');
    assert.match(html, />save</, '保存按钮');
    assert.match(html, /enabledHint/, '说明走问号气泡');
  });

  test('皮肤与跟随：下拉、默认项、跟随开关与打开文件夹按钮都在', () => {
    const Section = makeSessionFishSection(fakeRuntime());
    const html = renderToStaticMarkup(jsx(Section, {}));
    assert.match(html, /<select/, '皮肤是下拉选择');
    assert.match(html, /<option value=""[^>]*>skinDefault<\/option>/, '空值 = 默认皮肤');
    assert.match(html, /followPet/, '围着桌宠转的开关');
    assert.match(html, /openSkinFolder/, '打开皮肤文件夹');
    assert.match(html, /skinRescan/, '重新扫描');
  });
});
