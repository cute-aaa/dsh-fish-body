/**
 * 会话鱼皮肤渲染：视频 / 图片两种元素、地址编码、宽高比换算与失败回落。
 * 用真实 React 静态渲染（无 DOM、无网络）。
 * @module dsh-pet/src/client/session-fish/media.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { jsx } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Dispatch, SetStateAction } from 'react';
import {
  makeSessionFishMedia,
  rememberSessionFishAspect,
  sessionFishAspectOf,
  sessionFishHeightOf,
  sessionFishSkinUrl,
  SESSION_FISH_ASPECT,
} from './media.ts';

/** 不触发加载失败的运行时。 */
const loadingRuntime = {
  h: jsx,
  useState: <T>(initial: T): [T, Dispatch<SetStateAction<T>>] => [initial, () => {}],
};

/** 已失败（回落内嵌小鱼）的运行时：只有失败标记那一格被置 true。 */
const failedRuntime = {
  h: jsx,
  useState: <T>(initial: T): [T, Dispatch<SetStateAction<T>>] => [(true as unknown as T) ?? initial, () => {}],
};

describe('sessionFishSkinUrl', () => {
  test('空串用默认皮肤；中文名走 URL 编码', () => {
    assert.equal(sessionFishSkinUrl(''), '/dsh-pet-7340/session-fish/skin?name=%E5%86%99%E4%BB%A3%E7%A0%81.webm');
    assert.equal(
      sessionFishSkinUrl('我的鱼.gif'),
      '/dsh-pet-7340/session-fish/skin?name=%E6%88%91%E7%9A%84%E9%B1%BC.gif',
    );
  });
});

describe('sessionFishHeightOf', () => {
  test('默认 16:9；高度夹在 0.5–2 倍宽之间', () => {
    assert.equal(sessionFishHeightOf(96), Math.round(96 / SESSION_FISH_ASPECT));
    assert.equal(sessionFishHeightOf(100, 100), 50, '超宽素材不把鱼压成一条线');
    assert.equal(sessionFishHeightOf(100, 0.1), 200, '超长素材不把鱼拉成一列');
    assert.equal(sessionFishHeightOf(100, 0), Math.round(100 / SESSION_FISH_ASPECT), '非法比例退回默认');
  });
});

describe('rememberSessionFishAspect', () => {
  test('第一次记录算变化，同样的比例再记一次不算', () => {
    assert.equal(rememberSessionFishAspect('a-square.png', 200, 200), true);
    assert.equal(sessionFishAspectOf('a-square.png'), 1);
    assert.equal(rememberSessionFishAspect('a-square.png', 200, 200), false);
    assert.equal(rememberSessionFishAspect('a-square.png', 400, 400), false, '比例一致就不算变化');
    assert.equal(rememberSessionFishAspect('a-square.png', 200, 100), true);
    assert.equal(sessionFishAspectOf('a-square.png'), 2);
  });

  test('非法尺寸不记', () => {
    assert.equal(rememberSessionFishAspect('broken.png', 0, 100), false);
    assert.equal(sessionFishAspectOf('broken.png'), SESSION_FISH_ASPECT);
  });
});

describe('SessionFishMedia', () => {
  test('webm：渲染 video，静音循环且不可交互', () => {
    const Media = makeSessionFishMedia(loadingRuntime);
    const html = renderToStaticMarkup(jsx(Media, { width: 96, skin: '写代码.webm', state: 'working' }));
    assert.match(html, /<video/);
    assert.match(html, /session-fish\/skin\?name=%E5%86%99%E4%BB%A3%E7%A0%81.webm/);
    assert.match(html, /muted/);
    assert.match(html, /loop/);
    assert.match(html, /playsinline|playsInline/i);
  });

  test('gif：渲染 img，而不是 video', () => {
    const Media = makeSessionFishMedia(loadingRuntime);
    const html = renderToStaticMarkup(jsx(Media, { width: 96, skin: '我的鱼.gif', state: 'working' }));
    assert.match(html, /<img/);
    assert.doesNotMatch(html, /<video/);
  });

  test('kind 显式给出时以它为准（宿主已算好）', () => {
    const Media = makeSessionFishMedia(loadingRuntime);
    const html = renderToStaticMarkup(jsx(Media, { width: 96, skin: 'clip.mp4', kind: 'image', state: 'idle' }));
    assert.match(html, /<img/);
  });

  test('加载失败：回落内嵌小鱼，不再是媒体元素', () => {
    const Media = makeSessionFishMedia(failedRuntime);
    const html = renderToStaticMarkup(jsx(Media, { width: 96, skin: '写代码.webm', state: 'working' }));
    assert.doesNotMatch(html, /<video/);
    assert.match(html, /dsh-session-fish__mediaFallback/);
    assert.match(html, /<svg/);
  });
});
