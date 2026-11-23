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
import { MAX_TEXT_LINES } from '../voice/gsv/voice-pack.ts';
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

/**
 * 一份 `count` 行的纯文本（没有 `|`，整行即参考文本；布局与 `readTextLines` 的输出同形）。
 *
 * 用**真文件**而不是解析桩：`max` 的语义就落在「读到哪里 break」这一行上，
 * 把读文件换成桩，等于把被测对象换成自己的假设。
 */
function textFixture(root: string, name: string, count: number): string {
  const file = join(root, name);
  put(file, Array.from({ length: count }, (_unused, offset) => `第${String(offset + 1)}行`).join('\n'));
  return file;
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

  // ── `max` 契约（client R1 的全部机制压在这三条上）─────────────────────────────
  // 客户端 `voice-import.ts` 请求 `max: LINE_ROW_LIMIT`（500），宿主据此突破 `MAX_TEXT_LINES`（200）；
  // 而客户端单测桩与 E2E 桩**都故意忽略 `max`**（它们覆盖的是「客户端渲染期防御切片」）。
  // 所以「请求多少、宿主给多少」这条隐式约定只在这里可执行：谁把 `readTextLines` 的 `max` 吃掉，
  // 或把 `Math.min(500, …)` 改回 200，这三条立刻红——用户侧症状正是「只能看到 200 行且没有截断提示」。

  test('max: 500 → 600 行文件给正好 500 行（这是突破宿主默认 200 的唯一途径）', async () => {
    const root = tempRoot();
    const file = textFixture(root, 'lines600.txt', 600);
    const result = await handleVoicePackRoutes(deps(root), input('voice/text-lines', 'POST', { path: file, max: 500 }));
    const lines = objOf(result).lines as Array<{ index: number; text: string }>;
    assert.equal(lines.length, 500, '请求 max=500 就必须给满 500 行；夹回 200 就是本轮要消灭的静默截断');
    assert.equal(lines[0]?.index, 1);
    assert.equal(lines[499]?.index, 500, '第 500 行要在（客户端要能点到它）');
    assert.equal(lines[499]?.text, '第500行', '返回的是文件里真实的那一行，不是补出来的空行');
    assert.equal(
      lines.some((line) => line.index > 500),
      false,
      '也不能多给：客户端用「拿满 LINE_ROW_LIMIT」判断「文件里可能还有更多」',
    );
  });

  test('不传 max → 回到宿主默认 200 行（其它调用方看到的行为不变）', async () => {
    const root = tempRoot();
    const file = textFixture(root, 'lines600.txt', 600);
    const result = await handleVoicePackRoutes(deps(root), input('voice/text-lines', 'POST', { path: file }));
    const lines = objOf(result).lines as Array<{ index: number }>;
    assert.equal(MAX_TEXT_LINES, 200, '宿主默认值是 200：这条数字变了，客户端 500 的判据就得跟着复核');
    assert.equal(lines.length, MAX_TEXT_LINES, '不传 max 必须落回 readTextLines 的默认参数');
    assert.equal(lines[199]?.index, 200);
  });

  test('max: 9999 → 按宿主 clamp 到 500（上界 500 是契约，不许悄悄抬高）', async () => {
    const root = tempRoot();
    const file = textFixture(root, 'lines600.txt', 600);
    const result = await handleVoicePackRoutes(
      deps(root),
      input('voice/text-lines', 'POST', { path: file, max: 9999 }),
    );
    const lines = objOf(result).lines as Array<{ index: number }>;
    // `routes/voice-pack.ts` 的 `Math.min(500, Math.max(1, trunc(max)))`：上限 500，读码确认。
    assert.equal(lines.length, 500, '超限请求按 500 夹：一次读盘的无界增长不能由调用方决定');
    assert.equal(lines[499]?.index, 500);
  });
});
