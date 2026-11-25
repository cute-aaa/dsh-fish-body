/**
 * 作息提取器的契约：认哪些写法、不认哪些写法、以及「宁可漏判也不误判」的几条边界。
 *
 * 这些行为会直接驱动 `/rhythm` 让宠物真入睡，所以逐条钉住——抽错一条的代价是白天被强制睡觉，
 * 比漏一条严重得多。纯函数，不碰磁盘与时钟。
 * @module dsh-fish-body/src/host/schedule/extract.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { extractSchedule } from './extract.ts';

/** 把结果压成 `from-to:state` 便于断言（`source` 是排障字段，不参与比较）。 */
function pairsOf(text: string): string[] {
  return extractSchedule(text).map((entry) => entry.from + '-' + entry.to + ':' + entry.state);
}

describe('通道一：显式区间', () => {
  test('23:00 ~ 08:00 睡觉', () => {
    assert.deepEqual(pairsOf('作息：23:00 ~ 08:00 睡觉'), ['23:00-08:00:sleeping']);
  });

  test('23:00-08:00 睡（半角连字符）', () => {
    assert.deepEqual(pairsOf('23:00-08:00 睡'), ['23:00-08:00:sleeping']);
  });

  test('23:00 到 08:00', () => {
    assert.deepEqual(pairsOf('23:00 到 08:00'), ['23:00-08:00:sleeping']);
  });

  test('从 23:00 到次日 08:00（中间夹时段词）', () => {
    assert.deepEqual(pairsOf('从 23:00 到次日 08:00 都在睡'), ['23:00-08:00:sleeping']);
  });

  test('显式区间没有睡眠词也按入睡处理（这种写法只可能在说睡眠）', () => {
    assert.deepEqual(pairsOf('13:00-14:00'), ['13:00-14:00:sleeping']);
  });

  test('同日区间 12:30~13:30 也是合法时段', () => {
    assert.deepEqual(pairsOf('午休 12:30~13:30'), ['12:30-13:30:sleeping']);
  });
});

describe('通道二：两个时刻按方向配对', () => {
  test('23:00 睡觉，早上 08:00 起床', () => {
    assert.deepEqual(pairsOf('23:00 睡觉，早上 08:00 起床'), ['23:00-08:00:sleeping']);
  });

  test('语句中间用句号断开也能配对（间隔够近）', () => {
    assert.deepEqual(pairsOf('23:00 睡觉。早上 08:00 起床。'), ['23:00-08:00:sleeping']);
  });

  test('相距太远不配对，各自按单点推断', () => {
    const text = '23:00 睡觉' + '（中间隔了很多字'.repeat(4) + '）' + '08:00 起床';
    const pairs = pairsOf(text);
    assert.equal(pairs.includes('23:00-08:00:sleeping'), false, '不该跨长距离配对');
    assert.ok(pairs.length >= 1);
  });
});

describe('通道三：单点推断（7 小时是缺省值，不是从文本读出来的）', () => {
  test('只给入睡时刻 → from=它，to=+7 小时', () => {
    assert.deepEqual(pairsOf('23:00 必须睡'), ['23:00-06:00:sleeping']);
  });

  test('只给起床时刻 → to=它，from=-7 小时', () => {
    assert.deepEqual(pairsOf('早上 08:00 起床'), ['01:00-08:00:sleeping']);
  });

  test('单个字的「起」也认', () => {
    assert.deepEqual(pairsOf('08:00 起'), ['01:00-08:00:sleeping']);
  });

  test('白天的入睡点不跨午夜', () => {
    assert.deepEqual(pairsOf('14:00 睡午觉'), ['14:00-21:00:sleeping']);
  });

  test('「22:30 开始犯困，23:00 必须睡」两个点都命中，含 23:00 那条', () => {
    const pairs = pairsOf('22:30 开始犯困，23:00 必须睡');
    assert.ok(pairs.includes('23:00-06:00:sleeping'), '23:00 必须被抽到：' + pairs.join(' / '));
    assert.ok(pairs.includes('22:30-05:30:sleeping'), '22:30 也命中「困」，一并抽出');
  });
});

describe('不认的写法（误判成本高于漏判）', () => {
  test('中文数字时刻不认：十一点睡 → 空', () => {
    // 要认就得写一套中文数字解析；抽错会让宠物在白天被强制入睡，漏一条只是回到改之前
    assert.deepEqual(extractSchedule('十一点睡觉'), []);
  });

  test('中文数字**不带时段前缀**不认：十一点睡 → 空（11 点还是 23 点无从判断）', () => {
    assert.deepEqual(extractSchedule('十一点睡'), []);
  });

  test('中文数字带时段前缀 → 归一后认：晚上十一点睡，早上八点起', () => {
    const entries = extractSchedule('晚上十一点睡，早上八点起');
    assert.equal(entries.length, 1, '方向配对成一段');
    assert.equal(entries[0]?.from, '23:00');
    assert.equal(entries[0]?.to, '08:00');
    assert.equal(entries[0]?.state, 'sleeping');
  });

  test('只有时刻、附近没有睡眠词：23:00 加班 → 空', () => {
    assert.deepEqual(extractSchedule('23:00 加班'), []);
  });

  test('「一起」里的「起」不算起床：23:00 一起看电影 → 空', () => {
    assert.deepEqual(extractSchedule('23:00 一起看电影'), []);
  });

  test('完全没有时刻的作息描述不抽（早点睡 / 别熬夜）', () => {
    assert.deepEqual(extractSchedule('你要早点睡，别熬夜'), []);
  });
});

describe('校验与去重', () => {
  test('非法小时 25:00 丢弃', () => {
    assert.deepEqual(extractSchedule('25:00 睡觉'), []);
  });

  test('非法分钟 12:70 丢弃', () => {
    assert.deepEqual(extractSchedule('12:70 睡觉'), []);
  });

  test('一位小时补零：9:05 睡觉 → 09:05-16:05', () => {
    assert.deepEqual(pairsOf('9:05 睡觉'), ['09:05-16:05:sleeping']);
  });

  test('from === to 丢弃（无法区分零长度与整天）', () => {
    assert.deepEqual(extractSchedule('08:00-08:00 睡'), []);
  });

  test('完全相同的 from/to/state 只留一条', () => {
    const pairs = pairsOf('23:00-08:00 睡，23:00-08:00 睡觉');
    assert.deepEqual(pairs, ['23:00-08:00:sleeping']);
  });

  test('不同时段按出现顺序返回', () => {
    assert.deepEqual(pairsOf('23:00-08:00 睡，13:00-14:00 午睡'), ['23:00-08:00:sleeping', '13:00-14:00:sleeping']);
  });
});

describe('安全返回（不抛）', () => {
  test('空串 → 空数组', () => {
    assert.deepEqual(extractSchedule(''), []);
  });

  test('非字符串按「没有文本」处理，不抛', () => {
    assert.deepEqual(extractSchedule(undefined as unknown as string), []);
    assert.deepEqual(extractSchedule(null as unknown as string), []);
  });

  test('超过 64 KiB 直接返回空数组', () => {
    const huge = '23:00 睡觉 '.repeat(10_000);
    assert.ok(huge.length > 64 * 1024);
    assert.deepEqual(extractSchedule(huge), []);
  });
});
