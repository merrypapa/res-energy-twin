import type { ConfigTemplate, OptionAxis } from "../schema/template.js";
import { SiteContext } from "../schema/rule.js";
import { OperatingPoint } from "../analysis/operating-point.js";
import type { Options } from "../config/compose.js";

/**
 * 구성 선택 · 옵션 축 · 사이트 조건 · 동작점.
 *
 * 옵션 축은 템플릿 데이터에서 그대로 나온다 — 여기에 축 이름이 하드코딩되면
 * 새 축을 넣을 때마다 UI를 고쳐야 한다. 축이 여러 벤더에 공통이면 값을 공유해서
 * "같은 조건에서 벤더별 구성"이 비교된다.
 */
const MAX_COMPARE = 4;

export function Configurator({
  templates,
  selected,
  onSelected,
  options,
  onOptions,
  site,
  onSite,
  op,
  onOp,
}: {
  templates: ConfigTemplate[];
  selected: string[];
  onSelected: (ids: string[]) => void;
  options: Options;
  onOptions: (o: Options) => void;
  site: SiteContext;
  onSite: (s: SiteContext) => void;
  op: OperatingPoint;
  onOp: (o: OperatingPoint) => void;
}) {
  const chosen = templates.filter((t) => selected.includes(t.id));

  // 선택된 템플릿들의 축을 합친다. 같은 id면 한 번만 — 값이 공유된다.
  const axes: Array<{ axis: OptionAxis; owners: string[] }> = [];
  for (const t of chosen) {
    for (const axis of t.options) {
      const found = axes.find((a) => a.axis.id === axis.id);
      if (found) found.owners.push(t.vendor);
      else axes.push({ axis, owners: [t.vendor] });
    }
  }

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      if (selected.length === 1) return; // 최소 하나는 남긴다
      onSelected(selected.filter((x) => x !== id));
    } else if (selected.length < MAX_COMPARE) {
      onSelected([...selected, id]);
    }
  };

  const set = (id: string, value: string | number) => onOptions({ ...options, [id]: value });

  const valueOf = (axis: OptionAxis): string | number => options[axis.id] ?? axis.default;

  const num = (v: number | null) => (v === null ? "" : String(v));
  const setSite = (key: "backup_load_kw" | "largest_motor_lra", raw: string) => {
    const v = raw.trim() === "" ? null : Number(raw);
    if (v !== null && (!Number.isFinite(v) || v <= 0)) return;
    onSite(SiteContext.parse({ ...site, [key]: v }));
  };

  return (
    <>
      <h2>벤더 구성</h2>
      <div className="group">
        {templates.map((t) => {
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
        <p className="hint">
          {selected.length === 1 ? `단일 보기 — ${MAX_COMPARE}개까지 골라 비교한다` : `비교 ${selected.length}종`}
        </p>
      </div>

      <h2>구성 옵션</h2>
      <div className="group">
        {axes.length === 0 && <p className="empty">옵션 축이 없는 구성이다.</p>}
        {axes.map(({ axis, owners }) => (
          <div className="axis" key={axis.id}>
            <span className="axis-label">
              {axis.label}
              {chosen.length > 1 && owners.length < chosen.length && (
                <span className="sub"> · {owners.join("/")}만</span>
              )}
            </span>
            {axis.kind === "enum" ? (
              <div className="toggle-row">
                {axis.choices.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className="toggle"
                    data-on={String(valueOf(axis)) === c.value}
                    title={c.note ?? undefined}
                    onClick={() => set(axis.id, c.value)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            ) : (
              <label className="field inline">
                <input
                  type="number"
                  min={axis.min}
                  max={axis.max}
                  step={axis.step}
                  value={String(valueOf(axis))}
                  onChange={(e) => set(axis.id, Number(e.target.value))}
                />
                <span className="unit">
                  {axis.unit ?? ""} ({axis.min}~{axis.max})
                </span>
              </label>
            )}
            {axis.note && <p className="hint">{axis.note}</p>}
            {axis.kind === "enum" &&
              axis.choices.find((c) => c.value === String(valueOf(axis)))?.note && (
                <p className="hint">
                  {axis.choices.find((c) => c.value === String(valueOf(axis)))!.note}
                </p>
              )}
          </div>
        ))}
      </div>

      {chosen.length === 1 && chosen[0]!.presets.length > 0 && (
        <>
          <h2>프리셋</h2>
          <div className="group">
            {chosen[0]!.presets.map((p) => (
              <button
                key={p.id}
                type="button"
                className="preset"
                title={p.note ?? undefined}
                onClick={() => onOptions({ ...options, ...p.options })}
              >
                {p.display_name}
              </button>
            ))}
          </div>
        </>
      )}

      <h2>동작점 (신호 계산 입력)</h2>
      <div className="group">
        <label className="field">
          <span>일사 G/1000 — {Math.round(op.irradiance * 100)}%</span>
          <input
            type="range"
            min="0"
            max="1.2"
            step="0.05"
            value={op.irradiance}
            onChange={(e) => onOp(OperatingPoint.parse({ ...op, irradiance: Number(e.target.value) }))}
          />
        </label>
        <label className="field">
          <span>주택 부하 (kW)</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={num(op.house_load_kw)}
            placeholder="미입력 — 발전 전량이 상류로"
            onChange={(e) => {
              const raw = e.target.value.trim();
              const v = raw === "" ? null : Number(raw);
              if (v !== null && (!Number.isFinite(v) || v < 0)) return;
              onOp(OperatingPoint.parse({ ...op, house_load_kw: v }));
            }}
          />
        </label>
        <p className="hint">
          효율 {(op.inverter_efficiency * 100).toFixed(0)}% · 역률 {op.power_factor.toFixed(2)}는 가정값이다
          (제품 스펙 아님).
        </p>
      </div>

      <h2>사이트 조건 (룰 판정)</h2>
      <div className="group">
        <label className="field">
          <span>백업 부하 (kW)</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={num(site.backup_load_kw)}
            placeholder="미입력 — 판정 보류"
            onChange={(e) => setSite("backup_load_kw", e.target.value)}
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
            onChange={(e) => setSite("largest_motor_lra", e.target.value)}
          />
        </label>
        <label className="field">
          <span>유틸리티</span>
          <input
            type="text"
            value={site.utility ?? ""}
            placeholder="예: PG&E"
            onChange={(e) => onSite(SiteContext.parse({ ...site, utility: e.target.value.trim() || null }))}
          />
        </label>
      </div>
    </>
  );
}
