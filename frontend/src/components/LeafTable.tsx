import type { LeafRow } from "../types";
import { fmt, isZero } from "../json";

export function LeafTable({ rows }: { rows: LeafRow[] }) {
  return (
    <div className="table-wrap" data-testid="leaf-table">
      <table>
        <thead>
          <tr>
            <th>叶端</th>
            <th>到达值</th>
            <th>要求闭区间</th>
            <th>剩余裕量</th>
            <th>可达区间（零加量…满加量）</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.node} data-leaf-row={r.node}>
              <td>
                <code>{r.node}</code>
              </td>
              <td className="num strong" data-leaf-arrival={r.node}>
                {fmt(r.arrival)}
              </td>
              <td>[{fmt(r.lo)}, {fmt(r.hi)}]</td>
              <td className="num">
                <span
                  className={isZero(r.margin) ? "margin-zero" : "margin-ok"}
                  data-leaf-margin={r.node}
                >
                  {fmt(r.margin)}
                  <small>
                    {" "}
                    (下界 +{fmt(r.margin_low)} / 上界 −{fmt(r.margin_high)})
                  </small>
                </span>
              </td>
              <td>
                [{fmt(r.reachable_low)}, {fmt(r.reachable_high)}]
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
