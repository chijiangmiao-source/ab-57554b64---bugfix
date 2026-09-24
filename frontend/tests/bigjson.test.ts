// Code-level regression tests for the lossless JSON boundary and the real
// solveBatch request/response path. Bundled with esbuild (platform=node) and
// run under plain node; see verify/run.sh.
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseJsonLossless,
  stringifyJsonLossless,
  fmtInt,
  isZero,
} from "../src/bigjson";
import { solveBatch } from "../src/api";

const BIG = 9007199254740993n; // 2^53 + 1: rounds to ...992 through a double
const BIG_TEXT = "9007199254740993";
const ROUNDED_TEXT = "9007199254740992";

// --------------------------------------------------------------------------- //
// parseJsonLossless
// --------------------------------------------------------------------------- //

test("parse: 超出安全范围的整数保留为 bigint 且不被取整", () => {
  const v = parseJsonLossless(`{"d": ${BIG_TEXT}}`) as { d: bigint };
  assert.equal(typeof v.d, "bigint");
  assert.equal(v.d, BIG);
  assert.notEqual(v.d, BigInt(ROUNDED_TEXT));
});

test("parse: 安全范围内的整数仍是普通 number", () => {
  const v = parseJsonLossless('{"a": 0, "b": 16, "c": -5, "d": 9007199254740991}') as {
    a: unknown;
    b: unknown;
    c: unknown;
    d: unknown;
  };
  assert.deepEqual(v, { a: 0, b: 16, c: -5, d: Number.MAX_SAFE_INTEGER });
  for (const k of ["a", "b", "c", "d"] as const) {
    assert.equal(typeof v[k], "number");
  }
});

test("parse: 小数与科学计数法仍按 number 解析", () => {
  const v = parseJsonLossless('[1.5, -0.25, 1e3, 1.2e-2, 100000000000000000000.0]') as unknown[];
  assert.deepEqual(v, [1.5, -0.25, 1000, 0.012, 1e20]);
});

test("parse: 字符串中的数字文本不被转换", () => {
  const v = parseJsonLossless(`{"s": "${BIG_TEXT}", "u": "中\\u6587"}`) as {
    s: string;
    u: string;
  };
  assert.equal(v.s, BIG_TEXT);
  assert.equal(v.u, "中文");
});

test("parse: 嵌套数组/对象/布尔/null 与标准 JSON 行为一致", () => {
  const text =
    '{"nodes":["R","L1"],"edges":[{"delay":9007199254740993,"cap":0}],"ok":true,"x":null}';
  const v = parseJsonLossless(text) as any;
  assert.deepEqual(v.nodes, ["R", "L1"]);
  assert.equal(v.edges[0].delay, BIG);
  assert.equal(v.edges[0].cap, 0);
  assert.equal(v.ok, true);
  assert.equal(v.x, null);
});

test("parse: 非法 JSON 抛 SyntaxError 且不静默吞掉", () => {
  for (const bad of [
    "",
    "{",
    "[",
    '{"a":}',
    "[1,]",
    '{"a" 1}',
    "01",
    "1.",
    "1e",
    "123abc",
    "{",
    "nu",
  ]) {
    assert.throws(() => parseJsonLossless(bad), SyntaxError, `应拒绝: ${bad}`);
  }
});

// --------------------------------------------------------------------------- //
// stringifyJsonLossless
// --------------------------------------------------------------------------- //

test("stringify: bigint 输出为裸 JSON 数字字面量，与输入十进制一致", () => {
  const body = stringifyJsonLossless({ d: BIG, cap: 0n, n: 16 });
  assert.match(body, new RegExp(`"d":${BIG_TEXT}`));
  assert.doesNotMatch(body, new RegExp(ROUNDED_TEXT));
  // bigint must be emitted as a JSON number, never a quoted string.
  assert.doesNotMatch(body, new RegExp(`"d":"${BIG_TEXT}"`));
  assert.ok(body.includes(`"cap":0`));
});

test("stringify: 缩进格式与 JSON.stringify 对安全值完全一致", () => {
  const sample = {
    nodes: ["R", "A", "L1"],
    edges: [{ id: "e1", delay: 10, cap: 16 }],
    windows: [{ node: "L1", lo: 14, hi: 14 }],
    flags: [true, false, null],
  };
  assert.equal(stringifyJsonLossless(sample, 2), JSON.stringify(sample, null, 2));
  assert.equal(stringifyJsonLossless(sample), JSON.stringify(sample));
});

test("stringify: 解析后再序列化大整数文本不丢精度", () => {
  const text = `{"delay": ${BIG_TEXT}, "lo":${BIG_TEXT},"hi": ${BIG_TEXT}}`;
  const again = stringifyJsonLossless(parseJsonLossless(text));
  const reparsed = parseJsonLossless(again) as {
    delay: bigint;
    lo: bigint;
    hi: bigint;
  };
  assert.equal(reparsed.delay, BIG);
  assert.equal(reparsed.lo, BIG);
  assert.equal(reparsed.hi, BIG);
});

test("stringify: 循环引用抛错，undefined 按 JSON 规则省略", () => {
  const cyc: any = { a: 1 };
  cyc.self = cyc;
  assert.throws(() => stringifyJsonLossless(cyc), TypeError);
  assert.equal(
    stringifyJsonLossless({ a: 1, b: undefined, c: [1, undefined] }),
    '{"a":1,"c":[1,null]}'
  );
});

// --------------------------------------------------------------------------- //
// render helpers (React 18 renders bigint children as an empty node)
// --------------------------------------------------------------------------- //

test("fmtInt/isZero: 大整数按原十进制展示，0 判定跨 number/bigint", () => {
  assert.equal(fmtInt(BIG), BIG_TEXT);
  assert.equal(fmtInt(14), "14");
  assert.equal(fmtInt(0), "0");
  assert.equal(fmtInt(null), "—");
  assert.ok(isZero(0) && isZero(0n));
  assert.ok(!isZero(BIG) && !isZero(1));
});

// --------------------------------------------------------------------------- //
// real solveBatch boundary: request submission direction
// --------------------------------------------------------------------------- //

test("请求方向：solveBatch 把大整数批次原样写上线缆", async () => {
  // Mirror the page path: textarea text -> parseJsonLossless (App.onSubmit)
  // -> solveBatch (stringifyJsonLossless fetch body).
  const textareaText = `{
  "nodes": ["R", "L1", "L2"],
  "edges": [
    {"id": "e1", "source": "R", "target": "L1", "delay": ${BIG_TEXT}, "cap": 0},
    {"id": "e2", "source": "R", "target": "L2", "delay": 0, "cap": 0}
  ],
  "windows": [
    {"node": "L1", "lo": ${BIG_TEXT}, "hi": ${BIG_TEXT}},
    {"node": "L2", "lo": 0, "hi": 0}
  ]
}`;
  const batch = parseJsonLossless(textareaText);

  let capturedBody = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init?: any) => {
    capturedBody = init?.body ?? "";
    return new Response('{"status":"feasible"}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await solveBatch(batch as any);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(capturedBody.includes(BIG_TEXT), capturedBody);
  assert.ok(!capturedBody.includes(ROUNDED_TEXT), capturedBody);
  // What the server receives parses back to the exact bigint.
  const received = parseJsonLossless(capturedBody) as any;
  assert.equal(received.edges[0].delay, BIG);
  assert.equal(received.windows[0].lo, BIG);
  assert.equal(received.edges[1].delay, 0);
});

// --------------------------------------------------------------------------- //
// real solveBatch boundary: response display direction
// --------------------------------------------------------------------------- //

test("响应方向：返回的大整数到达值/延迟/窗口解析为 bigint 并精确展示", async () => {
  // Raw wire text the Python backend emits (Python ints, no safe-integer cap).
  const raw = `{
    "status": "feasible",
    "objectives": {
      "positive_edges": 0,
      "total_compensation": 0,
      "vector_order": ["e1", "e2"],
      "vector": [0, 0]
    },
    "tree": {
      "root": "R",
      "rows": [
        {
          "node": "L1",
          "depth": 1,
          "is_leaf": true,
          "parent_edge": "e1",
          "edge_delay": ${BIG_TEXT},
          "edge_cap": 0,
          "compensation": 0,
          "arrival": ${BIG_TEXT},
          "window": {"lo": ${BIG_TEXT}, "hi": ${BIG_TEXT}},
          "margin": 0,
          "margin_low": 0,
          "margin_high": 0
        }
      ]
    },
    "edges": [],
    "leaves": [
      {
        "node": "L1",
        "arrival": ${BIG_TEXT},
        "lo": ${BIG_TEXT},
        "hi": ${BIG_TEXT},
        "margin": 0,
        "margin_low": 0,
        "margin_high": 0,
        "reachable_low": ${BIG_TEXT},
        "reachable_high": ${BIG_TEXT}
      }
    ],
    "conflict": null
  }`;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(raw, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  let result: any;
  try {
    result = await solveBatch({ nodes: [], edges: [], windows: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const leaf = result.leaves[0];
  assert.equal(leaf.arrival, BIG);
  assert.equal(leaf.lo, BIG);
  assert.equal(leaf.reachable_high, BIG);
  // The exact string the LeafTable puts in the DOM.
  assert.equal(fmtInt(leaf.arrival), BIG_TEXT);
  assert.notEqual(fmtInt(leaf.arrival), ROUNDED_TEXT);
  assert.equal(fmtInt(result.tree.rows[0].edge_delay), BIG_TEXT);
  assert.equal(
    `[${fmtInt(result.tree.rows[0].window.lo)}, ${fmtInt(result.tree.rows[0].window.hi)}]`,
    `[${BIG_TEXT}, ${BIG_TEXT}]`
  );
});
