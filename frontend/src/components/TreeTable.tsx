import type { TreeRow } from "../types";
import { fmt, isZero } from "../json";

export function TreeTable({ rows }: { rows: TreeRow[] }) {
  return (
    <div className="table-wrap" data-testid="tree-table">
      <table>
        <thead>
          <tr>
            <th>节点（树状）</th>
            <th>入边标识</th>
            <th>固有延迟</th>
            <th>可加上限</th>
            <th>采用加量</th>
            <th>到达值</th>
            <th>要求窗口</th>
            <th>剩余裕量</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.node}
              className={r.is_leaf ? "row-leaf" : "row-internal"}
              data-node={r.node}
              data-leaf={r.is_leaf}
            >
              <td>
                <span
                  className="indent"
                  style={{ paddingLeft: r.depth * 1.4 + "rem" }}
                >
                  {r.depth > 0 ? "└─ " : ""}
                </span>
                {r.node}
                {r.is_leaf && <em className="tag">叶</em>}
              </td>
              <td>{r.parent_edge ?? "—"}</td>
              <td>{r.edge_delay === null ? "—" : fmt(r.edge_delay)}</td>
              <td>{r.edge_cap ?? "—"}</td>
              <td className="num">
                {r.compensation === null ? "—" : r.compensation}
              </td>
              <td className="num strong" data-arrival={r.node}>
                {fmt(r.arrival)}
              </td>
              <td>
                {r.window ? `[${fmt(r.window.lo)}, ${fmt(r.window.hi)}]` : "—"}
              </td>
              <td className="num">
                {r.margin === null ? (
                  "—"
                ) : (
                  <span className={isZero(r.margin) ? "margin-zero" : "margin-ok"}>
                    {fmt(r.margin)}
                    <small>
                      {" "}
                      (下界 +{fmt(r.margin_low!)}, 上界 −{fmt(r.margin_high!)})
                    </small>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
