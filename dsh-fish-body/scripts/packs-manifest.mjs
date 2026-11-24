/**
 * 资源包清单写真工具：把素材 zip 的真实事实（`bytes` / `sha256` / `files`）合并进 `assets/packs.json`。
 *
 * 为什么要有这个脚本：
 * - 清单是运行期下载的唯一凭据（契约见 `src/shared/packs.ts`）：`bytes` 是下载完的廉价预检，
 *   `sha256` 是唯一可信的完整性凭据，`files` 防止「空包也算装好了」。这三项手填必然写错，
 *   只能从 zip 本体算出来；算错一次，用户侧就是「下载成功但装不上」。
 * - 所以它只做「读 zip → 算事实 → 合并进清单」，**不创建 zip**：打包在 CI 里由 7z / Compress-Archive
 *   完成，字节只由一个环节产出；脚本再去改字节就会变成两处真源，清单和产物对不上。
 * - `sha256` 走流式：动画包几十 MB，整包 `readFileSync` 进内存既没必要，也会在 CI 小机器上顶爆堆。
 * - `--check` 服务于漂移检测：zip 重打后哈希变了但清单没更新，CI 必须在这里红，而不是等用户下载失败。
 *
 * 边界：
 * - 不联网：`--url` 只校验 https 形状，不探活、不下载、不校验远端字节。
 * - 只写 `--out`（缺省 `assets/packs.json`）和它的 `<out>.tmp` 临时文件，不碰仓库其它文件。
 * - 解压只在系统临时目录里做，统计完立刻递归删除；zip 本身只读。
 * - 清单校验用脚本内自带的轻量规则（逐条对齐 zod 契约），**不 import `.ts`**：
 *   这个脚本由普通 `node` 直接跑，不能依赖 `--experimental-strip-types`。
 *
 * 用法（在 `dsh-fish-body/` 下）：
 *   node scripts/packs-manifest.mjs --zip <file> --id <pack-id> --kind <fonts|memes|anims|cubism> \
 *     --label <中文名> --license <许可标识> --url <https地址>[,<https地址2>...] \
 *     [--note <说明>] [--out <manifest路径>] [--check]
 *
 * 退出码：0 成功（或 `--check` 一致）；1 参数/zip/清单/校验任一环节失败，且 stderr 上只留一行可操作中文。
 *
 * @module dsh-fish-body/scripts/packs-manifest
 */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** 脚本自身位置：缺省输出路径以它为准，跟着 cwd 走会写到别处去。 */
const here = dirname(fileURLToPath(import.meta.url));

/** 缺省清单：清单随代码走，素材本体既不进仓库也不进 npm 包。 */
const defaultOut = resolve(here, '..', 'assets', 'packs.json');

/** 与 `src/shared/packs.ts` 逐条对齐的契约常量；改动必须两边同步，否则清单会被宿主拒收。 */
const PACK_KINDS = new Set(['fonts', 'memes', 'anims', 'cubism']);
const PACK_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_PACKS = 64;
const MAX_BYTES = 4_000_000_000;
const MAX_FILES = 200_000;

/** 单行用法提示：所有参数类错误都把它带上，省得人再去翻文档。 */
const usage =
  'node scripts/packs-manifest.mjs --zip <file> --id <pack-id> --kind <fonts|memes|anims|cubism> ' +
  '--label <中文名> --license <许可标识> --url <https地址>[,<https地址2>...] ' +
  '[--note <说明>] [--out <manifest路径>] [--check]';

/** 参数选项表；`--url` 允许重复，重复与逗号分隔等价（多镜像时两种写法都自然）。 */
const options = {
  zip: { type: 'string' },
  id: { type: 'string' },
  kind: { type: 'string' },
  label: { type: 'string' },
  license: { type: 'string' },
  url: { type: 'string', multiple: true },
  note: { type: 'string' },
  out: { type: 'string' },
  check: { type: 'boolean' },
};

/** 预期内的失败：只用来区分「可操作提示」与「真 bug」，两者都走同一条 stderr 出口。 */
class UserError extends Error {}

/** 把任意 catch 到的值压成一句可读原因（Node 的 fs 错误 message 已经够具体）。 */
function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/** 逐条校验清单一条记录；返回第一条问题（带路径），合法返回 null。 */
function findEntryProblem(value, at) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return at + '：必须是对象';
  if (typeof value.id !== 'string' || !PACK_ID.test(value.id)) {
    return at + '.id：只能是小写字母/数字/连字符，首位是字母或数字，最长 32 位';
  }
  if (!PACK_KINDS.has(value.kind)) return at + '.kind：只能是 ' + [...PACK_KINDS].join(' / ');
  if (typeof value.label !== 'string' || value.label.length < 1 || value.label.length > 80) {
    return at + '.label：1–80 个字符';
  }
  if (typeof value.license !== 'string' || value.license.length < 1 || value.license.length > 120) {
    return at + '.license：1–120 个字符';
  }
  if (!Number.isInteger(value.bytes) || value.bytes <= 0 || value.bytes > MAX_BYTES) {
    return at + '.bytes：必须是正整数字节数（≤ ' + MAX_BYTES + '）';
  }
  if (typeof value.sha256 !== 'string' || !SHA256_HEX.test(value.sha256)) {
    return at + '.sha256：必须是 64 位小写十六进制';
  }
  if (!Array.isArray(value.urls) || value.urls.length < 1 || value.urls.length > 8) {
    return at + '.urls：1–8 个地址';
  }
  if (!value.urls.every((url) => typeof url === 'string' && url.startsWith('https://'))) {
    return at + '.urls：每个地址都必须是 https';
  }
  if (!Number.isInteger(value.files) || value.files <= 0 || value.files > MAX_FILES) {
    return at + '.files：必须是正整数文件数（≤ ' + MAX_FILES + '）';
  }
  if (value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 400)) {
    return at + '.note：必须是 ≤ 400 字符的字符串';
  }
  return null;
}

/** 校验整份清单形状；未知字段一律放过（宿主侧 zod 也只在已知字段上判形状）。 */
function findManifestProblem(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return '(root)：清单必须是对象';
  if (data.schema !== 1) return 'schema：必须是 1';
  if (!Array.isArray(data.packs)) return 'packs：必须是数组';
  if (data.packs.length > MAX_PACKS) return 'packs：最多 ' + MAX_PACKS + ' 个包';
  for (let index = 0; index < data.packs.length; index += 1) {
    const problem = findEntryProblem(data.packs[index], 'packs.' + index);
    if (problem !== null) return problem;
  }
  return null;
}

/**
 * 读现有清单。
 *
 * 文件不存在或只有空白字符时按「还没写过」处理：CI 里 `touch` 出来的空文件不该挡住第一条写入。
 * 已存在但解析/形状不对则直接失败——静默修正会把别人的手误变成「自动删条目」。
 */
function loadManifest(outPath) {
  if (!existsSync(outPath)) return { schema: 1, packs: [] };
  const raw = readFileSync(outPath, 'utf8');
  if (raw.trim() === '') return { schema: 1, packs: [] };
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new UserError('现有清单不是合法 JSON：' + outPath + '（' + reasonOf(error) + '）；修好或删掉它再跑');
  }
  const problem = findManifestProblem(data);
  if (problem !== null) {
    throw new UserError('现有清单形状不合法：' + outPath + ' · ' + problem + '；修好或删掉它再跑');
  }
  return data;
}

/** 流式算 sha256：大包不进内存，边读边喂哈希。 */
async function sha256OfFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

/** 递归统计普通文件数：目录与符号链接都不计，和 `files` 的语义（解压后能打开的文件）一致。 */
function countFiles(dirPath) {
  let count = 0;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFiles(join(dirPath, entry.name));
    else if (entry.isFile()) count += 1;
  }
  return count;
}

/**
 * 解压到系统临时目录后数文件数，统计完立刻删临时目录。
 *
 * 用它而不是自己解析 zip 目录：平台差异（反斜杠条目、绝对路径、UTF-8 标志位）都由这个依赖处理，
 * 而且「解压得开」本身就是发布前该验的一条。
 */
async function countZipFiles(zipPath) {
  let extract;
  try {
    ({ default: extract } = await import('@electron-internal/extract-zip'));
  } catch (error) {
    throw new UserError(
      '缺少依赖 @electron-internal/extract-zip：先在 dsh-fish-body/ 下执行 pnpm install（' + reasonOf(error) + '）',
    );
  }
  const workDir = mkdtempSync(join(tmpdir(), 'packs-manifest-'));
  try {
    try {
      await extract(zipPath, { dir: workDir });
    } catch (error) {
      throw new UserError(
        '压缩包无法解压：' +
          zipPath +
          '（' +
          reasonOf(error) +
          '）；请确认它是完整 zip（7z / Compress-Archive 生成），且没有被别处占用',
      );
    }
    return countFiles(workDir);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** 从参数里收下载地址：重复传参与逗号分隔等价；空段算错误而不是悄悄丢掉。 */
function collectUrls(values) {
  const urls = values.flatMap((value) => value.split(',')).map((value) => value.trim());
  if (urls.some((url) => url === '')) {
    throw new UserError('--url 里有空地址：逗号分隔的每一项都必须是完整 https 地址；用法：' + usage);
  }
  return urls;
}

/** 主流程：解析参数 → 算 zip 事实 → 写入或核对。失败一律抛 UserError，由底部统一收口。 */
async function main() {
  let values;
  try {
    values = parseArgs({ options, strict: true, allowPositionals: false }).values;
  } catch (error) {
    throw new UserError('命令行参数无法解析：' + reasonOf(error) + '；用法：' + usage);
  }

  const checkOnly = values.check === true;
  if (values.zip === undefined) throw new UserError('缺少必需参数 --zip；用法：' + usage);
  const id = (values.id ?? '').trim();
  if (id === '') throw new UserError('缺少必需参数 --id；用法：' + usage);
  if (!PACK_ID.test(id)) {
    throw new UserError('包 id 不合法：' + id + '；只能是小写字母/数字/连字符，首位是字母或数字，最长 32 位');
  }

  const outPath = values.out === undefined ? defaultOut : resolve(values.out);
  const manifest = loadManifest(outPath);
  const existing = manifest.packs.find((pack) => pack.id === id);

  // --check 只核对三件事实，不需要 label/license/url；写模式才要求全部给齐。
  let kind;
  let label;
  let license;
  let urls;
  let note;
  if (!checkOnly) {
    kind = values.kind;
    if (kind === undefined) throw new UserError('缺少必需参数 --kind；用法：' + usage);
    if (!PACK_KINDS.has(kind)) {
      throw new UserError('包种类不合法：' + kind + '；只能是 ' + [...PACK_KINDS].join(' / '));
    }
    label = values.label;
    if (label === undefined || label.trim() === '') throw new UserError('缺少必需参数 --label；用法：' + usage);
    license = values.license;
    if (license === undefined || license.trim() === '') throw new UserError('缺少必需参数 --license；用法：' + usage);
    if (values.url === undefined || values.url.length === 0) {
      throw new UserError('缺少必需参数 --url；用法：' + usage);
    }
    urls = collectUrls(values.url);
    for (const url of urls) {
      if (!url.startsWith('https://')) throw new UserError('下载地址必须是 https：' + url);
    }
    note = values.note;
  }

  if (checkOnly && !existsSync(outPath)) {
    throw new UserError('清单不存在：' + outPath + '；先跑一次不带 --check 的写入');
  }

  const zipPath = resolve(values.zip);
  if (!existsSync(zipPath)) throw new UserError('压缩包不存在：' + zipPath + '；先在 CI 里打出 zip 再跑本脚本');
  const zipStats = statSync(zipPath);
  if (!zipStats.isFile()) throw new UserError('--zip 指向的不是文件：' + zipPath);
  const bytes = zipStats.size;
  if (bytes <= 0) throw new UserError('压缩包是空文件（0 字节）：' + zipPath);
  if (bytes > MAX_BYTES) throw new UserError('压缩包超出清单上限（> ' + MAX_BYTES + ' 字节）：' + zipPath);

  const sha256 = await sha256OfFile(zipPath);
  const files = await countZipFiles(zipPath);
  if (files === 0) throw new UserError('压缩包内没有普通文件：' + zipPath + '；空包不能登记为素材包');

  if (checkOnly) {
    if (existing === undefined) {
      throw new UserError('清单里没有包 id ' + id + '：' + outPath + '；先跑一次不带 --check 的写入');
    }
    const drift = [];
    if (existing.bytes !== bytes) drift.push('bytes：清单 ' + existing.bytes + ' ≠ 压缩包 ' + bytes);
    if (existing.sha256 !== sha256) drift.push('sha256：清单 ' + existing.sha256 + ' ≠ 压缩包 ' + sha256);
    if (existing.files !== files) drift.push('files：清单 ' + existing.files + ' ≠ 压缩包 ' + files);
    if (drift.length > 0) {
      console.error('✗ 清单与压缩包不一致（' + id + '）：' + outPath);
      for (const item of drift) console.error('  - ' + item);
      console.error('  修法：用同一个 zip 重跑本脚本（去掉 --check）覆盖该条');
      process.exit(1);
    }
    console.log('✓ 一致：' + id + ' · bytes ' + bytes + ' · sha256 ' + sha256 + ' · files ' + files);
    return;
  }

  const entry = { id, kind, label, license, bytes, sha256, urls, files, ...(note === undefined ? {} : { note }) };
  const packs =
    existing === undefined ? [...manifest.packs, entry] : manifest.packs.map((pack) => (pack.id === id ? entry : pack));
  if (packs.length > MAX_PACKS) {
    throw new UserError('清单已有 ' + MAX_PACKS + ' 个包，无法再追加：' + id + '；超过上限说明设计跑偏了');
  }

  const text = JSON.stringify({ schema: 1, packs }, null, 2) + '\n';
  // 序列化后再校验一遍：JSON 往返会丢掉 undefined / NaN 之类的东西，光验内存对象照不出这类差异。
  const problem = findManifestProblem(JSON.parse(text));
  if (problem !== null) throw new UserError('生成的清单不合法（' + problem + '）；检查参数里的长度与数字范围');

  mkdirSync(dirname(outPath), { recursive: true });
  const tmpPath = outPath + '.tmp';
  try {
    // 原子替换：先写 .tmp 再 rename，中途失败不会留下半截清单让宿主解析失败。
    writeFileSync(tmpPath, text, 'utf8');
    renameSync(tmpPath, outPath);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw new UserError('写入清单失败：' + outPath + '（' + reasonOf(error) + '）');
  }

  if (readFileSync(outPath, 'utf8') !== text) {
    throw new UserError('写盘后复核失败：' + outPath + ' 的内容与预期不一致（可能被别处同时改写）');
  }

  console.log('✓ ' + (existing === undefined ? '新增' : '更新') + ' ' + id + ' → ' + outPath);
  console.log('  bytes: ' + bytes);
  console.log('  sha256: ' + sha256);
  console.log('  files: ' + files);
}

try {
  await main();
} catch (error) {
  // 所有失败都收敛成「一行中文 + exit 1」：CI 日志里不该出现未捕获异常的栈。
  const message = error instanceof UserError ? error.message : '未预期的失败：' + reasonOf(error);
  console.error('✗ ' + message);
  process.exit(1);
}
