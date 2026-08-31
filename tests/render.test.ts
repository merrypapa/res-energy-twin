import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDevices, loadTopologies } from "../src/validate/index.js";
import { layoutGraph, renderTopology, hasSymbol } from "../src/render/index.js";
import { buildRenderGraph, RenderGraphError } from "../src/graph/index.js";
import { DeviceClass, Device } from "../src/schema/device.js";
import { Topology } from "../src/schema/topology.js";

const devices = loadDevices("device-library").items;
const topologies = loadTopologies("topologies").items;
const byId = (id: string) => topologies.find((t) => t.id === id)!;

const tesla = byId("tesla-pw3-backup-switch-whole-home");
const enphase = byId("enphase-4g-meter-collar-whole-home");

const countOf = (svg: string, re: RegExp) => svg.match(re)?.length ?? 0;

describe("렌더 그래프", () => {
  it("모든 노드와 엣지가 device/port로 해석된다", () => {
    for (const t of topologies) {
      const g = buildRenderGraph(t, devices);
      expect(g.nodes).toHaveLength(t.nodes.length);
      expect(g.edges).toHaveLength(t.edges.length);
      for (const e of g.edges) {
        expect(e.from.port.id).toBe(e.from.portId);
        expect(e.to.port.id).toBe(e.to.portId);
      }
    }
  });

  it("레이어를 걸면 해당 엣지만 남는다", () => {
    const g = buildRenderGraph(enphase, devices, ["power"]);
    expect(g.edges.every((e) => e.layer === "power")).toBe(true);
    expect(g.edges.length).toBeLessThan(enphase.edges.length);
  });

  it("참조가 깨지면 조용히 넘어가지 않고 던진다", () => {
    const broken = Topology.parse({
      ...enphase,
      edges: [{ from: "collar.nope", to: "msp.main_lugs" }],
    });
    expect(() => buildRenderGraph(broken, devices)).toThrow(RenderGraphError);
  });
});

describe("계층 배치", () => {
  it("전력은 위에서 아래로 흐른다 — 서비스 포인트가 메인 패널보다 위", () => {
    for (const t of topologies) {
      const g = buildRenderGraph(t, devices);
      const l = layoutGraph(g);
      const rankOf = (cls: string) => {
        const ref = g.nodes.find((n) => n.device.class === cls)!.ref;
        return l.nodes.find((n) => n.ref === ref)!.rank;
      };
      expect(rankOf("service_point")).toBeLessThan(rankOf("main_panel"));
      expect(rankOf("mid")).toBeLessThan(rankOf("main_panel"));
    }
  });

  it("전원은 소비처 바로 위 랭크에 붙는다 (긴 엣지를 만들지 않는다)", () => {
    const g = buildRenderGraph(enphase, devices);
    const l = layoutGraph(g);
    const rankFor = (ref: string) => l.nodes.find((n) => n.ref === ref)!.rank;
    expect(rankFor("comb") - rankFor("batt")).toBe(1);
  });

  it("배치는 결정론적이다", () => {
    const g = buildRenderGraph(tesla, devices);
    expect(JSON.stringify(layoutGraph(g))).toBe(JSON.stringify(layoutGraph(buildRenderGraph(tesla, devices))));
  });

  it("모든 도체는 직교 폴리라인이다", () => {
    for (const t of topologies) {
      const l = layoutGraph(buildRenderGraph(t, devices));
      for (const r of l.edges) {
        for (let i = 0; i < r.points.length - 1; i++) {
          const a = r.points[i]!;
          const b = r.points[i + 1]!;
          expect(a.x === b.x || a.y === b.y).toBe(true);
        }
      }
    }
  });

  it("모든 노드가 캔버스 안에 있다", () => {
    for (const t of topologies) {
      const l = layoutGraph(buildRenderGraph(t, devices));
      for (const n of l.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.x + n.w).toBeLessThanOrEqual(l.width);
        expect(n.y + n.h).toBeLessThanOrEqual(l.height);
      }
    }
  });
});

describe("SVG 출력", () => {
  it("노드와 엣지가 빠짐없이 그려진다", () => {
    for (const t of topologies) {
      const svg = renderTopology(t, devices);
      expect(countOf(svg, /data-ref="/g)).toBe(t.nodes.length);
      expect(countOf(svg, /data-edge="/g)).toBe(t.edges.length);
      for (const n of t.nodes) expect(svg).toContain(`data-ref="${n.ref}"`);
    }
  });

  it("도체 정격 라벨이 도면에 나온다", () => {
    const svg = renderTopology(tesla, devices);
    expect(svg).toContain(">60A<");
    expect(svg).toContain(">200A<");
  });

  it("모든 출력에 disclaimer가 붙는다", () => {
    for (const t of topologies) {
      expect(renderTopology(t, devices)).toContain("퍼밋 도면");
    }
  });

  it("레이어를 끄면 그 도체는 그려지지 않는다", () => {
    const svg = renderTopology(enphase, devices, { layers: ["power"] });
    expect(svg).not.toContain("conductor comms");
  });

  it("사선 상태가 색으로만 표현된다 — 시나리오 엔진 입력이 그대로 반영된다", () => {
    const dead = { "svc.line->collar.grid_in": "dead" } as const;
    const svg = renderTopology(enphase, devices, { energization: dead });
    expect(countOf(svg, /data-edge="[^"]*" class="conductor power dead"/g)).toBe(1);
    // 계통 인입만 죽었을 때 서비스 포인트도 사선으로 떨어진다
    expect(svg).toContain('class="node dead" data-ref="svc"');
    expect(svg).toContain('class="node live" data-ref="msp"');
  });

  it("급전 상태를 주입하면 제목란이 계통 정상이라고 주장하지 않는다", () => {
    // 제목란은 폭에 맞춰 줄바꿈되므로 토막 문자열이 아니라 키워드로 본다.
    const dead = { [`${tesla.edges[0]!.from}->${tesla.edges[0]!.to}`]: "dead" as const };
    const noLabel = renderTopology(tesla, devices, { energization: dead, date: "2026-01-01" });
    expect(noLabel).not.toContain("grid_normal");
    expect(noLabel).toContain("미표기");

    const labelled = renderTopology(tesla, devices, {
      energization: dead,
      scenario: "outage_islanded",
      date: "2026-01-01",
    });
    expect(labelled).toContain("outage_islanded");
    expect(labelled).not.toContain("grid_normal");
  });

  it("급전 주입이 없으면 계통 정상으로 표기한다", () => {
    expect(renderTopology(tesla, devices, { date: "2026-01-01" })).toContain("grid_normal");
  });

  it("같은 입력이면 같은 바이트가 나온다", () => {
    expect(renderTopology(tesla, devices, { date: "2026-01-01" })).toBe(
      renderTopology(tesla, devices, { date: "2026-01-01" }),
    );
  });
});

describe("데이터가 제품이다 — 렌더러에 제품 지식이 없다", () => {
  // 그래프 해석은 src/graph/로 옮겼다. 두 곳 모두 제품 지식이 없어야 한다.
  const sources = ["src/render", "src/graph"].flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => ({ f: join(dir, f), text: readFileSync(join(dir, f), "utf8") })),
  );

  it("렌더러 소스에 벤더/제품명이 등장하지 않는다", () => {
    const banned = /tesla|enphase|qcells|solaredge|powerwall|iq\s?battery|backup switch|meter collar/i;
    for (const { f, text } of sources) {
      const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(`${f}: ${banned.test(code) ? code.match(banned)?.[0] : "clean"}`).toBe(`${f}: clean`);
    }
  });

  it("모든 device class에 심볼이 정의되어 있다", () => {
    for (const cls of DeviceClass.options) expect(hasSymbol(cls)).toBe(true);
  });

  it("device 파일만 추가해도 새 제품이 그려진다", () => {
    const newDevice = Device.parse({
      id: "vendor-x-ess-1",
      vendor: "VendorX",
      display_name: "VendorX ESS",
      class: "hybrid_inverter_battery",
      status: "draft",
      provides_mid: true,
      ports: [
        { id: "grid_in", type: "ac_service_line", direction: "in" },
        { id: "load_out", type: "ac_service_line", direction: "out" },
      ],
    });
    const t = Topology.parse({
      id: "vendor-x-demo",
      vendor: "VendorX",
      display_name: "VendorX 데모",
      status: "draft",
      backup_scope: "whole_home",
      nodes: [
        { ref: "svc", device: "generic-utility-service-200a" },
        { ref: "ess", device: "vendor-x-ess-1" },
        { ref: "msp", device: "generic-msp-200a" },
      ],
      edges: [
        { from: "svc.line", to: "ess.grid_in" },
        { from: "ess.load_out", to: "msp.main_lugs" },
      ],
    });
    const svg = renderTopology(t, [...devices, newDevice]);
    expect(svg).toContain('data-class="hybrid_inverter_battery"');
    expect(countOf(svg, /data-ref="/g)).toBe(3);
  });
});
