import { describe, expect, it } from "vitest";
import { loadConfigurations, loadDevices, checkTopology } from "../src/validate/index.js";
import {
  composeTopology,
  composePresets,
  defaultOptions,
  enumCombinations,
  resolveOptions,
} from "../src/config/compose.js";

const devices = loadDevices("device-library").items;
const templates = loadConfigurations("configurations").items;
const tpl = (id: string) => templates.find((t) => t.id === id)!;
const enphase = tpl("enphase-4g");
const tesla = tpl("tesla-pw3");

const refs = (t: ReturnType<typeof composeTopology>) => t.topology.nodes.map((n) => n.ref);
const edges = (t: ReturnType<typeof composeTopology>) => t.topology.edges.map((e) => `${e.from}->${e.to}`);

describe("컴포저 — 반복 노드", () => {
  it("모듈 1장 : 마이크로인버터 1대로 펼쳐진다", () => {
    const c = composeTopology(enphase, { pv_modules: 20, branch_size: 10 });
    expect(refs(c).filter((r) => r.startsWith("pv-"))).toHaveLength(20);
    expect(refs(c).filter((r) => r.startsWith("mi-"))).toHaveLength(20);
    // pairwise: 모듈 i는 인버터 i에만 붙는다
    expect(edges(c)).toContain("pv-07.dc_out->mi-07.dc_in");
    expect(edges(c).filter((e) => e.startsWith("pv-07."))).toHaveLength(1);
  });

  it("개수를 바꾸면 데이터만으로 따라간다 — 코드 변경 없음", () => {
    const c = composeTopology(enphase, { pv_modules: 6, branch_size: 3 });
    expect(refs(c).filter((r) => r.startsWith("pv-"))).toHaveLength(6);
    // 묶음 3개짜리 2줄 → 트렁크 결선은 줄마다 2개씩, 종단은 2개
    expect(edges(c).filter((e) => e.includes("trunk_in"))).toHaveLength(4);
    expect(edges(c).filter((e) => e.endsWith("comb.pv_ac_in"))).toHaveLength(2);
  });

  it("chain은 묶음 경계를 넘지 않는다 — 분기회로 두 개가 하나로 이어지지 않는다", () => {
    const c = composeTopology(enphase, { pv_modules: 20, branch_size: 10 });
    expect(edges(c)).not.toContain("mi-10.ac_out->mi-11.trunk_in");
    expect(edges(c)).toContain("mi-09.ac_out->mi-10.trunk_in");
    expect(edges(c)).toContain("mi-10.ac_out->comb.pv_ac_in");
  });

  it("직렬 스트링은 모듈 사이 결선으로 표현된다", () => {
    const c = composeTopology(tesla, { pv_modules: 20, string_size: 10 });
    expect(edges(c)).toContain("pv-01.dc_out->pv-02.dc_in");
    expect(edges(c)).not.toContain("pv-10.dc_out->pv-11.dc_in");
    expect(edges(c).filter((e) => e.endsWith("pw3.pv_dc"))).toHaveLength(2);
  });

  it("유닛이 여럿이면 스트링이 나눠 붙는다", () => {
    const c = composeTopology(tesla, { pv_modules: 20, string_size: 10, battery_units: 2 });
    expect(edges(c)).toContain("pv-10.dc_out->pw3-1.pv_dc");
    expect(edges(c)).toContain("pv-20.dc_out->pw3-2.pv_dc");
    // 통신은 대표 유닛만 MID에 붙는다
    expect(edges(c).filter((e) => e.includes("comms_local"))).toHaveLength(1);
  });

  it("0을 고르면 그 장치와 결선이 함께 사라진다", () => {
    const c = composeTopology(enphase, { battery_units: 0 });
    expect(refs(c).some((r) => r.startsWith("batt"))).toBe(false);
    expect(edges(c).some((e) => e.includes("batt"))).toBe(false);
  });
});

describe("컴포저 — 구성 옵션", () => {
  it("백업 구성이 결선과 backup_scope를 함께 바꾼다", () => {
    const whole = composeTopology(enphase, { backup_mode: "whole_home" });
    const partial = composeTopology(enphase, { backup_mode: "partial" });
    const none = composeTopology(enphase, { backup_mode: "none" });

    expect(whole.topology.backup_scope).toBe("whole_home");
    expect(edges(whole)).toContain("svc.line->collar.grid_in");
    expect(refs(whole).includes("sub")).toBe(false);

    expect(partial.topology.backup_scope).toBe("partial");
    expect(refs(partial)).toContain("sub");
    expect(edges(partial)).toContain("ctrl.load_out->sub.feed");

    expect(none.topology.backup_scope).toBe("none");
    expect(refs(none).some((r) => r === "collar" || r === "ctrl" || r === "sub")).toBe(false);
    expect(edges(none)).toContain("svc.line->msp.main_lugs");
  });

  it("계통 분리 장치를 바꾸면 그 장치만 갈린다", () => {
    const bs = composeTopology(tesla, { mid_device: "backup_switch" });
    const gw = composeTopology(tesla, { mid_device: "gateway_3" });
    expect(refs(bs)).toContain("bs");
    expect(refs(bs)).not.toContain("gw");
    expect(refs(gw)).toContain("gw");
    expect(edges(gw)).toContain("svc.line->gw.grid_in");
  });

  it("선택지에 없는 값은 error로 남고 기본값으로 계산한다", () => {
    const c = composeTopology(enphase, { backup_mode: "nope" });
    expect(c.findings.some((f) => f.code === "C011" && f.severity === "error")).toBe(true);
    expect(c.options["backup_mode"]).toBe(defaultOptions(enphase)["backup_mode"]);
  });

  it("범위를 벗어난 개수는 보정하고 그 사실을 남긴다", () => {
    const c = composeTopology(enphase, { pv_modules: 999 });
    expect(c.findings.some((f) => f.code === "C013")).toBe(true);
    expect(c.options["pv_modules"]).toBe(40);
  });
});

describe("컴포저 — 계약", () => {
  it("모든 enum 조합에서 컴포저 결함(C0xx)이 없다", () => {
    for (const t of templates) {
      for (const options of enumCombinations(t)) {
        const c = composeTopology(t, options);
        const bad = c.findings.filter((f) => f.code.startsWith("C0") && f.severity === "error");
        expect(`${t.id}: ${bad.map((f) => f.code).join(",") || "none"}`).toBe(`${t.id}: none`);
      }
    }
  });

  it("프리셋은 데이터 검증 error가 없다 — 체크인된 구성은 성립해야 한다", () => {
    for (const t of templates) {
      for (const r of composePresets(t)) {
        const errors = checkTopology(r.topology, devices).filter((f) => f.severity === "error");
        expect(`${r.topology.id}: ${errors.map((e) => e.code).join(",") || "none"}`).toBe(
          `${r.topology.id}: none`,
        );
      }
    }
  });

  it("옵션이 프리셋과 같으면 프리셋 id를 쓴다 — 링크가 흔들리지 않는다", () => {
    const c = composeTopology(enphase, defaultOptions(enphase));
    expect(c.topology.id).toBe("enphase-4g-meter-collar-whole-home");
  });

  it("같은 옵션은 같은 결과를 낸다", () => {
    const a = composeTopology(tesla, { pv_modules: 12, string_size: 6 });
    const b = composeTopology(tesla, { pv_modules: 12, string_size: 6 });
    expect(JSON.stringify(a.topology)).toBe(JSON.stringify(b.topology));
  });

  it("모르는 축은 버리지 않고 알린다", () => {
    const { findings } = resolveOptions(enphase, { nonsense: 1 });
    expect(findings.some((f) => f.code === "C010")).toBe(true);
  });
});
