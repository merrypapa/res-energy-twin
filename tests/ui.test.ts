import { describe, expect, it } from "vitest";
import { parseHash, toHash, type UiState } from "../src/ui/urlState.js";
import { EMPTY_SITE, SiteContext } from "../src/schema/rule.js";
import { loadConfigurations, loadDevices, loadNotes, loadScenarios, loadPresetTopologies } from "../src/validate/index.js";
import { DEFAULT_OP, OperatingPoint } from "../src/analysis/operating-point.js";
import { ConfigTemplate } from "../src/schema/template.js";
import { NodeNote } from "../src/schema/note.js";
import { Device } from "../src/schema/device.js";
import { Topology } from "../src/schema/topology.js";
import { Scenario } from "../src/schema/scenario.js";

const base: UiState = {
  selected: ["tesla-pw3"],
  layers: ["power", "comms"],
  scenarioId: null,
  trip: "",
  site: EMPTY_SITE,
  options: {},
  node: null,
  op: DEFAULT_OP,
  asking: false,
};

describe("URL 상태 — 백엔드가 없으므로 링크가 곧 저장이다", () => {
  it("빈 해시면 기본값을 그대로 쓴다", () => {
    expect(parseHash("", base)).toEqual(base);
    expect(parseHash("#", base)).toEqual(base);
  });

  it("왕복해도 값이 보존된다", () => {
    const state: UiState = {
      selected: ["a", "b"],
      layers: ["power", "physical"],
      scenarioId: "outage_islanded",
      trip: "pw3",
      site: SiteContext.parse({ utility: "PG&E", backup_load_kw: 14.5, largest_motor_lra: 200 }),
      options: { backup_mode: "partial", pv_modules: 24, battery_units: 2 },
      asking: true,
      node: { topology: "tesla-pw3--x", ref: "mi-07", port: "ac_out" },
      op: OperatingPoint.parse({
        location_id: "los-angeles-ca",
        month: 3,
        hour: 14.5,
        clearness: 0.6,
        house_load_kw: 3.5,
      }),
    };
    expect(parseHash(toHash(state), base)).toEqual(state);
  });

  it("구성 옵션과 선택한 노드가 링크에 실린다 — 신호 화면을 그대로 공유할 수 있다", () => {
    const h = toHash({
      ...base,
      options: { backup_mode: "whole_home", pv_modules: 20 },
      node: { topology: "enphase-4g-meter-collar-whole-home", ref: "mi-10", port: "ac_out" },
    });
    expect(h).toContain("o=backup_mode%3Awhole_home%2Cpv_modules%3A20");
    const back = parseHash(h, base);
    expect(back.options["pv_modules"]).toBe(20);
    expect(back.node).toEqual({
      topology: "enphase-4g-meter-collar-whole-home",
      ref: "mi-10",
      port: "ac_out",
    });
  });

  it("앰퍼샌드가 든 유틸리티 이름이 깨지지 않는다", () => {
    const state = { ...base, site: SiteContext.parse({ utility: "PG&E" }) };
    expect(parseHash(toHash(state), base).site.utility).toBe("PG&E");
  });

  it("알 수 없는 레이어는 버린다", () => {
    expect(parseHash("#layers=power,nonsense", base).layers).toEqual(["power"]);
  });

  it("레이어를 다 끄면 기본값으로 돌아간다 — 빈 캔버스를 링크로 만들지 않는다", () => {
    expect(parseHash("#t=a&layers=", base).layers).toEqual(base.layers);
  });

  it("단자를 고르지 않은 선택도 왕복한다", () => {
    const h = toHash({ ...base, node: { topology: "t", ref: "pw3", port: null } });
    expect(parseHash(h, base).node).toEqual({ topology: "t", ref: "pw3", port: null });
  });

  it("지역·월·시각이 링크에 실린다 — 그 시점의 신호 화면을 그대로 공유한다", () => {
    const h = toHash({
      ...base,
      op: OperatingPoint.parse({ location_id: "seattle-wa", month: 12, hour: 8.25 }),
    });
    const back = parseHash(h, base).op;
    expect(back.location_id).toBe("seattle-wa");
    expect(back.month).toBe(12);
    expect(back.hour).toBe(8.25);
  });

  it("음수·비수치 사이트 값은 무시한다", () => {
    const s = parseHash("#load=-5&lra=abc", base).site;
    expect(s.backup_load_kw).toBeNull();
    expect(s.largest_motor_lra).toBeNull();
  });

  it("기본 상태의 해시에는 빈 값이 들어가지 않는다", () => {
    const h = toHash(base);
    expect(h).not.toContain("sc=");
    expect(h).not.toContain("trip=");
    expect(h).not.toContain("load=");
  });
});

describe("UI 번들 계약", () => {
  it("번들에 실리는 데이터가 전부 스키마를 통과한다 — 앱은 검증된 것만 본다", () => {
    for (const d of loadDevices("device-library").items) expect(() => Device.parse(d)).not.toThrow();
    for (const t of loadPresetTopologies("configurations").items) expect(() => Topology.parse(t)).not.toThrow();
    for (const s of loadScenarios("scenarios").items) expect(() => Scenario.parse(s)).not.toThrow();
    for (const c of loadConfigurations("configurations").items) expect(() => ConfigTemplate.parse(c)).not.toThrow();
    for (const n of loadNotes("node-notes").items) expect(() => NodeNote.parse(n)).not.toThrow();
  });
});
