import { useEffect, useMemo, useState } from "react";
import type { Layer } from "../schema/common.js";
import { EMPTY_SITE, SiteContext } from "../schema/rule.js";
import { renderTopology } from "../render/index.js";
import { evaluateScenario } from "../scenario/index.js";
import { runRules } from "../rules/engine.js";
import { compareTopologies } from "../compare/index.js";
import { BUILT_AT, DATA_FINDINGS, DEVICES, SCENARIOS, TOPOLOGIES } from "./data.js";
import { Selector } from "./Selector.js";
import { FindingList } from "./FindingList.js";
import { DiffTable } from "./DiffTable.js";
import { readState, writeState } from "./urlState.js";

const ALL_LAYERS: Layer[] = ["power", "comms", "physical"];
const LAYER_LABEL: Record<Layer, string> = { power: "전력", comms: "통신", physical: "물리" };

export default function App() {
  const initial = useMemo(
    () =>
      readState({
        selected: [TOPOLOGIES[0]?.id ?? ""],
        layers: ["power", "comms"],
        scenarioId: null,
        trip: "",
        site: EMPTY_SITE,
      }),
    [],
  );
  const [selected, setSelected] = useState<string[]>(initial.selected);
  const [layers, setLayers] = useState<Layer[]>(initial.layers);
  const [scenarioId, setScenarioId] = useState<string | null>(initial.scenarioId);
  const [trip, setTrip] = useState<string>(initial.trip);
  const [site, setSite] = useState<SiteContext>(initial.site);

  // 링크가 곧 저장이다. 백엔드가 없으므로 상태를 URL에 남긴다.
  useEffect(() => {
    writeState({ selected, layers, scenarioId, trip, site });
  }, [selected, layers, scenarioId, trip, site]);

  const topologies = useMemo(
    () => selected.map((id) => TOPOLOGIES.find((t) => t.id === id)).filter((t) => t !== undefined),
    [selected],
  );
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  const comparing = topologies.length > 1;

  const results = useMemo(
    () =>
      topologies.map((t) => {
        const open = trip ? [trip] : [];
        const run = scenario ? evaluateScenario(t, DEVICES, scenario, { open }) : null;
        return {
          topology: t,
          run,
          svg: renderTopology(t, DEVICES, {
            layers,
            date: BUILT_AT,
            ...(run ? { energization: run.energization } : {}),
          }),
          rules: runRules(t, DEVICES, site),
        };
      }),
    [topologies, scenario, layers, site, trip],
  );

  const comparison = useMemo(
    () => (comparing ? compareTopologies(topologies, DEVICES, { site, scenario }) : null),
    [comparing, topologies, site, scenario],
  );

  const tripTargets = topologies.length === 1 ? (topologies[0]?.nodes ?? []) : [];

  return (
    <div className="app">
      <header className="masthead">
        <h1>Residential Energy System Twin</h1>
        <span className="sub">
          구성 {TOPOLOGIES.length}종 · 장치 {DEVICES.length}종 · 데이터 {BUILT_AT}
        </span>
        <span className="spacer" />
        <span className="sub">교육 및 비교 목적 — 시공 설계 근거로 사용할 수 없다</span>
      </header>

      <div className="columns">
        <aside className="pane left">
          <Selector
            topologies={TOPOLOGIES}
            selected={selected}
            onChange={setSelected}
            site={site}
            onSite={setSite}
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

          <div className="sheets" data-n={results.length}>
            {results.map((r) => (
              <figure className="sheet" key={r.topology.id}>
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
          <FindingList
            results={results}
            dataFindings={DATA_FINDINGS.filter((f) =>
              topologies.some((t) => f.where.includes(t.id)),
            )}
          />
        </aside>
      </div>
    </div>
  );
}

function liveCount(map: Readonly<Record<string, string>>): string {
  const values = Object.values(map);
  return `${values.filter((v) => v === "live").length}/${values.length}`;
}
