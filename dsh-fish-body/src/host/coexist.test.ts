/**
 * 共存的契约：检测只认硬证据、`auto` 不改行为、`body-only` 只停自动来源。
 *
 * 「只报告不擅自静音」是这一层的核心承诺——自动改行为会让用户以为宠物坏了，
 * 所以每条都要有测试盯着。
 * @module dsh-fish-body/src/host/coexist.test
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { CoexistStore, detectCoexistPartners } from './coexist.ts';

const ROOT = mkdtempSync(join(tmpdir(), 'coexist-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

let seq = 0;
/** 一组空的候选位置。 */
function layout(): { dshHome: string; home: string; appData: string } {
  seq += 1;
  const base = join(ROOT, 'case' + String(seq));
  const out = { dshHome: join(base, 'dsh'), home: join(base, 'home'), appData: join(base, 'appdata') };
  for (const dir of [out.dshHome, out.home, out.appData]) mkdirSync(dir, { recursive: true });
  return out;
}

describe('detectCoexistPartners —— 只认硬证据', () => {
  test('surfcore 有 pet/host.json 才算它在跑宠物宿主', () => {
    const l = layout();
    mkdirSync(join(l.dshHome, 'surfcore', 'pet'), { recursive: true });
    assert.deepEqual(detectCoexistPartners(l), [], '只有目录不算');
    writeFileSync(join(l.dshHome, 'surfcore', 'pet', 'host.json'), '{}', 'utf8');
    const partners = detectCoexistPartners(l);
    assert.equal(partners.length, 1);
    assert.equal(partners[0]?.id, 'surfcore');
    assert.equal(partners[0]?.risk, 'high');
    assert.equal(partners[0]?.evidence, 'surfcore/pet/host.json');
  });

  test('Coopanion 认工作区里的 PARTNER.md（含 memory/ 那一层）', () => {
    const l = layout();
    mkdirSync(join(l.dshHome, 'coopanion'), { recursive: true });
    assert.deepEqual(detectCoexistPartners(l), [], '空目录不算');
    writeFileSync(join(l.dshHome, 'coopanion', 'PARTNER.md'), '# 库\n', 'utf8');
    assert.equal(detectCoexistPartners(l)[0]?.id, 'coopanion');

    const l2 = layout();
    mkdirSync(join(l2.home, '.coopanion', 'memory'), { recursive: true });
    writeFileSync(join(l2.home, '.coopanion', 'memory', 'PARTNER.md'), '# 库\n', 'utf8');
    assert.equal(detectCoexistPartners(l2)[0]?.id, 'coopanion');
  });

  test('两个都在时按固定顺序返回，且都是 high（都有各自的宠物窗口/语音）', () => {
    const l = layout();
    mkdirSync(join(l.dshHome, 'surfcore', 'pet'), { recursive: true });
    writeFileSync(join(l.dshHome, 'surfcore', 'pet', 'host.json'), '{}', 'utf8');
    mkdirSync(join(l.dshHome, 'coopanion'), { recursive: true });
    writeFileSync(join(l.dshHome, 'coopanion', 'PARTNER.md'), '# 库\n', 'utf8');
    assert.deepEqual(
      detectCoexistPartners(l).map((item) => item.id),
      ['surfcore', 'coopanion'],
    );
  });

  test('都没有 → 空数组', () => {
    assert.deepEqual(detectCoexistPartners(layout()), []);
  });
});

describe('CoexistStore —— auto 不改行为', () => {
  const partners = [{ id: 'surfcore', label: 'x', evidence: 'y', risk: 'high' as const }];

  test('缺省 auto：检测结果可见，但周期碎碎念照跑', () => {
    const store = new CoexistStore(partners);
    const view = store.view();
    assert.equal(view.mode, 'auto');
    assert.equal(view.partners.length, 1);
    assert.equal(view.autoWhisperPaused, false, 'auto 不擅自静音');
    assert.equal(store.allowAutoWhisper(), true);
  });

  test('body-only：只停周期碎碎念', () => {
    const store = new CoexistStore(partners, 'body-only');
    assert.equal(store.allowAutoWhisper(), false);
    assert.equal(store.view().autoWhisperPaused, true);
  });

  test('full：即使检测到同伴也全功能照用', () => {
    const store = new CoexistStore(partners, 'full');
    assert.equal(store.allowAutoWhisper(), true);
  });

  test('set：同值返回 false，换值返回 true', () => {
    const store = new CoexistStore();
    assert.equal(store.set('body-only'), true);
    assert.equal(store.set('body-only'), false);
    assert.equal(store.set('auto'), true);
  });

  test('set 非法值抛 TypeError（路由层先收敛成 400）', () => {
    const store = new CoexistStore();
    assert.throws(() => store.set('quiet' as never), TypeError);
  });

  test('没有检测到同伴时也能切 body-only（用户可能就是想静音）', () => {
    const store = new CoexistStore([]);
    assert.equal(store.set('body-only'), true);
    assert.equal(store.allowAutoWhisper(), false);
  });
});
