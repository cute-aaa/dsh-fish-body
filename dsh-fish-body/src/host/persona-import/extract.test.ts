/**
 * 文档抽取的单元测试：五种类型的成功路径 + 四种拒绝 + 大小/数量闸门 + 零写盘。
 *
 * docx 用内存里现搭的最小 zip（stored，无压缩）——mammoth 只认真正的 OOXML 容器，
 * 拿假魔数糊过去会测不到解析分支。
 * @module dsh-fish-body/src/host/persona-import/extract.test
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DOCX_MAX_ENTRIES, DOCX_MAX_UNCOMPRESSED_BYTES, extractDocuments } from './extract.ts';

/** CRC32 表（zip 用的标准多项式）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/** 算一段字节的 CRC32。 */
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 用 stored（无压缩）条目拼一个最小 zip。 */
function zip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + entry.data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, directory, end]);
}

/** 造一份最小可解析的 .docx。 */
function docx(text: string): Buffer {
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:r><w:t>' +
    text +
    '</w:t></w:r></w:p></w:body></w:document>';
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
  ]);
}

/** 造一张带 chara tEXt 块的 PNG 卡（CRC 留空，解析器不校验）。 */
function pngWithCard(card: unknown): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const data = Buffer.concat([
    Buffer.from('chara\0', 'latin1'),
    Buffer.from(Buffer.from(JSON.stringify(card), 'utf8').toString('base64'), 'latin1'),
  ]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const chunk = Buffer.concat([length, Buffer.from('tEXt', 'latin1'), data, Buffer.alloc(4)]);
  const iend = Buffer.concat([Buffer.alloc(4), Buffer.from('IEND', 'latin1'), Buffer.alloc(4)]);
  return Buffer.concat([signature, chunk, iend]);
}

/** 一张没有 chara 块的合法 PNG。 */
function plainPng(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0]),
  ]);
}

/** v2 卡对象。 */
const CARD = {
  spec: 'chara_card_v2',
  data: { name: '鱼生', description: '蓝色大肥鱼', personality: '慵懒', scenario: '', first_mes: '', mes_example: '' },
};

/** base64 包装。 */
const b64 = (bytes: Buffer | string): string =>
  Buffer.isBuffer(bytes) ? bytes.toString('base64') : Buffer.from(bytes, 'utf8').toString('base64');

test('五种类型各一条成功用例', async () => {
  const result = await extractDocuments([
    { name: '鱼生.md', base64: b64('# 鱼生\n\n一只蓝色大肥鱼。') },
    { name: '备注.txt', base64: b64('\uFEFF附注：爱吃零食。') },
    { name: 'card.json', base64: b64(JSON.stringify(CARD)) },
    { name: 'card.png', base64: b64(pngWithCard(CARD)) },
    { name: 'doc.docx', base64: b64(docx('文档里的鱼生')) },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.files.map((file) => file.kind),
    ['md', 'txt', 'json', 'png', 'docx'],
  );
  assert.equal(result.files[0].text, '# 鱼生\n\n一只蓝色大肥鱼。');
  assert.equal(result.files[1].text, '附注：爱吃零食。', 'BOM 必须去掉');
  assert.equal(result.files[2].card?.name, '鱼生');
  assert.equal(result.files[3].card?.name, '鱼生');
  assert.match(result.files[4].text, /文档里的鱼生/);
});

test('.doc 与无 chara 块的 PNG → unsupported（各带可读原因）', async () => {
  const doc = await extractDocuments([{ name: 'old.doc', base64: b64('binary') }]);
  assert.equal(doc.ok, false);
  if (!doc.ok) {
    assert.equal(doc.reason, 'unsupported');
    assert.match(doc.message, /另存为 \.docx/);
  }
  const png = await extractDocuments([{ name: 'pic.png', base64: b64(plainPng()) }]);
  assert.equal(png.ok, false);
  if (!png.ok) {
    assert.equal(png.reason, 'unsupported');
    assert.match(png.message, /没有人设卡数据/);
  }
});

test('坏 JSON 按纯文本兜底（不直接失败）', async () => {
  const result = await extractDocuments([{ name: 'broken.json', base64: b64('{不是 json 但是有文字') }]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.files[0].kind, 'json');
  assert.equal(result.files[0].card, undefined);
  assert.match(result.files[0].text, /有文字/);
});

test('空文本 → extract-failed', async () => {
  const result = await extractDocuments([{ name: 'empty.txt', base64: b64('   \n\n  ') }]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'extract-failed');
});

test('6 个文件 → too-many-items', async () => {
  const files = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.txt`, base64: b64('文字') }));
  const result = await extractDocuments(files);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'too-many-items');
});

test('单文件 800 KiB → payload-too-large', async () => {
  const result = await extractDocuments([{ name: 'big.txt', base64: b64(Buffer.alloc(800 * 1024, 0x61)) }]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'payload-too-large');
});

test('调用前后目标目录内容一致（抽取零写盘）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'import-extract-'));
  try {
    await writeFile(join(dir, 'main-config.jsonc'), '{"pets":[]}', 'utf8');
    const before = (await readdir(dir)).sort();
    await extractDocuments([{ name: 'a.md', base64: b64('一些文本') }]);
    assert.deepEqual((await readdir(dir)).sort(), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** 造一个只有中央目录的 zip：用来测「解压闸门」而不真解压。 */
function zipStub(entries: number, uncompressedPerEntry: number): Buffer {
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  const central = Buffer.alloc(46 * entries);
  for (let index = 0; index < entries; index += 1) {
    const at = index * 46;
    central.writeUInt32LE(0x02014b50, at);
    central.writeUInt32LE(uncompressedPerEntry, at + 24);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries, 10);
  eocd.writeUInt32LE(46 * entries, 12);
  eocd.writeUInt32LE(30, 16);
  return Buffer.concat([local, central, eocd]);
}

test('docx 解压闸门：条目数超限 → extract-failed，且不进入 mammoth', async () => {
  const bomb = zipStub(DOCX_MAX_ENTRIES + 1, 1024);
  const outcome = await extractDocuments([{ name: 'bomb.docx', base64: bomb.toString('base64') }]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, 'extract-failed');
  assert.match(outcome.message, /解压后超过上限/);
  assert.match(outcome.message, new RegExp(String(DOCX_MAX_ENTRIES + 1)));
});

test('docx 解压闸门：解压总量超限 → extract-failed', async () => {
  const big = zipStub(4, Math.ceil(DOCX_MAX_UNCOMPRESSED_BYTES / 4) + 1);
  const outcome = await extractDocuments([{ name: 'big.docx', base64: big.toString('base64') }]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, 'extract-failed');
  assert.match(outcome.message, /解压后超过上限/);
});

test('边界：恰好 768 KiB 的解码总量就已经越界（768 KiB − 4 KiB 预算）', async () => {
  const edge = Buffer.alloc(768 * 1024, 0x41).toString('base64');
  const outcome = await extractDocuments([{ name: 'edge.txt', base64: edge }]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, 'payload-too-large');
  assert.match(outcome.message, /768 KiB − 4 KiB/);
});

test('边界：预算内（768 KiB − 4 KiB − 1）能通过解码闸门', async () => {
  const ok = Buffer.alloc(768 * 1024 - 4096 - 1, 0x41).toString('base64');
  const outcome = await extractDocuments([{ name: 'ok.txt', base64: ok }]);
  assert.equal(outcome.ok, true, '预算内必须放行，不能再被 1 MiB 的老口径卡住');
});
