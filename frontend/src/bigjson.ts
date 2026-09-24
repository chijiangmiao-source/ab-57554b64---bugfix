// Lossless JSON boundary for the audit.
//
// Delays, window endpoints and arrivals are unrestricted non-negative
// integers, so they may exceed Number.MAX_SAFE_INTEGER (2^53 - 1). Native
// JSON.parse / JSON.stringify round-trip such literals through IEEE-754
// doubles and silently rewrite 9007199254740993 into 9007199254740992.
//
// parseJsonLossless keeps integer literals outside the safe-integer range as
// bigint; safe integers remain ordinary numbers (so ordinary batches behave
// exactly as before). stringifyJsonLossless serializes bigint back to bare
// JSON number literals.

import type { IntLike } from "./types";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

export function parseJsonLossless(text: string): unknown {
  const len = text.length;
  let i = 0;

  function fail(msg: string): never {
    throw new SyntaxError(`${msg} (位置 ${i})`);
  }

  function skipWs(): void {
    while (
      i < len &&
      (text[i] === " " ||
        text[i] === "\t" ||
        text[i] === "\n" ||
        text[i] === "\r")
    ) {
      i++;
    }
  }

  function expectLit(lit: string): void {
    if (text.slice(i, i + lit.length) !== lit) fail(`应为字面量 ${lit}`);
    i += lit.length;
  }

  function parseString(): string {
    // Caller guarantees text[i] === '"'. Reuse the native parser on the exact
    // token so every escape/surrogate rule matches standard JSON.
    const start = i;
    i++;
    while (i < len) {
      const c = text[i++];
      if (c === '"') {
        try {
          return JSON.parse(text.slice(start, i)) as string;
        } catch {
          fail("非法字符串转义");
        }
      }
      if (c === "\\") {
        i++; // skip the escaped character
      } else if (c.charCodeAt(0) < 0x20) {
        fail("字符串中存在未转义的控制字符");
      }
    }
    return fail("字符串未闭合");
  }

  function parseNumber(): unknown {
    const start = i;
    if (text[i] === "-") i++;
    if (text[i] === "0") {
      i++;
    } else if (isDigit(text[i]) && text[i] !== "0") {
      i++;
      while (isDigit(text[i])) i++;
    } else {
      fail("非法数字");
    }
    let isInteger = true;
    if (text[i] === ".") {
      isInteger = false;
      i++;
      if (!isDigit(text[i])) fail("小数部分须包含数字");
      while (isDigit(text[i])) i++;
    }
    if (text[i] === "e" || text[i] === "E") {
      isInteger = false;
      i++;
      if (text[i] === "+" || text[i] === "-") i++;
      if (!isDigit(text[i])) fail("指数部分须包含数字");
      while (isDigit(text[i])) i++;
    }
    const lit = text.slice(start, i);
    if (isInteger) {
      const bi = BigInt(lit);
      // Keep ordinary integer payloads as ordinary numbers.
      return bi >= MIN_SAFE && bi <= MAX_SAFE ? Number(lit) : bi;
    }
    return Number(lit);
  }

  function parseArray(): unknown[] {
    i++; // '['
    const arr: unknown[] = [];
    skipWs();
    if (text[i] === "]") {
      i++;
      return arr;
    }
    while (true) {
      arr.push(parseValue());
      skipWs();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        return arr;
      }
      fail("数组中须以逗号或右方括号继续");
    }
  }

  function parseObject(): Record<string, unknown> {
    i++; // '{'
    const obj: Record<string, unknown> = {};
    skipWs();
    if (text[i] === "}") {
      i++;
      return obj;
    }
    while (true) {
      skipWs();
      if (text[i] !== '"') fail("对象键须为 JSON 字符串");
      const key = parseString();
      skipWs();
      if (text[i] !== ":") fail("对象键与值之间须有冒号");
      i++;
      obj[key] = parseValue();
      skipWs();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        return obj;
      }
      fail("对象中须以逗号或右花括号继续");
    }
  }

  function parseValue(): unknown {
    skipWs();
    const c = text[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"') return parseString();
    if (c === "t") return expectLit("true"), true;
    if (c === "f") return expectLit("false"), false;
    if (c === "n") return expectLit("null"), null;
    if (c === "-" || isDigit(c)) return parseNumber();
    fail("意外字符");
  }

  const value = parseValue();
  skipWs();
  if (i !== len) fail("顶层值之后存在多余字符");
  return value;
}

// Serialize values that may contain bigint. Mirrors JSON.stringify spacing
// when indent > 0 (used by the 格式化 button).
export function stringifyJsonLossless(value: unknown, indent = 0): string {
  const step = indent > 0 ? " ".repeat(Math.min(indent, 10)) : "";
  const seen = new WeakSet<object>();

  function render(v: unknown, gap: string): string | undefined {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "undefined") return undefined;
    if (t === "string") return JSON.stringify(v);
    if (t === "boolean") return v ? "true" : "false";
    if (t === "bigint") return (v as bigint).toString();
    if (t === "number") {
      return Number.isFinite(v as number) ? String(v) : "null";
    }
    if (t !== "object") return undefined; // function / symbol: omitted

    const o = v as object;
    if (seen.has(o)) throw new TypeError("循环引用无法序列化为 JSON");
    seen.add(o);
    try {
      const childGap = step ? gap + step : gap;
      if (Array.isArray(o)) {
        const parts = o.map((item) => render(item, childGap) ?? "null");
        if (parts.length === 0) return "[]";
        return step
          ? `[\n${childGap}${parts.join(`,\n${childGap}`)}\n${gap}]`
          : `[${parts.join(",")}]`;
      }
      const parts: string[] = [];
      for (const [k, val] of Object.entries(o as Record<string, unknown>)) {
        const r = render(val, childGap);
        if (r === undefined) continue;
        parts.push(step ? `${JSON.stringify(k)}: ${r}` : `${JSON.stringify(k)}:${r}`);
      }
      if (parts.length === 0) return "{}";
      return step
        ? `{\n${childGap}${parts.join(`,\n${childGap}`)}\n${gap}}`
        : `{${parts.join(",")}}`;
    } finally {
      seen.delete(o);
    }
  }

  const out = render(value, "");
  if (out === undefined) throw new TypeError("不支持序列化该顶层值");
  return out;
}

// React 18 renders bigint children as an empty node, so every integer shown
// in the UI must pass through an explicit decimal conversion.
export function fmtInt(v: IntLike | null | undefined, dash = "—"): string {
  if (v === null || v === undefined) return dash;
  return typeof v === "bigint" ? v.toString() : String(v);
}

export function isZero(v: IntLike): boolean {
  return v === 0 || v === 0n;
}
