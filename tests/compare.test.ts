import { describe, expect, it } from "vitest";
import { loadDevices, loadPresetTopologies, loadScenarios } from "../src/validate/index.js";
import { compareTopologies, toMarkdown, UNKNOWN } from "../src/compare/index.js";
import { Device } from "../src/schema/device.js";
import { Topology } from "../src/schema/topology.js";

const devices = loadDevices("device-library").items;
const topologies = loadPresetTopologies("configurations").items;
const scenarios = loadScenarios("scenarios").items;
const outage = scenarios.find((s) => s.id === "outage_islanded")!;

const pick = (...ids: string[]) => ids.map((id) => topologies.find((t) => t.id.startsWith(id))!);
const cmp = (ts = topologies, opts = {}) => compareTopologies(ts, devices, opts);
const row = (c: ReturnType<typeof cmp>, key: string) => c.rows.find((r) => r.key === key)!;
const cell = (c: ReturnType<typeof cmp>, key: string, vendor: string) =>
  row(c, key).cells[c.columns.findIndex((col) => col.vendor === vendor)];

describe("비교표", () => {
  it("4종이 한 표에 들어간다 — 스프린트 4 완료 기준", () => {
    const c = cmp(pick("tesla", "enphase", "solaredge", "qcells"));
    expect(c.columns.map((x) => x.vendor).sort()).toEqual(["Enphase", "Qcells", "SolarEdge", "Tesla"]);
  });

  it("모든 행이 열 수와 같은 셀 수를 갖는다", () => {
    const c = cmp(pick("tesla", "enphase", "solaredge", "qcells"));
    for (const r of c.rows) expect(`${r.key}:${r.cells.length}`).toBe(`${r.key}:${c.columns.length}`);
  });

  it("CLAUDE.md가 자동 비교를 약속한 세 항목이 실제로 계산된다", () => {
    const c = cmp(pick("tesla", "enphase"));
    // 부품 수 / 서브패널 필요 여부 / 결선 포인트 수.
    // 모듈·마이크로인버터를 1대씩 노드로 펼친 뒤로 이 값은 실제 설치 개수다:
    // 같은 20장 어레이에서 AC 결합은 유닛이 20개 더 붙고 결선 포인트도 그만큼 늘어난다.
    expect(cell(c, "parts", "Enphase")).toBe("43개");
    expect(cell(c, "parts", "Tesla")).toBe("22개");
    expect(Number(cell(c, "power_edges", "Enphase"))).toBeGreaterThan(
      Number(cell(c, "power_edges", "Tesla")),
    );
    expect(cell(c, "subpanel", "Enphase")).toBe("불필요");
    expect(cell(c, "subpanel", "Tesla")).toBe("조건부");
  });

  it("결합 방식은 제품명이 아니라 연결 구조에서 나온다", () => {
    const c = cmp(pick("tesla", "enphase"));
    expect(cell(c, "coupling", "Enphase")).toContain("AC 결합");
    expect(cell(c, "coupling", "Tesla")).toContain("DC 결합");
  });

  it("차이가 나는 행만 differs로 표시된다", () => {
    const c = cmp(pick("tesla", "enphase"));
    expect(row(c, "backup_scope").differs).toBe(false); // 둘 다 전체 백업
    expect(row(c, "coupling").differs).toBe(true);
  });

  it("값이 없으면 빈칸이 아니라 미확인으로 나온다 — 빈칸은 0으로 읽힌다", () => {
    // 어느 항목이 미확인인지에 매지 않는다 — LRA를 지운 사본으로 본다.
    const stripped = devices.map((d) =>
      d.id === "qcells-qhome-core-g3" ? Device.parse({ ...d, ratings: { ...d.ratings, lra: null } }) : d,
    );
    expect(cell(compareTopologies(pick("qcells"), stripped, {}), "lra", "Qcells")).toBe(UNKNOWN);
    // 채워지면 값이 나온다.
    const c = cmp(pick("qcells"));
    expect(cell(c, "lra", "Qcells")).not.toBe(UNKNOWN);
    expect(cell(c, "energy", "Qcells")).not.toBe("");
  });

  it("kW와 kVA를 합치지 않는다", () => {
    const c = cmp(pick("enphase"));
    const v = cell(c, "continuous", "Enphase")!;
    expect(v).toContain("kVA");
    expect(v).not.toContain("kW ");
  });

  it("정격이 없는 전원이 합산에서 빠진 사실을 표시한다", () => {
    // 어느 제품이 미확인인지에 매지 않는다 — 정격을 지운 사본으로 본다.
    const stripped = devices.map((d) =>
      d.id === "qcells-qtron-ac-microinverter"
        ? Device.parse({ ...d, ratings: { ...d.ratings, continuous_ac_kw: null, continuous_ac_kva: null } })
        : d,
    );
    const c = compareTopologies(pick("qcells"), stripped, {});
    expect(cell(c, "continuous", "Qcells")).toContain("미기재 20건 제외");
    // 채워지면 그 표기가 사라지고 값이 합산된다.
    expect(cell(cmp(pick("qcells")), "continuous", "Qcells")).not.toContain("미기재");
  });

  it("MID가 확정되지 않은 구성은 그 사실을 노트로 남긴다", () => {
    const c = cmp();
    expect(c.notes.join("\n")).toContain("MID 미확정");
    expect(cell(c, "mid", "Tesla")).toContain("별도 장치");
  });

  it("draft 구성을 노트로 경고한다", () => {
    expect(cmp().notes.join("\n")).toContain("대외 인용 금지");
  });

  it("노무시간을 추정하지 않았다는 사실을 밝힌다", () => {
    expect(cmp().notes.join("\n")).toContain("노무시간은 모델링하지 않았다");
  });
});

describe("시나리오 연동", () => {
  it("시나리오를 주면 급전 비교 행이 생긴다", () => {
    const c = cmp(topologies, { scenario: outage });
    expect(c.scenario_id).toBe("outage_islanded");
    expect(row(c, "energized").cells).toBeDefined();
  });

  it("시나리오가 없으면 급전 행이 없다", () => {
    const c = cmp();
    expect(c.scenario_id).toBeNull();
    expect(c.rows.find((r) => r.key === "energized")).toBeUndefined();
  });

  it("아일랜드를 세운 주체가 표에 나온다", () => {
    const c = cmp(pick("tesla", "qcells"), { scenario: outage });
    expect(cell(c, "island", "Tesla")).toBe("pw3");
    // Qcells는 CORE G3(그리드 포밍)가 세우고, AC 모듈들이 그 뒤에 실린다
    expect(cell(c, "island", "Qcells")).toContain("core");
  });

  it("그리드 포밍이 확인되지 않은 구성은 형성 안 됨으로 나온다", () => {
    const noForming = devices.map((d) =>
      d.grid_forming === true ? Device.parse({ ...d, grid_forming: null }) : d,
    );
    const c = compareTopologies(pick("tesla"), noForming, { scenario: outage });
    expect(c.rows.find((r) => r.key === "island")!.cells[0]).toBe("형성 안 됨");
  });
});

describe("데이터만으로 제품이 추가된다", () => {
  it("새 device/topology 파일을 넣으면 비교에 그대로 나온다 — 코드 변경 없음", () => {
    const newDevice = Device.parse({
      id: "vendor-z-allinone",
      vendor: "VendorZ",
      display_name: "올인원 ESS",
      class: "hybrid_inverter_battery",
      status: "draft",
      ratings: { continuous_ac_kw: 9, usable_energy_kwh: 20, lra: 120 },
      ports: [
        { id: "pv_dc", type: "dc_string", direction: "in" },
        { id: "ac_out", type: "ac_240v_split", direction: "bidirectional" },
        { id: "grid_in", type: "ac_service_line", direction: "in", mid_side: "grid" },
        { id: "load_out", type: "ac_service_line", direction: "out", mid_side: "load" },
      ],
      provides_mid: true,
      grid_forming: true,
      needs_backup_subpanel: "no",
      sources: [{ ref: "가상 제품", date: "2026-08", note: null }],
    });
    const newTopo = Topology.parse({
      id: "vendor-z-allinone-whole-home",
      vendor: "VendorZ",
      display_name: "올인원 — 전체 백업",
      status: "draft",
      backup_scope: "whole_home",
      nodes: [
        { ref: "svc", device: "generic-utility-service-200a" },
        { ref: "unit", device: "vendor-z-allinone" },
        { ref: "msp", device: "generic-msp-200a" },
        { ref: "pv", device: "generic-pv-module-400w", count: 20 },
      ],
      edges: [
        { from: "svc.line", to: "unit.grid_in", layer: "power" },
        { from: "unit.load_out", to: "msp.main_lugs", layer: "power" },
        { from: "pv.dc_out", to: "unit.pv_dc", layer: "power" },
      ],
    });
    const c = compareTopologies([...pick("tesla"), newTopo], [...devices, newDevice], {
      scenario: outage,
    });
    expect(c.columns.map((x) => x.vendor)).toContain("VendorZ");
    expect(cell(c, "parts", "VendorZ")).toBe("2개");
    expect(cell(c, "mid", "VendorZ")).toContain("내장");
    expect(cell(c, "island", "VendorZ")).toBe("unit");
    expect(cell(c, "continuous", "VendorZ")).toBe("9 kW");
  });
});

describe("마크다운 출력", () => {
  it("헤더 · 구분선 · 행 수가 맞는다", () => {
    const c = cmp(pick("tesla", "enphase"));
    const lines = toMarkdown(c).split("\n");
    expect(lines[0]).toContain("Tesla");
    expect(lines[1]).toMatch(/^\|(---\|)+$/);
    expect(lines.length).toBe(2 + c.rows.length);
  });

  it("--diffs는 차이 나는 행만 남긴다", () => {
    const c = cmp(pick("tesla", "enphase"));
    const all = toMarkdown(c).split("\n").length;
    const diffs = toMarkdown(c, { onlyDiffs: true }).split("\n").length;
    expect(diffs).toBeLessThan(all);
    expect(diffs).toBe(2 + c.rows.filter((r) => r.differs).length);
  });

  it("draft 구성에 표식이 붙는다", () => {
    expect(toMarkdown(cmp(pick("tesla")))).toContain("Tesla *");
  });
});
