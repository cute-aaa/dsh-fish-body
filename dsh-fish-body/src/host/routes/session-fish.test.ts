/**
 * 会话鱼路由：读设置、写设置（校验/落盘/发布）、focus/close 动作与错误矩阵。
 * @module dsh-fish-body/src/host/routes/session-fish.test
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleSessionFishRoutes } from './session-fish.ts';
import { SessionFishStore } from '../session-fish/store.ts';
import { SessionFishSettingsStore, sessionFishSettingsPath } from '../session-fish/settings.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';

let dir = '';
let skinUser = '';
let skinPack = '';
let publishes = 0;
let caseSeq = 0;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-fish-routes-'));
  // 皮肤池用临时目录：不依赖包内素材，也就不会受「源码直跑时 PACKAGE_ROOT 指向 src/」影响。
  skinUser = join(dir, 'skins');
  skinPack = join(dir, 'pack-skins');
  mkdirSync(skinUser, { recursive: true });
  mkdirSync(skinPack, { recursive: true });
  writeFileSync(join(skinUser, '我的鱼.gif'), 'GIF89a', 'utf8');
  writeFileSync(join(skinPack, '写代码.webm'), 'webm', 'utf8');
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 最小依赖表：只填本领域用到的几项；每个用例一份独立设置文件（互不污染）。 */
function makeDeps(): PetRouteDeps {
  const file = sessionFishSettingsPath(join(dir, 'case-' + ++caseSeq));
  const sessionFishSettings = new SessionFishSettingsStore(file);
  const sessionFish = new SessionFishStore({ settings: () => sessionFishSettings.get() });
  publishes = 0;
  return {
    sessionFish,
    sessionFishSettings,
    // 皮肤池的用户目录挂在数据根下：测试用临时目录，包内那份用一个固定的临时目录替身。
    userRoot: dir,
    fishSkinDirs: () => ({ user: skinUser, pack: skinPack }),
    publishSessionFish: () => {
      publishes += 1;
    },
  } as unknown as PetRouteDeps;
}

/** 造一次请求输入。 */
function input(method: string, body?: string, rest = 'session-fish', search = ''): RouteInput {
  return {
    url: new URL('http://localhost/dsh-pet-7340/' + rest + search),
    rest,
    method,
    body,
  };
}

/** 读 JSON 响应体。 */
function bodyOf(result: Awaited<ReturnType<typeof handleSessionFishRoutes>>): Record<string, unknown> {
  assert.ok(result && result.kind === 'json');
  return result.obj as Record<string, unknown>;
}

/** 取状态码（json 应答取 status，文本应答取自身状态码）。 */
function statusOf(result: Awaited<ReturnType<typeof handleSessionFishRoutes>>): number {
  if (!result) return 0;
  return result.kind === 'json' || result.kind === 'text' ? result.status : 0;
}

describe('handleSessionFishRoutes', () => {
  test('非本领域路径：返回 undefined 交给下一个处理器', async () => {
    const deps = makeDeps();
    const result = await handleSessionFishRoutes(deps, { ...input('GET'), rest: 'other' });
    assert.equal(result, undefined);
  });

  test('GET：返回当前设置（默认值）', async () => {
    const deps = makeDeps();
    const body = bodyOf(await handleSessionFishRoutes(deps, input('GET')));
    const settings = body.settings as Record<string, unknown>;
    assert.equal(settings.enabled, true);
    assert.equal(settings.sizePx, 96);
  });

  test('PUT：保存并发布；未知键 200 + bad-request', async () => {
    const deps = makeDeps();
    const okBody = bodyOf(await handleSessionFishRoutes(deps, input('PUT', JSON.stringify({ sizePx: 72 }))));
    assert.equal((okBody.settings as Record<string, unknown>).sizePx, 72);
    assert.equal(publishes, 1);

    const bad = bodyOf(await handleSessionFishRoutes(deps, input('PUT', JSON.stringify({ nope: true }))));
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'bad-request');
  });

  test('PUT：关掉总开关会清空现有鱼', async () => {
    const deps = makeDeps();
    await handleSessionFishRoutes(deps, input('PUT', JSON.stringify({ enabled: true })));
    await handleSessionFishRoutes(
      deps,
      input('POST', JSON.stringify({ action: 'focus', sessionId: 's1', blank: true })),
    );
    assert.equal(deps.sessionFish.list().length, 1);
    await handleSessionFishRoutes(deps, input('PUT', JSON.stringify({ enabled: false })));
    assert.equal(deps.sessionFish.list().length, 0);
  });

  test('POST focus：空白会话建鱼；close 移除', async () => {
    const deps = makeDeps();
    const focus = bodyOf(
      await handleSessionFishRoutes(
        deps,
        input('POST', JSON.stringify({ action: 'focus', sessionId: 's1', blank: true })),
      ),
    );
    assert.equal(focus.changed, true);
    assert.equal(deps.sessionFish.has('s1'), true);

    const close = bodyOf(
      await handleSessionFishRoutes(deps, input('POST', JSON.stringify({ action: 'close', sessionId: 's1' }))),
    );
    assert.equal(close.changed, true);
    assert.equal(deps.sessionFish.has('s1'), false);
  });

  test('错误矩阵：非法方法 / JSON / action / sessionId / 超长体', async () => {
    const deps = makeDeps();
    assert.equal(statusOf(await handleSessionFishRoutes(deps, input('DELETE'))), 405);
    assert.equal(bodyOf(await handleSessionFishRoutes(deps, input('POST', '{ not json'))).reason, 'invalid-json');
    const badAction = bodyOf(
      await handleSessionFishRoutes(deps, input('POST', JSON.stringify({ action: 'poke', sessionId: 's1' }))),
    );
    assert.equal(badAction.reason, 'bad-request');
    const badId = bodyOf(
      await handleSessionFishRoutes(deps, input('POST', JSON.stringify({ action: 'focus', sessionId: '  ' }))),
    );
    assert.equal(badId.reason, 'bad-request');
    const huge = await handleSessionFishRoutes(
      deps,
      input('POST', JSON.stringify({ action: 'close', sessionId: 'x'.repeat(9000) })),
    );
    assert.equal(statusOf(huge), 413);
  });
});

describe('皮肤端点', () => {
  test('GET /session-fish/skins：列出两处皮肤并给出默认值', async () => {
    const deps = makeDeps();
    const body = bodyOf(await handleSessionFishRoutes(deps, input('GET', undefined, 'session-fish/skins')));
    assert.equal(body.defaultSkin, '写代码.webm');
    const items = body.items as Array<Record<string, unknown>>;
    assert.ok(items.some((item) => item.id === '写代码.webm' && item.source === 'pack' && item.kind === 'video'));
    assert.ok(items.some((item) => item.id === '我的鱼.gif' && item.source === 'user' && item.kind === 'image'));
  });

  test('GET /session-fish/skin：下发包内动画字节', async () => {
    const deps = makeDeps();
    const result = await handleSessionFishRoutes(
      deps,
      input('GET', undefined, 'session-fish/skin', '?name=' + encodeURIComponent('写代码.webm')),
    );
    assert.equal(result?.kind, 'file');
    if (result?.kind === 'file') {
      assert.equal(result.contentType, 'video/webm');
      assert.equal(result.file, join(skinPack, '写代码.webm'));
    }
  });

  test('GET /session-fish/skin：图片皮肤走 image MIME', async () => {
    const deps = makeDeps();
    const result = await handleSessionFishRoutes(
      deps,
      input('GET', undefined, 'session-fish/skin', '?name=' + encodeURIComponent('我的鱼.gif')),
    );
    assert.equal(result?.kind, 'file');
    if (result?.kind === 'file') assert.equal(result.contentType, 'image/gif');
  });

  test('skin：缺参/穿越/未知扩展名 400，不存在 404', async () => {
    const deps = makeDeps();
    assert.equal(statusOf(await handleSessionFishRoutes(deps, input('GET', undefined, 'session-fish/skin'))), 400);
    assert.equal(
      statusOf(
        await handleSessionFishRoutes(
          deps,
          input('GET', undefined, 'session-fish/skin', '?name=' + encodeURIComponent('../package.json')),
        ),
      ),
      400,
    );
    assert.equal(
      statusOf(await handleSessionFishRoutes(deps, input('GET', undefined, 'session-fish/skin', '?name=note.txt'))),
      400,
    );
    assert.equal(
      statusOf(await handleSessionFishRoutes(deps, input('GET', undefined, 'session-fish/skin', '?name=none.png'))),
      404,
    );
  });

  test('皮肤端点只接受 GET', async () => {
    const deps = makeDeps();
    assert.equal(statusOf(await handleSessionFishRoutes(deps, input('PUT', '{}', 'session-fish/skins'))), 405);
    assert.equal(
      statusOf(await handleSessionFishRoutes(deps, input('POST', '{}', 'session-fish/skin', '?name=a.png'))),
      405,
    );
  });
});

describe('POST /session-fish/claim —— 出声权', () => {
  test('同一条播报只授予一次：第二个面拿到 false', async () => {
    const deps = makeDeps();
    const body = JSON.stringify({ sessionId: 's1', lineSeq: 3 });
    const first = bodyOf(await handleSessionFishRoutes(deps, input('POST', body, 'session-fish/claim')));
    const second = bodyOf(await handleSessionFishRoutes(deps, input('POST', body, 'session-fish/claim')));
    assert.equal(first.granted, true);
    assert.equal(second.granted, false, '另一面（或另一个标签页）不该再念一遍');
  });

  test('更新的序号授予、乱的旧序号拒绝；不同会话互不影响', async () => {
    const deps = makeDeps();
    const claim = async (sessionId: string, lineSeq: number) =>
      bodyOf(
        await handleSessionFishRoutes(
          deps,
          input('POST', JSON.stringify({ sessionId, lineSeq }), 'session-fish/claim'),
        ),
      ).granted;
    assert.equal(await claim('s1', 5), true);
    assert.equal(await claim('s1', 6), true);
    assert.equal(await claim('s1', 5), false, '旧序号晚到不该再念一次');
    assert.equal(await claim('s1', 7), true);
    assert.equal(await claim('s2', 1), true, '会话之间各自独立');
  });

  test('形状非法 400：缺 sessionId / lineSeq 非正 / body 不是对象', async () => {
    const deps = makeDeps();
    const bad = async (body: string) =>
      bodyOf(await handleSessionFishRoutes(deps, input('POST', body, 'session-fish/claim'))).reason;
    assert.equal(await bad(JSON.stringify({ lineSeq: 1 })), 'bad-request');
    assert.equal(await bad(JSON.stringify({ sessionId: 's1' })), 'bad-request');
    assert.equal(await bad(JSON.stringify({ sessionId: 's1', lineSeq: 0 })), 'bad-request');
    assert.equal(await bad(JSON.stringify({ sessionId: 's1', lineSeq: 'x' })), 'bad-request');
    assert.equal(await bad('[]'), 'bad-request');
  });

  test('claim 只接受 POST', async () => {
    const deps = makeDeps();
    assert.equal(statusOf(await handleSessionFishRoutes(deps, input('GET', undefined, 'session-fish/claim'))), 405);
  });
});
