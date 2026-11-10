/**
 * webm 渲染器（src/client/pet/render/webm.ts）的契约测试：只验证 Renderer 契约映射，
 * 不重复验证 A/B 换源引擎（引擎契约在 animation.test.ts）。假 video、假 stage、假素材加载器。
 * @module dsh-pet/src/client/pet/render/webm.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createWebmRenderer } from './webm.ts';
import type { AnimationSource, RendererMountOptions } from './types.ts';
import type { AssetHandlers, AssetLoader } from '../animation/asset-loader.ts';
import type { Animations } from '../../../shared/types.ts';

/** 假 video：只实现渲染器用到的成员。 */
class FakeVideo {
  loop = true;
  muted = false;
  autoplay = false;
  playsInline = false;
  src = '';
  className = '';
  onended: ((event: Event) => void) | null = null;
  onerror: (() => void) | null = null;
  style: Record<string, string> = {};
  paused = true;
  duration = 0;
  currentTime = 0;
  readyState = 0;
  seeking = false;
  loadCalls = 0;
  removed = 0;
  private readonly classes = new Set<string>();

  classList = {
    add: (name: string) => void this.classes.add(name),
    remove: (name: string) => void this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
  };

  addEventListener(): void {}
  removeEventListener(): void {}
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  load(): void {
    this.loadCalls += 1;
  }
  remove(): void {
    this.removed += 1;
  }
}

/** 假 stage：记录挂接的子元素。 */
class FakeStage {
  children: FakeVideo[] = [];
  appendChild(el: FakeVideo): void {
    this.children.push(el);
  }
}

/** 假素材加载器：手动决定每次 load 的结局。 */
class FakeLoader implements AssetLoader {
  requests: Array<{ url: string; handlers: AssetHandlers }> = [];
  aborts = 0;

  load(url: string, handlers: AssetHandlers): void {
    this.requests.push({ url, handlers });
  }
  abortAll(): void {
    this.aborts += 1;
  }
  release(): void {}
}

const animations = {
  idle: ['idle1'],
  turn: ['turn1'],
  drag: ['drag1'],
  clicks: ['click1'],
  moves: { default: {}, actions: [] },
  categories: [],
  events: {},
} as unknown as Animations;

/** 造一份最小动画源。 */
function makeSource(): AnimationSource {
  let current = 'idle1';
  return {
    cfg: () => ({ id: 'main', assetRoot: 'main', animations }),
    currentAnim: () => current,
    workStatus: () => null,
    facing: () => 'left',
    report: () => {},
    clearCuePlayback: () => {},
    onFrontReady: () => {},
    isDragging: () => false,
    initiallyFrozen: false,
    setCurrent: (name: string) => {
      current = name;
    },
  } as AnimationSource & { setCurrent(name: string): void };
}

/** 装配：假 stage + 假 video 工厂 + 假加载器，挂载后返回各句柄。 */
function mount() {
  const stage = new FakeStage();
  const videoA = new FakeVideo();
  const videoB = new FakeVideo();
  const created = [videoA, videoB];
  const loader = new FakeLoader();
  const renderer = createWebmRenderer({
    createVideo: () => (created.shift() ?? new FakeVideo()) as unknown as HTMLVideoElement,
    loader,
  });
  const source = makeSource();
  const opts: RendererMountOptions = { size: 462, assetRoot: 'main', source };
  renderer.mount(stage as unknown as HTMLElement, opts);
  return { renderer, stage, videoA, videoB, loader, source };
}

describe('createWebmRenderer —— 契约映射', () => {
  test('未挂载：ready=false、frontElement=null、progress 给零值', () => {
    const renderer = createWebmRenderer({ createVideo: () => new FakeVideo() as unknown as HTMLVideoElement });
    assert.equal(renderer.kind, 'webm');
    assert.equal(renderer.ready, false);
    assert.equal(renderer.frontElement(), null);
    assert.deepEqual(renderer.progress(), {
      playbackId: null,
      anim: '',
      currentTime: 0,
      duration: 0,
      paused: true,
      buffering: false,
    });
  });

  test('setIdle 走循环：目标槽 loop=true，素材按路由拼装', () => {
    const h = mount();
    h.renderer.setIdle('idle1');
    assert.equal(h.videoB.loop, true);
    assert.ok(h.loader.requests[0].url.includes('/thumb/main/idle1'), h.loader.requests[0].url);
  });

  test('playAction once 走单次：loop=false 且消费点播编号', () => {
    const h = mount();
    let cleared = 0;
    const src = h.source;
    src.clearCuePlayback = () => {
      cleared += 1;
    };
    h.renderer.playAction('click1', { once: true, playbackId: 'pb-1' });
    assert.equal(h.videoB.loop, false);
    assert.equal(cleared, 1);
    assert.ok(h.loader.requests[0].url.includes('/thumb/main/click1'));
  });

  test('playAction 带 url：直接用完整地址，不再拼路由', () => {
    const h = mount();
    h.renderer.playAction('https://example.com/a.webm', { once: true });
    assert.equal(h.loader.requests[0].url, 'https://example.com/a.webm');
  });

  test('冻结/解冻与前台元素', () => {
    const h = mount();
    assert.equal(h.renderer.frontElement(), h.videoA);
    assert.deepEqual(h.renderer.setFrozen(true), { kind: 'frozen' });
    assert.equal(h.renderer.isFrozen(), true);
    assert.equal(h.videoA.paused, true, '冻结要暂停前台');
    assert.deepEqual(h.renderer.setFrozen(false), { kind: 'resumed' });
    assert.deepEqual(h.renderer.setFrozen(false), null, '未翻转不再报');
  });

  test('stopLooping：把前台循环关掉、播完即停', () => {
    const h = mount();
    h.renderer.stopLooping();
    assert.equal(h.videoA.loop, false);
  });

  test('destroy：卸载元素并中断在途素材', () => {
    const h = mount();
    h.renderer.destroy();
    assert.equal(h.videoA.removed, 1);
    assert.equal(h.videoB.removed, 1);
    assert.equal(h.loader.aborts, 1);
    assert.equal(h.renderer.ready, false);
  });
});
