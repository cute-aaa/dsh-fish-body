/**
 * `/screen/*` 四个端点的契约（src/host/routes/screen.ts）。
 *
 * 这里钉住的是「谁决定拍不拍」——节奏与门禁全在宿主，Helper 只问一句、交一帧。
 * 所以测试都从路由出发：开关关着不拍、手动请求只消费一次、黑图/坏图不收、
 * 调试图只在 `?debug=1` 时才落盘。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, test } from 'node:test';

import { handleScreenRoutes } from './screen.ts';
import { markAgentActivity, resetAgentActivity } from '../agent-activity.ts';
import { screenState } from '../screen/state.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';

/** 一帧合法 JPEG 的最小 base64（内容不重要，路由只校验形状与 base64 规范）。 */
const FRAME_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]).toString('base64');

/** 造依赖：requirePet 恒命中，条目配置由调用方给；附件服务 / 模型 / 锁都是可控的假实现。 */
function harness(conf: Record<string, unknown>, opts: { userRoot?: string; reply?: string; locked?: boolean } = {}) {
  const userRoot = opts.userRoot ?? mkdtempSync(join(tmpdir(), 'dsh-pet-screen-'));
  const says: { petId: string; data: Record<string, unknown> }[] = [];
  const saved: unknown[] = [];
  const deps = {
    requirePet: () => ({ ok: true, petId: 'main', entry: 'main', conf, pet: { id: 'main', name: '鱼生' } }),
    userRoot,
    lockBlocked: () =>
      opts.locked === true ? { kind: 'json', status: 200, obj: { ok: false, reason: 'locked' } } : null,
    state: { writePet: (petId: string, _leaf: string, data: Record<string, unknown>) => says.push({ petId, data }) },
    log: { warn: () => {} },
    optionalService: (name: string) =>
      name === 'attachments'
        ? {
            saveImages: async (inputs: { mediaType: string; data: Uint8Array }[]) => {
              saved.push(...inputs);
              return inputs.map((item, i) => ({
                attachmentId: 'att-' + i,
                mediaType: item.mediaType,
                bytes: item.data.byteLength,
                width: 1280,
                height: 720,
              }));
            },
          }
        : undefined,
    ctx: {
      agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
      llm: {
        resolveModelInfo: async () => ({}),
        stream: () =>
          (async function* () {
            yield { type: 'text-delta', index: 0, text: opts.reply ?? '屏幕上有编辑器' };
          })(),
      },
    },
  } as unknown as PetRouteDeps;
  const call = (rest: string, method: string, query = '?pet=main', body?: string) =>
    handleScreenRoutes(deps, {
      url: new URL('http://127.0.0.1/dsh-pet-7340/' + rest + query),
      rest,
      method,
      body,
    } as RouteInput);
  return { call, userRoot, says, saved };
}

/** 取 JSON 应答体（非 JSON 应答给空对象，测试里读不到字段就等于失败）。 */
function bodyOf(result: RouteResult | undefined): Record<string, unknown> {
  if (!result || result.kind !== 'json') return {};
  return (result.obj ?? {}) as Record<string, unknown>;
}

/** 取协议状态码（json / text 两种应答才有；file 与「不处理」应答不参与这里的断言）。 */
function statusOf(result: RouteResult | undefined): number | undefined {
  if (!result) return undefined;
  return result.kind === 'json' || result.kind === 'text' ? result.status : undefined;
}

beforeEach(() => {
  screenState.reset();
  resetAgentActivity();
});

describe('handleScreenRoutes —— /screen/tick', () => {
  test('开关关着：不拍，原因 disabled', async () => {
    const { call } = harness({});
    const body = bodyOf(await call('screen/tick', 'GET'));
    assert.equal(body.ok, true);
    assert.equal(body.capture, false);
    assert.equal(body.reason, 'disabled');
  });

  test('开着且空闲：拍；刚说完话（事件在阈值内）则不拍', async () => {
    const conf = { screenReadEnabled: true, screenReadIdleSec: 30 };
    const first = bodyOf(await harness(conf).call('screen/tick', 'GET'));
    assert.equal(first.capture, true);
    assert.equal(first.reason, 'ready');

    // 记一次活动后立刻再问：空闲阈值没到 → busy
    markAgentActivity();
    const busyBody = bodyOf(await harness(conf).call('screen/tick', 'GET'));
    assert.equal(busyBody.capture, false);
    assert.equal(busyBody.reason, 'busy');
  });

  test('手动请求：优先于间隔，且只消费一次', async () => {
    const conf = { screenReadEnabled: true, screenReadIntervalSec: 3600 };
    const { call } = harness(conf);
    // 先手工把间隔记满，让「自动」这条路被挡住
    screenState.noteCaptured(Date.now());
    assert.equal(bodyOf(await call('screen/tick', 'GET')).reason, 'throttled');

    assert.equal(bodyOf(await call('screen/request', 'POST')).ok, true);
    const manual = bodyOf(await call('screen/tick', 'GET'));
    assert.equal(manual.capture, true);
    assert.equal(manual.reason, 'manual');
    // 取到即清：下一拍又回到被间隔挡住
    assert.equal(bodyOf(await call('screen/tick', 'GET')).reason, 'throttled');
  });
});

describe('handleScreenRoutes —— /screen/request', () => {
  test('开关关着：unsupported（按钮该置灰，不必等下一拍才发现没反应）', async () => {
    const result = await harness({}).call('screen/request', 'POST');
    assert.equal(statusOf(result), 200);
    assert.equal(bodyOf(result).reason, 'unsupported');
  });

  test('开着：记一个待处理请求', async () => {
    const body = bodyOf(await harness({ screenReadEnabled: true }).call('screen/request', 'POST'));
    assert.equal(body.ok, true);
    assert.equal(body.pending, true);
    assert.equal(screenState.manualPending(), true);
  });
});

describe('handleScreenRoutes —— /screen/frame', () => {
  test('开关关着：unsupported，且不记账', async () => {
    const { call } = harness({});
    const result = await call('screen/frame', 'POST', '?pet=main', JSON.stringify({ attachment: {} }));
    assert.equal(bodyOf(result).reason, 'unsupported');
  });

  test('坏附件：bad-request', async () => {
    const { call } = harness({ screenReadEnabled: true });
    const bad = await call(
      'screen/frame',
      'POST',
      '?pet=main',
      JSON.stringify({ attachment: { mediaType: 'x', data: '' } }),
    );
    assert.equal(bodyOf(bad).reason, 'bad-request');
    const notJson = await call('screen/frame', 'POST', '?pet=main', '{oops');
    assert.equal(statusOf(notJson), 400);
  });

  test('正常帧：回文本与字节数，帧进附件服务，结果写进说话气泡', async () => {
    const { call, userRoot, says, saved } = harness({ screenReadEnabled: true }, { reply: '在看编辑器' });
    const result = await call(
      'screen/frame',
      'POST',
      '?pet=main',
      JSON.stringify({ attachment: { mediaType: 'image/jpeg', data: FRAME_B64 } }),
    );
    const body = bodyOf(result);
    assert.equal(body.ok, true);
    assert.equal(body.text, '在看编辑器');
    assert.equal(body.bytes, 6);
    assert.equal(body.mediaType, 'image/jpeg');
    assert.ok(screenState.snapshot().lastMs > 0);
    // 帧交给附件服务（与对话配图同一套存储），不额外落盘
    assert.equal(saved.length, 1);
    assert.equal(existsSync(join(userRoot, 'screen-frame.jpg')), false);
    // 一句话写进 say 叶子：只出气泡、不念（没有 voiceTo）
    assert.equal(says.length, 1);
    assert.equal(says[0]?.petId, 'main');
    assert.equal(says[0]?.data.text, '在看编辑器');
    assert.equal(says[0]?.data.anim, true);
    assert.equal('voiceTo' in (says[0]?.data ?? {}), false);
  });

  test('持锁时不读图、不写气泡（先门禁后花钱）', async () => {
    const { call, says } = harness({ screenReadEnabled: true }, { locked: true });
    const body = bodyOf(
      await call(
        'screen/frame',
        'POST',
        '?pet=main',
        JSON.stringify({ attachment: { mediaType: 'image/jpeg', data: FRAME_B64 } }),
      ),
    );
    assert.equal(body.reason, 'locked');
    assert.equal(says.length, 0);
  });

  test('?debug=1：把这一帧写到用户根（只为验证 4K/150% 是不是黑图）', async () => {
    const { call, userRoot } = harness({ screenReadEnabled: true });
    const body = bodyOf(
      await call(
        'screen/frame',
        'POST',
        '?pet=main&debug=1',
        JSON.stringify({ attachment: { mediaType: 'image/jpeg', data: FRAME_B64 } }),
      ),
    );
    assert.equal(body.debugFile, 'screen-frame.jpg');
    const written = readFileSync(join(userRoot, 'screen-frame.jpg'));
    assert.equal(written.length, 6);
  });
});

describe('handleScreenRoutes —— /screen/state 与领域边界', () => {
  test('回快照与归一化后的配置', async () => {
    const body = bodyOf(await harness({ screenReadEnabled: true, avoidDelayMs: 99999 }).call('screen/state', 'GET'));
    assert.equal(body.ok, true);
    assert.equal(body.petId, 'main');
    const screen = body.screen as Record<string, unknown>;
    assert.equal(screen.readEnabled, true);
    // 运行期是夹取：99999 落到上限
    assert.equal(screen.avoidDelayMs, 10000);
    assert.equal(body.manualPending, false);
  });

  test('不属于本领域 → undefined（交给后面的处理器）', async () => {
    const { call } = harness({});
    assert.equal(await call('voice', 'GET'), undefined);
  });

  test('方法不对 → 405', async () => {
    const { call } = harness({ screenReadEnabled: true });
    assert.equal(statusOf(await call('screen/tick', 'POST')), 405);
    assert.equal(statusOf(await call('screen/request', 'GET')), 405);
  });
});
