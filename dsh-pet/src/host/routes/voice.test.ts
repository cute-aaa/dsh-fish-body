/**
 * 语音路由的契约测试（src/host/routes/voice.ts）。
 * 只断言协议层：方法判定、JSON 判定，以及把语音服务的结论映射成应答；不发真实请求。
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync as writeFile } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import type { PetRouteDeps } from './types.ts';
import { handleVoiceRoutes } from './voice.ts';
import { registerVoiceProvider, resetVoiceProviders } from '../voice/registry.ts';
import { userPaths } from '../user-layout.ts';

/** 临时目录登记表：每个用例结束时清掉。 */
const roots: string[] = [];

const VOICES = [{ id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', tag: '女 · 通用', default: true }];

/** 造最小依赖：只提供 voice 与 speech，其余字段这条路由不会碰。 */
function makeDeps(
  speak: (raw: unknown) => Promise<unknown>,
  hear: (raw: unknown, signal?: AbortSignal) => Promise<unknown> = async () => ({ ok: true, text: '你好' }),
): PetRouteDeps {
  return { voice: { listVoices: () => VOICES, speak }, speech: { hear } } as unknown as PetRouteDeps;
}

/** 造一次路由输入。 */
function input(rest: string, method: string, body?: string) {
  return { url: new URL(`http://127.0.0.1:1/dsh-pet-7340/${rest}`), rest, method, body };
}

test('GET /voice/voices：返回音色列表与 provider 状态（内置 edge 恒在）', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x.mp3' })),
    input('voice/voices', 'GET'),
  );
  assert.equal(result?.kind, 'json');
  if (result?.kind !== 'json') return;
  assert.equal(result.status, 200);
  assert.deepEqual((result.obj as { voices: unknown }).voices, VOICES);
  const providers = (result.obj as { providers: Array<{ id: string; builtin: boolean; available: boolean }> })
    .providers;
  assert.deepEqual(
    providers.map((p) => [p.id, p.builtin, p.available]),
    [['edge', true, true]],
    '没注册第三方时只剩内置一环',
  );
});

test('POST /voice/speak 成功：交回音频文件，Content-Type 跟着 mime', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/cache/a.wav', mime: 'audio/wav' })),
    input('voice/speak', 'POST', '{"text":"hi"}'),
  );
  assert.deepEqual(result, { kind: 'file', file: '/cache/a.wav', contentType: 'audio/wav' });
});

test('POST /voice/speak 业务失败：200 + 失败实体（不做成 4xx）', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: false, reason: 'bad-request', message: 'nope' })),
    input('voice/speak', 'POST', '{"text":""}'),
  );
  assert.equal(result?.kind, 'json');
  if (result?.kind !== 'json') return;
  assert.equal(result.status, 200);
  assert.equal((result.obj as { reason: string }).reason, 'bad-request');
});

test('POST /voice/speak 请求体不是 JSON：400', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x' })),
    input('voice/speak', 'POST', 'not json'),
  );
  assert.equal(result?.kind, 'json');
  if (result?.kind === 'json') assert.equal(result.status, 400);
});

test('POST /voice/hear 成功：返回识别文字', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x.mp3' })),
    input('voice/hear', 'POST', '{"audio":"AAAA"}'),
  );
  assert.equal(result?.kind, 'json');
  if (result?.kind !== 'json') return;
  assert.equal(result.status, 200);
  assert.deepEqual(result.obj, { ok: true, text: '你好' });
});

test('POST /voice/hear 业务失败：200 + 失败实体（与 /chat 同一口径）', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(
      async () => ({ ok: true, file: '/x.mp3' }),
      async () => ({
        ok: false,
        reason: 'unsupported',
        message: 'host has no speech provider enabled',
      }),
    ),
    input('voice/hear', 'POST', '{"audio":"AAAA"}'),
  );
  assert.equal(result?.kind, 'json');
  if (result?.kind !== 'json') return;
  assert.equal(result.status, 200);
  assert.equal((result.obj as { reason: string }).reason, 'unsupported');
});

test('POST /voice/hear 请求体不是 JSON：400', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x' })),
    input('voice/hear', 'POST', 'nope'),
  );
  assert.equal(result?.kind === 'json' ? result.status : 0, 400);
});

test('POST /voice/hear 把断开信号交给识别服务', async () => {
  let received: AbortSignal | undefined;
  const abort = new AbortController();
  await handleVoiceRoutes(
    makeDeps(
      async () => ({ ok: true, file: '/x.mp3' }),
      async (_raw, signal) => {
        received = signal;
        return { ok: true, text: '好' };
      },
    ),
    { ...input('voice/hear', 'POST', '{"audio":"AAAA"}'), signal: abort.signal },
  );
  assert.equal(received, abort.signal, '调用方断开时识别应能中止');
});

test('方法不对：三个端点都是 405', async () => {
  const speak = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x' })),
    input('voice/speak', 'GET'),
  );
  assert.equal(speak?.kind === 'json' ? speak.status : 0, 405);
  const voices = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x' })),
    input('voice/voices', 'POST'),
  );
  assert.equal(voices?.kind === 'json' ? voices.status : 0, 405);
  const hear = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x' })),
    input('voice/hear', 'GET'),
  );
  assert.equal(hear?.kind === 'json' ? hear.status : 0, 405);
});

test('不相干的路径：交回 undefined，让下一个处理器接手', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x' })),
    input('state', 'GET'),
  );
  assert.equal(result, undefined);
});

/** 临时数据根：接入配置写的是 `<userRoot>/config/voice-providers.json`。 */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-voicecfg-'));
  roots.push(root);
  return root;
}

/** 接入配置的落盘位置（新布局在 `config/` 下）；顺手把目录建出来，写文件才不会 ENOENT。 */
function providerFile(root: string): string {
  const file = userPaths(root).voiceProviders;
  mkdirSync(dirname(file), { recursive: true });
  return file;
}

/** 注册一个带 fields 的假实现，返回注销函数。 */
function registerGsvStub(): () => void {
  return registerVoiceProvider({
    id: 'gsv',
    name: 'GSV',
    fields: [
      { key: 'baseURL', label: '地址', kind: 'text' },
      { key: 'voicesDir', label: '音色目录', kind: 'text', required: true },
    ],
    listVoices: () => [{ id: 'vodyanitsa', name: 'vodyanitsa' }],
    activeVoice: () => 'vodyanitsa',
    synthesize: async () => ({ data: new Uint8Array([1]), mime: 'audio/wav' }),
  });
}

/** 带 userRoot 的依赖（接入配置路由要它）。 */
function providerDeps(userRoot: string): PetRouteDeps {
  return {
    voice: { listVoices: () => VOICES, speak: async () => ({ ok: true, file: '/x' }) },
    speech: { hear: async () => ({ ok: true, text: '' }) },
    userRoot,
  } as unknown as PetRouteDeps;
}

/** 接入配置的输入：query 进 url，`rest` 只留路径（与真实路由一致）。 */
function providerInput(rest: string, provider: string, method: string, body?: string) {
  const url = new URL(`http://127.0.0.1:1/dsh-pet-7340/${rest}?provider=${encodeURIComponent(provider)}`);
  return { url, rest, method, body };
}

describe('voice/provider-process —— 启停脚本', () => {
  afterEach(() => {
    resetVoiceProviders();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /** 调一次启停路由。 */
  const post = (body: unknown) =>
    handleVoiceRoutes(providerDeps(tempRoot()), input('voice/provider-process', 'POST', JSON.stringify(body)));

  test('没配启动脚本：bad-request 说清缺什么', async () => {
    const dispose = registerGsvStub();
    try {
      const result = await post({ provider: 'gsv', action: 'start' });
      assert.equal(result?.kind === 'json' ? result.status : 0, 200);
      const obj = (result as { obj: { ok: boolean; reason: string; message: string } }).obj;
      assert.equal(obj.ok, false);
      assert.equal(obj.reason, 'bad-request');
      assert.match(obj.message, /未配置脚本路径/);
    } finally {
      dispose();
    }
  });

  test('action 不合法 / 内置实现 / 未知实现：各自拒绝', async () => {
    const dispose = registerGsvStub();
    try {
      const badAction = await post({ provider: 'gsv', action: 'reboot' });
      assert.equal((badAction as { obj: { reason: string } }).obj.reason, 'bad-request');
      const builtin = await post({ provider: 'edge', action: 'start' });
      assert.equal((builtin as { obj: { reason: string } }).obj.reason, 'bad-request');
      const missing = await post({ provider: 'ghost', action: 'start' });
      assert.equal((missing as { obj: { reason: string } }).obj.reason, 'provider-missing');
    } finally {
      dispose();
    }
  });

  test('GET → 405', async () => {
    const dispose = registerGsvStub();
    try {
      const result = await handleVoiceRoutes(providerDeps(tempRoot()), input('voice/provider-process', 'GET'));
      assert.equal(result?.kind === 'json' ? result.status : 0, 405);
    } finally {
      dispose();
    }
  });

  test('没配停止脚本：走 api_v2 的 /control?command=exit，不让用户去写脚本', async () => {
    const dispose = registerGsvStub();
    const root = tempRoot();
    // 造一个只会回 200 的假 api_v2：记录被请求的路径。
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(String(req.url));
      res.writeHead(200).end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      await writeFile(providerFile(root), JSON.stringify({ gsv: { baseURL: `http://127.0.0.1:${port}` } }), 'utf8');
      const result = await handleVoiceRoutes(
        providerDeps(root),
        input('voice/provider-process', 'POST', JSON.stringify({ provider: 'gsv', action: 'stop' })),
      );
      const obj = (result as { obj: { ok: boolean; message?: string } }).obj;
      assert.equal(obj.ok, true);
      assert.match(obj.message ?? '', /自行退出/);
      assert.ok(seen.includes('/control?command=exit'), 'should call /control?command=exit: ' + seen.join(','));
    } finally {
      dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('voice/provider-config —— 接入配置读写', () => {
  afterEach(() => {
    resetVoiceProviders();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  test('GET：没有文件时给空串（不是 500，也不是编默认路径）', async () => {
    const dispose = registerGsvStub();
    try {
      const result = await handleVoiceRoutes(
        providerDeps(tempRoot()),
        providerInput('voice/provider-config', 'gsv', 'GET'),
      );
      assert.equal(result?.kind, 'json');
      if (result?.kind !== 'json') return;
      assert.deepEqual(result.obj, { ok: true, provider: 'gsv', values: { baseURL: '', voicesDir: '' } });
    } finally {
      dispose();
    }
  });

  test('POST：写盘并回新值，空串 = 删掉该键', async () => {
    const dispose = registerGsvStub();
    const root = tempRoot();
    try {
      const saved = await handleVoiceRoutes(
        providerDeps(root),
        providerInput(
          'voice/provider-config',
          'gsv',
          'POST',
          JSON.stringify({ provider: 'gsv', patch: { baseURL: 'http://127.0.0.1:9880', voicesDir: 'D:/v' } }),
        ),
      );
      assert.equal(saved?.kind === 'json' ? saved.status : 0, 200);
      const file = providerFile(root);
      assert.equal(JSON.parse(readFileSync(file, 'utf8')).gsv.voicesDir, 'D:/v');

      const cleared = await handleVoiceRoutes(
        providerDeps(root),
        providerInput(
          'voice/provider-config',
          'gsv',
          'POST',
          JSON.stringify({ provider: 'gsv', patch: { voicesDir: '' } }),
        ),
      );
      assert.deepEqual((cleared as { obj: { values: unknown } }).obj.values, {
        baseURL: 'http://127.0.0.1:9880',
        voicesDir: '',
      });
      assert.equal(JSON.parse(readFileSync(file, 'utf8')).gsv.voicesDir, undefined, '空串要删键，不写空值');
    } finally {
      dispose();
    }
  });

  test('POST 拒绝：未知键 / 非字符串 / baseURL 没有协议 / 空 patch', async () => {
    const dispose = registerGsvStub();
    const deps = providerDeps(tempRoot());
    try {
      for (const patch of [{ nope: 'x' }, { baseURL: 42 }, { baseURL: '127.0.0.1:9880' }, {}]) {
        const result = await handleVoiceRoutes(
          deps,
          providerInput('voice/provider-config', 'gsv', 'POST', JSON.stringify({ provider: 'gsv', patch })),
        );
        assert.equal(result?.kind === 'json' ? result.status : 0, 200, JSON.stringify(patch));
        assert.equal((result as { obj: { reason: string } }).obj.reason, 'bad-request', JSON.stringify(patch));
      }
    } finally {
      dispose();
    }
  });

  test('内置实现没有接入配置；不存在的实现回 provider-missing', async () => {
    const edge = await handleVoiceRoutes(
      providerDeps(tempRoot()),
      providerInput('voice/provider-config', 'edge', 'GET'),
    );
    assert.equal((edge as { obj: { reason: string } }).obj.reason, 'bad-request');
    const missing = await handleVoiceRoutes(
      providerDeps(tempRoot()),
      providerInput('voice/provider-config', 'ghost', 'GET'),
    );
    assert.equal((missing as { obj: { reason: string } }).obj.reason, 'provider-missing');
  });

  test('PUT 之类的方法：405', async () => {
    const dispose = registerGsvStub();
    try {
      const result = await handleVoiceRoutes(
        providerDeps(tempRoot()),
        providerInput('voice/provider-config', 'gsv', 'PUT', '{}'),
      );
      assert.equal(result?.kind === 'json' ? result.status : 0, 405);
    } finally {
      dispose();
    }
  });

  test('POST 的 provider 也可以只写在请求体里（设置页就是这么发的）', async () => {
    const dispose = registerGsvStub();
    const root = tempRoot();
    try {
      const result = await handleVoiceRoutes(providerDeps(root), {
        url: new URL('http://127.0.0.1:1/dsh-pet-7340/voice/provider-config'),
        rest: 'voice/provider-config',
        method: 'POST',
        body: JSON.stringify({ provider: 'gsv', patch: { baseURL: 'http://127.0.0.1:9999' } }),
      });
      assert.equal((result as { obj: { ok: boolean } }).obj.ok, true);
      assert.equal(JSON.parse(readFileSync(providerFile(root), 'utf8')).gsv.baseURL, 'http://127.0.0.1:9999');
    } finally {
      dispose();
    }
  });
});
