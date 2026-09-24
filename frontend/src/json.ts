// Lossless JSON parse/stringify for the audit UI.
//
// The batch format allows non-negative integer delays and integer window
// endpoints with NO JavaScript safe-integer upper bound (the backend keeps
// them as arbitrary-precision integers). `JSON.parse`/`JSON.stringify`
// silently round such values (9007199254740993 -> 9007199254740992), so this
// module keeps any integer literal outside the safe range as a BigInt in
// both directions: request serialization and response parsing.

/** An integer decoded from JSON: a number when safe, a BigInt otherwise. */
export type JsonInt = number | bigint;

/** Format a JSON integer for display as its exact decimal string. */
export function fmt(v: JsonInt): string {
  return typeof v === "bigint" ? v.toString() : String(v);
}

/** Zero test that works for both numbers and BigInts. */
export function isZero(v: JsonInt): boolean {
  return typeof v === "bigint" ? v === 0n : v === 0;
}

const WS = new Set([" ", "\t", "\n", "\r"]);
const isDigit = (c: string) => c >= "0" && c <= "9";

/**
 * Parse JSON like `JSON.parse`, except integer literals whose magnitude
 * exceeds the safe-integer range are returned as BigInt (exact) instead of
 * being silently rounded to the nearest double.
 */
export function parseJson(text: string): unknown {
  let i = 0;
  const n = text.length;

  const fail = (msg: string): never => {
    throw new SyntaxError(`${msg} (位置 ${i})`);
  };

  const skipWs = () => {
    while (i < n && WS.has(text[i])) i++;
  };

  const parseLiteral = (word: string, value: unknown): unknown => {
    if (!text.startsWith(word, i)) fail(`无效字面量, 期望 ${word}`);
    i += word.length;
    return value;
  };

  const ESCAPES: Record<string, string> = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
  };

  const parseString = (): string => {
    // text[i] === '"'
    i++;
    let out = "";
    for (;;) {
      if (i >= n) fail("字符串未闭合");
      const c = text[i];
      if (c === '"') {
        i++;
        return out;
      }
      if (c === "\\") {
        i++;
        if (i >= n) fail("转义序列不完整");
        const e = text[i];
        if (e === "u") {
          const hex = text.slice(i + 1, i + 5);
          if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex))
            fail("无效的 \\u 转义");
          out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
        } else if (e in ESCAPES) {
          out += ESCAPES[e];
          i++;
        } else {
          fail(`无效转义 \\${e}`);
        }
        continue;
      }
      if (c < " ") fail("字符串含未转义的控制字符");
      out += c;
      i++;
    }
  };

  const parseNumber = (): number | bigint => {
    const start = i;
    if (text[i] === "-") i++;
    if (text[i] === "0") {
      i++;
    } else if (i < n && isDigit(text[i])) {
      while (i < n && isDigit(text[i])) i++;
    } else {
      fail("无效数字");
    }
    let isInt = true;
    if (text[i] === ".") {
      isInt = false;
      i++;
      if (!(i < n && isDigit(text[i]))) fail("小数点后须为数字");
      while (i < n && isDigit(text[i])) i++;
    }
    if (text[i] === "e" || text[i] === "E") {
      isInt = false;
      i++;
      if (text[i] === "+" || text[i] === "-") i++;
      if (!(i < n && isDigit(text[i]))) fail("指数部分须为数字");
      while (i < n && isDigit(text[i])) i++;
    }
    const lit = text.slice(start, i);
    if (isInt) {
      const num = Number(lit);
      // Safe integers stay plain numbers (existing behavior unchanged);
      // anything larger is kept exactly as a BigInt.
      if (Number.isSafeInteger(num)) return num;
      return BigInt(lit);
    }
    return Number(lit);
  };

  const parseArray = (): unknown[] => {
    i++; // '['
    const arr: unknown[] = [];
    skipWs();
    if (text[i] === "]") {
      i++;
      return arr;
    }
    for (;;) {
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
      fail("数组元素之间须为逗号");
    }
  };

  const parseObject = (): Record<string, unknown> => {
    i++; // '{'
    const obj: Record<string, unknown> = {};
    skipWs();
    if (text[i] === "}") {
      i++;
      return obj;
    }
    for (;;) {
      skipWs();
      if (text[i] !== '"') fail("对象键须为字符串");
      const key = parseString();
      skipWs();
      if (text[i] !== ":") fail("对象键后须为冒号");
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
      fail("对象成员之间须为逗号");
    }
  };

  function parseValue(): unknown {
    skipWs();
    if (i >= n) fail("JSON 文本意外结束");
    const c = text[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"') return parseString();
    if (c === "t") return parseLiteral("true", true);
    if (c === "f") return parseLiteral("false", false);
    if (c === "n") return parseLiteral("null", null);
    if (c === "-" || isDigit(c)) return parseNumber();
    fail(`意外字符 ${JSON.stringify(c)}`);
  }

  const value = parseValue();
  skipWs();
  if (i !== n) fail("JSON 文本含多余内容");
  return value;
}

/**
 * Serialize like `JSON.stringify(value, null, space)`, except BigInts are
 * emitted as their exact decimal literal instead of throwing.
 */
export function stringifyJson(value: unknown, space?: number): string {
  const indent =
    typeof space === "number" && space > 0
      ? " ".repeat(Math.min(Math.floor(space), 10))
      : "";

  const ser = (v: unknown, level: number): string => {
    if (v === null || v === undefined) return "null";
    switch (typeof v) {
      case "boolean":
        return v ? "true" : "false";
      case "number":
        return Number.isFinite(v) ? String(v) : "null";
      case "bigint":
        return v.toString();
      case "string":
        return JSON.stringify(v);
      case "object": {
        const pad = indent.repeat(level);
        const padIn = indent.repeat(level + 1);
        if (Array.isArray(v)) {
          if (v.length === 0) return "[]";
          const items = v.map((x) => ser(x ?? null, level + 1));
          return indent
            ? `[\n${padIn}${items.join(`,\n${padIn}`)}\n${pad}]`
            : `[${items.join(",")}]`;
        }
        const entries = Object.entries(v as Record<string, unknown>).filter(
          ([, val]) =>
            val !== undefined &&
            typeof val !== "function" &&
            typeof val !== "symbol"
        );
        if (entries.length === 0) return "{}";
        const sep = indent ? ": " : ":";
        const items = entries.map(
          ([k, val]) => `${JSON.stringify(k)}${sep}${ser(val, level + 1)}`
        );
        return indent
          ? `{\n${padIn}${items.join(`,\n${padIn}`)}\n${pad}}`
          : `{${items.join(",")}}`;
      }
      default:
        return "null";
    }
  };

  return ser(value, 0);
}
