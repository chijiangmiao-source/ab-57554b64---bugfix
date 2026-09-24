// Integer payload fields are unrestricted integers; values beyond JS safe
// integer range are carried as bigint by the lossless JSON layer (see
// bigjson.ts). Safe integers stay as number.
export type IntLike = number | bigint;

export interface EdgeIn {
  id: string;
  source: string;
  target: string;
  delay: IntLike;
  cap: IntLike;
}

export interface WindowIn {
  node: string;
  lo: IntLike;
  hi: IntLike;
}

export interface Batch {
  nodes: string[];
  edges: EdgeIn[];
  windows: WindowIn[];
}

export interface Objectives {
  positive_edges: number;
  total_compensation: IntLike;
  vector_order: string[];
  vector: IntLike[];
}

export interface TreeRow {
  node: string;
  depth: number;
  is_leaf: boolean;
  parent_edge: string | null;
  edge_delay: IntLike | null;
  edge_cap: IntLike | null;
  compensation: IntLike | null;
  arrival: IntLike;
  window: { lo: IntLike; hi: IntLike } | null;
  margin: IntLike | null;
  margin_low: IntLike | null;
  margin_high: IntLike | null;
}

export interface EdgeRow {
  id: string;
  source: string;
  target: string;
  delay: IntLike;
  cap: IntLike;
  adjustable: boolean;
  chosen: IntLike;
  min: IntLike;
  max: IntLike;
}

export interface LeafRow {
  node: string;
  arrival: IntLike;
  lo: IntLike;
  hi: IntLike;
  margin: IntLike;
  margin_low: IntLike;
  margin_high: IntLike;
  reachable_low: IntLike;
  reachable_high: IntLike;
}

export interface ConflictLeaf {
  node: string;
  lo: IntLike;
  hi: IntLike;
  reachable_low: IntLike;
  reachable_high: IntLike;
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
      { id: "e1", source: "A", target: "L1", delay: 0, cap: 16 },
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
