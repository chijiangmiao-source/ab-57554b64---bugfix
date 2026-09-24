import type { Batch, SolveResult } from "./types";
import { parseJson, stringifyJson } from "./json";

// Configurable endpoint. Empty means same-origin (nginx proxy in compose).
export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export async function fetchHealth(): Promise<{ status: string }> {
  const r = await fetch(`${API_BASE}/health`);
  if (!r.ok) throw new Error(`health ${r.status}`);
  return r.json();
}

export async function solveBatch(batch: Batch): Promise<SolveResult> {
  const r = await fetch(`${API_BASE}/api/v1/solve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Lossless: BigInt delays/window endpoints serialize as exact literals.
    body: stringifyJson(batch),
  });
  if (r.status === 422) {
    const text = await r.text().catch(() => "");
    let body: unknown = {};
    try {
      body = parseJson(text);
    } catch {
      body = {};
    }
    const detail =
      typeof (body as { detail?: unknown }).detail === "string"
        ? (body as { detail: string }).detail
        : stringifyJson((body as { detail?: unknown }).detail ?? body);
    throw new Error(`输入校验失败 (422): ${detail}`);
  }
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`请求失败 (HTTP ${r.status}) ${text}`);
  }
  // Lossless: big integer arrivals/windows arrive as BigInt, not rounded.
  return parseJson(await r.text()) as SolveResult;
}
