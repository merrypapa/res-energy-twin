import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDevices, loadTopologies, loadScenarios } from "../src/validate/index.js";
import { evaluateScenario, type ScenarioResult } from "../src/scenario/index.js";
import { renderTopology } from "../src/render/index.js";
import { buildRenderGraph } from "../src/graph/index.js";
import { Scenario } from "../src/schema/scenario.js";
import { Device } from "../src/schema/device.js";

const devices = loadDevices("device-library").items;
const topologies = loadTopologies("topologies").items;
const scenarios = loadScenarios("scenarios").items;

const topo = (id: string) => topologies.find((t) => t.id.startsWith(id))!;
const scen = (id: string) => scenarios.find((s) => s.id === id)!;
const tesla = topo("tesla");
const enphase = topo("enphase");

const run = (t = tesla, s = "grid_normal", open?: string[]): ScenarioResult =>
  evaluateScenario(t, devices, scen(s), open ? { open } : {});

const codes = (r: ScenarioResult) => r.findings.map((f) => f.code);
const liveEdges = (r: ScenarioResult) =>
  Object.entries(r.energization).filter(([, v]) => v === "live").map(([k]) => k);

describe("시나리오 데이터", () => {
  it("CLAUDE.md가 정의한 다섯 상태가 모두 있다", () => {
    expect(scenarios.map((s) => s.id).sort()).toEqual(
      ["black_start", "fault", "grid_normal", "load_shed", "outage_islanded"].sort(),
    );
  });

  it("스키마를 벗어난 필드는 거부된다", () => {
    expect(() => Scenario.parse({ ...scen("grid_normal"), soc_percent: 50 })).toThrow();
  });

  it("order로 정렬되어 로드된다", () => {
    const orders = scenarios.map((s) => s.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });
});

describe("계통 정상", () => {
  it("모든 전력 엣지가 활선이다", () => {
    for (const t of topologies) {
      const r = evaluateScenario(t, devices, scen("grid_normal"));
      expect(Object.values(r.energization).every((v) => v === "live")).toBe(true);
    }
  });

  it("흐름은 전부 소스에서 부하 방향(forward)이다", () => {
    for (const t of topologies) {
      const r = evaluateScenario(t, devices, scen("grid_normal"));
      expect(Object.values(r.flows).every((f) => f === "forward")).toBe(true);
    }
  });

  it("MID는 닫혀 있다", () => {
    for (const t of topologies) {
      expect(evaluateScenario(t, devices, scen("grid_normal")).open_nodes).toEqual([]);
    }
  });
});

describe("정전 — 아일랜딩", () => {
  it("provides_mid 장치가 시나리오 파일 지정 없이 자동 개방된다", () => {
    expect(run(tesla, "outage_islanded").open_nodes).toEqual(["bs"]);
    expect(run(enphase, "outage_islanded").open_nodes).toEqual(["collar"]);
  });

  it("계통측 도체가 사선화된다", () => {
    expect(run(tesla, "outage_islanded").energization["svc.line->bs.grid_in"]).toBe("dead");
    expect(run(enphase, "outage_islanded").energization["svc.line->collar.grid_in"]).toBe("dead");
  });

  it("MID 부하측은 아일랜드에서 역방향으로 급전된다", () => {
    const r = run(tesla, "outage_islanded");
    expect(r.energization["bs.load_out->msp.main_lugs"]).toBe("live");
    expect(r.flows["bs.load_out->msp.main_lugs"]).toBe("reverse");
  });

  it("그리드 포밍 장치가 아일랜드를 세운다", () => {
    expect(run(tesla, "outage_islanded").injectors).toContain("pw3");
    expect(run(enphase, "outage_islanded").injectors).toContain("batt");
  });

  it("계통 정상 대비 경로가 실제로 바뀐다 — 스프린트 2 완료 기준", () => {
    for (const t of topologies) {
      const normal = evaluateScenario(t, devices, scen("grid_normal"));
      const outage = evaluateScenario(t, devices, scen("outage_islanded"));
      expect(outage.energization).not.toEqual(normal.energization);
      expect(liveEdges(outage).length).toBeLessThan(liveEdges(normal).length);
    }
  });
});

describe("블랙스타트", () => {
  it("black_start_capable이 미확인이면 기동을 성립시키지 않는다", () => {
    for (const t of topologies) {
      const r = evaluateScenario(t, devices, scen("black_start"));
      expect(r.injectors).toEqual([]);
      expect(codes(r)).toContain("S022");
      expect(codes(r)).toContain("S021");
    }
  });

  it("PV DC 회로만 살아 있고 AC측은 전부 사선이다", () => {
    const r = evaluateScenario(tesla, devices, scen("black_start"));
    expect(liveEdges(r)).toEqual(["pv.dc_out->pw3.pv_dc"]);
  });

  it("black_start_capable=true를 넣으면 기동이 성립한다 — 데이터만으로 결과가 바뀐다", () => {
    const patched = devices.map((d) =>
      d.id === "tesla-powerwall-3" ? Device.parse({ ...d, black_start_capable: true }) : d,
    );
    const r = evaluateScenario(tesla, patched, scen("black_start"));
    expect(r.injectors).toContain("pw3");
    expect(r.energization["pw3.ac_out->msp.branch"]).toBe("live");
    expect(codes(r)).not.toContain("S022");
  });
});

describe("부하 차단 (야간 아일랜딩)", () => {
  it("일몰 후 DC 어레이 회로는 사선이다 — 인버터가 어레이를 역급전하지 않는다", () => {
    expect(run(tesla, "load_shed").energization["pv.dc_out->pw3.pv_dc"]).toBe("dead");
    expect(run(enphase, "load_shed").energization["pv.dc_out->micro.dc_in"]).toBe("dead");
  });

  it("마이크로인버터의 AC 도체는 야간에도 활선이다", () => {
    const r = run(enphase, "load_shed");
    expect(r.energization["micro.ac_out->comb.pv_ac_in"]).toBe("live");
    expect(r.flows["micro.ac_out->comb.pv_ac_in"]).toBe("reverse");
  });

  it("부하 노드가 없다는 사실을 숨기지 않고 보고한다", () => {
    expect(codes(run(tesla, "load_shed"))).toContain("S030");
  });
});

describe("고장 — 브레이커 트립", () => {
  it("트립 대상을 지정하지 않으면 그 사실을 보고한다", () => {
    expect(codes(run(tesla, "fault"))).toContain("S011");
  });

  it("트립된 장치는 소스로 동작하지 않는다", () => {
    const r = run(tesla, "fault", ["pw3"]);
    expect(r.injectors).not.toContain("pw3");
    expect(r.open_nodes).toContain("pw3");
  });

  it("트립되면 그 도체의 흐름 방향이 뒤집힌다", () => {
    expect(run(tesla, "fault").flows["pw3.ac_out->msp.branch"]).toBe("forward");
    expect(run(tesla, "fault", ["pw3"]).flows["pw3.ac_out->msp.branch"]).toBe("reverse");
  });

  it("토폴로지에 없는 노드를 트립시키면 error를 낸다", () => {
    const r = run(tesla, "fault", ["nope"]);
    expect(r.findings.find((f) => f.code === "S010")?.severity).toBe("error");
  });
});

describe("물리 규칙 — 모든 토폴로지 × 모든 시나리오", () => {
  const all = topologies.flatMap((t) =>
    scenarios.map((s) => ({ t, s, r: evaluateScenario(t, devices, s) })),
  );

  it("AC에서 DC로 역급전되는 경로가 절대 생기지 않는다", () => {
    for (const { t, s, r } of all) {
      const graph = buildRenderGraph(t, devices, ["power"]);
      for (const e of graph.edges) {
        if (r.energization[e.id] !== "live") continue;
        const dc = e.from.port.type.startsWith("dc_") || e.to.port.type.startsWith("dc_");
        if (!dc) continue;
        // DC 회로가 살아 있으려면 PV가 발전 중이어야 한다.
        expect(`${t.id}/${s.id}/${e.id}: pv=${s.pv}`).toBe(`${t.id}/${s.id}/${e.id}: pv=producing`);
      }
    }
  });

  it("개방된 노드는 어떤 시나리오에서도 소스가 되지 않는다", () => {
    for (const { t, s, r } of all) {
      const both = r.injectors.filter((x) => r.open_nodes.includes(x));
      expect(`${t.id}/${s.id}: ${both.join(",") || "none"}`).toBe(`${t.id}/${s.id}: none`);
    }
  });

  it("개방된 노드를 관통해야만 닿는 노드는 사선이다", () => {
    for (const { t, s, r } of all) {
      const graph = buildRenderGraph(t, devices, ["power"]);
      const open = new Set(r.open_nodes);
      // 개방 노드를 제거한 그래프에서 소스로부터 도달 가능한 노드만 활선일 수 있다.
      const reachable = new Set(r.injectors.filter((x) => !open.has(x)));
      for (const n of graph.nodes) {
        if (open.has(n.ref)) continue;
        if (n.device.class === "service_point" && s.grid === "present") reachable.add(n.ref);
        if (n.device.class === "pv_module" && s.pv === "producing") reachable.add(n.ref);
      }
      for (let i = 0; i < graph.nodes.length; i++) {
        for (const e of graph.edges) {
          const [a, b] = [e.from.nodeRef, e.to.nodeRef];
          if (open.has(a) || open.has(b)) continue;
          if (reachable.has(a)) reachable.add(b);
          if (reachable.has(b)) reachable.add(a);
        }
      }
      for (const n of graph.nodes) {
        if (open.has(n.ref) || r.nodes[n.ref] !== "live") continue;
        // 활선인데 개방 노드를 제외한 그래프에서 소스에 못 닿으면 관통한 것이다.
        expect(`${t.id}/${s.id}/${n.ref}: reachable=${reachable.has(n.ref)}`).toBe(
          `${t.id}/${s.id}/${n.ref}: reachable=true`,
        );
      }
    }
  });

  it("모든 엣지가 활선/사선 판정을 받는다 — 누락 없음", () => {
    for (const { t, r } of all) {
      const graph = buildRenderGraph(t, devices, ["power"]);
      expect(Object.keys(r.energization).sort()).toEqual(graph.edges.map((e) => e.id).sort());
      expect(Object.keys(r.flows).sort()).toEqual(graph.edges.map((e) => e.id).sort());
    }
  });

  it("사선 엣지에는 흐름 방향이 없다", () => {
    for (const { r } of all) {
      for (const [id, v] of Object.entries(r.energization)) {
        if (v === "dead") expect(r.flows[id]).toBe("none");
        else expect(r.flows[id]).not.toBe("none");
      }
    }
  });

  it("같은 입력이면 같은 결과다", () => {
    for (const { t, s, r } of all) {
      expect(evaluateScenario(t, devices, s)).toEqual(r);
    }
  });
});

describe("렌더러 계약 — 스프린트 1 인터페이스를 그대로 쓴다", () => {
  it("엔진 출력이 렌더러에 그대로 들어간다", () => {
    const r = run(tesla, "outage_islanded");
    const svg = renderTopology(tesla, devices, { energization: r.energization, date: "2026-01-01" });
    expect(svg).toContain("<svg");
  });

  it("시나리오가 다르면 도면이 다르다", () => {
    const opts = { date: "2026-01-01" } as const;
    const normal = renderTopology(tesla, devices, { ...opts, energization: run(tesla, "grid_normal").energization });
    const outage = renderTopology(tesla, devices, { ...opts, energization: run(tesla, "outage_islanded").energization });
    expect(outage).not.toBe(normal);
  });
});

describe("데이터가 제품이다 — 엔진에 제품 지식이 없다", () => {
  const sources = readdirSync("src/scenario")
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ f, text: readFileSync(join("src/scenario", f), "utf8") }));

  it("엔진 소스에 벤더/제품명이 등장하지 않는다", () => {
    const banned = /tesla|enphase|qcells|solaredge|powerwall|iq\s?battery|backup switch|meter collar/i;
    for (const { f, text } of sources) {
      const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(`${f}: ${banned.test(code) ? code.match(banned)?.[0] : "clean"}`).toBe(`${f}: clean`);
    }
  });

  it("엔진 소스에 노드 ref가 하드코딩되어 있지 않다", () => {
    const banned = /["'](?:pw3|msp|collar|comb|batt|micro|svc|bs)["']/;
    for (const { f, text } of sources) {
      const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(`${f}: ${banned.test(code) ? code.match(banned)?.[0] : "clean"}`).toBe(`${f}: clean`);
    }
  });
});
