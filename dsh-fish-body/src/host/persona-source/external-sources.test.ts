/**
 * 两个外部项目来源的契约：surfcore 靠 `character.json` 自述路径，Coopanion 靠候选工作区里的 `PARTNER.md`。
 *
 * 它们的共同点是「格式我们不用猜」——surfcore 把文件名写在元数据里，Coopanion 的主文件名字是常量。
 * 所以这里钉的是**定位逻辑**与**不该读什么**（比如 surfcore 的 `purpose-outreach.json` 是它自己的调度）。
 * @module dsh-fish-body/src/host/persona-source/external-sources.test
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createCoopanionSource } from './coopanion-source.ts';
import { createSurfcoreSource } from './surfcore-source.ts';

const ROOT = mkdtempSync(join(tmpdir(), 'external-sources-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

let seq = 0;
/** 每个用例一个干净的 DSH 根。 */
function dshRoot(): string {
  seq += 1;
  const dir = join(ROOT, 'case' + String(seq));
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('surfcore —— 靠 character.json 的自述路径', () => {
  /** 造一份真实形态的角色目录。 */
  function seed(dshHome: string, opts: { personaName?: string; withCurrent?: boolean } = {}): string {
    const charDir = join(dshHome, 'surfcore', 'characters', 'char-abc');
    mkdirSync(charDir, { recursive: true });
    writeFileSync(
      join(charDir, 'character.json'),
      JSON.stringify({
        version: 1,
        id: 'char-abc',
        name: '傲娇助手',
        persona: opts.personaName ?? 'persona.md',
      }),
      'utf8',
    );
    writeFileSync(
      join(charDir, opts.personaName ?? 'persona.md'),
      '# 傲娇助手\n\n- 性格：傲娇、嘴硬心软\n- 说话风格：简短、带点小脾气\n',
      'utf8',
    );
    if (opts.withCurrent !== false) {
      writeFileSync(
        join(dshHome, 'surfcore', 'characters', 'current.json'),
        JSON.stringify({ version: 1, id: 'char-abc', dir: charDir, name: '傲娇助手' }),
        'utf8',
      );
    }
    return charDir;
  }

  test('probe：current.json + character.json + 人设文件齐了才算装了', async () => {
    const dshHome = dshRoot();
    seed(dshHome);
    const source = createSurfcoreSource({ dshHome });
    const probe = await source.probe?.();
    assert.equal(probe?.installed, true);
    assert.ok(probe?.path.endsWith('persona.md'));
  });

  test('scan：1 个角色，名字用 character.json 的 name，正文是 Markdown 的人设', async () => {
    const dshHome = dshRoot();
    const charDir = seed(dshHome);
    const source = createSurfcoreSource({ dshHome });
    const result = await source.scan?.();
    assert.equal(result?.characters.length, 1);
    assert.equal(result?.characters[0]?.name, '傲娇助手');
    assert.equal(result?.characters[0]?.path, join(charDir, 'persona.md'));
    assert.ok(result?.characters[0]?.text.includes('傲娇、嘴硬心软'));
    assert.deepEqual(result?.skipped, []);
  });

  test('自述路径改了（persona: "custom.md"）也读得到——不靠猜文件名', async () => {
    const dshHome = dshRoot();
    seed(dshHome, { personaName: 'custom.md' });
    const source = createSurfcoreSource({ dshHome });
    const result = await source.scan?.();
    assert.equal(result?.characters.length, 1);
    assert.ok(result?.characters[0]?.path.endsWith('custom.md'));
  });

  test('缺 current.json → 未安装（不按目录名猜当前角色）', async () => {
    const dshHome = dshRoot();
    seed(dshHome, { withCurrent: false });
    const source = createSurfcoreSource({ dshHome });
    assert.equal((await source.probe?.())?.installed, false);
    assert.deepEqual(await source.scan?.(), { characters: [], skipped: [] });
  });

  test('resolve：回正文与声明名', async () => {
    const dshHome = dshRoot();
    seed(dshHome);
    const source = createSurfcoreSource({ dshHome });
    const resolved = await source.resolve();
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.name, '傲娇助手');
      assert.ok(resolved.text.includes('傲娇'));
    }
  });

  test('不读 purpose-outreach.json（那是它自己的主动开口调度）', async () => {
    const dshHome = dshRoot();
    const charDir = seed(dshHome);
    writeFileSync(
      join(charDir, 'purpose-outreach.json'),
      JSON.stringify({ nextFireAt: 1, drives: { play: 0.2 } }),
      'utf8',
    );
    const source = createSurfcoreSource({ dshHome });
    const result = await source.scan?.();
    assert.equal(result?.characters.length, 1);
    assert.equal(result?.characters[0]?.text.includes('nextFireAt'), false);
    assert.equal(result?.characters[0]?.text.includes('drives'), false);
  });
});

describe('Coopanion —— 候选工作区里的 PARTNER.md', () => {
  /** 在某个候选根下放 PARTNER.md。 */
  function seed(root: string, withPartnerDir = false): void {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'PARTNER.md'), '# 库\n\n- 性格：好奇、有点懒\n- 口头禅：句尾带一个「库...」\n', 'utf8');
    if (withPartnerDir) {
      mkdirSync(join(root, 'partner'), { recursive: true });
      writeFileSync(join(root, 'partner', 'food.md'), '爱吃甜的，不吃香菜。\n', 'utf8');
    }
  }

  /** 造一组空的候选位置。 */
  function layout(): { dshHome: string; home: string; appData: string } {
    const base = dshRoot();
    return { dshHome: join(base, 'dsh'), home: join(base, 'home'), appData: join(base, 'appdata') };
  }

  test('命中 <DSH_HOME>/coopanion/PARTNER.md', async () => {
    const l = layout();
    seed(join(l.dshHome, 'coopanion'));
    const source = createCoopanionSource(l);
    assert.equal((await source.probe?.())?.installed, true);
    const result = await source.scan?.();
    assert.equal(result?.characters.length, 1);
    assert.ok(result?.characters[0]?.text.includes('句尾带一个「库'));
  });

  test('也认 <home>/.coopanion 与 %APPDATA%/Coopanion', async () => {
    for (const pick of ['home', 'appData'] as const) {
      const l = layout();
      const root = pick === 'home' ? join(l.home, '.coopanion') : join(l.appData, 'Coopanion');
      seed(root);
      const source = createCoopanionSource(l);
      assert.equal((await source.probe?.())?.installed, true, pick);
      assert.equal((await source.scan?.())?.characters.length, 1, pick);
    }
  });

  test('主文件在 workspace/memory/ 下也认（它的工作区就是 memoryDir）', async () => {
    const l = layout();
    seed(join(l.dshHome, 'coopanion', 'memory'));
    const source = createCoopanionSource(l);
    assert.equal((await source.probe?.())?.installed, true);
  });

  test('partner/*.md 并进「关于主人」段，不覆盖主文件', async () => {
    const l = layout();
    seed(join(l.dshHome, 'coopanion'), true);
    const source = createCoopanionSource(l);
    const text = (await source.scan?.())?.characters[0]?.text ?? '';
    assert.ok(text.includes('好奇、有点懒'), '主文件在');
    assert.ok(text.includes('关于主人：爱吃甜的'), 'partner/ 折成关于主人');
  });

  test('所有候选都没有 → 未安装，且给出期望路径', async () => {
    const l = layout();
    const source = createCoopanionSource(l);
    const probe = await source.probe?.();
    assert.equal(probe?.installed, false);
    assert.ok(probe?.path.endsWith(join('coopanion', 'PARTNER.md')));
    assert.deepEqual(await source.scan?.(), { characters: [], skipped: [] });
  });

  test('只有目录没有 PARTNER.md 不算装了（避免「已安装但空」）', async () => {
    const l = layout();
    mkdirSync(join(l.dshHome, 'coopanion'), { recursive: true });
    const source = createCoopanionSource(l);
    assert.equal((await source.probe?.())?.installed, false);
  });
});
