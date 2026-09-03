import type { RenderGraph } from "../graph/index.js";
import type { NodeNote } from "../schema/note.js";
import type { NodeSignalReport, PortSignal } from "../analysis/signals.js";
import type { PowerFlowResult } from "../analysis/powerflow.js";
import type { OperatingPoint } from "../analysis/operating-point.js";
import { assumptionLines } from "../analysis/operating-point.js";
import { notesFor } from "../analysis/notes.js";
import { ELECTRICAL_SOURCE } from "../schema/electrical.js";
import { IvChart, WaveformChart } from "./SignalChart.js";
import { ProductCard } from "./ProductSheet.js";

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
  notes,
  onClose,
}: {
  graph: RenderGraph;
  report: NodeSignalReport;
  flow: PowerFlowResult;
  op: OperatingPoint;
  notes: NodeNote[];
  onClose: () => void;
}) {
  const node = graph.byRef.get(report.ref)!;
  const applicable = notesFor(notes, node.device);
  const power = report.ports.filter((p) => p.domain !== "signal");
  const signal = report.ports.filter((p) => p.domain === "signal");
  const charted = power.filter((p) => p.waveform !== null && Math.abs(p.p_kw ?? 0) > 0.0005);

  return (
    <section className="inspector">
      <header className="inspector-head">
        <div>
          <h2>{report.label}</h2>
          <p className="sub">
            {node.device.display_name} · {report.device_class} · <span className="mono">{report.ref}</span>
          </p>
        </div>
        <button type="button" className="toggle" onClick={onClose}>
          닫기
        </button>
      </header>

      {/* ── 그래프: 이 노드에서 무엇이 흐르는가 ───────────────── */}
      <div className="group charts">
        <h3>신호</h3>
        {charted.length === 0 && report.iv === null && (
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
            <p className="chart-caption">모듈 I–V · P–V</p>
            <IvChart iv={report.iv} />
          </div>
        )}
        {power.some((p) => p.domain === "dc" && p.p_kw !== null && p.waveform === null) && (
          <p className="hint">직류 지점은 파형이 없다 — 값이 시간에 따라 변하지 않는다.</p>
        )}
      </div>

      {/* ── 아래는 설명 ─────────────────────────────────────── */}
      <div className="group">
        <h3>동작점</h3>
        <ul className="plain">
          {assumptionLines(op).map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>
            수지: PV {flow.pv_kw.toFixed(2)} kW · 축전지 {flow.battery_kw.toFixed(2)} kW · 계통{" "}
            {flow.grid_kw.toFixed(2)} kW · 부하 {flow.load_kw.toFixed(2)} kW
            {flow.curtailed_kw > 0 && ` · 제한 ${flow.curtailed_kw.toFixed(2)} kW`}
          </li>
        </ul>
      </div>

      {power.map((p) => (
        <PortPanel key={p.port_id} port={p} />
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

function PortPanel({ port }: { port: PortSignal }) {
  const flowing = port.p_kw !== null && Math.abs(port.p_kw) > 0.0005;
  return (
    <div className="group port">
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
