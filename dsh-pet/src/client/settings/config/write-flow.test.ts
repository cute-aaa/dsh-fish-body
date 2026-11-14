/**
 * 写路径编排（src/client/settings/config/write-flow.ts）的契约测试。
 *
 * 四条契约：
 *   1. `saveAll` 的顺序是「主配置 → 会话鱼」，两段都成功才报整包成功；
 *   2. 主配置成功、会话鱼失败时，基线只推进主配置那半（否则会话鱼的圆点会被误抹掉）；
 *   3. 「确定」要的是布尔结果：失败就不该关闭设置页；
 *   4. 重置走 `POST /config` + 会话鱼默认值；任一步失败都要如实降级。
 *
 * 每个用例都换掉 `globalThis.fetch`，结束时还原——不发真实请求。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_FONT } from '../../../shared/fonts.ts';
import { DEFAULT_HOTKEYS } from '../../../shared/hotkeys.ts';
import { DEFAULT_PHYSICS } from '../../../shared/physics.ts';
import type { SaveFields } from './http.ts';
import { createWriteFlow, type SavedScope, type WriteFlowDeps } from './write-flow.ts';

/** 一份能过校验的表单。 */
const fields: SaveFields = {
  pets: [
    {
      id: 'main',
      name: '鱼',
      size: 240,
      display: 'web',
      position: { corner: 'top-left', marginX: 0, marginY: 0 },
    } as never,
  ],
  hotkeys: DEFAULT_HOTKEYS,
  notificationsEnabled: true,
  sfxEnabled: true,
  sfxKeepAlive: true,
  sfxVolume: 0.5,
  sfx: {},
  whisperImageEnabled: false,
  chatImageEnabled: false,
  chatAnimationEnabled: true,
  confineToScreen: false,
  trayEnabled: true,
  voiceEnabled: false,
  voiceName: 'xiao',
  voiceVolume: 1,
  voiceWhisperEnabled: false,
  voiceTodoEnabled: false,
  voiceNotifyEnabled: false,
  speakStripEmoji: true,
  physics: { ...DEFAULT_PHYSICS },
  whisperModel: { provider: '', model: '' },
  chatModel: { provider: '', model: '' },
  chatMemoryRounds: 10,
  chatImageLimit: 20,
  font: { ...DEFAULT_FONT },
  animationWeights: { idle: 30, turn: 20, move: 20 },
};

/** 换掉全局 fetch，按路径与方法作答。 */
async function withFetch(
  handler: (url: string, method: string) => { status: number; body: unknown },
  run: () => Promise<void>,
): Promise<string[]> {
  const previous = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push(method + ' ' + url);
    const answer = handler(url, method);
    return Promise.resolve({
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body,
    } as Response);
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = previous;
  }
  return calls;
}

/** 一套记录型依赖。 */
function makeDeps(over: Partial<WriteFlowDeps> = {}) {
  const log: string[] = [];
  const scopes: SavedScope[] = [];
  const messages: string[] = [];
  let busy = false;
  const deps: WriteFlowDeps = {
    fields: () => fields,
    packWrites: () => [],
    busy: () => busy,
    setBusy: (value) => {
      busy = value;
    },
    // 只记有内容的结论：清空（空 kind + 空文案）是每个动作的第一步，不该进断言。
    setMsg: (feedback) => {
      if (feedback.text !== '') messages.push(feedback.kind + ':' + feedback.text);
    },
    setDialog: () => {},
    dialog: () => null,
    applyConfig: () => log.push('applyConfig'),
    userFile: () => '/tmp/main-config.jsonc',
    t: (key) => key,
    onRemove: () => log.push('remove'),
    saveFish: async () => {
      log.push('saveFish');
      return true;
    },
    resetFish: async () => {
      log.push('resetFish');
      return true;
    },
    onSaved: (scope) => scopes.push(scope),
    onRestore: () => log.push('restore'),
    ...over,
  };
  return { deps, log, scopes, messages, isBusy: () => busy };
}

describe('saveAll —— 主配置 + 会话鱼', () => {
  test('顺序：写主配置 → 写会话鱼 → 推进整包基线', async () => {
    const { deps, log, scopes } = makeDeps();
    const flow = createWriteFlow(deps);
    const calls = await withFetch(
      () => ({ status: 200, body: { main: { pets: fields.pets } } }),
      async () => {
        assert.equal(await flow.saveAll(), true);
      },
    );
    assert.deepEqual(log, ['saveFish']);
    assert.deepEqual(scopes, ['main', 'all']);
    // 保存成功后还会顺手重读一次通知（另一条 GET），这里只认配置那条 PUT。
    const writes = calls.filter((call) => call.startsWith('PUT '));
    assert.equal(writes.length, 1, '只该有一次 PUT /config');
    assert.ok(writes[0].endsWith('/config'), '写的是配置端点');
  });

  test('主配置写失败：不写会话鱼、不推进基线、返回 false（确定不关闭）', async () => {
    const { deps, log, scopes, messages } = makeDeps();
    const flow = createWriteFlow(deps);
    await withFetch(
      () => ({ status: 500, body: { ok: false } }),
      async () => {
        assert.equal(await flow.saveAll(), false);
      },
    );
    assert.deepEqual(log, []);
    assert.deepEqual(scopes, []);
    assert.deepEqual(messages, ['err:saveError']);
  });

  test('主配置成功、会话鱼失败：只推进主配置基线', async () => {
    const { deps, scopes } = makeDeps({ saveFish: async () => false });
    const flow = createWriteFlow(deps);
    await withFetch(
      () => ({ status: 200, body: { main: { pets: fields.pets } } }),
      async () => {
        assert.equal(await flow.saveAll(), false);
      },
    );
    assert.deepEqual(scopes, ['main']);
  });

  test('表单非法：一次请求都不发', async () => {
    const { deps, messages } = makeDeps({ fields: () => ({ ...fields, font: { ...DEFAULT_FONT, size: 0 } }) });
    const flow = createWriteFlow(deps);
    const calls = await withFetch(
      () => ({ status: 200, body: {} }),
      async () => {
        assert.equal(await flow.saveAll(), false);
      },
    );
    assert.deepEqual(calls, []);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /^err:/);
  });
});

describe('重置 —— POST /config + 会话鱼默认值', () => {
  test('确认后：写默认 → 回填表单 → 写会话鱼默认', async () => {
    const { deps, log, messages } = makeDeps({ dialog: () => ({ kind: 'reset' }) });
    const flow = createWriteFlow(deps);
    const calls = await withFetch(
      () => ({ status: 200, body: { main: { pets: fields.pets } } }),
      async () => {
        flow.requestReset();
        flow.confirmDialog();
        // confirmDialog 里是 void doReset()，等两拍让 await 链跑完。
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    );
    assert.deepEqual(log, ['applyConfig', 'resetFish']);
    assert.deepEqual(messages, ['ok:resetDone']);
    assert.equal(calls[0], 'POST ' + String(calls[0]).split(' ')[1], '首个请求是 POST');
    assert.match(calls[0], /^POST /);
    assert.match(calls[0], /\/config$/, '重置打的是 POST /config');
  });

  test('写默认失败：报错、不回填、不写会话鱼', async () => {
    const { deps, log, messages } = makeDeps({ dialog: () => ({ kind: 'reset' }) });
    const flow = createWriteFlow(deps);
    await withFetch(
      () => ({ status: 500, body: { ok: false } }),
      async () => {
        flow.confirmDialog();
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    );
    assert.deepEqual(log, []);
    assert.deepEqual(messages, ['err:resetError']);
  });

  test('会话鱼没写成功：主配置已恢复，提示部分成功', async () => {
    const { deps, messages } = makeDeps({ dialog: () => ({ kind: 'reset' }), resetFish: async () => false });
    const flow = createWriteFlow(deps);
    await withFetch(
      () => ({ status: 200, body: { main: { pets: fields.pets } } }),
      async () => {
        flow.confirmDialog();
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    );
    assert.deepEqual(messages, ['err:resetPartial']);
  });
});

describe('confirmDialog —— 派发', () => {
  test('没有弹窗时什么都不做', () => {
    const { deps, log } = makeDeps();
    createWriteFlow(deps).confirmDialog();
    assert.deepEqual(log, []);
  });

  test('删除走 onRemove，不碰配置请求', async () => {
    const { deps, log } = makeDeps({ dialog: () => ({ kind: 'remove' }) });
    const calls = await withFetch(
      () => ({ status: 200, body: {} }),
      async () => {
        createWriteFlow(deps).confirmDialog();
      },
    );
    assert.deepEqual(log, ['remove']);
    assert.deepEqual(calls, []);
  });
});
