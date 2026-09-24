import type { JsonInt } from "./json";

export interface EdgeIn {
  id: string;
  source: string;
  target: string;
  // No JS safe-integer bound: may decode as BigInt.
  delay: JsonInt;
  cap: number;
}

export interface WindowIn {
  node: string;
  lo: JsonInt;
  hi: JsonInt;
}

export interface Batch {
  nodes: string[];
  edges: EdgeIn[];
  windows: WindowIn[];
}

export interface Objectives {
  positive_edges: number;
  total_compensation: number;
  vector_order: string[];
  vector: number[];
}

export interface TreeRow {
  node: string;
  depth: number;
  is_leaf: boolean;
  parent_edge: string | null;
  edge_delay: JsonInt | null;
  edge_cap: number | null;
  compensation: number | null;
  arrival: JsonInt;
  window: { lo: JsonInt; hi: JsonInt } | null;
  margin: JsonInt | null;
  margin_low: JsonInt | null;
  margin_high: JsonInt | null;
}

export interface EdgeRow {
  id: string;
  source: string;
  target: string;
  delay: JsonInt;
  cap: number;
  adjustable: boolean;
  chosen: number;
  min: number;
  max: number;
}

export interface LeafRow {
  node: string;
  arrival: JsonInt;
  lo: JsonInt;
  hi: JsonInt;
  margin: JsonInt;
  margin_low: JsonInt;
  margin_high: JsonInt;
  reachable_low: JsonInt;
  reachable_high: JsonInt;
}

export interface ConflictLeaf {
  node: string;
  lo: JsonInt;
  hi: JsonInt;
  reachable_low: JsonInt;
  reachable_high: JsonInt;
}

export interface SolveResult {
  status: "feasible" | "infeasible";
  objectives: Objectives | null;
  tree: { root: string; rows: TreeRow[] } | null;
  edges: EdgeRow[] | null;
  leaves: LeafRow[] | null;
  conflict: { leaves: ConflictLeaf[]; message: string } | null;
}

export const SAMPLES: Record<string, Batch> = {
  sharedUpstream: {
    // 共享上游补偿：e0 一次移动整片子树；L1 闭点 [14,14]，L2 区间 [14,20]
    nodes: ["R", "A", "L1", "L2"],
    edges: [
      { id: "e0", source: "R", target: "A", delay: 10, cap: 16 },
      { id: "e1", source: "A", "target": "L1", delay: 0, cap: 16 },
      { id: "e2", source: "A", target: "L2", delay: 0, cap: 16 },
    ],
    windows: [
      { node: "L1", lo: 14, hi: 14 },
      { node: "L2", lo: 14, hi: 20 },
    ],
  },
  tiedRanges: {
    // 同优边范围：t/u 在 L1 路径上可互换；字典序取 t=0,u=2
    nodes: ["R", "A", "B", "L1", "L2"],
    edges: [
      { id: "s", source: "R", target: "A", delay: 0, cap: 16 },
      { id: "t", source: "A", target: "B", delay: 0, cap: 16 },
      { id: "u", source: "B", target: "L1", delay: 0, cap: 16 },
      { id: "v", source: "A", target: "L2", delay: 0, cap: 16 },
    ],
    windows: [
      { node: "L1", lo: 4, hi: 4 },
      { node: "L2", lo: 2, hi: 2 },
    ],
  },
  windowConflict: {
    // 叶端窗口冲突：仅共享边可调，两叶端被强制同步却要求不同到达
    nodes: ["R", "A", "L1", "L2"],
    edges: [
      { id: "e0", source: "R", target: "A", delay: 0, cap: 16 },
      { id: "e1", source: "A", target: "L1", delay: 0, cap: 0 },
      { id: "e2", source: "A", target: "L2", delay: 0, cap: 0 },
    ],
    windows: [
      { node: "L1", lo: 2, hi: 2 },
      { node: "L2", lo: 8, hi: 8 },
    ],
  },
};
