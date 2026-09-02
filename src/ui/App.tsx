import { useEffect, useMemo, useRef, useState } from "react";
import type { Layer } from "../schema/common.js";
import { EMPTY_SITE, SiteContext } from "../schema/rule.js";
import { renderTopology } from "../render/index.js";
import { buildRenderGraph } from "../graph/index.js";
import { evaluateScenario } from "../scenario/index.js";
import { runRules } from "../rules/engine.js";
import { compareTopologies } from "../compare/index.js";
import { composeTopology, type Options } from "../config/compose.js";
import { computePowerFlow } from "../analysis/powerflow.js";
import { nodeSignals } from "../analysis/signals.js";
import { DEFAULT_OP, OperatingPoint } from "../analysis/operating-point.js";
import { BUILT_AT, CONFIGURATIONS, DATA_FINDINGS, DEVICES, NOTES, SCENARIOS } from "./data.js";
import { Configurator } from "./Configurator.js";
import { FindingList } from "./FindingList.js";
import { DiffTable } from "./DiffTable.js";
import { NodeInspector } from "./NodeInspector.js";
import { readState, writeState } from "./urlState.js";

const ALL_LAYERS: Layer[] = ["power", "comms", "physical"];
const LAYER_LABEL: Record<Layer, string> = { power: "전력", comms: "통신", physical: "물리" };

export default function App() {
  const initial = useMemo(
    () =>
      readState({
        selected: [CONFIGURATIONS[0]?.id ?? ""],
        layers: ["power", "comms"],
        scenarioId: null,
        trip: "",
        site: EMPTY_SITE,
        options: {},
        node: null,
        op: DEFAULT_OP,
      }),
    [],
  );
  // 오래된 링크가 사라진 구성을 가리키면 조용히 빈 화면이 되지 않게 첫 구성으로 떨어진다.
  const known = initial.selected.filter((id) => CONFIGURATIONS.some((c) => c.id === id));
  const [selected, setSelected] = useState<string[]>(
    known.length > 0 ? known : [CONFIGURATIONS[0]?.id ?? ""],
  );
  const [layers, setLayers] = useState<Layer[]>(initial.layers);
  const [scenarioId, setScenarioId] = useState<string | null>(initial.scenarioId);
  const [trip, setTrip] = useState<string>(initial.trip);
  const [site, setSite] = useState<SiteContext>(initial.site);
  const [options, setOptions] = useState<Options>(initial.options);
  const [node, setNode] = useState<{ topology: string; ref: string } | null>(initial.node);
  const [op, setOp] = useState<OperatingPoint>(initial.op);
  /** 도면 크기. 모듈 20장짜리 도면은 폭에 맞추면 읽을 수 없다 — 기본은 실제 크기다. */
  const [zoom, setZoom] = useState<"actual" | "fit">("actual");

  // 링크가 곧 저장이다. 백엔드가 없으므로 상태를 URL에 남긴다.
  useEffect(() => {
    writeState({ selected, layers, scenarioId, trip, site, options, node, op });
  }, [selected, layers, scenarioId, trip, site, options, node, op]);

  const templates = useMemo(
    () => selected.map((id) => CONFIGURATIONS.find((c) => c.id === id)).filter((c) => c !== undefined),
    [selected],
  );
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  const comparing = templates.length > 1;

  const results = useMemo(
    () =>
      templates.map((tpl) => {
        // 이 템플릿이 아는 축만 넘긴다. 벤더마다 축이 달라도 값은 공유된다.
        const own: Options = {};
        for (const axis of tpl.options) if (options[axis.id] !== undefined) own[axis.id] = options[axis.id]!;
        const composed = composeTopology(tpl, own);
        const topology = composed.topology;
        const open = trip ? [trip] : [];
        const run = scenario ? evaluateScenario(topology, DEVICES, scenario, { open }) : null;
        const graph = buildRenderGraph(topology, DEVICES, ALL_LAYERS);
        const flow = computePowerFlow(graph, op, {
          scenario: scenario ?? null,
          energization: run?.energization ?? null,
          site,
        });
        return {
          template: tpl,
          topology,
          appliedOptions: composed.options,
          composeFindings: composed.findings,
          run,
          graph,
          flow,
          svg: renderTopology(topology, DEVICES, {
            layers,
            date: BUILT_AT,
            selected: node?.topology === topology.id ? node.ref : null,
            ...(run && scenario ? { energization: run.energization, scenario: scenario.id } : {}),
          }),
          rules: runRules(topology, DEVICES, site),
        };
      }),
    [templates, options, scenario, layers, site, trip, node, op],
  );

  const comparison = useMemo(
    () =>
      comparing
        ? compareTopologies(
            results.map((r) => r.topology),
            DEVICES,
            { site, scenario },
          )
        : null,
    [comparing, results, site, scenario],
  );

  const inspected = useMemo(() => {
    if (!node) return null;
    const target = results.find((r) => r.topology.id === node.topology);
    if (!target || !target.graph.byRef.has(node.ref)) return null;
    return { target, report: nodeSignals(target.graph, node.ref, target.flow, op) };
  }, [node, results, op]);

  // SVG는 문자열로 주입되므로 클릭은 컨테이너에서 위임으로 받는다.
  const canvasRef = useRef<HTMLDivElement>(null);
  const onCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest("[data-ref]");
    const sheet = (e.target as HTMLElement).closest("[data-topology]");
    if (!el || !sheet) return;
    const ref = el.getAttribute("data-ref");
    const topology = sheet.getAttribute("data-topology");
    if (!ref || !topology) return;
    setNode((prev) => (prev?.ref === ref && prev.topology === topology ? null : { topology, ref }));
  };

  const tripTargets = results.length === 1 ? (results[0]?.topology.nodes ?? []) : [];

  return (
    <div className="app">
      <header className="masthead">
        <h1>Residential Energy System Twin</h1>
        <span className="sub">
          구성 {CONFIGURATIONS.length}종 · 장치 {DEVICES.length}종 · 노트 {NOTES.length}건 · 데이터 {BUILT_AT}
        </span>
        <span className="spacer" />
        <span className="sub">교육 및 비교 목적 — 시공 설계 근거로 사용할 수 없다</span>
      </header>

      <div className="columns">
        <aside className="pane left">
          <Configurator
            templates={CONFIGURATIONS}
            selected={selected}
            onSelected={setSelected}
            options={options}
            onOptions={setOptions}
            site={site}
            onSite={setSite}
            op={op}
            onOp={setOp}
          />
        </aside>

        <main className="pane canvas">
          <div className="canvas-bar">
            <span className="label">레이어</span>
            <div className="toggle-row">
              {ALL_LAYERS.map((l) => (
                <button
                  key={l}
                  type="button"
                  className="toggle"
                  data-on={layers.includes(l)}
                  onClick={() =>
                    setLayers((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]))
                  }
                >
                  {LAYER_LABEL[l]}
                </button>
              ))}
            </div>

            <span className="label">시나리오</span>
            <div className="toggle-row">
              <button
                type="button"
                className="toggle"
                data-on={scenarioId === null}
                onClick={() => {
                  setScenarioId(null);
                  setTrip("");
                }}
              >
                없음
              </button>
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="toggle"
                  data-on={scenarioId === s.id}
                  onClick={() => setScenarioId(s.id)}
                  title={s.description}
                >
                  {s.display_name}
                </button>
              ))}
            </div>

            <span className="label">노드를 클릭하면 신호와 설계 노트가 나온다</span>
            <span className="spacer" />
            <span className="label">도면</span>
            <div className="toggle-row">
              <button type="button" className="toggle" data-on={zoom === "actual"} onClick={() => setZoom("actual")}>
                실제 크기
              </button>
              <button type="button" className="toggle" data-on={zoom === "fit"} onClick={() => setZoom("fit")}>
                폭 맞춤
              </button>
            </div>

            {scenario?.requires_trip_target && tripTargets.length > 0 && (
              <label className="label">
                트립 대상{" "}
                <select value={trip} onChange={(e) => setTrip(e.target.value)}>
                  <option value="">지정 없음</option>
                  {tripTargets.map((n) => (
                    <option key={n.ref} value={n.ref}>
                      {n.label ?? n.ref}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div
            className="sheets"
            data-n={results.length}
            data-zoom={comparing ? "fit" : zoom}
            ref={canvasRef}
            onClick={onCanvasClick}
          >
            {results.map((r) => (
              <figure className="sheet" key={r.topology.id} data-topology={r.topology.id}>
                <figcaption>
                  {r.topology.vendor} · {r.topology.display_name}
                  {r.run && ` · 활선 ${liveCount(r.run.energization)}`}
                </figcaption>
                <div className="paper" dangerouslySetInnerHTML={{ __html: r.svg }} />
              </figure>
            ))}
          </div>

          {comparison && <DiffTable comparison={comparison} />}

          <p className="disclaimer">
            교육 및 비교 목적의 구성 도면이다. 퍼밋 도면 · PE 날인 설계 · 시공 근거로 사용할 수 없다.
            정격과 결선은 제조사 매뉴얼 원문 대조 전 값이며, 코드 판정은 조문 원문 대조 전이다.
          </p>
        </main>

        <aside className="pane right">
          {inspected ? (
            <NodeInspector
              graph={inspected.target.graph}
              report={inspected.report}
              flow={inspected.target.flow}
              op={op}
              notes={NOTES}
              onClose={() => setNode(null)}
            />
          ) : (
            <FindingList
              results={results}
              dataFindings={[
                ...DATA_FINDINGS.filter((f) => results.some((r) => f.where.includes(r.template.id))),
                ...results.flatMap((r) => [...r.composeFindings, ...r.flow.findings]),
              ]}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function liveCount(map: Readonly<Record<string, string>>): string {
  const values = Object.values(map);
  return `${values.filter((v) => v === "live").length}/${values.length}`;
}
