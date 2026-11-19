/**
 * `POST /voice/provider-config` 的 200 响应在 `openapi.yaml` 里必须同时容纳「成功体」与
 * 「业务失败体」（P2-8）。
 *
 * 这条路由的历史契约是「校验失败也回 200」，文档若只声明成功体（`required: [ok, …]` +
 * `ok: const true`），失败体 `{ok:false, reason, message}` 就成了文档外的形状；改文档的人
 * 下一次很可能顺手把失败体改回 400，把全线客户端的 `ok` 分支打断。
 *
 * 该断言只读 YAML，不起服务、不发请求：`check:openapi` 管「文档自身合法」，这里管
 * 「这条路由的成败两态都写在文档里」。
 * @module dsh-fish-body/src/host/routes/provider-config-openapi.test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
/** js-yaml 没有随包类型（devDependency 由 `check:openapi` 使用），这里只声明用到的一个方法。 */
const yaml = require('js-yaml') as { load(input: string): unknown };

/** 文档在仓库根（`dsh-pet/src/host/routes` → 上四级），与 `scripts/check-openapi.mjs` 同一份。 */
const SPEC_URL = new URL('../../../../openapi.yaml', import.meta.url);

/** 只声明本测试要读的形状，避免用 `any` 把文档结构错误藏起来。 */
interface SchemaNode {
  readonly $ref?: string;
  readonly type?: string;
  readonly const?: unknown;
  readonly required?: readonly string[];
  readonly oneOf?: readonly SchemaNode[];
  readonly properties?: Readonly<Record<string, SchemaNode>>;
}
interface OpenApiDoc {
  readonly paths: Readonly<
    Record<
      string,
      {
        readonly post: {
          readonly responses: Readonly<
            Record<string, { readonly content: Readonly<Record<string, { readonly schema: SchemaNode }>> }>
          >;
        };
      }
    >
  >;
  readonly components: { readonly schemas: Readonly<Record<string, SchemaNode>> };
}

/** 读文档并取 provider-config 的 POST 200 schema。 */
function postOkSchema(): { spec: OpenApiDoc; schema: SchemaNode } {
  const spec = yaml.load(readFileSync(SPEC_URL, 'utf8')) as OpenApiDoc;
  const schema =
    spec.paths['/dsh-pet-7340/voice/provider-config']?.post?.responses['200']?.content['application/json']?.schema;
  assert.ok(schema !== undefined, 'POST /voice/provider-config 的 200 响应 schema 不见了');
  return { spec, schema };
}

test('P2-8：200 响应是 oneOf[成功体, FailureResponse]，失败体不是 400', () => {
  const { spec, schema } = postOkSchema();
  assert.ok(Array.isArray(schema.oneOf), '200 必须用 oneOf 同时声明成功体与失败体');
  assert.equal(schema.oneOf.length, 2, '恰好两支：成功体 + 失败体');

  const [success, failure] = schema.oneOf;
  assert.equal(success.properties?.ok?.const, true, '成功体必须把 ok 钉成 true');
  for (const key of ['ok', 'provider', 'values', 'secrets', 'providers']) {
    assert.ok(success.required?.includes(key), `成功体缺少 required: ${key}`);
  }

  assert.equal(failure.$ref, '#/components/schemas/FailureResponse', '失败体必须复用 FailureResponse');
  const failureSchema = spec.components.schemas.FailureResponse;
  assert.ok(failureSchema !== undefined, 'FailureResponse 未定义');
  for (const key of ['ok', 'reason']) {
    assert.ok(failureSchema.required?.includes(key), `FailureResponse 缺少 required: ${key}`);
  }
});

test('P2-8：400 只留给「请求体不是合法 JSON」，别把业务失败塞进 4xx', () => {
  const { spec } = postOkSchema();
  const responses = spec.paths['/dsh-pet-7340/voice/provider-config'].post.responses;
  const description = JSON.stringify(responses['400']);
  assert.match(description, /JSON/, '400 的语义应仍是「请求体不是合法 JSON」');
  assert.equal(responses['403'], undefined, '缺 key 是业务失败（200 + ok:false），不该新开 403');
});
