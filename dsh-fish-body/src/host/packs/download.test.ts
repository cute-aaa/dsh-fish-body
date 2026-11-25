/**
 * 下载兜底的契约：代理只从环境 / 注册表读、curl 只做兜底、失败要把两个原因都说出来。
 *
 * 这一层存在的理由是实测到的故障：Node 的 `fetch` 不读系统代理，Windows 用户点了下载会直接超时。
 * @module dsh-fish-body/src/host/packs/download.test
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { downloadViaProxy, parseProxy, proxyOf } from './download.ts';

const ROOT = mkdtempSync(join(tmpdir(), 'pack-download-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

describe('parseProxy', () => {
  test('认 host:port 与 http://host:port', () => {
    assert.deepEqual(parseProxy('127.0.0.1:7897'), { host: '127.0.0.1', port: 7897 });
    assert.deepEqual(parseProxy('http://127.0.0.1:7897'), { host: '127.0.0.1', port: 7897 });
    assert.deepEqual(parseProxy('http://proxy.local:3128/'), { host: 'proxy.local', port: 3128 });
  });

  test('空 / 非法端口 / 越界 → undefined', () => {
    assert.equal(parseProxy(''), undefined);
    assert.equal(parseProxy(undefined), undefined);
    assert.equal(parseProxy('host'), undefined);
    assert.equal(parseProxy('host:0'), undefined);
    assert.equal(parseProxy('host:99999'), undefined);
  });

  test('socks 不认（http(s)_proxy 里出现 socks 语义模糊，不猜）', () => {
    assert.equal(parseProxy('socks5://127.0.0.1:1080'), undefined);
    assert.equal(parseProxy('socks4://127.0.0.1:1080'), undefined);
  });
});

describe('proxyOf', () => {
  test('环境变量优先：HTTPS_PROXY', () => {
    assert.deepEqual(proxyOf({ env: { HTTPS_PROXY: '127.0.0.1:7897' }, platform: 'linux' }), {
      host: '127.0.0.1',
      port: 7897,
    });
  });

  test('小写 https_proxy 也认', () => {
    assert.deepEqual(proxyOf({ env: { https_proxy: '10.0.0.1:8080' }, platform: 'linux' }), {
      host: '10.0.0.1',
      port: 8080,
    });
  });

  test('环境变量没有时，Windows 才回退注册表', () => {
    const readRegistry = (): { host: string; port: number } => ({ host: '127.0.0.1', port: 7897 });
    assert.deepEqual(proxyOf({ env: {}, platform: 'win32', readRegistry }), { host: '127.0.0.1', port: 7897 });
    assert.equal(proxyOf({ env: {}, platform: 'darwin', readRegistry }), undefined, '非 Windows 不读注册表');
  });

  test('注册表读取抛错 → 当作没有代理（不让它阻断下载）', () => {
    const readRegistry = (): { host: string; port: number } => {
      throw new Error('reg 不可用');
    };
    assert.equal(proxyOf({ env: {}, platform: 'win32', readRegistry }), undefined);
  });

  test('环境变量非法时继续看注册表', () => {
    const readRegistry = (): { host: string; port: number } => ({ host: '127.0.0.1', port: 7897 });
    assert.deepEqual(proxyOf({ env: { HTTPS_PROXY: 'socks5://x:1' }, platform: 'win32', readRegistry }), {
      host: '127.0.0.1',
      port: 7897,
    });
  });
});

describe('downloadViaProxy', () => {
  test('curl 退出 0 且文件非空 → ok', async () => {
    const dest = join(ROOT, 'ok.zip');
    const result = await downloadViaProxy(
      'https://example.test/a.zip',
      dest,
      { host: '127.0.0.1', port: 7897 },
      {
        runCurl: (args) => {
          // 断言关键参数：代理、跟随重定向、失败即非零、输出文件
          assert.ok(args.includes('--proxy'));
          assert.ok(args.includes('127.0.0.1:7897'));
          assert.ok(args.includes('--location'));
          assert.ok(args.includes('--fail'));
          assert.ok(args.includes(dest));
          writeFileSync(dest, 'zip-bytes');
          return { status: 0, stderr: '' };
        },
      },
    );
    assert.equal(result.ok, true);
  });

  test('curl 非零 → 失败，消息带退出码与 stderr 尾部', async () => {
    const result = await downloadViaProxy(
      'https://example.test/a.zip',
      join(ROOT, 'fail.zip'),
      { host: '127.0.0.1', port: 7897 },
      { runCurl: () => ({ status: 56, stderr: 'curl: (56) Recv failure\ncurl: (56) 连接被重置' }) },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.message.includes('56'));
      assert.ok(result.message.includes('连接被重置'));
    }
  });

  test('curl 退出 0 但文件为空 → 仍算失败（--fail 只管 HTTP 状态）', async () => {
    const dest = join(ROOT, 'empty.zip');
    const result = await downloadViaProxy(
      'https://example.test/a.zip',
      dest,
      { host: '127.0.0.1', port: 7897 },
      {
        runCurl: () => {
          writeFileSync(dest, '');
          return { status: 0, stderr: '' };
        },
      },
    );
    assert.equal(result.ok, false);
  });

  test('curl 本身起不来 → 失败但不抛', async () => {
    const result = await downloadViaProxy(
      'https://example.test/a.zip',
      join(ROOT, 'x.zip'),
      {
        host: '127.0.0.1',
        port: 7897,
      },
      {
        runCurl: () => {
          throw new Error('spawn curl ENOENT');
        },
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.message.includes('ENOENT'));
  });

  test('超时按秒传（--max-time）', async () => {
    await downloadViaProxy(
      'https://example.test/a.zip',
      join(ROOT, 't.zip'),
      { host: 'h', port: 1 },
      {
        timeoutMs: 30_000,
        runCurl: (args) => {
          const at = args.indexOf('--max-time');
          assert.equal(args[at + 1], '30');
          return { status: 1, stderr: '' };
        },
      },
    );
  });
});
