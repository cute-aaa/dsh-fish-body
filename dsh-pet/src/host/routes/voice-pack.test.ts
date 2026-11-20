/**
 * `/voice/voice-pack` 与 `/voice/text-lines` 的契约测试。
 *
 * 钉四件事：`weights` 纯读且返回逐行候选、`plan` 零写入、`apply` 批量写盘且只 rescan 一次、
 * 非法方法/取值/实现一律拒绝（不要让设置页以为保存成功）。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import type { PetRouteDeps } from './types.ts';
import { handleVoicePackRoutes } from './voice-pack.ts';
import { registerVoiceProvider, resetVoiceProviders } from '../voice/registry.ts';
import { userPaths } from '../user-layout.ts';

const roots: string[] = [];

/** 临时数据根。 */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-vpack-'));
  roots.push(root);
  return root;
}

/** 写文件并建父目录。 */
function put(file: string, content: string | Uint8Array = 'weights'): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

afterEach(() => {
  resetVoiceProviders();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 造依赖：只有 userRoot 会被这条路由用到。 */
function deps(userRoot: string): PetRouteDeps {
  return { userRoot, optionalService: () => undefined } as unknown as PetRouteDeps;
}

/** 路由输入。 */
function input(rest: string, method: string, body?: unknown) {
  return {
    url: new URL(`http://127.0.0.1:1/dsh-pet-7340/${rest}`),
    rest,
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

/** 取 JSON 应答体。 */
function objOf(result: unknown): Record<string, unknown> {
  return (result as { obj: Record<string, unknown> }).obj;
}

/** 一套素材：仓库两侧权重 + 参考音频 + 已保存的 gsv 配置（只有一个音色包目录）。 */
interface Made {
  readonly repo: string;
  readonly ref: string;
  readonly voicesDir: string;
}

/** 造素材。 */
function writeConfig(root: string): Made {
  const repo = join(root, 'repo');
  put(join(repo, 'GPT_weights_v2', 'klee-gsv-e10.ckpt'));
  put(join(repo, 'SoVITS_weights_v2', 'klee-gsv_e8_s288.pth'));
  const ref = join(root, 'in', 'klee.wav');
  put(ref, new Uint8Array([0]));
  const voicesDir = join(root, 'voices');
  mkdirSync(voicesDir, { recursive: true });
  put(userPaths(root).voiceProviders, JSON.stringify({ gsv: { baseURL: 'http://127.0.0.1:9880', voicesDir } }));
  return { repo, ref, voicesDir };
}

/** 一条导入条目。 */
function itemOf(made: Made): Record<string, unknown> {
  return {
    weightPath: join(made.repo, 'GPT_weights_v2', 'klee-gsv-e10.ckpt'),
    counterpartPath: join(made.repo, 'SoVITS_weights_v2', 'klee-gsv_e8_s288.pth'),
    refAudioPath: made.ref,
    refText: '甲',
    id: 'klee',
    placement: 'copy',
    overwrite: false,
  };
}

/** 注册一个带 rescan 计数的假实现。 */
function registerStub(): { rescans: () => number; dispose: () => void } {
  let count = 0;
  const dispose = registerVoiceProvider({
    id: 'gsv',
    name: 'GSV',
    rescan: async () => {
      count += 1;
      return true;
    },
    synthesize: async () => ({ data: new Uint8Array([1]), mime: 'audio/wav' }),
  });
  return { rescans: () => count, dispose };
}

describe('voice/voice-pack', () => {
  test('weights：只读取候选，不建任何目录', async () => {
    const root = tempRoot();
    const made = writeConfig(root);
    const stub = registerStub();
    try {
      const result = await handleVoicePackRoutes(
        deps(root),
        input('voice/voice-pack', 'POST', { provider: 'gsv', mode: 'weights', root: made.repo }),
      );
      assert.equal((result as { status: number }).status, 200);
      const scan = objOf(result).scan as {
        voicesDir: string;
        gptDirs: string[];
        sovitsDirs: string[];
        candidates: Array<{ id: string; gptPath?: string; linkable: boolean; installed: boolean }>;
      };
      assert.equal(scan.voicesDir.replace(/\\/g, '/'), made.voicesDir.replace(/\\/g, '/'));
      assert.equal(scan.gptDirs.length, 1);
      assert.equal(scan.sovitsDirs.length, 1);
      assert.equal(scan.candidates[0]?.id, 'klee');
      assert.match(String(scan.candidates[0]?.gptPath), /klee-gsv-e10\.ckpt$/);
      assert.equal(scan.candidates[0]?.installed, false);
      assert.equal(existsSync(join(made.voicesDir, 'klee')), false, 'weights 不能写盘');
      assert.equal(stub.rescans(), 0, 'weights 不需要重扫');
    } finally {
      stub.dispose();
    }
  });

  test('plan：零写入，返回预检与逐条错误', async () => {
    const root = tempRoot();
    const made = writeConfig(root);
    const stub = registerStub();
    try {
      const result = await handleVoicePackRoutes(
        deps(root),
        input('voice/voice-pack', 'POST', {
          provider: 'gsv',
          mode: 'plan',
          items: [itemOf(made), { ...itemOf(made), refAudioPath: '' }],
        }),
      );
      const obj = objOf(result);
      assert.equal(obj.ok, true);
      const previews = obj.previews as Array<{ id: string; pending: boolean } | null>;
      assert.equal(previews[0]?.id, 'klee');
      assert.equal(previews[0]?.pending, true);
      assert.equal(previews[1], null);
      const errors = obj.errors as Array<{ index: number; message: string }>;
      assert.equal(errors.length, 1);
      assert.equal(errors[0]?.index, 1);
      assert.match(errors[0]?.message ?? '', /参考音频/);
      assert.equal(existsSync(join(made.voicesDir, 'klee')), false, 'plan 不能写盘');
    } finally {
      stub.dispose();
    }
  });

  test('apply：批量写盘，只 rescan 一次，回 providers', async () => {
    const root = tempRoot();
    const made = writeConfig(root);
    const stub = registerStub();
    try {
      const result = await handleVoicePackRoutes(
        deps(root),
        input('voice/voice-pack', 'POST', { provider: 'gsv', mode: 'apply', items: [itemOf(made)] }),
      );
      const obj = objOf(result);
      assert.equal(obj.ok, true);
      const results = obj.results as Array<{ status: string; placed: string[] } | null>;
      assert.equal(results[0]?.status, 'written');
      assert.equal(results[0]?.placed.length, 2);
      assert.ok(existsSync(join(made.voicesDir, 'klee', 'ref.wav')));
      assert.ok(existsSync(join(made.voicesDir, 'klee', 'klee-gsv-e10.ckpt')));
      assert.equal((obj.providers as Array<{ id: string }>)[0]?.id, 'gsv');
      assert.equal(stub.rescans(), 1, '整批只重扫一次');
    } finally {
      stub.dispose();
    }
  });

  test('拒绝：mode 非法 / items 不合法 / root 没权重 / 非 gsv / 非 POST', async () => {
    const root = tempRoot();
    const made = writeConfig(root);
    const stub = registerStub();
    try {
      const badMode = await handleVoicePackRoutes(
        deps(root),
        input('voice/voice-pack', 'POST', { provider: 'gsv', mode: 'scan' }),
      );
      assert.equal(objOf(badMode).reason, 'bad-request');
      assert.match(String(objOf(badMode).message), /weights、plan 或 apply/);

      const noItems = await handleVoicePackRoutes(
        deps(root),
        input('voice/voice-pack', 'POST', { provider: 'gsv', mode: 'plan' }),
      );
      assert.equal(objOf(noItems).reason, 'bad-request');

      const emptyItems = await handleVoicePackRoutes(
        deps(root),
        input('voice/voice-pack', 'POST', { provider: 'gsv', mode: 'plan', items: [] }),
      );
      assert.equal(objOf(emptyItems).reason, 'bad-request');

      const tooMany = await handleVoicePackRoutes(
        deps(root),
        input('voice/voice-pack', 'POST', {
          provider: 'gsv',
          mode: 'plan',
          items: Array.from({ length: 51 }, () => itemOf(made)),
        }),
      );
      assert.equal(objOf(tooMany).reason, 'bad-request');
      assert.match(String(objOf(tooMany).message), /最多导入 50/);

      const badPlacement = await handleVoicePackRoutes(
        deps(root),
        input('voice/voice-pack', 'POST', {
          provider: 'gsv',
          mode: 'plan',
          items: [{ ...itemOf(made), placement: 'pointer' }],
        }),
      );
      assert.equal(objOf(badPlacement).reason, 'bad-request');

      const emptyDir = join(root, 'empty');
      mkdirSync(emptyDir, { recursive: true });
      const noWeights = await handleVoicePackRoutes(
        deps(root),
        input('voice/voice-pack', 'POST', { provider: 'gsv', mode: 'weights', root: emptyDir }),
      );
      assert.equal(objOf(noWeights).reason, 'bad-request');

      const cloud = await handleVoicePackRoutes(
        deps(root),
        input('voice/voice-pack', 'POST', { provider: 'cloud', mode: 'weights', root: made.repo }),
      );
      assert.equal(objOf(cloud).reason, 'bad-request');

      const wrongMethod = await handleVoicePackRoutes(deps(root), input('voice/voice-pack', 'GET'));
      assert.equal((wrongMethod as { status: number }).status, 405);
    } finally {
      stub.dispose();
    }
  });
});

describe('voice/text-lines', () => {
  test('读 .list 返回第 4 列；坏路径回 bad-request', async () => {
    const root = tempRoot();
    const list = join(root, 'x.list');
    put(list, 'a.wav|klee|ZH|第一句\nb.wav|klee|ZH|含|竖线\n');
    const ok = await handleVoicePackRoutes(deps(root), input('voice/text-lines', 'POST', { path: list }));
    const obj = objOf(ok);
    assert.deepEqual(
      (obj.lines as Array<{ text: string }>).map((line) => line.text),
      ['第一句', '含|竖线'],
    );
    const missing = await handleVoicePackRoutes(
      deps(root),
      input('voice/text-lines', 'POST', { path: join(root, 'nope.txt') }),
    );
    assert.equal(objOf(missing).reason, 'bad-request');
    const noPath = await handleVoicePackRoutes(deps(root), input('voice/text-lines', 'POST', {}));
    assert.equal(objOf(noPath).reason, 'bad-request');
  });
});
