import type { RenderGraph } from "../graph/index.js";
import type { NodeNote } from "../schema/note.js";
import type { NodeSignalReport, PortSignal } from "../analysis/signals.js";
import type { PowerFlowResult } from "../analysis/powerflow.js";
import type { OperatingPoint } from "../analysis/operating-point.js";
import { assumptionLines } from "../analysis/operating-point.js";
import { notesFor } from "../analysis/notes.js";
import { ELECTRICAL_SOURCE } from "../schema/electrical.js";
import type { Location } from "../schema/location.js";
import type { DayProfile } from "../analysis/day.js";
import { IvChart, LinePlot, WaveformChart } from "./SignalChart.js";
import { renderInternals } from "../render/internals.js";
import type { Device } from "../schema/device.js";
import { ProductCard } from "./ProductSheet.js";
import { TimeBar } from "./TimeBar.js";

/**
 * 노드 포인트 패널 — 위는 그래프, 아래는 설명.
 *
 * 이 컴포넌트는 값을 만들지 않는다. 숫자는 전부 analysis/가 계산한 것이고,
 * 설명은 전부 node-notes/의 데이터, 스펙은 device-library의 것이다.
 * 여기에 제품 지식을 적으면 안 된다.
 */
export function NodeInspector({
  graph,
  report,
  flow,
  op,
  rawOp,
  location,
  day,
  focusPort,
  notes,
  playing,
  onHour,
  onPlay,
  onClose,
}: {
  graph: RenderGraph;
  report: NodeSignalReport;
  flow: PowerFlowResult;
  /** 일사가 계산돼 들어간 동작점 (엔진이 쓴 것) */
  op: OperatingPoint;
  /** 사용자가 고른 값 그대로 — 시간 축이 이걸 움직인다 */
  rawOp: OperatingPoint;
  location: Location | null;
  day: DayProfile | null;
  focusPort: string | null;
  notes: NodeNote[];
  playing: boolean;
  onHour: (hour: number) => void;
  onPlay: (playing: boolean) => void;
  onClose: () => void;
}) {
  const node = graph.byRef.get(report.ref)!;
  const applicable = notesFor(notes, node.device);
  const power = report.ports.filter((p) => p.domain !== "signal");
  const signal = report.ports.filter((p) => p.domain === "signal");
  // 단자를 골랐으면 그 단자만 그린다. 함체를 골랐으면 전력 포트 전부.
  const focused = focusPort === null ? power : power.filter((p) => p.port_id === focusPort);
  const charted = focused.filter((p) => p.waveform !== null && Math.abs(p.p_kw ?? 0) > 0.0005);
  const ordered = focusPort === null ? power : [...focused, ...power.filter((p) => p.port_id !== focusPort)];

  return (
    <section className="inspector">
      <header className="inspector-head">
        <div>
          <h2>{report.label}</h2>
          <p className="sub">
            {node.device.display_name} · {report.device_class} ·{" "}
            <span className="mono">
              {report.ref}
              {focusPort !== null && `.${focusPort}`}
            </span>
            {focusPort !== null && " 단자"}
          </p>
        </div>
        <button type="button" className="toggle" onClick={onClose}>
          닫기
        </button>
      </header>

      {/* ── 시간 축: 하루가 흐르면 신호가 어떻게 변하는가 ───────── */}
      <TimeBar op={rawOp} location={location} playing={playing} onHour={onHour} onPlay={onPlay} />

      {/* ── 그래프: 이 노드에서 무엇이 흐르는가 ───────────────── */}
      <div className="group charts">
        <h3>신호</h3>
        {day && (
          <div className="port-charts">
            <p className="chart-caption">하루 전력 — 시간 축의 눈금이 지금 보고 있는 시각이다</p>
            {(focusPort === null ? power : focused).map((p) => (
              <LinePlot
                key={`day-${p.port_id}`}
                x={day.hours}
                y={day.ports[p.port_id] ?? []}
                title={`${p.port_id} · P(t)`}
                unit="kW"
                marker={{
                  x: rawOp.hour,
                  y: (day.ports[p.port_id] ?? [])[Math.round(rawOp.hour / day.step)] ?? 0,
                  label: `${(
                    (day.ports[p.port_id] ?? [])[Math.round(rawOp.hour / day.step)] ?? 0
                  ).toFixed(2)} kW`,
                }}
                xLabels={["00시", "24시"]}
              />
            ))}
          </div>
        )}
        {charted.length === 0 && report.iv === null && day === null && (
          <p className="empty">
            이 노드에는 지금 흐르는 전력이 없거나, 계산에 필요한 정격이 확인되지 않았다.
            아래 설명에서 이유를 볼 수 있다.
          </p>
        )}
        {charted.map((p) => (
          <div className="port-charts" key={p.port_id}>
            <p className="chart-caption">
              <span className="mono">{p.port_id}</span> · {p.domain === "ac" ? "교류" : "직류"} ·{" "}
              {p.p_kw! > 0 ? "공급" : "흡수"} {Math.abs(p.p_kw!).toFixed(2)} kW
            </p>
            <WaveformChart wave={p.waveform!} />
          </div>
        ))}
        {report.iv && (
          <div className="port-charts">
            <p className="chart-caption">
              모듈 I–V · P–V — 최대출력점(MPP)은 일사에 따라 움직인다
            </p>
            <IvChart iv={report.iv} />
          </div>
        )}
        {report.device_class === "pv_module" && report.iv === null && (
          <MissingIv device={node.device} />
        )}
        {power.some((p) => p.domain === "dc" && p.p_kw !== null && p.waveform === null) && (
          <p className="hint">직류 지점은 파형이 없다 — 값이 시간에 따라 변하지 않는다.</p>
        )}
      </div>

      <InternalsSection device={node.device} />

      {/* ── 아래는 설명 ─────────────────────────────────────── */}
      <div className="group">
        <h3>동작점</h3>
        <ul className="plain">
          {assumptionLines(op, location).map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>
            수지: PV {flow.pv_kw.toFixed(2)} kW · 축전지 {flow.battery_kw.toFixed(2)} kW · 계통{" "}
            {flow.grid_kw.toFixed(2)} kW · 부하 {flow.load_kw.toFixed(2)} kW
            {flow.clipped_kw > 0 && ` · 클리핑 ${flow.clipped_kw.toFixed(2)} kW`}
            {flow.curtailed_kw > 0 && ` · 제한 ${flow.curtailed_kw.toFixed(2)} kW`}
          </li>
        </ul>
      </div>

      {ordered.map((p) => (
        <PortPanel key={p.port_id} port={p} focused={focusPort === p.port_id} />
      ))}

      {signal.length > 0 && (
        <div className="group">
          <h3>통신 · 계측 포트</h3>
          <ul className="plain">
            {signal.map((p) => (
              <li key={p.port_id}>
                <span className="mono">{p.port_id}</span> — {p.arrangement}
                {p.peers.length > 0 ? ` → ${p.peers.join(", ")}` : " (미접속)"}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="group">
        <h3>설계 · 기능</h3>
        {applicable.length === 0 && <p className="empty">이 클래스의 노드 노트가 아직 없다.</p>}
        {applicable.map((note) => (
          <article key={note.id} className="note">
            <p className="role">{note.role}</p>
            {note.design_points.map((dp) => (
              <div key={dp.title} className="design-point">
                <h4>{dp.title}</h4>
                <p>{dp.body}</p>
                {dp.formula && <p className="formula">{dp.formula}</p>}
                {dp.code_ref && (
                  <p className="cite">
                    근거 {dp.code_ref} · {dp.verified ? "원문 대조 완료" : "원문 대조 전"}
                  </p>
                )}
              </div>
            ))}
            {note.watch_outs.length > 0 && (
              <ul className="plain watch">
                {note.watch_outs.map((w) => (
                  <li key={w}>확인 필요 — {w}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>

      <div className="group">
        <h3>제품 스펙 · 데이터시트</h3>
        <ProductCard device={node.device} />
      </div>

      <p className="disclaimer">
        전압·주파수는 {ELECTRICAL_SOURCE.ref}의 공칭값이며 원문 대조 전이다. 계산은 임피던스·전압 강하·
        무효전력을 풀지 않는 전력 수지이고, 온도계수는 반영하지 않는다. 시공·정정 근거로 쓸 수 없다.
      </p>
    </section>
  );
}

function num(v: number | null, unit: string, digits = 2): string {
  return v === null ? "미확인" : `${Number(v.toFixed(digits))} ${unit}`;
}

function PortPanel({ port, focused }: { port: PortSignal; focused: boolean }) {
  const flowing = port.p_kw !== null && Math.abs(port.p_kw) > 0.0005;
  return (
    <div className="group port" data-focused={focused}>
      <h3>
        <span className="mono">{port.port_id}</span> · {port.domain === "ac" ? "교류" : "직류"}
        <span className="sub"> {port.arrangement}</span>
      </h3>

      <table className="readout">
        <tbody>
          <tr>
            <th>전력 P</th>
            <td>
              {num(port.p_kw, "kW")}
              {flowing && <span className="sub"> ({port.p_kw! > 0 ? "이 포트에서 나감" : "이 포트로 들어옴"})</span>}
            </td>
          </tr>
          <tr>
            <th>전압 V</th>
            <td>
              {num(port.v, "V", 1)}
              {port.domain === "ac" && port.v !== null && <span className="sub"> 실효(rms), 선간</span>}
            </td>
          </tr>
          <tr>
            <th>전류 I</th>
            <td>{num(port.i, "A")}</td>
          </tr>
        </tbody>
      </table>

      {port.peers.length > 0 && <p className="sub">도체 상대: {port.peers.join(", ")}</p>}

      {port.basis.length > 0 && (
        <ul className="plain basis">
          {port.basis.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      {port.formulas.length > 0 && (
        <dl className="formulas">
          {port.formulas.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd className="formula">{f.expr}</dd>
            </div>
          ))}
        </dl>
      )}

      {port.notes.map((n) => (
        <p key={n} className="empty">
          {n}
        </p>
      ))}
    </div>
  );
}

/** I-V 곡선에 필요한 STC 값. 하나라도 없으면 곡선을 그리지 않는다. */
const IV_FIELDS = [
  ["pv_voc_v", "개방 전압 Voc"],
  ["pv_isc_a", "단락 전류 Isc"],
  ["pv_vmp_v", "최대출력 전압 Vmp"],
  ["pv_imp_a", "최대출력 전류 Imp"],
] as const;

/**
 * 곡선을 못 그리는 이유를 구체적으로 밝힌다.
 *
 * "정격이 없다"로 끝내면 무엇을 채워야 하는지 알 수 없다. 빠진 항목을 이름으로 대고
 * 출처 링크를 함께 준다 — 값을 추정해 곡선을 만들어 내지는 않는다.
 */
function MissingIv({ device }: { device: Device }) {
  const missing = IV_FIELDS.filter(([key]) => device.ratings[key] === null);
  if (missing.length === 0) return null;
  const sheet = device.sources.find((s) => s.url !== null);
  return (
    <p className="hint">
      I–V · MPPT 곡선을 그리려면 STC 값 네 개가 필요하다. 지금 없는 것:{" "}
      <b>{missing.map(([, label]) => label).join(" · ")}</b>. 추정해 그리지 않는다 —
      데이터시트에서 채우면 바로 나온다.
      {sheet && (
        <>
          {" "}
          <a href={sheet.url!} target="_blank" rel="noreferrer noopener">
            {sheet.ref}
          </a>
        </>
      )}
    </p>
  );
}

/**
 * 함체 내부. 단선도에는 한 상자로 그려지는 것의 안쪽이다 —
 * 결합반의 차단기 구성처럼 상자 하나로는 보이지 않는 것을 여기서 연다.
 */
function InternalsSection({ device }: { device: Device }) {
  const internals = device.internals;
  if (internals === null) return null;
  const svg = renderInternals(device);
  if (svg === null) return null;
  return (
    <div className="group">
      <h3>함체 내부</h3>
      <div className="internals-sheet" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="hint">
        읽기 위한 기술이다 — 전력 조류와 코드 판정은 이 구조를 보지 않는다.
      </p>
      {internals.todos.length > 0 && (
        <ul className="plain watch">
          {internals.todos.map((t) => (
            <li key={t}>확인 필요 — {t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
