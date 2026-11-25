/**
 * 桌宠位置记忆（`runtime/electron-helper/sprite/position-store.js`）的单测。
 *
 * 这条链要护住的是两个互相拉扯的需求，缺一个都会被用户当成 bug：
 * 1. **换皮肤 / 重启 Helper 不能把人摆的位置挪走**（桌面端切渲染方式走的就是重启）；
 * 2. **改角落 / 边距必须立刻生效**（那是明确的「放这里」），所以记录带位置配置签名，签名变了就不认旧坐标。
 *
 * 顺带把「存储坏了怎么办」钉住：读坏、写满、被禁用时一律降级成「这次没记住」，绝不让宠物起不来。
 * 跑法：node --test scripts/tests/pet-position-store.test.mjs（npm run test:ui 会带上）
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  positionKeyOf,
  readPetPosition,
  signatureOf,
  writePetPosition,
  clearPetPosition,
} = require('../../runtime/electron-helper/sprite/position-store.js');

/** 内存版 Storage：只为这几条用例存在，不模拟配额。 */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    get size() {
      return map.size;
    },
    raw: (key) => map.get(key),
  };
}

const SIG = signatureOf({ corner: 'top-right', marginX: 24, marginY: 100 });

describe('签名：位置配置一变，旧坐标立即失效', () => {
  test('同一份 position 得到同一个签名', () => {
    assert.equal(signatureOf({ corner: 'top-right', marginX: 24, marginY: 100 }), SIG);
  });

  test('角落 / 边距任一不同 → 签名不同', () => {
    assert.notEqual(signatureOf({ corner: 'bottom-left', marginX: 24, marginY: 100 }), SIG);
    assert.notEqual(signatureOf({ corner: 'top-right', marginX: 25, marginY: 100 }), SIG);
    assert.notEqual(signatureOf({ corner: 'top-right', marginX: 24, marginY: 101 }), SIG);
  });

  test('缺字段 / 非对象 → 空签名（永远匹配不上记录）', () => {
    assert.equal(signatureOf(undefined), '');
    assert.equal(signatureOf(null), '');
    assert.equal(signatureOf({ marginX: 1, marginY: 2 }), '');
    assert.equal(signatureOf({ corner: 'top-right' }), '');
  });
});

describe('读写：换皮肤重启后位置还在', () => {
  test('写进去再读出来，坐标一致', () => {
    const storage = memoryStorage();
    assert.equal(writePetPosition(storage, 'main', { rx: 0.42, ry: 0.61 }, SIG), true);
    assert.deepEqual(readPetPosition(storage, 'main', SIG), { rx: 0.42, ry: 0.61 });
  });

  test('每只宠物各记各的（同一 localStorage 下互不覆盖）', () => {
    const storage = memoryStorage();
    writePetPosition(storage, 'main', { rx: 0.1, ry: 0.2 }, SIG);
    writePetPosition(storage, 'fish2', { rx: 0.8, ry: 0.9 }, SIG);
    assert.deepEqual(readPetPosition(storage, 'main', SIG), { rx: 0.1, ry: 0.2 });
    assert.deepEqual(readPetPosition(storage, 'fish2', SIG), { rx: 0.8, ry: 0.9 });
  });

  test('位置配置改过 → 不认旧坐标（改角落要立刻生效）', () => {
    const storage = memoryStorage();
    writePetPosition(storage, 'main', { rx: 0.42, ry: 0.61 }, SIG);
    const moved = signatureOf({ corner: 'bottom-left', marginX: 24, marginY: 100 });
    assert.equal(readPetPosition(storage, 'main', moved), null);
  });

  test('没记过 → null', () => {
    assert.equal(readPetPosition(memoryStorage(), 'main', SIG), null);
  });

  test('坐标超出 0..1 会被夹进来（多屏归一化空间恒为 0..1）', () => {
    const storage = memoryStorage();
    writePetPosition(storage, 'main', { rx: -0.5, ry: 1.7 }, SIG);
    assert.deepEqual(readPetPosition(storage, 'main', SIG), { rx: 0, ry: 1 });
  });
});

describe('坏数据与坏存储：一律降级，不抛异常', () => {
  test('JSON 坏了 → null', () => {
    const storage = memoryStorage({ [positionKeyOf('main')]: '{不是 json' });
    assert.equal(readPetPosition(storage, 'main', SIG), null);
  });

  test('坐标不是有限数 → null（不让 NaN 变成宠物飞到屏幕外）', () => {
    for (const bad of ['{"rx":null,"ry":0.5,"sig":"' + SIG + '"}', '{"rx":"left","ry":0.5,"sig":"' + SIG + '"}']) {
      const storage = memoryStorage({ [positionKeyOf('main')]: bad });
      assert.equal(readPetPosition(storage, 'main', SIG), null);
    }
  });

  test('写非法坐标 → false，且不落盘', () => {
    const storage = memoryStorage();
    assert.equal(writePetPosition(storage, 'main', { rx: Number.NaN, ry: 0.5 }, SIG), false);
    assert.equal(storage.size, 0);
  });

  test('没有可用存储（被禁用 / 隐私模式）→ 读 null、写 false、清 false，全都不抛', () => {
    for (const storage of [null, undefined, {}]) {
      assert.equal(readPetPosition(storage, 'main', SIG), null);
      assert.equal(writePetPosition(storage, 'main', { rx: 0.5, ry: 0.5 }, SIG), false);
      assert.equal(clearPetPosition(storage, 'main'), false);
    }
  });

  test('存储自己抛错（配额满 / 权限）→ 写 false、读 null，异常不外溢', () => {
    const thrower = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    assert.equal(readPetPosition(thrower, 'main', SIG), null);
    assert.equal(writePetPosition(thrower, 'main', { rx: 0.5, ry: 0.5 }, SIG), false);
    assert.equal(clearPetPosition(thrower, 'main'), false);
  });

  test('空 petId / 空签名 → 不读不写（不落一条主键是空的垃圾记录）', () => {
    const storage = memoryStorage();
    assert.equal(writePetPosition(storage, '', { rx: 0.5, ry: 0.5 }, SIG), false);
    assert.equal(writePetPosition(storage, 'main', { rx: 0.5, ry: 0.5 }, ''), false);
    assert.equal(readPetPosition(storage, '', SIG), null);
    assert.equal(storage.size, 0);
  });
});

describe('清除：回到原位之后重启也不该跳回旧坐标', () => {
  test('clear 之后读不到，且键真的被删掉', () => {
    const storage = memoryStorage();
    writePetPosition(storage, 'main', { rx: 0.42, ry: 0.61 }, SIG);
    assert.equal(clearPetPosition(storage, 'main'), true);
    assert.equal(readPetPosition(storage, 'main', SIG), null);
    assert.equal(storage.raw(positionKeyOf('main')), undefined);
  });
});

/**
 * 接到精灵原型上的那一层（`sprite/init.js` 的 setCustomPos / readStoredPosition / clearCustomPos）。
 *
 * 单测纯函数只能证明「存得进去」，证明不了「换皮肤重启后真的读回来」——这里把 init.js 挂到一个
 * 假 PetSprite 原型上、用同一个 localStorage 造两只「前后两个进程」的实例，把那条链路补上。
 */
describe('精灵这一层：重启后把位置读回来', () => {
  /**
   * 把 `sprite/init.js` 挂到一个假原型上（只挂一次：require 有缓存，第二次再 require 不会重新挂）。
   *
   * @returns {object} 假 PetSprite 的 prototype。
   */
  let cachedProto = null;
  function spriteProto() {
    if (cachedProto !== null) return cachedProto;
    globalThis.PetSprite = class {};
    globalThis.PetPositionStore = { positionKeyOf, readPetPosition, signatureOf, writePetPosition, clearPetPosition };
    require('../../runtime/electron-helper/sprite/init.js');
    cachedProto = globalThis.PetSprite.prototype;
    return cachedProto;
  }

  /** 造一只只有位置记忆相关字段的精灵（不需要完整构造，那几个方法只碰 pet + customPos + storage）。 */
  function makeSprite(storage, position) {
    globalThis.window = storage === null ? {} : { localStorage: storage };
    const sprite = Object.create(spriteProto());
    sprite.pet = { id: 'main', position };
    return sprite;
  }

  test('写过的位置在「下一个进程」里读得回来；位置配置改过则不认', () => {
    const storage = memoryStorage();
    const position = { corner: 'top-right', marginX: 24, marginY: 100 };

    const before = makeSprite(storage, position);
    // 「重启前」拖到某处
    before.setCustomPos({ rx: 0.33, ry: 0.77 });

    // 「重启后」：新实例初始化时会读一次
    const after = makeSprite(storage, position);
    assert.deepEqual(after.readStoredPosition(), { rx: 0.33, ry: 0.77 });

    // 改过角落 → 不认旧坐标，落到新角落
    assert.equal(makeSprite(storage, { corner: 'bottom-left', marginX: 24, marginY: 100 }).readStoredPosition(), null);

    // 「回到原位」→ 连存储一起清，之后重启也读不到
    after.clearCustomPos();
    assert.equal(after.customPos, null);
    assert.equal(makeSprite(storage, position).readStoredPosition(), null);
  });

  test('localStorage 拿不到（隐私模式 / 策略禁用）时这些方法照常可用，只是不记', () => {
    globalThis.window = {
      get localStorage() {
        throw new Error('SecurityError');
      },
    };
    const sprite = Object.create(spriteProto());
    sprite.pet = { id: 'main', position: { corner: 'top-right', marginX: 24, marginY: 100 } };
    assert.equal(sprite.positionStorage(), null);
    assert.equal(sprite.readStoredPosition(), null);
    sprite.setCustomPos({ rx: 0.1, ry: 0.2 });
    assert.deepEqual(sprite.customPos, { rx: 0.1, ry: 0.2 }, '位置本身仍要生效（本次会话内）');
    sprite.clearCustomPos();
    assert.equal(sprite.customPos, null);
  });
});
