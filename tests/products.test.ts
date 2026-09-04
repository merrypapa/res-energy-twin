import { describe, expect, it } from "vitest";
import { loadConfigurations, loadDevices, loadScenarios } from "../src/validate/index.js";
import { composeTopology } from "../src/config/compose.js";
import { buildRenderGraph } from "../src/graph/index.js";
import { evaluateScenario } from "../src/scenario/index.js";
import { computePowerFlow } from "../src/analysis/powerflow.js";
import { nodeSignals } from "../src/analysis/signals.js";
import { specRows, specSheets } from "../src/analysis/spec.js";
import { OperatingPoint } from "../src/analysis/operating-point.js";
import { portElectrical } from "../src/schema/electrical.js";
import { Device } from "../src/schema/device.js";

const devices = loadDevices("device-library").items;
const templates = loadConfigurations("configurations").items;
const scenarios = loadScenarios("scenarios").items;
const tpl = (id: string) => templates.find((t) => t.id === id)!;
const dev = (id: string) => devices.find((d) => d.id === id)!;
const OP = OperatingPoint.parse({ irradiance: 0.8, house_load_kw: 3 });

describe("제품 데이터 규율", () => {
  it("제조사 제품의 숫자 스펙에는 원문 링크가 달려 있다", () => {
    const missing = devices
      .filter((d) => d.vendor !== "generic")
      .filter((d) => Object.values(d.ratings).some((v) => typeof v === "number"))
      .filter((d) => !d.sources.some((s) => s.url !== null))
      .map((d) => d.id);
    expect(missing).toEqual([]);
  });

  it("출처에는 확인일이 있다 — 승인·정격은 시점에 따라 바뀐다", () => {
    const undated = devices
      .filter((d) => d.vendor !== "generic")
      .flatMap((d) => d.sources.filter((s) => s.url !== null && s.date === null).map(() => d.id));
    expect(undated).toEqual([]);
  });

  it("확인되지 않은 값은 채우지 않는다 — 링크만 있고 값이 없는 제품이 있어도 된다", () => {
    // 스키마가 이 상태를 허용해야 한다. 값을 못 구했다고 제품을 못 올리면
    // 추정치를 넣게 된다 — 그걸 막는 것이 이 프로젝트의 전제다.
    const linkOnly = Device.parse({
      id: "vendor-x-unconfirmed",
      vendor: "VendorX",
      display_name: "정격 미확인 제품",
      class: "pv_module",
      status: "draft",
      ports: [{ id: "dc_out", type: "dc_pv_module", direction: "out" }],
      provides_mid: false,
      sources: [{ ref: "제조사 페이지", url: "https://example.invalid/x", date: "2026-09-04" }],
      todos: ["STC 전기 정격 확인"],
    });
    expect(linkOnly.ratings.pv_stc_w).toBeNull();
    expect(linkOnly.sources[0]!.url).not.toBeNull();
  });

  it("값이 채워진 제품에는 출처가 붙어 있다", () => {
    for (const d of devices) {
      const hasNumber = Object.values(d.ratings).some((v) => typeof v === "number");
      if (!hasNumber) continue;
      expect(`${d.id}: sources ${d.sources.length}`).not.toBe(`${d.id}: sources 0`);
    }
  });
});

describe("AC 모듈 — 모듈 + 변환기를 나눠 그린다", () => {
  it("모듈 노드와 마이크로인버터 노드로 나뉜다 — 모듈의 DC 출력이 보여야 한다", () => {
    const t = composeTopology(tpl("qcells-qhome")).topology;
    expect(t.nodes.filter((n) => n.ref.startsWith("pv-"))).toHaveLength(20);
    expect(t.nodes.filter((n) => n.ref.startsWith("mi-"))).toHaveLength(20);
    expect(t.edges.map((e) => `${e.from}->${e.to}`)).toContain("pv-07.dc_out->mi-07.dc_in");
  });

  it("모듈 DC 구간이 도면에 나온다", () => {
    const t = composeTopology(tpl("qcells-qhome")).topology;
    const g = buildRenderGraph(t, devices, ["power"]);
    const dc = g.edges.filter((e) =>
      [e.from.port.type, e.to.port.type].every((ty) => portElectrical(ty).domain === "dc"),
    );
    expect(dc).toHaveLength(20);
  });

  it("변환기들이 트렁크로 모여 결합반으로 간다 — 전류가 누적된다", () => {
    const t = composeTopology(tpl("qcells-qhome"), { pv_module_device: "generic-pv-module-400w" })
      .topology;
    const g = buildRenderGraph(t, devices, ["power"]);
    const flow = computePowerFlow(g, OP, { scenario: scenarios.find((s) => s.id === "grid_normal")! });
    const at = (ref: string) => nodeSignals(g, ref, flow, OP).ports.find((p) => p.port_id === "ac_out")!.i!;
    expect(at("mi-01")).toBeLessThan(at("mi-10"));
    expect(at("mi-10") / at("mi-01")).toBeCloseTo(10, 1);
  });

  it("계통 추종이다 — 정전에서 스스로 아일랜드를 세우지 않는다", () => {
    const t = composeTopology(tpl("qcells-qhome"), { battery_units: 0 }).topology;
    const outage = evaluateScenario(t, devices, scenarios.find((s) => s.id === "outage_islanded")!);
    expect(outage.injectors).toEqual([]);
  });

  it("정격이 미확인인 모듈을 고르면 DC 전압·전류를 계산하지 않고 이유를 남긴다", () => {
    // 어느 제품이 미입력인지에 매지 않는다 — 모듈의 STC 전기 정격을 지운 사본으로 본다.
    const stripped = devices.map((d) =>
      d.class === "pv_module"
        ? Device.parse({
            ...d,
            ratings: { ...d.ratings, pv_vmp_v: null, pv_imp_a: null, pv_voc_v: null, pv_isc_a: null },
          })
        : d,
    );
    const t = composeTopology(tpl("qcells-qhome")).topology;
    const g = buildRenderGraph(t, stripped, ["power"]);
    const flow = computePowerFlow(g, OP, { scenario: scenarios.find((s) => s.id === "grid_normal")! });
    const report = nodeSignals(g, "pv-01", flow, OP);
    const dcOut = report.ports.find((p) => p.port_id === "dc_out")!;
    expect(dcOut.p_kw).toBeGreaterThan(0); // 출력(W)은 STC 정격에서 나온다
    expect(dcOut.v).toBeNull();
    expect(dcOut.i).toBeNull();
    expect(dcOut.notes.join(" ")).toContain("pv_imp_a");
    expect(report.iv).toBeNull();
  });

  it("정격이 채워진 모듈은 DC 전압·전류와 곡선이 나온다", () => {
    const t = composeTopology(tpl("qcells-qhome")).topology;
    const g = buildRenderGraph(t, devices, ["power"]);
    const flow = computePowerFlow(g, OP, { scenario: scenarios.find((s) => s.id === "grid_normal")! });
    const report = nodeSignals(g, "pv-01", flow, OP);
    const dcOut = report.ports.find((p) => p.port_id === "dc_out")!;
    expect(dcOut.v).not.toBeNull();
    expect(dcOut.i).not.toBeNull();
    expect(report.iv).not.toBeNull();
  });
});

describe("DC 결합 축전지", () => {
  it("스스로 AC를 내지 못한다", () => {
    expect(dev("solaredge-home-battery-400v").grid_forming).toBe(false);
  });

  it("해가 없어도 인버터가 축전지로 아일랜드를 유지한다", () => {
    const t = composeTopology(tpl("solaredge-home-hub")).topology;
    // load_shed = 야간 아일랜딩 (grid absent · pv dark · battery available)
    const night = evaluateScenario(t, devices, scenarios.find((s) => s.id === "load_shed")!);
    expect(night.injectors).toContain("inv");
  });

  it("축전지 DC가 인버터를 관통해 어레이로 되돌아가지 않는다", () => {
    const t = composeTopology(tpl("solaredge-home-hub")).topology;
    const night = evaluateScenario(t, devices, scenarios.find((s) => s.id === "load_shed")!);
    const arrayEdges = Object.keys(night.energization).filter((id) => id.startsWith("pv-"));
    expect(arrayEdges.length).toBeGreaterThan(0);
    for (const id of arrayEdges) expect(`${id}=${night.energization[id]}`).toBe(`${id}=dead`);
  });

  it("축전지가 없으면 야간 아일랜드가 성립하지 않는다", () => {
    const t = composeTopology(tpl("solaredge-home-hub"), { battery_units: 0 }).topology;
    const night = evaluateScenario(t, devices, scenarios.find((s) => s.id === "load_shed")!);
    expect(night.injectors).toEqual([]);
  });
});

describe("제품 선택 (device_from)", () => {
  it("옵션 값이 그 자리의 device를 정한다", () => {
    const a = composeTopology(tpl("enphase-4g"), { micro_device: "enphase-iq8a" }).topology;
    const b = composeTopology(tpl("enphase-4g"), { micro_device: "enphase-iq8plus" }).topology;
    expect(a.nodes.find((n) => n.ref === "mi-01")!.device).toBe("enphase-iq8a");
    expect(b.nodes.find((n) => n.ref === "mi-01")!.device).toBe("enphase-iq8plus");
  });

  it("고른 제품의 정격이 신호에 그대로 반영된다", () => {
    const run = (micro: string) => {
      const t = composeTopology(tpl("enphase-4g"), { micro_device: micro }).topology;
      const g = buildRenderGraph(t, devices, ["power"]);
      return g.byRef.get("mi-01")!.device.ratings.continuous_ac_kva;
    };
    expect(run("enphase-iq8m")).toBe(0.325);
    expect(run("enphase-iq8a")).toBe(0.349);
  });

  it("벤더를 고르면 그 회사의 대표 제품이 기본값으로 들어간다", () => {
    const byVendor: Record<string, string[]> = {
      "enphase-4g": ["enphase-iq8m", "enphase-iq-battery-5p", "enphase-iq-meter-collar"],
      "tesla-pw3": ["tesla-powerwall-3", "tesla-backup-switch"],
      "solaredge-home-hub": ["solaredge-home-hub-se7600h", "solaredge-home-battery-400v", "solaredge-backup-interface"],
      "qcells-qhome": ["qcells-qtron-blk-m-g2", "qcells-qtron-ac-microinverter", "qcells-qhome-core-g3", "qcells-qhome-hub-g3", "qcells-qhome-combiner-80-g1"],
    };
    for (const [id, expected] of Object.entries(byVendor)) {
      const used = new Set(composeTopology(tpl(id)).topology.nodes.map((n) => n.device));
      for (const device of expected) expect(`${id}: ${device} ${used.has(device)}`).toBe(`${id}: ${device} true`);
    }
  });
});

describe("스펙 요약", () => {
  it("값이 있는 항목만 나온다 — 빈 줄을 만들지 않는다", () => {
    const rows = specRows(dev("tesla-powerwall-3"));
    expect(rows.some((r) => r.value.includes("13.5 kWh"))).toBe(true);
    expect(rows.some((r) => r.value.includes("undefined") || r.value.includes("null"))).toBe(false);
  });

  it("같은 제품이 여러 노드면 대수로 합쳐진다", () => {
    const t = composeTopology(tpl("enphase-4g"), { pv_modules: 12, branch_size: 6 }).topology;
    const sheets = specSheets(devices, t.nodes.map((n) => n.device));
    expect(sheets.find((s) => s.device.class === "microinverter")!.units).toBe(12);
    expect(sheets.find((s) => s.device.id === "enphase-iq-meter-collar")!.units).toBe(1);
  });
});
