import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDevices, loadConfigurations } from "../src/validate/index.js";
import { composeTopology } from "../src/config/compose.js";
import { buildRenderGraph } from "../src/graph/index.js";
import { computePowerFlow } from "../src/analysis/powerflow.js";
import { OperatingPoint } from "../src/analysis/operating-point.js";
import { renderInternals } from "../src/render/internals.js";
import { Device } from "../src/schema/device.js";
import { Internals } from "../src/schema/internals.js";

const devices = loadDevices("device-library").items;
const templates = loadConfigurations("configurations").items;
const withInternals = devices.filter((d) => d.internals !== null);
const byId = (id: string) => devices.find((d) => d.id === id)!;

describe("함체 내부 데이터", () => {
  it("내부 구조가 기재된 제품이 있다", () => {
    expect(withInternals.map((d) => d.id).sort()).toEqual([
      "qcells-qhome-combiner-80-g1",
      "qcells-qhome-core-g3",
    ]);
  });

  it("ESS는 셀과 변환기로 갈린다", () => {
    const kinds = byId("qcells-qhome-core-g3").internals!.blocks.map((b) => b.kind);
    expect(kinds).toContain("cells");
    expect(kinds).toContain("converter");
  });

  it("결합반은 모선과 차단기로 갈린다", () => {
    const blocks = byId("qcells-qhome-combiner-80-g1").internals!.blocks;
    expect(blocks.filter((b) => b.kind === "breaker").length).toBeGreaterThan(1);
    expect(blocks.some((b) => b.kind === "busbar")).toBe(true);
  });

  it("함체에 포함되지 않는 차단기는 정격을 비워 둔다 — 시공 시 정해지는 값이다", () => {
    // 데이터시트가 '분기 차단기는 미포함, 현장 조달'이라 적는다. 자리마다 정격이 달라질
    // 수 있으므로 하나의 수를 적으면 없는 사실을 만든다.
    const dg = byId("qcells-qhome-combiner-80-g1").internals!.blocks.find((b) => b.id === "dg_breakers")!;
    expect(dg.ocpd_a).toBeNull();
    expect(dg.count).toBe(4);
  });

  it("정격을 적은 블록이 있으면 그 함체에 내부 출처가 붙어 있다", () => {
    // 값이 데이터에 들어오는 것 자체는 막지 않는다. 막는 것은 근거 없이 들어오는 것이다.
    for (const d of withInternals) {
      const rated = d.internals!.blocks.filter((b) => b.ocpd_a !== null);
      if (rated.length === 0) continue;
      expect(`${d.id}:${d.internals!.sources.length > 0}`).toBe(`${d.id}:true`);
    }
  });

  it("내부 구조에도 출처와 확인 대상이 붙는다", () => {
    for (const d of withInternals) {
      expect(`${d.id}:${d.internals!.sources.length > 0}`).toBe(`${d.id}:true`);
      expect(`${d.id}:${d.internals!.todos.length > 0}`).toBe(`${d.id}:true`);
    }
  });

  it("블록이 가리키는 포트는 실재해야 한다", () => {
    for (const d of withInternals) {
      const ids = new Set(d.ports.map((p) => p.id));
      for (const b of d.internals!.blocks) {
        if (b.port === null) continue;
        expect(`${d.id}/${b.id}: ${b.port}`).toBe(`${d.id}/${b.id}: ${ids.has(b.port) ? b.port : "없는 포트"}`);
      }
    }
  });

  it("링크는 실재하는 블록만 잇는다", () => {
    for (const d of withInternals) {
      const ids = new Set(d.internals!.blocks.map((b) => b.id));
      for (const l of d.internals!.links) {
        expect(`${d.id}: ${l.from}→${l.to}`).toBe(
          `${d.id}: ${ids.has(l.from) ? l.from : "?"}→${ids.has(l.to) ? l.to : "?"}`,
        );
      }
    }
  });

  it("스키마를 벗어난 필드는 거부된다", () => {
    expect(() =>
      Internals.parse({ blocks: [{ id: "a", display_name: "a", kind: "cells", volts: 400 }] }),
    ).toThrow();
  });
});

describe("함체 내부 도면", () => {
  it("내부 구조가 없는 제품에는 아무것도 그리지 않는다", () => {
    const plain = devices.find((d) => d.internals === null)!;
    expect(renderInternals(plain)).toBeNull();
  });

  it("모든 블록이 도면에 나온다", () => {
    for (const d of withInternals) {
      const svg = renderInternals(d)!;
      for (const b of d.internals!.blocks) expect(svg).toContain(b.display_name);
    }
  });

  it("값이 없는 자리는 빈칸이 아니라 미확인으로 적는다", () => {
    expect(renderInternals(byId("qcells-qhome-combiner-80-g1"))!).toContain("미확인");
  });

  it("계측 신호는 전력선과 다른 선으로 그린다", () => {
    const svg = renderInternals(byId("qcells-qhome-combiner-80-g1"))!;
    expect(svg).toContain('class="link signal"');
  });

  it("같은 입력이면 같은 바이트가 나온다", () => {
    const d = byId("qcells-qhome-core-g3");
    expect(renderInternals(d)).toBe(renderInternals(d));
  });

  it("도면 소스에 벤더/제품명이 없다", () => {
    const banned = /tesla|enphase|qcells|solaredge|powerwall|q\.home|q\.tron/i;
    const text = readFileSync(join("src/render", "internals.ts"), "utf8").replace(
      /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
      "",
    );
    expect(banned.test(text) ? text.match(banned)?.[0] : "clean").toBe("clean");
  });
});

describe("내부 구조는 계산에 새지 않는다", () => {
  const flowOf = (ds: Device[]) => {
    const tpl = templates.find((t) => t.id === "qcells-qhome")!;
    const g = buildRenderGraph(composeTopology(tpl, {}).topology, ds, ["power", "comms"]);
    return computePowerFlow(g, OperatingPoint.parse({ irradiance: 0.8, house_load_kw: 2 }), {});
  };

  it("내부 구조를 지워도 전력 조류가 같다", () => {
    const stripped = devices.map((d) =>
      d.internals === null ? d : Device.parse({ ...d, internals: null }),
    );
    const a = flowOf(devices);
    const b = flowOf(stripped);
    expect(b.edges).toEqual(a.edges);
    expect(b.pv_kw).toBe(a.pv_kw);
    expect(b.battery_kw).toBe(a.battery_kw);
  });
});
