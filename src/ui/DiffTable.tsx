import type { Comparison } from "../compare/index.js";

/** 비교 모드 하단의 차이 요약. 값이 갈리는 행을 굵게 표시한다 (CLAUDE.md §6). */
export function DiffTable({ comparison }: { comparison: Comparison }) {
  return (
    <div className="diff">
      <table>
        <thead>
          <tr>
            <th />
            {comparison.columns.map((c) => (
              <th key={c.id}>
                {c.vendor}
                {c.draft && " · draft"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((r) => (
            <tr key={r.key} data-differs={r.differs}>
              <th scope="row">{r.label}</th>
              {r.cells.map((cell, i) => (
                <td key={`${r.key}-${i}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {comparison.notes.length > 0 && (
        <ul className="empty" style={{ margin: 0, paddingLeft: 30 }}>
          {comparison.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
