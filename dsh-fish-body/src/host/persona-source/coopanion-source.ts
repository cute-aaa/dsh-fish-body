/**
 * Coopanion 的人格来源：读它工作区里的 `PARTNER.md`（+ 可选的 `partner/` 细节目录）。
 *
 * 依据（v0.2.x 源码）：`core/persona.ts` 里 `PARTNER_FILE = 'PARTNER.md'`、`PARTNER_DIR = 'partner'`，
 * 这份文件**整份进 system 前缀**——在本插件里它就是人设正文。
 *
 * 路径不确定是刻意的实情：它的工作区目录由 Electron 主进程在运行时决定（`memoryDir`），
 * 源码里没有写死的常量。所以这里**列候选目录**而不是猜一个：命中哪个用哪个，都没命中就是未安装。
 * 用户也随时可以用「自定义路径」来源直接指到自己的 `PARTNER.md`。
 *
 * 只读：不搬它的文件（它的 `arrangePartner` 会自己整理 `partner/`，我们不掺和）。
 * @module dsh-fish-body/src/host/persona-source/coopanion-source
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { markdownCardOf, readMarkdownPersona, type MarkdownDoc } from './markdown-card.ts';
import type { PersonaResolution, PersonaScanResult, PersonaSource, PersonaSourceAvailability } from './types.ts';

/** 注册表里的 id 与展示名。 */
const SOURCE_ID = 'coopanion';
const SOURCE_NAME = 'Coopanion';

/** 主文件与它放「关于人」细节的子目录（与 `core/persona.ts` 的常量同名）。 */
const PARTNER_FILE = 'PARTNER.md';
const PARTNER_DIR = 'partner';

/** 单个文档上限：与卡片扫描同一条防线。 */
const MAX_DOC_BYTES = 1024 * 1024;

/** 一份解析出来的工作区位置。 */
interface Workspace {
  /** 工作区目录（绝对路径）。 */
  readonly dir: string;
  /** `PARTNER.md` 的绝对路径。 */
  readonly file: string;
}

/**
 * 候选工作区：命中含 `PARTNER.md` 的那个。
 *
 * 顺序即优先级：先看本插件数据根旁边的约定位置（`<DSH_HOME>/coopanion`），
 * 再看 Electron 的 userData 与常见的家目录位置。**只认 `PARTNER.md` 存在**——
 * 光有目录不算装过，否则每个候选都会被当成「已安装但空」。
 */
function candidatesOf(dshHome: string, home: string, appData: string): string[] {
  const roots = [
    join(dshHome, 'coopanion'),
    join(home, '.coopanion'),
    join(appData, 'Coopanion'),
    join(appData, 'coopanion'),
  ];
  const out: string[] = [];
  for (const root of roots) {
    if (root.trim() === '') continue;
    // 主文件可能直接在根上，也可能在 `memory/` 下（它的工作区就是 memoryDir）
    for (const dir of [root, join(root, 'memory')]) {
      if (existsSync(join(dir, PARTNER_FILE))) out.push(dir);
    }
  }
  return out;
}

/** 读一目录下的 Markdown（一层，跳过隐藏与超限）。 */
function docsIn(dir: string): MarkdownDoc[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: MarkdownDoc[] = [];
  for (const name of names.sort()) {
    if (name.startsWith('.') || !name.toLowerCase().endsWith('.md')) continue;
    const path = join(dir, name);
    try {
      const stat = statSync(path);
      if (!stat.isFile() || stat.size > MAX_DOC_BYTES) continue;
      out.push({ name, text: readFileSync(path, 'utf8') });
    } catch {
      // 读不到就跳过：一份细节文档缺失不该让整个人设导入失败
    }
  }
  return out;
}

/**
 * 把工作区折成 8 字段：`PARTNER.md` 是正文，`partner/*.md` 按文件名并成「关于主人」段。
 *
 * `partner/` 里的文件名是主题名（`food-likes-and-dislikes.md`），语义由文件名承载，
 * 所以沿用 Markdown 归一器那套「按文件名定标签」的做法会被认成未知文件——这里显式改名成
 * `user-<主题>.md` 借它的「关于主人」标签，内容与顺序都不动。
 */
function cardOfWorkspace(ws: Workspace): MarkdownDoc[] {
  const docs: MarkdownDoc[] = docsIn(ws.dir)
    .filter((doc) => doc.name.toUpperCase() === PARTNER_FILE.toUpperCase())
    // 主文件就是人设正文：显式给 soul（排在第一位、不戴标签），否则文件名 PARTNER 认不出语义、
    // 会被排到 partner/ 的细节之后，正文变成「细节在前、人设在后」。
    .map((doc) => ({ ...doc, role: 'soul' }));
  // 主文件在 `memory/` 下时，细节目录在同一层
  const detailDir = join(ws.dir, PARTNER_DIR);
  if (existsSync(detailDir)) {
    for (const doc of docsIn(detailDir)) docs.push({ name: doc.name, text: doc.text, role: 'user' });
  }
  return docs;
}

/** 造一个 Coopanion 人格来源。 */
export function createCoopanionSource(options: {
  readonly dshHome: string;
  readonly home: string;
  readonly appData: string;
  readonly id?: string;
  readonly name?: string;
}): PersonaSource {
  const locate = (): Workspace | undefined => {
    const [dir] = candidatesOf(options.dshHome, options.home, options.appData);
    return dir === undefined ? undefined : { dir, file: join(dir, PARTNER_FILE) };
  };

  const probe = async (): Promise<PersonaSourceAvailability> => {
    const ws = locate();
    return { installed: ws !== undefined, path: ws?.file ?? join(options.dshHome, 'coopanion', PARTNER_FILE) };
  };

  const scan = async (): Promise<PersonaScanResult> => {
    const ws = locate();
    if (ws === undefined) return { characters: [], skipped: [] };
    const docs = cardOfWorkspace(ws);
    if (docs.length === 0) return { characters: [], skipped: [{ path: ws.file, reason: 'invalid-card' }] };
    const card = markdownCardOf(docs);
    if (card.description.trim() === '') {
      return { characters: [], skipped: [{ path: ws.file, reason: 'empty' }] };
    }
    // 来源记工作区目录：角色由 `PARTNER.md` + `partner/` 合成，指着一份说「来自这里」是错的
    return { characters: [{ name: card.name, text: card.description, path: ws.dir, data: card }], skipped: [] };
  };

  return {
    id: options.id ?? SOURCE_ID,
    name: options.name ?? SOURCE_NAME,
    kind: 'soul-card',
    watchPath: join(options.dshHome, 'coopanion', PARTNER_FILE),
    probe,
    scan,
    resolve: async (): Promise<PersonaResolution> => {
      const ws = locate();
      if (ws === undefined) return { ok: false, reason: 'not-found', message: join(options.dshHome, 'coopanion') };
      return readMarkdownPersona(ws.file);
    },
  };
}
