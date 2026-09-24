// Page-level verification against the REAL built app served by the web
// container. jsdom cannot execute the production bundle's <script
// type="module">, so run.sh additionally bundles the very same React source
// (frontend/verify-entry.tsx -> src/App.tsx) with esbuild as an IIFE. We load
// the real index.html over HTTP (nginx), inject that bundle, and drive the
// actual UI: sample buttons -> submit -> real HTTP via the nginx proxy ->
// assert rendered tree/edge/leaf/conflict values and input retention.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("/workspace/frontend/");
const { JSDOM } = require("jsdom");

const WEB = process.env.WEB_URL ?? "http://web:80";
const API = process.env.API_URL ?? "http://api:8000";
const BUNDLE =
  process.env.VERIFY_BUNDLE ?? "/workspace/frontend/dist/verify-bundle.js";

let failures = 0;
function check(name, cond, detail = "") {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${name}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bodies of POST requests the page actually sends (request-direction probe).
const sentBodies = [];

async function waitFor(predicate, { timeout = 15000, label = "" } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    let v;
    try {
      v = predicate();
    } catch {
      v = null;
    }
    if (v) return v;
    await sleep(150);
  }
  throw new Error(`等待超时: ${label}`);
}

async function bootDom() {
  // Real built artifact from the web container.
  const res = await fetch(`${WEB}/`);
  if (!res.ok) throw new Error(`无法获取 ${WEB}/ : ${res.status}`);
  const html = await res.text();
  if (!html.includes('id="root"') || !html.includes("低温探测器"))
    throw new Error("首页内容不是预期的构建产物");

  const bundle = readFileSync(BUNDLE, "utf8");

  const dom = new JSDOM(html, {
    url: WEB,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      // Same-origin browser fetch routed through Node's real fetch -> nginx.
      window.fetch = (url, init) => {
        if (init && String(init.method ?? "GET").toUpperCase() === "POST")
          sentBodies.push(String(init.body ?? ""));
        return globalThis.fetch(new URL(url, WEB).toString(), init);
      };
    },
  });
  const { window } = dom;
  window.addEventListener("error", (e) => {
    console.error("window error:", e.error ?? e.message);
    failures++;
  });
  process.on("uncaughtException", (err) => {
    console.error("uncaught:", err);
    failures++;
  });

  // Execute the real React application code inside the jsdom window.
  window.eval(bundle);
  return window;
}

const $ = (w, sel) => w.document.querySelector(sel);
const $$ = (w, sel) => Array.from(w.document.querySelectorAll(sel));

// Set the controlled textarea's value the way a real user's edit would
// (native setter + bubbling input event so React picks it up).
function setBatchInput(w, text) {
  const textarea = $(w, '[data-testid="batch-input"]');
  const setter = Object.getOwnPropertyDescriptor(
    w.HTMLTextAreaElement.prototype, "value"
  ).set;
  setter.call(textarea, text);
  textarea.dispatchEvent(new w.Event("input", { bubbles: true }));
  return textarea;
}

async function loadSampleAndSubmit(w, buttonText) {
  const btn = $$(w, "button").find((b) => b.textContent.trim() === buttonText);
  if (!btn) throw new Error(`找不到样例按钮: ${buttonText}`);
  btn.click();
  await sleep(50);
  $(w, '[data-testid="submit"]').click();
}

async function main() {
  console.log(`核对真实页面: ${WEB} (API ${API})`);
  const w = await bootDom();

  // App booted and the health indicator turned green via the real API.
  const health = await waitFor(
    () => {
      const el = $(w, '[data-testid="health"]');
      return el && el.textContent.includes("在线") ? el : null;
    },
    { label: "API 在线指示" }
  );
  check("页面健康指示反映真实 API 在线", !!health, health?.textContent);

  // ---- A. shared upstream compensation ----------------------------------
  console.log("A. 页面展示共享上游补偿");
  await loadSampleAndSubmit(w, "共享上游补偿");
  await waitFor(() => $(w, '[data-testid="tree-table"]'), { label: "树表" });
  const row = (node) => $(w, `tr[data-node="${node}"]`);
  check("树表 A 行显示入边 e0 采用加量 4",
    row("A")?.textContent.includes("4"), row("A")?.textContent);
  check("树表 L1 到达值 14",
    $(w, '[data-arrival="L1"]')?.textContent.trim() === "14");
  check("树表 L2 到达值 14",
    $(w, '[data-arrival="L2"]')?.textContent.trim() === "14");
  check("树表 L1 剩余裕量 0（贴下界）",
    row("L1").textContent.replace(/\s+/g, "").includes("0"));
  const vector = $(w, '[data-testid="vector"]')?.textContent.replace(/\s+/g, "");
  check("目标摘要含字典序加量向量 (e0,e1,e2)=(4,0,0)",
    vector?.includes("(e0,e1,e2)=(4,0,0)"), vector);
  check("边表 e0 采用 4、同优范围固定 4..4",
    $(w, '[data-chosen="e0"]')?.textContent.trim() === "4" &&
      $(w, '[data-min="e0"]')?.textContent.trim() === "4" &&
      $(w, '[data-max="e0"]')?.textContent.trim() === "4");
  check("叶端表 L1 闭点裕量 0（下界/上界均 0）",
    $(w, '[data-leaf-margin="L1"]')?.textContent.replace(/\s+/g, "")
      === "0(下界+0/上界−0)",
    $(w, '[data-leaf-margin="L1"]')?.textContent);
  check("叶端表 L2 裕量 0 贴下界、上界侧余量 6",
    (() => {
      const t = $(w, '[data-leaf-margin="L2"]')?.textContent.replace(/\s+/g, "");
      return t === "0(下界+0/上界−6)";
    })(),
    $(w, '[data-leaf-margin="L2"]')?.textContent);

  // ---- B. co-optimal edge ranges + lexicographic tie --------------------
  console.log("B. 页面展示同优边范围与字典序取值");
  await loadSampleAndSubmit(w, "同优边范围");
  await waitFor(
    () => $(w, '[data-edge="t"]') && $(w, '[data-chosen="u"]'),
    { label: "边表刷新" }
  );
  check("边表 t 采用 0、同优范围 0..2",
    $(w, '[data-chosen="t"]')?.textContent.trim() === "0" &&
      $(w, '[data-min="t"]')?.textContent.trim() === "0" &&
      $(w, '[data-max="t"]')?.textContent.trim() === "2");
  check("边表 u 采用 2、同优范围 0..2（字典序把加量后置到 u）",
    $(w, '[data-chosen="u"]')?.textContent.trim() === "2" &&
      $(w, '[data-min="u"]')?.textContent.trim() === "0" &&
      $(w, '[data-max="u"]')?.textContent.trim() === "2");
  check("边表 s 固定 2（2..2）",
    $(w, '[data-chosen="s"]')?.textContent.trim() === "2" &&
      $(w, '[data-min="s"]')?.textContent.trim() === "2" &&
      $(w, '[data-max="s"]')?.textContent.trim() === "2");
  check("树表 L1 到达 4、L2 到达 2",
    $(w, '[data-arrival="L1"]')?.textContent.trim() === "4" &&
      $(w, '[data-arrival="L2"]')?.textContent.trim() === "2");

  // ---- C. leaf window conflict ------------------------------------------
  console.log("C. 页面展示叶端窗口冲突");
  await loadSampleAndSubmit(w, "叶端窗口冲突");
  await waitFor(() => $(w, '[data-testid="conflict-panel"]'), {
    label: "冲突面板",
  });
  const l1 = $(w, '[data-conflict-leaf="L1"]')?.textContent.replace(/\s+/g, "");
  const l2 = $(w, '[data-conflict-leaf="L2"]')?.textContent.replace(/\s+/g, "");
  check("冲突面板列出 L1：要求 [2,2]、可达 [0,16]",
    l1?.includes("[2,2]") && l1?.includes("[0,16]"), l1);
  check("冲突面板列出 L2：要求 [8,8]、可达 [0,16]",
    l2?.includes("[8,8]") && l2?.includes("[0,16]"), l2);

  // ---- D. failed validation must preserve the input ---------------------
  console.log("D. 校验/请求失败后页面保留输入");
  const badText = '{"nodes":["R"] ,"edges":[],"windows":[]}';
  const textarea = setBatchInput(w, badText);
  $(w, '[data-testid="submit"]').click();
  await waitFor(
    () => $(w, '[data-testid="error-banner"]')?.textContent.includes("422"),
    { label: "422 错误提示" }
  );
  check("后端返回 422 后输入原样保留",
    textarea.value === badText);
  check("错误横幅显示校验信息",
    ($(w, '[data-testid="error-banner"]')?.textContent.length ?? 0) > 5);

  // Malformed JSON: purely client-side, still kept verbatim.
  const malformed = badText + "}}not json";
  setBatchInput(w, malformed);
  $(w, '[data-testid="submit"]').click();
  await waitFor(
    () => $(w, '[data-testid="error-banner"]')?.textContent.includes("JSON"),
    { label: "JSON 错误提示" }
  );
  check("JSON 解析失败后输入同样保留", textarea.value === malformed);

  // ---- E. big integers survive the real submit path losslessly ----------
  console.log("E. 大整数批次经真实提交路径无损往返");
  // 2^53 + 1: not representable as a JS double. Built as TEXT — a numeric
  // literal in this script would already be rounded before the page sees it.
  const BIG = "9007199254740993";
  const BIG_OFF = "9007199254740992";
  const bigText = [
    "{",
    '  "nodes": ["R", "L1", "L2"],',
    '  "edges": [',
    `    {"id": "a", "source": "R", "target": "L1", "delay": ${BIG}, "cap": 0},`,
    '    {"id": "b", "source": "R", "target": "L2", "delay": 0, "cap": 0}',
    "  ],",
    '  "windows": [',
    `    {"node": "L1", "lo": ${BIG}, "hi": ${BIG}},`,
    '    {"node": "L2", "lo": 0, "hi": 0}',
    "  ]",
    "}",
  ].join("\n");
  const bigArea = setBatchInput(w, bigText);
  $(w, '[data-testid="submit"]').click();
  await waitFor(
    () => $(w, '[data-leaf-arrival="L1"]'),
    { label: "大整数批次叶端表" }
  );
  // Request direction: the page must have POSTed the exact integer.
  const lastBody = sentBodies[sentBodies.length - 1] ?? "";
  check("请求方向: 提交体原样携带 delay=9007199254740993",
    lastBody.includes(`"delay":${BIG}`), lastBody);
  check("请求方向: 提交体不含被改写的 9007199254740992",
    !lastBody.includes(BIG_OFF), lastBody);
  // Response direction: exact rendering of arrival / window / delay.
  const l1Arrival = $(w, '[data-leaf-arrival="L1"]')?.textContent.trim();
  check("叶端表 L1 到达值为 9007199254740993",
    l1Arrival === BIG, l1Arrival);
  check("叶端表 L1 到达值不是相邻的 9007199254740992",
    l1Arrival !== BIG_OFF, l1Arrival);
  check("叶端表 L2 到达值为 0",
    $(w, '[data-leaf-arrival="L2"]')?.textContent.trim() === "0");
  check("树表 L1 到达值精确",
    $(w, '[data-arrival="L1"]')?.textContent.trim() === BIG);
  const leafRowL1 = $(w, 'tr[data-leaf-row="L1"]')?.textContent.replace(/\s+/g, "");
  check("叶端表 L1 要求窗口与可达区间精确显示大整数",
    leafRowL1?.includes(`[${BIG},${BIG}]`), leafRowL1);
  const treeRowL1 = $(w, 'tr[data-node="L1"]')?.textContent.replace(/\s+/g, "");
  check("树表 L1 行固有延迟与窗口精确显示大整数",
    !!treeRowL1 && treeRowL1.includes(BIG) && treeRowL1.includes(`[${BIG},${BIG}]`),
    treeRowL1);
  check("边表 a 行固有延迟精确显示大整数",
    $(w, 'tr[data-edge="a"]')?.textContent.replace(/\s+/g, "").includes(BIG));
  check("大整数批次无校验错误提示",
    !$(w, '[data-testid="error-banner"]'));
  check("提交后输入区仍原样保留大整数文本",
    bigArea.value === bigText, bigArea.value.slice(0, 120));

  console.log(`\n页面核对: ${failures} 项失败`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
