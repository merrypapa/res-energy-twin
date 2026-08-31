import type { Device, Port } from "../schema/device.js";
import type { Topology } from "../schema/topology.js";
import type { Layer } from "../schema/common.js";

/**
 * topology(참조) + device-library(스펙) → 렌더 가능한 그래프.
 *
 * 렌더러는 이 구조체까지만 본다. device.vendor / device.id로 분기하지 않는다.
 * 그림에 필요한 모든 정보(심볼 종류, 라벨, 정격 요약)는 class와 ratings에서 나온다.
 */

/** 엣지의 급전 상태. 스프린트 2 시나리오 엔진이 계산해 주입한다. */
export type Energization = "live" | "dead";

/** key = `${edge.from}->${edge.to}`. 없으면 live로 본다(계통 정상). */
export type EnergizationMap = Readonly<Record<string, Energization>>;

export interface RGEnd {
  nodeRef: string;
  portId: string;
  port: Port;
}

export interface RGNode {
  ref: string;
  device: Device;
  label: string;
  count: number;
  /** 정격 요약 한 줄. 값이 없으면 null — 추정치를 만들어 넣지 않는다. */
  meta: string | null;
}

export interface RGEdge {
  id: string;
  from: RGEnd;
  to: RGEnd;
  layer: Layer;
  /** 도체 라벨(OCPD / AWG). 값이 없으면 null. */
  conductor: string | null;
}

export interface RenderGraph {
  topology: Topology;
  nodes: RGNode[];
  edges: RGEdge[];
  byRef: Map<string, RGNode>;
}

export function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

export function edgeState(e: RGEdge, map: EnergizationMap): Energization {
  return map[e.id] ?? "live";
}

/** 노드는 접속된 전력 엣지가 모두 사선일 때만 사선으로 본다. */
export function nodeState(g: RenderGraph, ref: string, map: EnergizationMap): Energization {
  const touching = g.edges.filter(
    (e) => e.layer === "power" && (e.from.nodeRef === ref || e.to.nodeRef === ref),
  );
  if (touching.length === 0) return "live";
  return touching.some((e) => edgeState(e, map) === "live") ? "live" : "dead";
}

const RATING_LABELS: ReadonlyArray<readonly [string, (v: number) => string]> = [
  ["continuous_ac_kw", (v) => `${v} kW`],
  ["continuous_ac_kva", (v) => `${v} kVA`],
  ["usable_energy_kwh", (v) => `${v} kWh`],
  ["busbar_a", (v) => `버스바 ${v}A`],
  ["service_a", (v) => `서비스 ${v}A`],
  ["main_ocpd_a", (v) => `메인 ${v}A`],
  ["lra", (v) => `LRA ${v}`],
];

function ratingSummary(d: Device): string | null {
  const parts: string[] = [];
  for (const [key, fmt] of RATING_LABELS) {
    const v = (d.ratings as Record<string, number | null>)[key];
    if (typeof v === "number") parts.push(fmt(v));
    if (parts.length === 3) break;
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function conductorLabel(e: Topology["edges"][number]): string | null {
  const c = e.conductor;
  if (!c) return null;
  const parts: string[] = [];
  if (c.ocpd_a !== null) parts.push(`${c.ocpd_a}A`);
  if (c.awg !== null) parts.push(`${c.awg} AWG`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export class RenderGraphError extends Error {}

/**
 * 검증기(`npm run validate`)를 통과한 데이터만 들어온다고 가정한다.
 * 참조가 깨져 있으면 조용히 건너뛰지 않고 던진다 — 그림이 거짓말을 하면 안 된다.
 */
export function buildRenderGraph(
  topology: Topology,
  devices: Device[],
  layers: readonly Layer[] = ["power", "comms", "physical"],
): RenderGraph {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const nodes: RGNode[] = [];
  const byRef = new Map<string, RGNode>();

  for (const n of topology.nodes) {
    const device = byId.get(n.device);
    if (!device) throw new RenderGraphError(`${topology.id}#${n.ref}: 알 수 없는 device ${n.device}`);
    const node: RGNode = {
      ref: n.ref,
      device,
      label: n.label ?? device.display_name,
      count: n.count,
      meta: ratingSummary(device),
    };
    nodes.push(node);
    byRef.set(n.ref, node);
  }

  const resolveEnd = (ref: string, where: string): RGEnd => {
    const [nodeRef, portId] = ref.split(".") as [string, string];
    const node = byRef.get(nodeRef);
    if (!node) throw new RenderGraphError(`${where}: 알 수 없는 노드 ${nodeRef}`);
    const port = node.device.ports.find((p) => p.id === portId);
    if (!port) throw new RenderGraphError(`${where}: ${node.device.id}에 포트 ${portId} 없음`);
    return { nodeRef, portId, port };
  };

  const edges: RGEdge[] = [];
  for (const e of topology.edges) {
    if (!layers.includes(e.layer)) continue;
    const where = `${topology.id}:${e.from}→${e.to}`;
    edges.push({
      id: edgeKey(e.from, e.to),
      from: resolveEnd(e.from, where),
      to: resolveEnd(e.to, where),
      layer: e.layer,
      conductor: conductorLabel(e),
    });
  }

  return { topology, nodes, edges, byRef };
}
