import { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { jsx } from 'react/jsx-runtime';
import { makePetConfigSection, petBridge, dicts } from '../../src/client/settings.ts';

petBridge.current = window.initialConfig.main.pets;
petBridge.template = petBridge.current[0];
const dictionary = dicts[new URLSearchParams(location.search).get('lang') === 'zh' ? 'zh' : 'en'];
// 关闭探针：真实设置页由 DSH 外壳提供 close，这里用计数器代替，便于断言「确定 / 取消」是否关页。
window.__closed = 0;
// 客户端上下文替身：快捷键目录取不到就回落到默认键帽，与真实环境里服务缺失时的降级一致。
const ctx = { get: () => undefined };
const Section = makePetConfigSection(
  {
    h: jsx,
    useState,
    useEffect,
    useRef,
    useCallback,
    t: (key) => dictionary[key] ?? key,
  },
  ctx,
);
createRoot(document.getElementById('root')).render(
  jsx(Section, {
    close: () => {
      window.__closed += 1;
    },
  }),
);
