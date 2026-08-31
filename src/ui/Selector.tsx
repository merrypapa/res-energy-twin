import type { Topology } from "../schema/topology.js";
import { SiteContext } from "../schema/rule.js";

/** 구성 선택 + 사이트 조건. 2~4개를 고르면 비교 모드가 된다 (CLAUDE.md §6). */
const MAX_COMPARE = 4;

export function Selector({
  topologies,
  selected,
  onChange,
  site,
  onSite,
}: {
  topologies: Topology[];
  selected: string[];
  onChange: (ids: string[]) => void;
  site: SiteContext;
  onSite: (s: SiteContext) => void;
}) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      if (selected.length === 1) return; // 최소 하나는 남긴다
      onChange(selected.filter((x) => x !== id));
    } else if (selected.length < MAX_COMPARE) {
      onChange([...selected, id]);
    }
  };

  const num = (v: number | null) => (v === null ? "" : String(v));
  const setNum = (key: "backup_load_kw" | "largest_motor_lra", raw: string) => {
    const v = raw.trim() === "" ? null : Number(raw);
    if (v !== null && (!Number.isFinite(v) || v <= 0)) return;
    onSite(SiteContext.parse({ ...site, [key]: v }));
  };

  return (
    <>
      <h2>구성 선택</h2>
      <div className="group">
        {topologies.map((t) => {
          const on = selected.includes(t.id);
          const full = !on && selected.length >= MAX_COMPARE;
          return (
            <label className="choice" data-on={on} key={t.id}>
              <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(t.id)} />
              <span>
                <span className="name">{t.vendor}</span>
                <span className="meta">{t.display_name}</span>
              </span>
            </label>
          );
        })}
        <p className="meta" style={{ color: "var(--ink-soft)", fontSize: 12, marginBottom: 0 }}>
          {selected.length === 1
            ? `단일 보기 — ${MAX_COMPARE}개까지 골라 비교한다`
            : `비교 ${selected.length}종`}
        </p>
      </div>

      <h2>사이트 조건</h2>
      <div className="group">
        <label className="field">
          <span>백업 부하 (kW)</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={num(site.backup_load_kw)}
            placeholder="미입력 — 판정 보류"
            onChange={(e) => setNum("backup_load_kw", e.target.value)}
          />
        </label>
        <label className="field">
          <span>최대 모터 기동 전류 (LRA)</span>
          <input
            type="number"
            min="0"
            step="5"
            value={num(site.largest_motor_lra)}
            placeholder="미입력 — 판정 보류"
            onChange={(e) => setNum("largest_motor_lra", e.target.value)}
          />
        </label>
        <label className="field">
          <span>유틸리티</span>
          <input
            type="text"
            value={site.utility ?? ""}
            placeholder="예: PG&E"
            onChange={(e) =>
              onSite(SiteContext.parse({ ...site, utility: e.target.value.trim() || null }))
            }
          />
        </label>
      </div>
    </>
  );
}
