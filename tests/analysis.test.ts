import { describe, expect, it } from "vitest";
import { loadConfigurations, loadDevices, loadNotes, loadScenarios } from "../src/validate/index.js";
import { composeTopology } from "../src/config/compose.js";
import { buildRenderGraph } from "../src/graph/index.js";
import { evaluateScenario } from "../src/scenario/index.js";
import { computePowerFlow } from "../src/analysis/powerflow.js";
import { nodeSignals } from "../src/analysis/signals.js";
import { checkNoteCoverage, notesFor } from "../src/analysis/notes.js";
import { OperatingPoint } from "../src/analysis/operating-point.js";
import { Device } from "../src/schema/device.js";

const devices = loadDevices("device-library").items;
const templates = loadConfigurations("configurations").items;
const scenarios = loadScenarios("scenarios").items;
const notes = loadNotes("node-notes").items;
const tpl = (id: string) => templates.find((t) => t.id === id)!;
const scen = (id: string) => scenarios.find((s) => s.id === id)!;

const OP = OperatingPoint.parse({ irradiance: 0.8, house_load_kw: 3 });

function build(id: string, options = {}, devs = devices) {
  const topology = composeTopology(tpl(id), options).topology;
  return { topology, graph: buildRenderGraph(topology, devs, ["power", "comms"]) };
}

function run(id: string, scenarioId: string | null, options = {}, op = OP) {
  const { topology, graph } = build(id, options);
  const sc = scenarioId ? scen(scenarioId) : null;
  const result = sc ? evaluateScenario(topology, devices, sc) : null;
  const flow = computePowerFlow(graph, op, {
    scenario: sc,
    energization: result?.energization ?? null,
  });
  return { topology, graph, flow };
}

/** 400W × 20장 × 일사 0.8 = 6.4 kW DC */
const PV_DC_KW = 6.4;

describe("전력 수지", () => {
  it("PV 발전은 정격 × 일사이고, 부하 지점에는 변환 손실 뒤에 도달한다", () => {
    const { flow } = run("tesla-pw3", "grid_normal");
    expect(flow.pv_kw).toBeCloseTo(PV_DC_KW * OP.inverter_efficiency, 3);
  });

  it("일사를 0으로 두면 발전이 사라지고 축전지가 부하를 받는다", () => {
    const { flow } = run("tesla-pw3", "grid_normal", {}, OperatingPoint.parse({ irradiance: 0, house_load_kw: 3 }));
    expect(flow.pv_kw).toBe(0);
    expect(flow.battery_kw).toBeCloseTo(3, 3); // 자가소비 — 정격 안이면 축전지가 먼저 낸다
    expect(flow.grid_kw).toBeCloseTo(0, 6);
  });

  it("축전지가 감당 못 하는 부하는 계통에서 온다", () => {
    const op = OperatingPoint.parse({ irradiance: 0, house_load_kw: 20 });
    const { flow } = run("tesla-pw3", "grid_normal", {}, op);
    expect(flow.battery_kw).toBeCloseTo(11.5, 3); // 연속 출력 정격에서 멈춘다
    expect(flow.grid_kw).toBeCloseTo(8.5, 3);
  });

  it("변환 손실은 DC→AC 지점에서 한 번만 먹인다 — 트렁크를 지날 때마다 줄지 않는다", () => {
    const { flow } = run("enphase-4g", "grid_normal");
    expect(flow.pv_kw).toBeCloseTo(PV_DC_KW * OP.inverter_efficiency, 3);
  });

  it("잉여는 축전지로 가고, 남으면 계통으로 수출된다", () => {
    const { flow } = run("tesla-pw3", "grid_normal");
    expect(flow.battery_kw).toBeLessThan(0); // 충전
    expect(flow.pv_kw + flow.battery_kw + flow.grid_kw).toBeCloseTo(flow.load_kw, 6);
  });

  it("부하를 모르면 축전지 거동을 지어내지 않는다 — 전량이 계통으로 나간다", () => {
    const op = OperatingPoint.parse({ irradiance: 0.8 });
    const { flow } = run("tesla-pw3", "grid_normal", {}, op);
    expect(flow.battery_kw).toBe(0);
    expect(flow.grid_kw).toBeCloseTo(-flow.pv_kw, 6);
    expect(flow.findings.some((f) => f.code === "P013")).toBe(true);
  });

  it("정전에서는 계통 전력이 0이다", () => {
    const { flow } = run("tesla-pw3", "outage_islanded");
    expect(flow.grid_kw).toBe(0);
  });

  it("사선 도체에는 전력이 실리지 않는다", () => {
    const { flow, graph } = run("tesla-pw3", "outage_islanded");
    const svcEdge = graph.edges.find((e) => e.from.nodeRef === "svc")!;
    expect(flow.edges[svcEdge.id]).toBe(0);
  });

  it("아일랜드에서 실을 수 없는 PV는 제한된다", () => {
    const op = OperatingPoint.parse({ irradiance: 1.0, house_load_kw: 0.5 });
    const { flow } = run("enphase-4g", "outage_islanded", { battery_units: 1 }, op);
    // 부하 0.5kW + 충전 여력 7.08kVA를 넘는 발전은 실을 수 없다
    expect(flow.pv_kw).toBeLessThanOrEqual(0.5 + 7.08 + 1e-6);
    if (flow.curtailed_kw > 0) expect(flow.findings.some((f) => f.code === "P020")).toBe(true);
  });

  it("정격이 없는 모듈은 0으로 두고 그 사실을 알린다 — 조용히 넘어가지 않는다", () => {
    const stripped = devices.map((d) =>
      d.id === "generic-pv-module-400w" ? Device.parse({ ...d, ratings: { ...d.ratings, pv_stc_w: null } }) : d,
    );
    const { topology } = build("tesla-pw3", {}, stripped);
    const graph = buildRenderGraph(topology, stripped, ["power"]);
    const flow = computePowerFlow(graph, OP, { scenario: scen("grid_normal") });
    expect(flow.pv_kw).toBe(0);
    expect(flow.findings.some((f) => f.code === "P010")).toBe(true);
  });
});

describe("노드 신호", () => {
  it("AC 전류는 전력과 공칭 전압에서 나온다", () => {
    const { graph, flow } = run("tesla-pw3", "grid_normal");
    const r = nodeSignals(graph, "pw3", flow, OP);
    const ac = r.ports.find((p) => p.port_id === "ac_out")!;
    expect(ac.v).toBe(240);
    expect(ac.i).toBeCloseTo((Math.abs(ac.p_kw!) * 1000) / 240, 6);
    expect(ac.formulas.some((f) => f.expr.includes("I = P / (V_LL · PF)"))).toBe(true);
  });

  it("트렁크 전류는 하류로 갈수록 누적된다", () => {
    const { graph, flow } = run("enphase-4g", "grid_normal");
    const at = (ref: string) => nodeSignals(graph, ref, flow, OP).ports.find((p) => p.port_id === "ac_out")!.i!;
    expect(at("mi-01")).toBeLessThan(at("mi-05"));
    expect(at("mi-05")).toBeLessThan(at("mi-10"));
    // 10번째 구간은 유닛 하나의 열 배에 가깝다 (모든 유닛이 같은 출력이므로)
    expect(at("mi-10") / at("mi-01")).toBeCloseTo(10, 1);
  });

  it("직렬 스트링은 전압이 쌓이고 전류는 그대로다", () => {
    const { graph, flow } = run("tesla-pw3", "grid_normal", { pv_modules: 20, string_size: 10 });
    const first = nodeSignals(graph, "pv-01", flow, OP).ports.find((p) => p.port_id === "dc_out")!;
    const last = nodeSignals(graph, "pv-10", flow, OP).ports.find((p) => p.port_id === "dc_out")!;
    expect(first.i).toBeCloseTo(last.i!, 6);
    expect(last.v! / first.v!).toBeCloseTo(10, 1);
  });

  it("병렬 스트링은 전압이 그대로고 전류가 더해진다", () => {
    const { graph, flow } = run("tesla-pw3", "grid_normal", { pv_modules: 20, string_size: 10 });
    const mppt = nodeSignals(graph, "pw3", flow, OP).ports.find((p) => p.port_id === "pv_dc")!;
    const module = devices.find((d) => d.id === "generic-pv-module-400w")!;
    expect(mppt.v).toBeCloseTo(10 * module.ratings.pv_vmp_v!, 0);
    expect(mppt.i).toBeCloseTo(2 * module.ratings.pv_imp_a! * OP.irradiance, 3);
  });

  it("파형은 흡수와 공급을 위상으로 구분한다", () => {
    const { graph, flow } = run("enphase-4g", "grid_normal");
    const mi = nodeSignals(graph, "mi-10", flow, OP);
    const out = mi.ports.find((p) => p.port_id === "ac_out")!;
    const inn = mi.ports.find((p) => p.port_id === "trunk_in")!;
    const avg = (w: number[]) => w.reduce((a, b) => a + b, 0) / w.length;
    expect(out.p_kw!).toBeGreaterThan(0);
    expect(inn.p_kw!).toBeLessThan(0);
    expect(avg(out.waveform!.p)).toBeGreaterThan(0);
    expect(avg(inn.waveform!.p)).toBeLessThan(0);
  });

  it("통신 포트는 전압·전류를 계산하지 않는다", () => {
    const { graph, flow } = run("enphase-4g", "grid_normal");
    const comms = nodeSignals(graph, "collar", flow, OP).ports.find((p) => p.domain === "signal")!;
    expect(comms.v).toBeNull();
    expect(comms.i).toBeNull();
    expect(comms.notes.join(" ")).toContain("전력을 나르지 않으므로");
  });

  it("모듈에는 I–V 곡선이 붙고, MPP가 정격과 맞는다", () => {
    const { graph, flow } = run("tesla-pw3", "grid_normal");
    const iv = nodeSignals(graph, "pv-01", flow, OP).iv!;
    const module = devices.find((d) => d.id === "generic-pv-module-400w")!;
    expect(iv.mpp.v).toBe(module.ratings.pv_vmp_v);
    expect(iv.isc).toBeCloseTo(module.ratings.pv_isc_a! * OP.irradiance, 3);
    expect(iv.model).toContain("실측 곡선 아님");
    // 곡선은 단조 감소한다 (Voc로 갈수록 전류가 준다)
    for (let i = 1; i < iv.i.length; i++) expect(iv.i[i]!).toBeLessThanOrEqual(iv.i[i - 1]! + 1e-9);
  });

  it("같은 입력은 같은 결과를 낸다", () => {
    const { graph, flow } = run("enphase-4g", "grid_normal");
    expect(JSON.stringify(nodeSignals(graph, "comb", flow, OP))).toBe(
      JSON.stringify(nodeSignals(graph, "comb", flow, OP)),
    );
  });
});

describe("노드 노트", () => {
  it("class 노트가 그 class의 모든 장치에 붙는다", () => {
    const mi = devices.find((d) => d.class === "microinverter")!;
    expect(notesFor(notes, mi).length).toBeGreaterThan(0);
  });

  it("device 노트는 그 제품에만 붙는다", () => {
    const collar = devices.find((d) => d.id === "enphase-iq-meter-collar")!;
    const other = devices.find((d) => d.id === "generic-mid-placeholder")!;
    expect(notesFor(notes, collar).some((n) => n.applies_to.device === collar.id)).toBe(true);
    expect(notesFor(notes, other).some((n) => n.applies_to.device !== null)).toBe(false);
  });

  it("쓰이는 모든 class에 노트가 있다", () => {
    const missing = checkNoteCoverage(notes, devices).filter((f) => f.code === "N010");
    expect(missing.map((f) => f.message)).toEqual([]);
  });

  it("노트에 error가 없다", () => {
    expect(checkNoteCoverage(notes, devices).filter((f) => f.severity === "error")).toEqual([]);
  });
});
