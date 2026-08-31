import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadDevices, loadTopologies, validateAll, checkTopology, checkSourcedNumbers } from "../src/validate/index.js";
import { Device } from "../src/schema/device.js";
import { Topology } from "../src/schema/topology.js";

const devices = loadDevices("device-library");
const topologies = loadTopologies("topologies");

describe("데이터 로드", () => {
  it("모든 device 파일이 스키마를 통과한다", () => {
    expect(devices.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(devices.items.length).toBeGreaterThan(0);
  });
  it("모든 topology 파일이 스키마를 통과한다", () => {
    expect(topologies.findings.filter((f) => f.severity === "error")).toEqual([]);
    // 개수를 상수로 박지 않는다. 데이터 파일 추가만으로 제품이 늘어나는 것이 이 프로젝트의 전제다.
    // 지켜야 할 것은 "디렉터리의 파일이 하나도 조용히 누락되지 않는다"이다.
    const files = readdirSync("topologies").filter((f) => f.endsWith(".json"));
    expect(topologies.items.length).toBe(files.length);
    expect(topologies.items.length).toBeGreaterThan(0);
  });
  it("모든 device 파일이 빠짐없이 로드된다", () => {
    const count = (dir: string): number =>
      readdirSync(dir, { withFileTypes: true }).reduce(
        (n, e) =>
          n + (e.isDirectory() ? count(`${dir}/${e.name}`) : /\.ya?ml$/.test(e.name) ? 1 : 0),
        0,
      );
    expect(devices.items.length).toBe(count("device-library"));
  });
  it("전체 검증에 error가 없다", () => {
    const errors = validateAll(devices.items, topologies.items).filter((f) => f.severity === "error");
    expect(errors).toEqual([]);
  });
});

const dev = (o: Record<string, unknown>) =>
  Device.parse({
    vendor: "t", display_name: "t", status: "draft", provides_mid: false, ...o,
  });

describe("포트 정합성", () => {
  const a = dev({ id: "a", class: "ac_battery", ports: [{ id: "out", type: "ac_240v_split", direction: "out" }] });
  const b = dev({ id: "b", class: "main_panel", ports: [{ id: "in", type: "dc_string", direction: "in" }] });

  it("타입이 다르면 error", () => {
    const t = Topology.parse({
      id: "x", vendor: "t", display_name: "x", status: "draft", backup_scope: "none",
      nodes: [{ ref: "a", device: "a" }, { ref: "b", device: "b" }],
      edges: [{ from: "a.out", to: "b.in" }],
    });
    expect(checkTopology(t, [a, b]).some((f) => f.code === "E023")).toBe(true);
  });

  it("없는 포트를 참조하면 error", () => {
    const t = Topology.parse({
      id: "x", vendor: "t", display_name: "x", status: "draft", backup_scope: "none",
      nodes: [{ ref: "a", device: "a" }, { ref: "b", device: "b" }],
      edges: [{ from: "a.nope", to: "b.in" }],
    });
    expect(checkTopology(t, [a, b]).some((f) => f.code === "E022")).toBe(true);
  });

  it("max_connections를 넘으면 error", () => {
    const src = dev({ id: "s", class: "pv_module", ports: [{ id: "o", type: "dc_pv_module", direction: "out", max_connections: 1 }] });
    const sink = dev({ id: "k", class: "string_inverter", ports: [{ id: "i", type: "dc_string", direction: "in", max_connections: 4 }] });
    const t = Topology.parse({
      id: "x", vendor: "t", display_name: "x", status: "draft", backup_scope: "none",
      nodes: [{ ref: "s", device: "s" }, { ref: "k", device: "k" }],
      edges: [{ from: "s.o", to: "k.i" }, { from: "s.o", to: "k.i" }],
    });
    expect(checkTopology(t, [src, sink]).some((f) => f.code === "E024")).toBe(true);
  });
});

describe("구성 규칙", () => {
  it("백업 구성인데 MID가 없으면 warning", () => {
    const a = dev({ id: "a", class: "ac_battery", ports: [{ id: "o", type: "ac_240v_split", direction: "out" }] });
    const b = dev({ id: "b", class: "main_panel", ports: [{ id: "i", type: "ac_240v_split", direction: "in" }] });
    const t = Topology.parse({
      id: "x", vendor: "t", display_name: "x", status: "draft", backup_scope: "whole_home",
      nodes: [{ ref: "a", device: "a" }, { ref: "b", device: "b" }],
      edges: [{ from: "a.o", to: "b.i" }],
    });
    expect(checkTopology(t, [a, b]).some((f) => f.code === "W030")).toBe(true);
  });

  it("requires_one_of가 충족되지 않으면 error", () => {
    const a = dev({
      id: "a", class: "ac_battery", requires_one_of: ["mid-x"],
      ports: [{ id: "o", type: "ac_240v_split", direction: "out" }],
    });
    const b = dev({ id: "b", class: "main_panel", ports: [{ id: "i", type: "ac_240v_split", direction: "in" }] });
    const t = Topology.parse({
      id: "x", vendor: "t", display_name: "x", status: "draft", backup_scope: "none",
      nodes: [{ ref: "a", device: "a" }, { ref: "b", device: "b" }],
      edges: [{ from: "a.o", to: "b.i" }],
    });
    expect(checkTopology(t, [a, b]).some((f) => f.code === "E025")).toBe(true);
  });

  it("출처 없는 숫자 스펙은 error", () => {
    const a = dev({ id: "a", class: "ac_battery", ratings: { usable_energy_kwh: 10 } });
    expect(checkSourcedNumbers([a]).some((f) => f.code === "E010")).toBe(true);
  });
});
