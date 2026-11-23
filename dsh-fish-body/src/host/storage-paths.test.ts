/**
 * 安装形态推导（src/host/storage-paths.ts）的契约：从包路径反推 profile 名。
 *
 * 本模块现在只剩这一件事——数据根与缓存位置全部由 `host/user-layout` 的路径表给出，
 * 设置页不再需要任何「系统级缓存目录」的推导（那些目录已经搬进数据根）。
 * 反推不出来时给 `undefined`，由客户端退回占位符：宁可不给名字，也不猜错。
 *
 * 跑法：node --experimental-strip-types --test src/host/storage-paths.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { profileNameFrom } from './storage-paths.ts';

describe('profileNameFrom —— 卸载命令里的 profile 名', () => {
  test('从 <DSH_HOME>/profiles/<name>/node_modules/<pkg> 反推', () => {
    assert.equal(profileNameFrom("C:\\Users\\p'c\\.dsh\\profiles\\web\\node_modules\\dsh-pet"), 'web');
    assert.equal(profileNameFrom('C:\\Users\\u\\.dsh\\profiles\\web\\node_modules\\dsh-fish-body'), 'web');
    assert.equal(profileNameFrom('/home/u/.dsh/profiles/custom/node_modules/dsh-pet'), 'custom');
    // 末尾带分隔符也算同一种安装形态
    assert.equal(profileNameFrom('/home/u/.dsh/profiles/custom/node_modules/dsh-pet/'), 'custom');
  });

  test('反推不出来 → undefined（宁可退回占位符，也不猜一个错的）', () => {
    // 共享层：profiles/node_modules/<pkg> 少了一层 profile 名
    assert.equal(profileNameFrom('/dsh-home/profiles/node_modules/dsh-pet'), undefined);
    // link: 安装到别处
    assert.equal(profileNameFrom('/some/link/dsh-pet'), undefined);
    // 包目录更深一层（node_modules/<pkg>/lib）不是安装根
    assert.equal(profileNameFrom('/dsh-home/profiles/web/node_modules/dsh-pet/lib'), undefined);
    assert.equal(profileNameFrom(''), undefined);
  });
});
