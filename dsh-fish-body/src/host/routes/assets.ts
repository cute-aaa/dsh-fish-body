/**
 * 静态素材：/font、/pic（含表情包链）、/sound、/cubism、/skin、/thumb 的取文件与路径守卫。
 *
 * 不决定素材归属，只按给定目录链查找。素材根写 `pool` 时表示「共享资源池」（保留虚拟根）：
 * /sound /skin /thumb 各自把池目录当成唯一候选，其它素材根则按「先 pack 后池」依次回落。
 * 依赖（PetRouteDeps）显式传入，模块内不读全局、不建状态。
 * @module dsh-fish-body/src/host/routes/assets
 */
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../paths.ts';
import { MIME, resolveAsset, resolveExisting } from '../http.ts';
import { isValidPetId, RENDERER_SET } from '../config.ts';
import { SFX_AUDIO_EXTS } from '../../shared/sfx/types.ts';
import { isValidModelPath, skinIdOfModel } from '../sfx/scan.ts';
import { isModelSettingsFile, mergeModelExtras } from '../model-extras.ts';
import { petAvatarFile } from '../pet-avatar.ts';
import { existsSync, readFileSync } from 'node:fs';
import { POOL_ASSET_ROOT, POOL_LAYER_DIR } from '../../shared/pool.ts';
import { resolveExtraAsset } from '../packs/roots.ts';
import { listInstalled } from '../packs/state.ts';
import { createPoolReader, poolLayerDirs } from '../pool/roots.ts';
import { listLayeredIds, listModelIds, readRenderResources } from '../pool/inventory.ts';
import { soundCandidateDirs } from '../sfx/order.ts';
import type { RenderAnimDir } from '../pool/inventory.ts';
import type { PoolEntryItem, RendererKind } from '../../shared/types.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';

/** 池里当皮肤根用的两个目录（`layered` / `live2d`），顺序即探测顺序。 */
const POOL_SKIN_LAYERS: ReadonlyArray<'layered' | 'live2d'> = ['layered', 'live2d'];

/** Cubism Core 的文件名（`/models` 的 `core` 判据与 `/cubism` 路由共用）。 */
const CUBISM_CORE_FILE = 'live2dcubismcore.min.js';

/**
 * 找 Cubism Core：扩展根链（用户目录 / 资源包）优先，包内兜底。
 *
 * 路由与 `/models` 的 `core` 判据**必须**共用这一个函数——两边各写一遍就会漂移，
 * 症状是「右键说不能用，实际取得到」或反过来（首轮切换真踩到过：路由 200、判据 false）。
 * @param deps - 路由依赖。
 * @param rel - 相对于 cubism 目录的路径。
 * @returns 命中的绝对路径；都没有为 undefined。
 */
function cubismCorePath(deps: PetRouteDeps, rel: string): string | undefined {
  return resolveExtraAsset(deps, 'cubism', rel) ?? resolveExisting(join(PACKAGE_ROOT, 'assets', 'cubism'), rel);
}

/** 判断一个 URL 段是不是池里的渲染方式目录名。 */
function poolLayerOf(segment: string): 'layered' | 'live2d' | undefined {
  return (POOL_SKIN_LAYERS as readonly string[]).includes(segment) ? (segment as 'layered' | 'live2d') : undefined;
}

/**
 * 把「旧布局的 id」与「池里的 id」合成一份带来源的清单。
 *
 * 旧布局在前、池在后（与 `pets[].model` 的「先 pack 后池」一致），同名只留旧布局那一份——
 * 否则设置页会列出两个一模一样的名字，选哪个都说不清。
 *
 * 响应形状保持 `{id, source}`：桌面 helper（`init.js`）按这个形状读，行内不新增字段。
 *
 * @param packIds - 旧布局的皮肤 id / 模型相对路径。
 * @param poolIds - 池里的资源 id。
 * @returns 去重后的 `{id, source}` 列表。
 */
function mergeEntryItems(packIds: readonly string[], poolIds: readonly string[]): PoolEntryItem[] {
  const out: PoolEntryItem[] = [];
  const seen = new Set<string>();
  for (const id of packIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, source: 'pack' });
  }
  for (const id of poolIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, source: 'pool' });
  }
  return out;
}

/** 静态素材领域：未命中返回 undefined，命中返回应答。 */
export async function handleAssetsRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { assetRootFor, memeDirsFor, petConfigDir, poolRoot, poolRoots, soundDirsFor, userRootFor } = deps;
  const { rest, url } = input;
  // 池根可能缺失（老调用方 / 精简测试桩）：空数组 = 没有池，整条池分支静默跳过。
  // 多根（`assets.resourceDirs`）时按根序试：清单与取文件用同一顺序，否则会出现「清单有、点下去 404」。
  const poolBases = typeof poolRoots === 'function' ? poolRoots() : typeof poolRoot === 'function' ? [poolRoot()] : [];
  const poolRootList = poolBases.filter((root) => root !== '');
  const poolBase = poolRootList[0] ?? '';

  // 动画素材：/thumb/<素材根>/<file>，扩展名 webm（默认）/ mov（macOS 定制）。
  // 存在 `pet/<素材根>-animation/` 的宠物先查自己的目录，再查共享资源池（`<池>/webm/`），
  // 仍未命中才走主素材链：用户 assets/animation/<ext> → 包内 assets/<ext>（所有主配置宠物共用）。
  // mov（HEVC-with-Alpha）不随包发布，用户从 GitHub Release 下载后放 assets/animation/mov/，
  // 并把客户端播放常量 ANIMATION_EXT 改为 .mov。
  // font / pic 是扁平的 /<scope>/<file>，只有 thumb 是 /<scope>/<petId>/<file>：先拆 scope 再各自拆剩余段。
  const [scope, ...restParts] = rest.split('/');

  // 插件 logo / 宠物头像：/logo → 包内 assets/logo.png。只放行这一个文件——不把 assets 根开放成静态目录
  // （同目录还有 config.jsonc）。对话面板拿它当宠物头像。
  // 带 ?root=<素材根> 时先找该宠物的自定义头像（pet/<素材根>-avatar.<ext>），没有就回退包内 logo：
  // 「没上传过」与「上传后又删掉」都由这一处兜底，前端不必区分。
  // main 不查自定义文件：pet/ 只归 pet pack，内置条目永远用包内 logo。
  // 参数叫 root 而不是 pet：这里要的是素材根（目录前缀），不是 pets[].id。
  if (scope === 'logo') {
    if (restParts.length > 0) return { kind: 'text', status: 400, body: 'fish-body: expected /dsh-pet-7340/logo' };
    const assetRoot = (url.searchParams.get('root') ?? '').trim();
    if (assetRoot !== '' && assetRoot !== 'main') {
      // 素材根是标识符不是路径片段：含分隔符/保留字符即显式 400，早于任何路径拼接。
      if (!isValidPetId(assetRoot)) return { kind: 'text', status: 400, body: 'fish-body: invalid asset root' };
      const own = petAvatarFile(petConfigDir, assetRoot);
      if (own !== undefined) return { kind: 'file', file: own.file, contentType: own.contentType };
    }
    const logo = resolveExisting(join(PACKAGE_ROOT, 'assets'), 'logo.png');
    if (logo === undefined) return { kind: 'text', status: 404, body: 'fish-body: logo not found' };
    return { kind: 'file', file: logo, contentType: MIME['.png'] ?? 'image/png' };
  }

  if (scope === 'font') {
    // 字体不在包内了（商业字体已移除）：先看用户目录与已安装的资源包，最后才是包内兜底。
    // 顺序即语义——用户显式放进来的那份必须能盖过其它来源。
    const fontRel = restParts.join('/');
    const fontFile =
      resolveExtraAsset(deps, 'fonts', fontRel) ?? resolveExisting(join(PACKAGE_ROOT, 'assets', 'fonts'), fontRel);
    if (fontFile === undefined) return { kind: 'text', status: 404, body: 'fish-body: font not found' };
    const ext = fontFile.slice(fontFile.lastIndexOf('.')).toLowerCase();
    return { kind: 'file', file: fontFile, contentType: MIME[ext] ?? 'application/octet-stream' };
  }

  // 通知图标：/pic/<file> → 包内 assets/pic（方形 png，系统通知 icon 用）。
  // 表情包：/pic/memes/<素材根>/<名称>.png → 按素材根走 memeDirsFor 的目录链，与 /thumb 同一套
  // 归属语义；名称含中文，URL 段已在上方解码。旧的两段形式 /pic/memes/<名称>.png 保留，
  // 等价于素材根 main 的目录链。表情包不参与资源池：池只放皮肤 / 模型 / 动画 / 音效。
  if (scope === 'pic') {
    if (restParts[0] === 'memes') {
      const segs = restParts.slice(1);
      // 段数 ≥ 2 = <素材根>/<名称…>；恰好 1 段 = 旧扁平形式。表情包名称即文件名（不含子目录），
      // 所以两种形式不歧义；素材根与 /thumb 的 petId 同规矩：含分隔符 / 保留字符即显式 400。
      const scoped = segs.length >= 2;
      const assetRoot = scoped ? segs[0] : 'main';
      if (scoped && !isValidPetId(assetRoot)) {
        return { kind: 'text', status: 400, body: 'fish-body: invalid asset root' };
      }
      const rel = (scoped ? segs.slice(1) : segs).join('/');
      let picFile: string | undefined;
      for (const dir of memeDirsFor(assetRoot)) {
        picFile = resolveExisting(dir, rel);
        if (picFile !== undefined) break;
      }
      if (picFile === undefined) return { kind: 'text', status: 404, body: 'fish-body: pic not found' };
      const ext = picFile.slice(picFile.lastIndexOf('.')).toLowerCase();
      return { kind: 'file', file: picFile, contentType: MIME[ext] ?? 'application/octet-stream' };
    }
    const picRoot = join(PACKAGE_ROOT, 'assets', 'pic');
    const picFile = resolveExisting(picRoot, restParts.join('/'));
    if (picFile === undefined) return { kind: 'text', status: 404, body: 'fish-body: pic not found' };
    const ext = picFile.slice(picFile.lastIndexOf('.')).toLowerCase();
    return { kind: 'file', file: picFile, contentType: MIME[ext] ?? 'application/octet-stream' };
  }

  // 音效：两种形式并存。
  //   /sound/<素材根>/<file>：按该素材根的音效搜索链取文件（池资源目录 → 池渲染兜底 → 池全局
  //     → 旧皮肤目录 → -sound → 用户共享 → 动画同目录 → 包内默认），顺序与 host/sfx/order 完全同一份，
  //     否则索引指名的文件在这里取不到。
  //   /sound/<file>：旧形式，等价于素材根 main 的包内默认目录——只为兼容已存在的地址。
  // ?model= 决定先查哪套皮肤的目录（layered 皮肤名 / live2d 模型所在目录），缺省只看不带皮肤的那几层；
  // ?renderer= 决定池的哪一层参与（缺省 webm）。
  if (scope === 'sound') {
    const scoped = restParts.length >= 2;
    const assetRoot = scoped ? restParts[0] : 'main';
    if (!isValidPetId(assetRoot)) return { kind: 'text', status: 400, body: 'fish-body: invalid sound asset root' };
    const rel = (scoped ? restParts.slice(1) : restParts).join('/');
    const rawModel = (url.searchParams.get('model') ?? '').trim();
    if (!isValidModelPath(rawModel)) return { kind: 'text', status: 400, body: 'fish-body: invalid model path' };
    const rawRenderer = url.searchParams.get('renderer') ?? 'webm';
    if (!RENDERER_SET.has(rawRenderer)) return { kind: 'text', status: 400, body: 'fish-body: unknown renderer' };
    const renderer = rawRenderer as RendererKind;
    const dirs = soundDirsFor(assetRoot, '.webm', { model: rawModel, renderer });
    let soundFile: string | undefined;
    for (const dir of soundCandidateDirs(dirs, skinIdOfModel(rawModel))) {
      soundFile = resolveExisting(dir, rel);
      if (soundFile !== undefined) break;
    }
    if (soundFile === undefined) return { kind: 'text', status: 404, body: 'fish-body: sound not found' };
    const ext = soundFile.slice(soundFile.lastIndexOf('.')).toLowerCase();
    if (!SFX_AUDIO_EXTS.includes(ext)) {
      return {
        kind: 'text',
        status: 400,
        body: 'fish-body: unsupported sound format (expected .wav / .ogg / .mp3 / .m4a)',
      };
    }
    return { kind: 'file', file: soundFile, contentType: MIME[ext] ?? 'application/octet-stream' };
  }

  // Live2D Cubism Core：/dsh-pet-7340/cubism/<file> → 包内 assets/cubism（live2dcubismcore.min.js）。
  // 与 font 同一套扁平形式：只放行包内一份，客户端按需注入 <script> 后读 window.Live2DCubismCore。
  if (scope === 'cubism') {
    // Cubism Core 不再随包分发（Live2D 许可禁止同捆）：用户把官方 SDK 里的
    // live2dcubismcore.min.js 放进 `<数据根>/cubism/`（或安装 cubism 资源包）后即可用。
    const cubismRel = restParts.join('/');
    const cubismFile = cubismCorePath(deps, cubismRel);
    if (cubismFile === undefined)
      return {
        kind: 'text',
        status: 404,
        body: 'fish-body: cubism core not found（把 live2dcubismcore.min.js 放进 <数据根>/cubism/，或在设置页安装 cubism 资源包）',
      };
    const ext = cubismFile.slice(cubismFile.lastIndexOf('.')).toLowerCase();
    return { kind: 'file', file: cubismFile, contentType: MIME[ext] ?? 'application/octet-stream' };
  }

  // live2d 运行时依赖：/vendor/<file> → 包内 assets/vendor（pixi / pixi-live2d-display 的浏览器 UMD）。
  // 不做进 client bundle：那两个包按 ESM 打进来会带出 node 的 url/punycode 垫片与裸 import，
  // 经典脚本下必然加载失败；UMD 形态由页面 <script> 直接加载，pixi-live2d-display 再挂到 PIXI.live2d。
  if (scope === 'vendor') {
    const vendorFile = resolveExisting(join(PACKAGE_ROOT, 'assets', 'vendor'), restParts.join('/'));
    if (vendorFile === undefined) return { kind: 'text', status: 404, body: 'fish-body: vendor asset not found' };
    const ext = vendorFile.slice(vendorFile.lastIndexOf('.')).toLowerCase();
    return { kind: 'file', file: vendorFile, contentType: MIME[ext] ?? 'application/octet-stream' };
  }

  // 分层 / live2d 皮肤：/skin/<素材根>/<file> → pet/<素材根>-skin/（manifest.json + art/*.png / .moc3 / 纹理）。
  // 素材根写 `pool`（保留虚拟根）时只查共享资源池：`/skin/pool/<渲染方式>/<file>` 指定桶，
  // `/skin/pool/<file>` 依次试 layered → live2d。普通素材根先查自己的目录，缺失再回落到池（先 pack 后池）。
  // 路径一律过 resolveExisting（规范化后必须留在根内），素材根含分隔符/保留字符即 400。
  if (scope === 'skin') {
    const [assetRoot, ...nameParts] = restParts;
    if (!assetRoot || nameParts.length === 0) {
      return { kind: 'text', status: 400, body: 'fish-body: expected /dsh-pet-7340/skin/<petId>/<file>' };
    }
    if (!isValidPetId(assetRoot)) {
      return { kind: 'text', status: 400, body: 'fish-body: invalid skin asset root' };
    }
    const fromPool = assetRoot === POOL_ASSET_ROOT;
    // 池视图没有池根就直接 404（虚拟根靠池存在才有意义）；精简测试桩没有 poolRoot 时同样跳过池分支。
    if (fromPool && poolBase === '') return { kind: 'text', status: 404, body: 'fish-body: skin file not found' };
    const pool = poolBase === '' ? undefined : createPoolReader(poolRootList).scan();
    const packSkinDir = fromPool ? undefined : resolveAsset(petConfigDir, assetRoot + '-skin');
    const packDir = packSkinDir !== undefined && existsSync(packSkinDir) ? packSkinDir : undefined;

    // 池视图的候选根：显式给了渲染方式桶就只查那一桶，否则 layered → live2d 依次试。
    // 多根时先按桶把每个根的目录摊平：同一桶里根序即优先级；`bare` 外部根直接就是皮肤集合目录。
    const bucket = fromPool && nameParts.length > 1 ? poolLayerOf(nameParts[0]) : undefined;
    const skinsCandidates =
      pool === undefined
        ? []
        : (bucket === undefined ? POOL_SKIN_LAYERS : [bucket]).flatMap((layer) => poolLayerDirs(poolRootList, layer));
    const relParts = bucket === undefined ? nameParts : nameParts.slice(1);
    const rel = relParts.join('/');

    // /skin/<root>/models：列出全部 .model3.json（相对路径，供 live2d 右键「模型」切换）。
    // 普通素材根 = 旧皮肤目录 ∪ 池；池视图只有池。`items` 带来源，老调用方仍读 `models`。
    if (relParts.length === 1 && relParts[0] === 'models') {
      const packIds = packDir === undefined ? [] : listModelIds(packDir);
      const poolIds = pool === undefined ? [] : pool.live2d.map((entry) => entry.id);
      return {
        kind: 'json',
        status: 200,
        obj: {
          items: mergeEntryItems(packIds, poolIds),
          models: [...packIds, ...poolIds],
          // Cubism Core 不在包内：把「能不能找到它」一并告诉两端，右键才能把 live2d 置灰而不是点出一块空画布。
          // 判据与 `/cubism` 路由共用 cubismCorePath，两边不会漂移。
          core: cubismCorePath(deps, CUBISM_CORE_FILE) !== undefined,
        },
      };
    }
    // /skin/<root>/skins：列出可切换的分层皮肤（清单所在子目录名，根布局为空串），
    // 供 layered 右键「皮肤」切换（pets[].model 写这里的值）。根布局与子目录布局都认，
    // 见 shared/layered-paths——一处布局变了，这条列表跟着变，别在两端各写一套扫描。
    if (relParts.length === 1 && relParts[0] === 'skins') {
      const packIds = packDir === undefined ? [] : listLayeredIds(packDir);
      const poolIds = pool === undefined ? [] : pool.layered.map((entry) => entry.id);
      return {
        kind: 'json',
        status: 200,
        obj: { items: mergeEntryItems(packIds, poolIds), skins: [...packIds, ...poolIds] },
      };
    }

    // /skin/<root>/resources：设置页用的三桶清单（layered / live2d / webm）。
    // 与 /skins、/models 共用 `pool/inventory` 的扫描判定：同一目录在两处不会给出两种答案。
    // 只增不改——`/skins`、`/models` 的响应形状原样保留（桌面 helper 仍在消费）。
    if (relParts.length === 1 && relParts[0] === 'resources') {
      // 平铺动画的候选链与 /thumb 的 findAnim 同序：专属目录 → 池 → 用户共享 → 包内。
      const animDirs: RenderAnimDir[] = [];
      if (!fromPool) {
        const extraAnimDir = resolveAsset(petConfigDir, assetRoot + '-animation');
        if (extraAnimDir !== undefined) animDirs.push({ dir: extraAnimDir, source: 'pack' });
      }
      // 每个皮肤根都要试：用户 skin/webm 在前，内置池 ssets/pet/webm 在后。
      for (const root of poolRootList) animDirs.push({ dir: join(root, POOL_LAYER_DIR.webm), source: 'pool' });
      if (!fromPool && typeof userRootFor === 'function' && typeof assetRootFor === 'function') {
        // 两条共享素材链不算「这只宠物的专属目录」，按池同一来源标注。
        animDirs.push({ dir: userRootFor('.webm'), source: 'pool' });
        animDirs.push({ dir: assetRootFor('.webm'), source: 'pool' });
      }
      const resources = readRenderResources({
        poolRoot: poolBase,
        poolRoots: poolRootList,
        packSkinDir: packDir,
        animDirs,
      });
      return { kind: 'json', status: 200, obj: { root: assetRoot, renderers: resources } };
    }

    let skinFile: string | undefined;
    for (const root of [...(packDir === undefined ? [] : [packDir]), ...skinsCandidates]) {
      skinFile = resolveExisting(root, rel);
      if (skinFile !== undefined) break;
    }
    if (skinFile === undefined) return { kind: 'text', status: 404, body: 'fish-body: skin file not found' };
    // 模型清单：补上目录里现成的 Animation 动作与 Exp3 表情（见 host/model-extras）。
    // 只改下发的这一份，磁盘上的用户文件保持原样；解析失败就按原文件走，不额外编个错误页。
    if (isModelSettingsFile(rel)) {
      try {
        const raw: unknown = JSON.parse(readFileSync(skinFile, 'utf8'));
        return { kind: 'json', status: 200, obj: mergeModelExtras(skinFile, raw) };
      } catch {
        // 坏清单：原样下发，前端挂载时会自己报错。
      }
    }
    const ext = skinFile.slice(skinFile.lastIndexOf('.')).toLowerCase();
    return { kind: 'file', file: skinFile, contentType: MIME[ext] ?? 'application/octet-stream' };
  }

  if (scope !== 'thumb') {
    return { kind: 'text', status: 400, body: 'fish-body: expected /dsh-pet-7340/thumb/<petId>/<file>' };
  }

  // thumb 是三段式：/<scope>/<petId>/<file>——从这里再拆宠物 id 与文件名
  const [petId, ...nameParts] = restParts;

  if (!petId || nameParts.length === 0) {
    return { kind: 'text', status: 400, body: 'fish-body: expected /dsh-pet-7340/thumb/<petId>/<file>' };
  }

  // petId 是标识符（= pet/<名>-animation/ 的 <名>，来源是 pet/ 下的文件名前缀），不是路径片段：
  // 含分隔符/保留字符即显式 400，早于任何路径拼接判定。合法名（含中文）照常——
  // 用非法字符类而不是 ASCII 白名单。非法输入不再静默回落到主素材池（攻击尝试与「没有独立素材」可区分），
  // 也给下面的 resolveAsset 之外再留一道结构性防线。
  if (!isValidPetId(petId)) {
    return { kind: 'text', status: 400, body: 'fish-body: invalid pet id' };
  }

  const fileName = nameParts.join('/');

  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();

  if (ext !== '.webm' && ext !== '.mov') {
    return { kind: 'text', status: 400, body: 'fish-body: unsupported animation format (expected .webm or .mov)' };
  }

  // 素材归属：`pet/<素材根>-animation/` 存在则先查它；随后查共享资源池的平铺动画（`<池>/webm/`）；
  // 仍未命中走主素材链（用户根 → 包内根）。extraAnimDir 必须先过 resolveAsset：petId 是解码后的 URL 段，
  // Windows 上 %5C 解出的反斜杠不会被 split('/') 切开，直接 join 会让 `..\..\x` 逃出用户根读盘。
  // 素材根写 `pool` 时只查池（虚拟根没有 pack）。
  const fromPool = petId === POOL_ASSET_ROOT;
  // 池的平铺动画目录：多根时按根序全都作为候选（先命中的赢；bare 外部根就是根本身）
  const poolDirs = poolLayerDirs(poolRootList, 'webm');
  const extraAnimDir = fromPool ? undefined : resolveAsset(petConfigDir, petId + '-animation');

  /** 按扩展名查同名素材（专属目录 → 池（多根按序）→ 已装资源包 → 用户根 → 包内根） */
  const findAnim = (e: string): string | undefined => {
    const name = fileName.replace(/\.(webm|mov)$/i, '') + e;
    const candidates: string[] = [];
    if (extraAnimDir !== undefined && existsSync(extraAnimDir)) candidates.push(extraAnimDir);
    candidates.push(...poolDirs);
    // 动画 extras 包（`packs/<id>/`，包根平铺 `*.webm`）：装进来就能播，与池同一档优先级。
    // 只认「装好了」的包（listInstalled 读标记），半装目录不参与。
    for (const pack of listInstalled(deps.packsRoot)) candidates.push(join(deps.packsRoot, pack.id));
    if (!fromPool && typeof userRootFor === 'function' && typeof assetRootFor === 'function') {
      candidates.push(userRootFor(e), assetRootFor(e));
    }
    for (const dir of candidates) {
      const hit = resolveExisting(dir, name);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };

  let file = findAnim(ext);

  let servedExt = ext;

  // mov（HEVC-with-Alpha，macOS 定制）不随包发布：缺失时退回同名 webm。
  // 宿主是唯一知道素材在不在的一方——宁可让 Safari 播黑底（webm 的 alpha 被丢弃），
  // 也不能让整段动画 404（表现就是宠物完全不显示）。
  if (file === undefined && ext === '.mov') {
    const fb = findAnim('.webm');
    if (fb !== undefined) {
      file = fb;
      servedExt = '.webm';
    }
  }

  if (file === undefined) return { kind: 'text', status: 404, body: 'fish-body: asset not found' };

  return { kind: 'file', file, contentType: MIME[servedExt] ?? 'application/octet-stream' };
}
