/**
 * 素材路由的 `/logo` 分支：缺省回包内 logo，带 `root=<素材根>` 时回该宠物的自定义头像。
 *
 * 只钉本模块的 root 分支；其余素材端点（thumb / pic / font / sound）经真实 router 在
 * routes.test.ts 覆盖，这里不重复搭那一套。
 * 跑法：node --experimental-strip-types --test src/host/routes/assets.test.ts
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { handleAssetsRoutes } from './assets.ts';
import { savePetAvatar } from '../pet-avatar.ts';
import { writeInstalled } from '../packs/state.ts';
import type { RouteResult } from '../http.ts';
import type { PetRouteDeps } from './types.ts';

/** 最小 PNG 文件头：够魔数判定，不构成完整图片。 */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);

let dir = '';

/** 路由只用到 petConfigDir 与池根（其余字段本领域不读），测试里不构造。 */
const deps = (): PetRouteDeps => ({ petConfigDir: dir, poolRoot: () => join(dir, 'skin') }) as unknown as PetRouteDeps;

/** 调一次 logo 读取；`rest` 默认是干净的 `logo`。 */
function readLogo(query: string, rest = 'logo'): Promise<RouteResult | undefined> {
  return handleAssetsRoutes(deps(), { url: new URL('http://localhost/logo' + query), rest, method: 'GET' });
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-assets-'));
});

beforeEach(() => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('handleAssetsRoutes —— /logo?root=', () => {
  test('带 root 且该宠物有头像 → 回该文件', async () => {
    savePetAvatar(dir, 'cat', PNG);
    const result = await readLogo('?root=cat');
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.contentType, 'image/png');
    assert.equal(result.file, join(dir, 'cat-avatar.png'));
  });

  test('带 root 但没上传过 → 不回头像（继续走默认 logo 分支）', async () => {
    const result = await readLogo('?root=cat');
    // 源码形态下包内 assets/logo.png 不可达，所以断言「不是 pet 目录里的文件」即可
    assert.ok(result === undefined || result.kind !== 'file' || !result.file.startsWith(dir));
  });

  test('非法素材根 → 400，不做任何路径拼接', async () => {
    const result = await readLogo('?root=' + encodeURIComponent('../evil'));
    assert.ok(result !== undefined && result.kind === 'text');
    assert.equal(result.status, 400);
  });

  test('/logo 后面还有段 → 400', async () => {
    const result = await readLogo('', 'logo/x');
    assert.ok(result !== undefined && result.kind === 'text');
    assert.equal(result.status, 400);
  });

  test('root=main（内置）即使有残留文件也不读它', async () => {
    // 直接写文件（绕过上传端点），模拟历史遗留：读取侧仍然要无视它
    writeFileSync(join(dir, 'main-avatar.png'), PNG);
    const result = await readLogo('?root=main');
    assert.ok(
      result === undefined || result.kind !== 'file' || !result.file.startsWith(dir),
      'main 只能回包内默认 logo',
    );
    assert.equal(readFileSync(join(dir, 'main-avatar.png')).equals(PNG), true, '残留文件不被删除');
  });
});

describe('/skin/<root>/skins —— layered 可切换皮肤清单', () => {
  /** 调一次皮肤清单读取。 */
  const readSkins = (root: string) =>
    handleAssetsRoutes(deps(), {
      url: new URL('http://localhost/skin/' + root + '/skins'),
      rest: 'skin/' + root + '/skins',
      method: 'GET',
    });

  test('根布局记空串、子目录布局记目录名，一级子目录里的清单也算', async () => {
    const skinDir = join(dir, 'fish-skin');
    mkdirSync(join(skinDir, 'layered'), { recursive: true });
    writeFileSync(join(skinDir, 'layered', 'manifest.json'), '{"canvas":{"w":1,"h":1},"layers":[]}');
    mkdirSync(join(skinDir, 'winter'), { recursive: true });
    writeFileSync(join(skinDir, 'winter', 'manifest.json'), '{"canvas":{"w":1,"h":1},"layers":[]}');
    mkdirSync(join(skinDir, 'not-a-skin'), { recursive: true });
    const result = await readSkins('fish');
    assert.equal(result?.kind, 'json');
    if (result?.kind !== 'json') return;
    assert.deepEqual((result.obj as { skins: string[] }).skins, ['layered', 'winter'], '根上没有清单就不出现空串');
  });

  test('根布局存在时排在第一个（空串 = 默认皮肤）', async () => {
    const skinDir = join(dir, 'fish-skin');
    mkdirSync(skinDir, { recursive: true });
    writeFileSync(join(skinDir, 'manifest.json'), '{"canvas":{"w":1,"h":1},"layers":[]}');
    mkdirSync(join(skinDir, 'layered'), { recursive: true });
    writeFileSync(join(skinDir, 'layered', 'manifest.json'), '{"canvas":{"w":1,"h":1},"layers":[]}');
    const result = await readSkins('fish');
    if (result?.kind !== 'json') return;
    assert.deepEqual((result.obj as { skins: string[] }).skins, ['', 'layered']);
  });

  test('皮肤目录不存在：空数组而不是 404', async () => {
    const result = await readSkins('nobody');
    if (result?.kind !== 'json') return;
    assert.deepEqual((result.obj as { skins: string[] }).skins, []);
  });
});

describe('资源池 —— /skin 与 /thumb 的池分支', () => {
  /** 写一个池文件（自动建目录）。 */
  const putPool = (rel: string, body = '{}'): string => {
    const path = join(dir, 'skin', rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    return path;
  };

  /** 读一个素材路径。 */
  const read = (rest: string, query = '') =>
    handleAssetsRoutes(deps(), { url: new URL('http://localhost/' + rest + query), rest, method: 'GET' });

  test('/skin/pool/<渲染方式>/<file>：池视图直接取池里的皮肤文件', async () => {
    const file = putPool(join('layered', 'character1', 'manifest.json'), '{"canvas":{"w":1,"h":1}}');
    const result = await read('skin/pool/layered/character1/manifest.json');
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.file, file);
  });

  test('/skin/pool/<file>：没给渲染方式桶时按 layered → live2d 试', async () => {
    const file = putPool(join('live2d', 'model1', 'xx.model3.json'), '{"Version":3,"FileReferences":{}}');
    const result = await read('skin/pool/model1/xx.model3.json');
    assert.ok(result !== undefined);
    // .model3.json 会走 model-extras 的补全分支（kind=json）；这里只钉「命中了池里那一份」。
    assert.ok(result.kind === 'json' || (result.kind === 'file' && result.file === file));
  });

  test('普通素材根：pack 里没有的模型回落到池（先 pack 后池）', async () => {
    const file = putPool(join('layered', 'character1', 'manifest.json'), '{"canvas":{"w":1,"h":1}}');
    const result = await read('skin/fish/character1/manifest.json');
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.file, file);
  });

  test('普通素材根：pack 里有的模型仍压过池里的同名模型', async () => {
    mkdirSync(join(dir, 'fish-skin', 'character1'), { recursive: true });
    const packFile = join(dir, 'fish-skin', 'character1', 'manifest.json');
    writeFileSync(packFile, '{"canvas":{"w":1,"h":1}}');
    putPool(join('layered', 'character1', 'manifest.json'), '{"canvas":{"w":2,"h":2}}');
    const result = await read('skin/fish/character1/manifest.json');
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.file, packFile);
  });

  test('/skin/<root>/skins：旧皮肤 ∪ 池，带 items 来源标注', async () => {
    mkdirSync(join(dir, 'fish-skin', 'winter'), { recursive: true });
    writeFileSync(join(dir, 'fish-skin', 'winter', 'manifest.json'), '{"canvas":{"w":1,"h":1}}');
    putPool(join('layered', 'character1', 'manifest.json'));
    const result = await read('skin/fish/skins');
    if (result?.kind !== 'json') return assert.fail('应为 json');
    const body = result.obj as { skins: string[]; items: Array<{ id: string; source: string }> };
    assert.deepEqual(body.skins, ['winter', 'character1']);
    assert.deepEqual(body.items, [
      { id: 'winter', source: 'pack' },
      { id: 'character1', source: 'pool' },
    ]);
  });

  test('/skin/<root>/models：池里的 live2d 模型也进清单', async () => {
    putPool(join('live2d', 'model1', 'xx.model3.json'), '{"Version":3}');
    const result = await read('skin/fish/models');
    if (result?.kind !== 'json') return assert.fail('应为 json');
    const body = result.obj as { models: string[]; items: Array<{ id: string; source: string }> };
    assert.deepEqual(body.models, ['model1/xx.model3.json']);
    assert.deepEqual(body.items, [{ id: 'model1/xx.model3.json', source: 'pool' }]);
  });

  test('/thumb/pool/<动画>.webm：池里的平铺动画可播', async () => {
    const file = putPool(join('webm', 'movie1.webm'), 'x');
    const result = await read('thumb/pool/movie1.webm');
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.file, file);
    assert.equal(result.contentType, 'video/webm');
  });

  test('/thumb/<素材根>/<动画>.webm：专属目录没有时回落池', async () => {
    const file = putPool(join('webm', 'movie1.webm'), 'x');
    const result = await read('thumb/fish/movie1.webm');
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.file, file);
  });

  test('非法 petId 仍然 400（池的加入不放宽路径守卫）', async () => {
    const result = await read('thumb/../evil/movie1.webm');
    assert.ok(result !== undefined && result.kind === 'text');
    assert.equal(result.status, 400);
  });
});

describe('资源清单 —— /skin/<root>/resources', () => {
  /** 写一个池文件（自动建目录）。 */
  const putPool = (rel: string, body = '{}'): string => {
    const path = join(dir, 'skin', rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    return path;
  };

  /** 读一份清单。 */
  const read = (rest: string) =>
    handleAssetsRoutes(deps(), { url: new URL('http://localhost/' + rest), rest, method: 'GET' });

  test('池虚拟根：三桶形状 + 目录 + 缺文件', async () => {
    putPool(join('layered', 'character1', 'manifest.json'));
    putPool(join('webm', 'wave.webm'), 'x');
    const result = await read('skin/pool/resources');
    if (result?.kind !== 'json') return assert.fail('应为 json');
    const body = result.obj as {
      root: string;
      renderers: Record<string, { status: string; dir: string; count: number; missingFiles: string[] }>;
    };
    assert.equal(body.root, 'pool');
    assert.equal(body.renderers.layered.status, 'ok');
    assert.equal(body.renderers.layered.count, 1);
    assert.equal(body.renderers.layered.dir, join(dir, 'skin', 'layered'));
    assert.equal(body.renderers.live2d.status, 'missing');
    assert.deepEqual(body.renderers.live2d.missingFiles, ['*.model3.json']);
    assert.equal(body.renderers.webm.status, 'ok');
  });

  test('普通素材根：没有皮肤目录时三桶都回池桶，路径仍是绝对路径', async () => {
    putPool(join('live2d', 'model1', 'xx.model3.json'), '{"Version":3}');
    const result = await read('skin/fish/resources');
    if (result?.kind !== 'json') return assert.fail('应为 json');
    const body = result.obj as {
      root: string;
      renderers: Record<string, { status: string; dir: string; items: Array<{ id: string; source: string }> }>;
    };
    assert.equal(body.root, 'fish');
    assert.equal(body.renderers.live2d.status, 'ok');
    assert.deepEqual(body.renderers.live2d.items, [
      { id: 'model1/xx.model3.json', label: 'model1/xx.model3.json', source: 'pool' },
    ]);
    assert.equal(body.renderers.layered.dir, join(dir, 'skin', 'layered'));
  });

  test('/skin/<root>/resources 之后的段仍在：/skins 的既有形状不变', async () => {
    putPool(join('layered', 'character1', 'manifest.json'));
    const result = await read('skin/pool/skins');
    if (result?.kind !== 'json') return assert.fail('应为 json');
    const body = result.obj as { skins: string[]; items: Array<{ id: string; source: string }> };
    assert.deepEqual(body.skins, ['character1']);
    assert.deepEqual(body.items, [{ id: 'character1', source: 'pool' }]);
  });
});

describe('多素材根（assets.resourceDirs）—— 取文件按根序回退', () => {
  /** 造一个「主根 + 外部根」的 deps：外部根目录在临时目录里另起。 */
  const multiDeps = (extra: string): PetRouteDeps =>
    ({
      petConfigDir: dir,
      poolRoot: () => join(dir, 'skin'),
      poolRoots: () => [join(dir, 'skin'), extra],
    }) as unknown as PetRouteDeps;

  const readWith = (who: PetRouteDeps, rest: string) =>
    handleAssetsRoutes(who, { url: new URL('http://localhost/' + rest), rest, method: 'GET' });

  const putExternal = (root: string, rel: string, body = '{}'): string => {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    return path;
  };

  test('/skin/pool/...：主根没有的文件去外部根取', async () => {
    const extra = join(dir, 'external-skins');
    const file = putExternal(extra, join('layered', 'external1', 'manifest.json'), '{"canvas":{"w":2,"h":2}}');
    const result = await readWith(multiDeps(extra), 'skin/pool/layered/external1/manifest.json');
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.file, file);
  });

  test('同名资源：主根优先，外部根不顶掉它', async () => {
    const extra = join(dir, 'external-skins');
    const primary = join(dir, 'skin', 'layered', 'same', 'manifest.json');
    mkdirSync(dirname(primary), { recursive: true });
    writeFileSync(primary, '{"canvas":{"w":1,"h":1}}');
    putExternal(extra, join('layered', 'same', 'manifest.json'), '{"canvas":{"w":9,"h":9}}');
    const result = await readWith(multiDeps(extra), 'skin/pool/layered/same/manifest.json');
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.file, primary);
  });

  test('/skin/pool/skins：两个根的资源都进清单', async () => {
    const extra = join(dir, 'external-skins');
    putExternal(join(dir, 'skin'), join('layered', 'primary1', 'manifest.json'));
    putExternal(extra, join('layered', 'external1', 'manifest.json'));
    const result = await readWith(multiDeps(extra), 'skin/pool/skins');
    assert.ok(result !== undefined && result.kind === 'json');
    const skins = (result.obj as { skins: string[] }).skins;
    assert.deepEqual([...skins].sort(), ['external1', 'primary1']);
  });

  test('/thumb/pool/<动画>.webm：外部根里的平铺动画也能播', async () => {
    const extra = join(dir, 'external-skins');
    const file = putExternal(extra, join('webm', 'extra-movie.webm'), 'x');
    const result = await readWith(multiDeps(extra), 'thumb/pool/extra-movie.webm');
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.file, file);
  });
});

describe('handleAssetsRoutes —— Cubism Core 的判据与路由不许漂移', () => {
  /** 造一个「装了 cubism 包」的依赖桩。 */
  function cubismDeps(userRoot: string): PetRouteDeps {
    const packsRoot = join(userRoot, 'packs');
    return {
      petConfigDir: userRoot,
      userRoot,
      packsRoot,
      poolRoot: () => join(userRoot, 'skin'),
    } as unknown as PetRouteDeps;
  }

  /** 往资源包里放一个 Core（平铺布局，打 zip 常见的那种）。 */
  function installCore(packsRoot: string): string {
    const dir = join(packsRoot, 'cubism-core');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'live2dcubismcore.min.js'), '// core');
    writeInstalled(dir, {
      id: 'cubism-core',
      sha256: 'd'.repeat(64),
      bytes: 8,
      files: 1,
      at: '2026-11-24T00:00:00.000Z',
    });
    return join(dir, 'live2dcubismcore.min.js');
  }

  test('已装 cubism 包：/cubism 取到包内那份，/models 的 core 为 true', async () => {
    const deps = cubismDeps(dir);
    const file = installCore(join(dir, 'packs'));
    const probe = await handleAssetsRoutes(deps, {
      url: new URL('http://localhost/cubism/live2dcubismcore.min.js'),
      rest: 'cubism/live2dcubismcore.min.js',
      method: 'GET',
    });
    assert.ok(probe !== undefined && probe.kind === 'file');
    assert.equal(probe.file, file);

    const models = await handleAssetsRoutes(deps, {
      url: new URL('http://localhost/skin/main/models'),
      rest: 'skin/main/models',
      method: 'GET',
    });
    assert.ok(models !== undefined && models.kind === 'json');
    assert.equal((models.obj as { core?: unknown }).core, true);
  });

  test('不变量：core 恒等于 /cubism 的实际命中（两边共用一个查找链）', async () => {
    for (const withPack of [false, true]) {
      if (withPack) installCore(join(dir, 'packs'));
      const deps = cubismDeps(dir);
      const probe = await handleAssetsRoutes(deps, {
        url: new URL('http://localhost/cubism/live2dcubismcore.min.js'),
        rest: 'cubism/live2dcubismcore.min.js',
        method: 'GET',
      });
      const models = await handleAssetsRoutes(deps, {
        url: new URL('http://localhost/skin/main/models'),
        rest: 'skin/main/models',
        method: 'GET',
      });
      assert.ok(models !== undefined && models.kind === 'json');
      assert.equal(
        (models.obj as { core?: unknown }).core,
        probe !== undefined && probe.kind === 'file',
        'withPack=' + withPack,
      );
    }
  });
});

describe('内置分层皮肤（包内只读池）', () => {
  /** 仓库包根：从本测试文件向上三级（src/host/routes → 包根）。 */
  const PACKAGE_PET = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'pet');
  /** `core-skins.json` 声明的内置皮肤 id。 */
  const declared = (): string[] => {
    const raw: unknown = JSON.parse(readFileSync(join(dirname(PACKAGE_PET), 'core-skins.json'), 'utf8'));
    const skins = (raw as { skins?: unknown }).skins;
    return Array.isArray(skins) ? skins.filter((id): id is string => typeof id === 'string') : [];
  };
  /** 用户池是空的（干净数据根）→ 内置那份必须自己撑起列表。 */
  const emptyUserPool = (): PetRouteDeps =>
    ({
      petConfigDir: dir,
      poolRoot: () => join(dir, 'skin'),
      poolRoots: () => [join(dir, 'skin'), PACKAGE_PET],
    }) as unknown as PetRouteDeps;

  test('用户池空着时 /skins 恰好是全部内置皮肤（没有把目录里的杂项算成皮肤）', async () => {
    const ids = declared();
    assert.ok(ids.length > 0, 'core-skins.json 不能为空：内置皮肤是 layered 的开箱素材');
    const result = await handleAssetsRoutes(emptyUserPool(), {
      url: new URL('http://localhost/skin/main/skins'),
      rest: 'skin/main/skins',
      method: 'GET',
    });
    assert.ok(result !== undefined && result.kind === 'json');
    const skins = (result.obj as { skins?: unknown }).skins;
    assert.ok(Array.isArray(skins));
    assert.deepEqual([...skins].sort(), [...ids].sort());
  });

  test('每套内置皮肤都能取到清单与第一张图层（清单里的 file 路径真的落在包内）', async () => {
    for (const id of declared()) {
      const manifest = await handleAssetsRoutes(emptyUserPool(), {
        url: new URL(`http://localhost/skin/main/${id}/manifest.json`),
        rest: `skin/main/${id}/manifest.json`,
        method: 'GET',
      });
      // 清单走静态文件分支（只有 `.model3.json` 才被改写成 json 应答），所以这里断言 file。
      assert.ok(manifest !== undefined && manifest.kind === 'file', `${id} 的清单取不到`);
      const layers = (JSON.parse(readFileSync(manifest.file, 'utf8')) as { layers?: readonly { file?: unknown }[] })
        .layers;
      assert.ok(Array.isArray(layers) && layers.length > 0, `${id} 的清单没有图层`);
      const first = layers[0]?.file;
      assert.equal(typeof first, 'string');
      const art = await handleAssetsRoutes(emptyUserPool(), {
        url: new URL(`http://localhost/skin/main/${id}/${String(first)}`),
        rest: `skin/main/${id}/${String(first)}`,
        method: 'GET',
      });
      assert.ok(art !== undefined && art.kind === 'file', `${id} 的图层 ${String(first)} 取不到`);
      assert.ok(art.file.startsWith(PACKAGE_PET), `${id} 的图层没落在包内只读池：${art.file}`);
    }
  });

  test('用户放了同名皮肤时用户那份优先（内置只作兜底）', async () => {
    const ids = declared();
    const first = ids[0];
    assert.ok(first !== undefined);
    const userSkin = join(dir, 'skin', 'layered', first);
    mkdirSync(userSkin, { recursive: true });
    writeFileSync(join(userSkin, 'manifest.json'), JSON.stringify({ schema: 2, rig: 'layered', marker: 'user' }));
    const result = await handleAssetsRoutes(emptyUserPool(), {
      url: new URL(`http://localhost/skin/main/${first}/manifest.json`),
      rest: `skin/main/${first}/manifest.json`,
      method: 'GET',
    });
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.file, join(userSkin, 'manifest.json'), '用户同名皮肤没压过内置那份');
  });
});
