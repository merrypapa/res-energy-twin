import { describe, expect, it } from "vitest";
import { loadConfigurations, loadDevices, loadLocations } from "../src/validate/index.js";
import { composeTopology } from "../src/config/compose.js";
import { buildRenderGraph } from "../src/graph/index.js";
import { dayCurve, daylight, declinationDeg, sunAt } from "../src/analysis/solar.js";
import { dayProfile } from "../src/analysis/day.js";
import { OperatingPoint, withSolar } from "../src/analysis/operating-point.js";

const devices = loadDevices("device-library").items;
const templates = loadConfigurations("configurations").items;
const locations = loadLocations("locations").items;
const loc = (id: string) => locations.find((l) => l.id === id)!;

describe("태양 기하", () => {
  it("밤에는 일사가 0이다", () => {
    expect(sunAt(34.05, 6, 2).poa_wm2).toBe(0);
    expect(sunAt(34.05, 6, 23).poa_wm2).toBe(0);
    expect(sunAt(34.05, 12, 6).elevation_deg).toBeLessThan(0);
  });

  it("정오가 가장 높고, 아침·저녁이 낮다", () => {
    const noon = sunAt(34.05, 6, 12).poa_wm2;
    expect(noon).toBeGreaterThan(sunAt(34.05, 6, 9).poa_wm2);
    expect(noon).toBeGreaterThan(sunAt(34.05, 6, 16).poa_wm2);
  });

  it("계절이 값을 바꾼다 — 겨울 정오가 여름 정오보다 낮다", () => {
    expect(sunAt(40.71, 12, 12).poa_wm2).toBeLessThan(sunAt(40.71, 6, 12).poa_wm2);
    expect(declinationDeg(6)).toBeGreaterThan(0);
    expect(declinationDeg(12)).toBeLessThan(0);
  });

  it("위도가 높을수록 겨울이 더 낮다", () => {
    expect(sunAt(47.61, 12, 12).poa_wm2).toBeLessThan(sunAt(29.76, 12, 12).poa_wm2);
  });

  it("일출과 일몰은 정오를 기준으로 대칭이다", () => {
    const d = daylight(loc("los-angeles-ca"), 6)!;
    expect(d.sunrise + d.sunset).toBeCloseTo(24, 6);
    expect(daylight(loc("seattle-wa"), 6)!.sunset).toBeGreaterThan(
      daylight(loc("seattle-wa"), 12)!.sunset,
    );
  });

  it("맑음 계수는 크기만 줄인다", () => {
    const full = sunAt(34.05, 6, 12, 1).poa_wm2;
    expect(sunAt(34.05, 6, 12, 0.5).poa_wm2).toBeCloseTo(full * 0.5, 6);
    expect(sunAt(34.05, 6, 12, 0).poa_wm2).toBe(0);
  });

  it("하루 곡선은 0시에서 24시까지 끊김 없이 나온다", () => {
    const curve = dayCurve(loc("phoenix-az"), 6);
    expect(curve[0]!.hour).toBe(0);
    expect(curve[curve.length - 1]!.hour).toBeCloseTo(24, 6);
    expect(Math.max(...curve.map((c) => c.poa_wm2))).toBeGreaterThan(800);
  });
});

describe("동작점과 일사", () => {
  it("지역을 고르면 일사가 계산돼 들어간다", () => {
    const op = OperatingPoint.parse({ location_id: "los-angeles-ca", month: 6, hour: 12 });
    expect(withSolar(op, loc("los-angeles-ca")).irradiance).toBeGreaterThan(0.8);
  });

  it("지역이 없으면 손으로 준 값을 그대로 쓴다 — 값을 지어내지 않는다", () => {
    const op = OperatingPoint.parse({ irradiance: 0.42 });
    expect(withSolar(op, null).irradiance).toBe(0.42);
  });

  it("밤이면 일사가 0이 되고, 그 시각의 발전도 0이다", () => {
    const op = OperatingPoint.parse({ location_id: "los-angeles-ca", month: 12, hour: 3 });
    expect(withSolar(op, loc("los-angeles-ca")).irradiance).toBe(0);
  });
});

describe("하루 곡선", () => {
  const t = composeTopology(templates.find((x) => x.id === "enphase-4g")!).topology;
  const graph = buildRenderGraph(t, devices, ["power"]);
  const profile = dayProfile(graph, "mi-10", {
    op: OperatingPoint.parse({ location_id: "los-angeles-ca", month: 6, house_load_kw: 3 }),
    location: loc("los-angeles-ca"),
  });

  it("0시부터 24시까지 같은 간격으로 계산된다", () => {
    expect(profile.hours[0]).toBe(0);
    expect(profile.hours[profile.hours.length - 1]).toBeCloseTo(24, 6);
    expect(profile.ports["ac_out"]).toHaveLength(profile.hours.length);
  });

  it("해가 뜨면 출력이 생기고 밤에는 0이다", () => {
    const at = (h: number) => profile.ports["ac_out"]![Math.round(h / profile.step)]!;
    expect(at(2)).toBe(0);
    expect(at(12)).toBeGreaterThan(0);
    expect(at(12)).toBeGreaterThan(at(8));
    expect(at(23)).toBe(0);
  });

  it("정오 부근이 최댓값이다", () => {
    const values = profile.ports["ac_out"]!;
    const peakHour = profile.hours[values.indexOf(Math.max(...values))]!;
    expect(Math.abs(peakHour - 12)).toBeLessThanOrEqual(1);
  });
});
