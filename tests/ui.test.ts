import { describe, expect, it } from "vitest";
import { parseHash, toHash, type UiState } from "../src/ui/urlState.js";
import { EMPTY_SITE, SiteContext } from "../src/schema/rule.js";
import { loadDevices, loadScenarios, loadTopologies } from "../src/validate/index.js";
import { Device } from "../src/schema/device.js";
import { Topology } from "../src/schema/topology.js";
import { Scenario } from "../src/schema/scenario.js";

const base: UiState = {
  selected: ["tesla-pw3-backup-switch-whole-home"],
  layers: ["power", "comms"],
  scenarioId: null,
  trip: "",
  site: EMPTY_SITE,
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
    };
    expect(parseHash(toHash(state), base)).toEqual(state);
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
    for (const t of loadTopologies("topologies").items) expect(() => Topology.parse(t)).not.toThrow();
    for (const s of loadScenarios("scenarios").items) expect(() => Scenario.parse(s)).not.toThrow();
  });
});
