/**
 * 音效地址（src/client/pet/sfx.ts 的 sfxUrl）的契约：素材根、文件名、渲染方式、皮肤四段都在位。
 *
 * 重点盯 renderer：池的资源目录是 `<池>/<渲染方式>/<皮肤>/`，漏了这个参数，宿主按 webm 找，
 * 表现就是「索引里有名字、点击却没声音」（池里 layered 皮肤的音效一律 404）。
 * 只拼字符串，不发请求、不接 audio。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { sfxUrl } from './sfx.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { Pet } from '../../shared/types.ts';

/** 拼一只只带地址相关字段的宠物（其余字段与地址无关）。 */
function petOf(patch: Partial<Pet>): Pet {
  return { id: 'main', name: 'main', ...patch } as Pet;
}

describe('sfxUrl', () => {
  test('layered + 皮肤：renderer 与 model 都带在查询串上', () => {
    const url = sfxUrl(petOf({ model: 'feiyu-05', renderer: 'layered' }), 'manifest-click.wav');
    assert.equal(url, ROUTE_PATH + '/sound/main/manifest-click.wav?renderer=layered&model=feiyu-05');
  });

  test('没有皮肤也带 renderer（池的渲染方式兜底目录要靠它）', () => {
    const url = sfxUrl(petOf({ renderer: 'webm' }), 'click.wav');
    assert.equal(url, ROUTE_PATH + '/sound/main/click.wav?renderer=webm');
  });

  test('老配置没有 renderer 字段：按 webm 处理（与宿主缺省一致）', () => {
    const url = sfxUrl(petOf({}), 'click.wav');
    assert.ok(url.includes('renderer=webm'));
  });

  test('素材根来自 assetRoot，缺省回落到宠物 id', () => {
    assert.equal(
      sfxUrl(petOf({ assetRoot: 'beiluoye', renderer: 'layered' }), 'a.wav'),
      ROUTE_PATH + '/sound/beiluoye/a.wav?renderer=layered',
    );
    assert.equal(sfxUrl(petOf({ renderer: 'layered' }), 'a.wav'), ROUTE_PATH + '/sound/main/a.wav?renderer=layered');
  });

  test('文件名与皮肤都过 encodeURIComponent（中文素材名照常）', () => {
    const url = sfxUrl(petOf({ model: '皮肤 一', renderer: 'layered' }), '点击 回应.wav');
    assert.ok(url.includes(encodeURIComponent('点击 回应.wav')));
    assert.ok(url.includes('model=' + encodeURIComponent('皮肤 一')));
  });
});
