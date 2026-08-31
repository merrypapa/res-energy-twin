import type { Finding } from "../schema/common.js";
import type { RuleFinding } from "../schema/rule.js";
import type { ScenarioResult } from "../scenario/index.js";
import type { RuleRunResult } from "../rules/engine.js";
import type { Topology } from "../schema/topology.js";

const SEVERITY: Record<string, string> = { error: "오류", warning: "경고", info: "정보" };
const ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

interface Result {
  topology: Topology;
  run: ScenarioResult | null;
  rules: RuleRunResult;
}

interface Row {
  severity: string;
  code: string;
  message: string;
  refs: string[];
  cite: string | null;
  origin: string;
}

/** 검증 결과 패널. 데이터 검증 · 시나리오 · 룰의 finding을 한 줄기로 모은다. */
export function FindingList({ results, dataFindings }: { results: Result[]; dataFindings: Finding[] }) {
  const rows: Row[] = [];

  for (const f of dataFindings) {
    rows.push({ severity: f.severity, code: f.code, message: f.message, refs: [f.where], cite: null, origin: "데이터" });
  }
  for (const r of results) {
    const tag = results.length > 1 ? `${r.topology.vendor} · ` : "";
    for (const f of r.run?.findings ?? []) {
      rows.push({ severity: f.severity, code: f.code, message: f.message, refs: [], cite: null, origin: `${tag}시나리오` });
    }
    for (const f of r.rules.findings as RuleFinding[]) {
      rows.push({
        severity: f.severity,
        code: f.code,
        message: f.message,
        refs: f.refs,
        cite: f.code_ref,
        origin: `${tag}룰`,
      });
    }
  }

  rows.sort((a, b) => (ORDER[a.severity] ?? 3) - (ORDER[b.severity] ?? 3) || a.code.localeCompare(b.code));

  const unverified = [...new Set(results.flatMap((r) => r.rules.unverified))].sort();

  return (
    <>
      <h2>
        검증 결과 · {rows.length}건
        {rows.filter((r) => r.severity === "warning").length > 0 &&
          ` (경고 ${rows.filter((r) => r.severity === "warning").length})`}
      </h2>
      {rows.length === 0 && <p className="empty">지적 사항 없음.</p>}
      {rows.map((r, i) => (
        <div className="finding" data-sev={r.severity} key={`${r.code}-${i}`}>
          <div className="head">
            <span>{SEVERITY[r.severity] ?? r.severity}</span>
            <span className="code">{r.code}</span>
            <span>{r.origin}</span>
          </div>
          <div className="msg">{r.message}</div>
          {r.refs.length > 0 && <div className="refs">{r.refs.join(" · ")}</div>}
          {r.cite && <div className="cite">{r.cite}</div>}
        </div>
      ))}
      {unverified.length > 0 && (
        <p className="empty">
          조문 원문 미대조 룰: {unverified.join(", ")}. 이 판정은 사내 배포용 근거가 아니다 —
          전기 엔지니어 리뷰가 필요하다.
        </p>
      )}
    </>
  );
}
