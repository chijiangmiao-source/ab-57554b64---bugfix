// Unit tests for the lossless JSON layer (frontend/src/json.ts).
//
// These cover the two directions of the big-integer regression:
//   1. request submission: a batch typed into the page must serialize with
//      9007199254740993 intact (not silently rounded to 9007199254740992);
//   2. response display: big integer delays/windows/arrivals returned by the
//      API must decode exactly and render as their decimal string.
//
// Bundled with esbuild and run under `node --test` by verify/run.sh.

import test from "node:test";
import assert from "node:assert/strict";

import { fmt, isZero, parseJson, stringifyJson } from "../src/json";

const BIG = "9007199254740993"; // 2^53 + 1: first integer JS cannot represent
const BIG_MINUS_1 = "9007199254740992";

// The exact legal batch from the regression report: root R with leaves
// L1 (delay + closed window = 9007199254740993) and L2 (all zeros).
const BIG_BATCH_TEXT = `{
  "nodes": ["R", "L1", "L2"],
  "edges": [
    {"id": "a", "source": "R", "target": "L1", "delay": ${BIG}, "cap": 0},
    {"id": "b", "source": "R", "target": "L2", "delay": 0, "cap": 0}
  ],
  "windows": [
    {"node": "L1", "lo": ${BIG}, "hi": ${BIG}},
    {"node": "L2", "lo": 0, "hi": 0}
  ]
}`;

test("请求提交方向: 大整数批次序列化后保持精确", () => {
  const batch = parseJson(BIG_BATCH_TEXT) as {
    edges: { delay: number | bigint }[];
    windows: { lo: number | bigint; hi: number | bigint }[];
  };
  // Decoded exactly, as BigInt — not rounded to a double.
  assert.equal(batch.edges[0].delay, 9007199254740993n);
  assert.equal(typeof batch.edges[0].delay, "bigint");
  assert.equal(batch.windows[0].lo, 9007199254740993n);
  assert.equal(batch.windows[0].hi, 9007199254740993n);

  const body = stringifyJson(batch);
  assert.ok(
    body.includes(`"delay":${BIG}`),
    `请求体须原样包含 "delay":${BIG}, 实际: ${body}`
  );
  assert.ok(body.includes(`"lo":${BIG}`));
  assert.ok(body.includes(`"hi":${BIG}`));
  assert.ok(
    !body.includes(BIG_MINUS_1),
    `请求体不得包含被改写的 ${BIG_MINUS_1}: ${body}`
  );
  // Round-trip: parsing the serialized body again yields the same BigInts.
  const again = parseJson(body) as typeof batch;
  assert.equal(again.edges[0].delay, 9007199254740993n);
});

test("请求提交方向: JSON.parse 会静默改写, 本模块不会", () => {
  // Sanity check that the regression is real and our parser avoids it.
  assert.equal(JSON.parse(BIG), 9007199254740992);
  assert.equal(parseJson(BIG), 9007199254740993n);
});

test("响应展示方向: 大整数到达值/窗口/延迟精确解码并可显示", () => {
  const responseText = `{
    "status": "feasible",
    "objectives": {"positive_edges": 0, "total_compensation": 0,
                   "vector_order": ["a", "b"], "vector": [0, 0]},
    "tree": {"root": "R", "rows": [
      {"node": "R", "depth": 0, "is_leaf": false, "parent_edge": null,
       "edge_delay": null, "edge_cap": null, "compensation": null,
       "arrival": 0, "window": null,
       "margin": null, "margin_low": null, "margin_high": null},
      {"node": "L1", "depth": 1, "is_leaf": true, "parent_edge": "a",
       "edge_delay": ${BIG}, "edge_cap": 0, "compensation": 0,
       "arrival": ${BIG}, "window": {"lo": ${BIG}, "hi": ${BIG}},
       "margin": 0, "margin_low": 0, "margin_high": 0}
    ]},
    "edges": [
      {"id": "a", "source": "R", "target": "L1", "delay": ${BIG},
       "cap": 0, "adjustable": false, "chosen": 0, "min": 0, "max": 0}
    ],
    "leaves": [
      {"node": "L1", "arrival": ${BIG}, "lo": ${BIG}, "hi": ${BIG},
       "margin": 0, "margin_low": 0, "margin_high": 0,
       "reachable_low": ${BIG}, "reachable_high": ${BIG}}
    ],
    "conflict": null
  }`;
  const r = parseJson(responseText) as {
    tree: { rows: { arrival: number | bigint; edge_delay: unknown }[] };
    edges: { delay: number | bigint }[];
    leaves: {
      arrival: number | bigint;
      lo: number | bigint;
      reachable_high: number | bigint;
    }[];
  };
  const leaf = r.leaves[0];
  assert.equal(leaf.arrival, 9007199254740993n);
  // Displayed exactly as the decimal string, never the rounded neighbor.
  assert.equal(fmt(leaf.arrival), BIG);
  assert.notEqual(fmt(leaf.arrival), BIG_MINUS_1);
  assert.equal(fmt(r.tree.rows[1].arrival as number | bigint), BIG);
  assert.equal(fmt(r.edges[0].delay), BIG);
  assert.equal(fmt(leaf.lo), BIG);
  assert.equal(fmt(leaf.reachable_high), BIG);
});

test("普通整数批次行为不变: 仍是 number, 输出与 JSON.stringify 一致", () => {
  const ordinary = {
    nodes: ["R", "A", "L1", "L2"],
    edges: [
      { id: "e0", source: "R", target: "A", delay: 10, cap: 16 },
      { id: "e1", source: "A", target: "L1", delay: 0, cap: 16 },
    ],
    windows: [
      { node: "L1", lo: 14, hi: 14 },
      { node: "L2", lo: 14, hi: 20 },
    ],
    flag: true,
    nothing: null,
    ratio: 1.5,
  };
  const text = JSON.stringify(ordinary);
  const parsed = parseJson(text) as Record<string, unknown>;
  assert.deepEqual(parsed, ordinary);
  assert.equal(typeof (parsed.edges as { delay: unknown }[])[0].delay, "number");
  // Compact and pretty forms match JSON.stringify exactly.
  assert.equal(stringifyJson(parsed), text);
  assert.equal(
    stringifyJson(parsed, 2),
    JSON.stringify(ordinary, null, 2)
  );
  // Safe boundary integers stay plain numbers.
  assert.equal(parseJson("9007199254740991"), 9007199254740991);
  assert.equal(typeof parseJson("9007199254740991"), "number");
  assert.equal(parseJson("-7"), -7);
});

test("边界与杂项: 负大整数、嵌套结构、字符串转义", () => {
  assert.equal(parseJson("-9007199254740993"), -9007199254740993n);
  assert.equal(stringifyJson(-9007199254740993n), "-9007199254740993");
  const nested = parseJson(
    `{"a": [{"b": "x\\n\\u0041\\uD834\\uDD1E"}, [1, [2, [${BIG}]]], ""]}`
  ) as { a: [{ b: string }, unknown[], string] };
  assert.equal(nested.a[0].b, "x\nA𝄞");
  assert.equal(nested.a[2], "");
  assert.deepEqual(nested.a[1], [1, [2, [9007199254740993n]]]);
  assert.deepEqual(
    parseJson(`[1, [2, [${BIG}]]]`),
    [1, [2, [9007199254740993n]]]
  );
  assert.equal(
    stringifyJson(parseJson(`{"s": "\\u0041\\t"}`)),
    `{"s":"A\\t"}`
  );
  // floats remain floats
  assert.equal(parseJson("1.25"), 1.25);
  assert.equal(parseJson("1e3"), 1000);
  assert.equal(stringifyJson(1.25), "1.25");
});

test("非法 JSON 依旧抛出 SyntaxError (输入保留路径不变)", () => {
  for (const bad of [
    "",
    "{",
    '{"a":}',
    "[1,]",
    "{'x':1}",
    "01",
    "1.",
    ".5",
    "+1",
    "tru",
    '"unterminated',
    "null extra",
    '{"a" 1}',
    '[1 2]',
  ]) {
    assert.throws(() => parseJson(bad), SyntaxError, `应当拒绝: ${bad}`);
  }
});

test("fmt / isZero 辅助函数", () => {
  assert.equal(fmt(0), "0");
  assert.equal(fmt(0n), "0");
  assert.equal(fmt(14), "14");
  assert.equal(fmt(9007199254740993n), BIG);
  assert.ok(isZero(0));
  assert.ok(isZero(0n));
  assert.ok(!isZero(1));
  assert.ok(!isZero(1n));
  assert.ok(!isZero(9007199254740993n));
});
