import type { RenderGraph, RGEdge } from "../graph/index.js";
import { symbolExtent } from "./symbols.js";
import { GEO } from "./theme.js";

/**
 * 계층 배치. 전력 흐름이 위 → 아래로 흐르도록 랭크를 매기고, 랭크 안에서
 * 교차가 줄어드는 순서를 찾는다. 통신 엣지는 배치에 영향을 주지 않는다
 * (통신선이 전력 계층 구조를 왜곡하면 단선도로 읽히지 않는다).
 *
 * 범용 그래프 라이브러리는 쓰지 않는다 (CLAUDE.md §7). 필요성이 증명되면 그때.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface PlacedNode {
  ref: string;
  rank: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoutedEdge {
  edge: RGEdge;
  points: Pt[];
  label: { text: string; x: number; y: number; anchor: "middle" | "start" } | null;
}

export interface Layout {
  nodes: PlacedNode[];
  edges: RoutedEdge[];
  /** 노드가 차지하는 영역 */
  drawing: { x: number; y: number; w: number; h: number };
  width: number;
  /** 도면 영역 높이. 제목란은 포함하지 않는다 (svg.ts가 아래에 붙인다). */
  height: number;
}

type Item = { kind: "node"; key: string } | { kind: "dummy"; key: string; edgeId: string };

const DUMMY_W = 20;

/** 전력 엣지 기준 최장경로 랭크. 사이클이 있으면 남은 노드를 뒤에 몰아 배치한다. */
function computeRanks(g: RenderGraph): Map<string, number> {
  const power = g.edges.filter((e) => e.layer === "power");
  const indeg = new Map<string, number>();
  const succ = new Map<string, string[]>();
  for (const n of g.nodes) {
    indeg.set(n.ref, 0);
    succ.set(n.ref, []);
  }
  for (const e of power) {
    if (e.from.nodeRef === e.to.nodeRef) continue;
    succ.get(e.from.nodeRef)!.push(e.to.nodeRef);
    indeg.set(e.to.nodeRef, (indeg.get(e.to.nodeRef) ?? 0) + 1);
  }

  const rank = new Map<string, number>();
  const queue = g.nodes.filter((n) => (indeg.get(n.ref) ?? 0) === 0).map((n) => n.ref);
  for (const ref of queue) rank.set(ref, 0);

  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    for (const next of succ.get(cur) ?? []) {
      const candidate = (rank.get(cur) ?? 0) + 1;
      if (candidate > (rank.get(next) ?? -1)) rank.set(next, candidate);
      const left = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, left);
      if (left === 0) queue.push(next);
    }
  }

  // 사이클에 걸려 확정되지 않은 노드 (데이터 오류에 가깝지만 그리기는 해야 한다)
  const maxRank = Math.max(0, ...rank.values());
  for (const n of g.nodes) if (!rank.has(n.ref)) rank.set(n.ref, maxRank + 1);

  // 전원(유입 엣지가 없는 노드)을 소비처 바로 위로 끌어내린다.
  // 배터리를 최상단에 올려두면 긴 엣지가 생기고 계층이 실제 결선보다 깊어 보인다.
  for (const n of g.nodes) {
    const outs = succ.get(n.ref) ?? [];
    const hasIncoming = power.some((e) => e.to.nodeRef === n.ref);
    if (hasIncoming || outs.length === 0) continue;
    const tight = Math.min(...outs.map((s) => rank.get(s) ?? 0)) - 1;
    if (tight > (rank.get(n.ref) ?? 0)) rank.set(n.ref, tight);
  }

  // 비어 버린 랭크는 접는다 (빈 띠가 도면에 남지 않도록)
  const used = [...new Set(rank.values())].sort((a, b) => a - b);
  const remap = new Map(used.map((r, i) => [r, i]));
  for (const [ref, r] of rank) rank.set(ref, remap.get(r)!);
  return rank;
}

/** 인접 랭크 사이의 연결. 긴 엣지는 더미를 거쳐 한 칸씩 끊어 둔다. */
interface Segment {
  upper: string;
  lower: string;
  edgeId: string;
}

function buildLayers(g: RenderGraph, rank: Map<string, number>) {
  const power = g.edges.filter((e) => e.layer === "power" && e.from.nodeRef !== e.to.nodeRef);
  const depth = Math.max(0, ...rank.values()) + 1;
  const layers: Item[][] = Array.from({ length: depth }, () => []);
  for (const n of g.nodes) layers[rank.get(n.ref)!]!.push({ kind: "node", key: n.ref });

  const segments: Segment[] = [];
  /** edgeId → 더미 key들(랭크 오름차순) */
  const chains = new Map<string, string[]>();

  for (const e of power) {
    const r0 = rank.get(e.from.nodeRef)!;
    const r1 = rank.get(e.to.nodeRef)!;
    const step = r1 > r0 ? 1 : -1;
    const chain: string[] = [];
    let prev = e.from.nodeRef;
    for (let r = r0 + step; r !== r1; r += step) {
      const key = `~${e.id}#${r}`;
      layers[r]!.push({ kind: "dummy", key, edgeId: e.id });
      chain.push(key);
      segments.push(step > 0 ? { upper: prev, lower: key, edgeId: e.id } : { upper: key, lower: prev, edgeId: e.id });
      prev = key;
    }
    segments.push(
      step > 0
        ? { upper: prev, lower: e.to.nodeRef, edgeId: e.id }
        : { upper: e.to.nodeRef, lower: prev, edgeId: e.id },
    );
    chains.set(e.id, chain);
  }

  return { layers, segments, chains, rankOf: rank };
}

/** 중앙값 정렬 2회 왕복. 결정론적이며, 동률이면 선언 순서를 유지한다. */
function orderLayers(layers: Item[][], segments: Segment[]): void {
  const pos = new Map<string, number>();
  const reindex = () => {
    for (const layer of layers) layer.forEach((it, i) => pos.set(it.key, i));
  };
  reindex();

  const neighborsUp = new Map<string, string[]>();
  const neighborsDown = new Map<string, string[]>();
  for (const s of segments) {
    (neighborsUp.get(s.lower) ?? neighborsUp.set(s.lower, []).get(s.lower)!).push(s.upper);
    (neighborsDown.get(s.upper) ?? neighborsDown.set(s.upper, []).get(s.upper)!).push(s.lower);
  }

  const bary = (key: string, side: Map<string, string[]>): number | null => {
    const ns = side.get(key);
    if (!ns || ns.length === 0) return null;
    const vals = ns.map((n) => pos.get(n) ?? 0).sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 === 1 ? vals[mid]! : (vals[mid - 1]! + vals[mid]!) / 2;
  };

  const sweep = (side: Map<string, string[]>, order: number[]) => {
    for (const r of order) {
      const layer = layers[r]!;
      const keyed = layer.map((it, i) => ({ it, i, b: bary(it.key, side) }));
      keyed.sort((a, b) => {
        if (a.b === null && b.b === null) return a.i - b.i;
        if (a.b === null) return a.i - b.i;
        if (b.b === null) return a.i - b.i;
        return a.b - b.b || a.i - b.i;
      });
      layers[r] = keyed.map((k) => k.it);
      reindex();
    }
  };

  const down = layers.map((_, i) => i).slice(1);
  const up = layers.map((_, i) => i).slice(0, -1).reverse();
  for (let pass = 0; pass < 2; pass++) {
    sweep(neighborsUp, down);
    sweep(neighborsDown, up);
  }
}

/**
 * 직교 폴리라인. 앵커 x가 몇 px 어긋나 생기는 미세 계단은 붙여 버린다.
 * 도면에서 1px 꺾임은 정보가 아니라 렌더링 잡음이다.
 */
function orthogonal(input: Pt[]): Pt[] {
  const points = input.map((p) => ({ ...p }));
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (Math.abs(cur.x - prev.x) < 3) cur.x = prev.x;
  }
  const out: Pt[] = [];
  const push = (p: Pt) => {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    push(a);
    if (a.x !== b.x) {
      const my = (a.y + b.y) / 2;
      push({ x: a.x, y: my });
      push({ x: b.x, y: my });
    }
  }
  push(points[points.length - 1]!);
  return out;
}

function labelFor(points: Pt[], text: string | null): RoutedEdge["label"] {
  if (!text) return null;
  let best = { len: -1, a: points[0]!, b: points[0]! };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (len > best.len) best = { len, a, b };
  }
  const mx = (best.a.x + best.b.x) / 2;
  const my = (best.a.y + best.b.y) / 2;
  return best.a.x === best.b.x
    ? { text, x: mx + 7, y: my + 3, anchor: "start" }
    : { text, x: mx, y: my - 6, anchor: "middle" };
}

export function layoutGraph(g: RenderGraph): Layout {
  const rank = computeRanks(g);
  const { layers, segments, chains } = buildLayers(g, rank);
  orderLayers(layers, segments);

  // ── 좌표 배정 ────────────────────────────────────────────────
  const widthOf = (it: Item) => (it.kind === "node" ? GEO.nodeW : DUMMY_W);
  const rankWidth = (layer: Item[]) =>
    layer.reduce((sum, it) => sum + widthOf(it), 0) + Math.max(0, layer.length - 1) * GEO.colGap;
  const widest = Math.max(GEO.nodeW, ...layers.map(rankWidth));
  const originX = GEO.margin;
  const originY = GEO.margin;

  const boxes = new Map<string, { x: number; y: number; w: number; h: number; rank: number }>();
  layers.forEach((layer, r) => {
    let cursor = originX + (widest - rankWidth(layer)) / 2;
    const y = originY + r * (GEO.nodeH + GEO.rankGap);
    for (const it of layer) {
      const w = widthOf(it);
      boxes.set(it.key, { x: cursor, y, w, h: GEO.nodeH, rank: r });
      cursor += w + GEO.colGap;
    }
  });

  const nodes: PlacedNode[] = g.nodes.map((n) => {
    const b = boxes.get(n.ref)!;
    return { ref: n.ref, rank: b.rank, x: b.x, y: b.y, w: b.w, h: b.h };
  });

  const centerOf = (key: string): Pt => {
    const b = boxes.get(key)!;
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  };

  // ── 포트 앵커: 전력은 상/하단, 통신은 우측 ──────────────────────
  const powerEdges = g.edges.filter((e) => e.layer === "power");
  const otherEdges = g.edges.filter((e) => e.layer !== "power");

  /** 엣지가 노드를 떠난 직후 향하는 지점의 x — 앵커 정렬 기준 */
  const nextX = (e: RGEdge, downward: boolean): number => {
    const chain = chains.get(e.id) ?? [];
    if (downward) return centerOf(chain[0] ?? e.to.nodeRef).x;
    return centerOf(chain[chain.length - 1] ?? e.from.nodeRef).x;
  };

  const anchors = new Map<string, Pt>(); // `${edgeId}|out` / `|in`
  const assign = (side: "out" | "in") => {
    const byNode = new Map<string, RGEdge[]>();
    for (const e of powerEdges) {
      const ref = side === "out" ? e.from.nodeRef : e.to.nodeRef;
      (byNode.get(ref) ?? byNode.set(ref, []).get(ref)!).push(e);
    }
    for (const [ref, list] of byNode) {
      const b = boxes.get(ref)!;
      const sorted = [...list].sort((a, c) => nextX(a, side === "out") - nextX(c, side === "out"));
      sorted.forEach((e, i) => {
        anchors.set(`${e.id}|${side}`, {
          x: b.x + (b.w * (i + 1)) / (sorted.length + 1),
          y: side === "out" ? b.y + b.h : b.y,
        });
      });
    }
  };
  assign("out");
  assign("in");

  const routed: RoutedEdge[] = [];
  for (const e of powerEdges) {
    const start = anchors.get(`${e.id}|out`)!;
    const end = anchors.get(`${e.id}|in`)!;
    const mids = (chains.get(e.id) ?? []).map(centerOf);
    const points = orthogonal([start, ...mids, end]);
    routed.push({ edge: e, points, label: labelFor(points, e.conductor) });
  }

  // ── 통신/물리 레이어 ─────────────────────────────────────────
  // 함체(심볼) 옆면에서 나와 상대 쪽으로 향한다. 같은 랭크에서 이웃이면 곧장 잇고,
  // 아니면 랭크 아래 여백(거터)을 타고 돌아간다. 노드 라벨 위를 가로지르지 않는다.
  const drawingRight = originX + widest;
  const drawingBottom = originY + layers.length * (GEO.nodeH + GEO.rankGap) - GEO.rankGap;

  const sideUsed = new Map<string, number>();
  /** dir = +1이면 우측으로, -1이면 좌측으로 빠진다. */
  const side = (ref: string, lane: number, dir: 1 | -1) => {
    const b = boxes.get(ref)!;
    const i = sideUsed.get(ref) ?? 0;
    sideUsed.set(ref, i + 1);
    const [halfW] = symbolExtent(g.byRef.get(ref)!.device.class);
    return {
      edge: b.x + b.w / 2 + dir * halfW,
      stub: dir > 0 ? b.x + b.w + GEO.commsStub + lane * 6 : b.x - GEO.commsStub - lane * 6,
      y: b.y + GEO.glyphCy + i * 7,
      gutterY: b.y + b.h + 12,
      rank: b.rank,
      cx: b.x + b.w / 2,
    };
  };

  /** 같은 랭크에서 두 노드 사이에 다른 노드가 없으면 곧장 이어도 된다. */
  const adjacentInRank = (p: string, q: string): boolean => {
    const a = boxes.get(p)!;
    const b = boxes.get(q)!;
    if (a.rank !== b.rank) return false;
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    return !g.nodes.some((n) => {
      const o = boxes.get(n.ref)!;
      return o.rank === a.rank && o.x > lo && o.x < hi;
    });
  };

  let minX: number = originX;
  let maxX: number = drawingRight;
  let maxY = drawingBottom;
  otherEdges.forEach((e, i) => {
    const from = boxes.get(e.from.nodeRef)!;
    const to = boxes.get(e.to.nodeRef)!;
    const dir: 1 | -1 = to.x + to.w / 2 >= from.x + from.w / 2 ? 1 : -1;
    const back: 1 | -1 = dir > 0 ? -1 : 1;
    const a = side(e.from.nodeRef, i, dir);
    const b = side(e.to.nodeRef, i, back);

    let points: Pt[];
    if (adjacentInRank(e.from.nodeRef, e.to.nodeRef)) {
      points = [
        { x: a.edge, y: a.y },
        { x: b.edge, y: a.y },
      ];
    } else {
      const gutterY = a.gutterY + i * 8;
      maxY = Math.max(maxY, gutterY);
      points = [
        { x: a.edge, y: a.y },
        { x: a.stub, y: a.y },
        { x: a.stub, y: gutterY },
        { x: b.stub, y: gutterY },
        { x: b.stub, y: b.y },
        { x: b.edge, y: b.y },
      ];
    }
    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
    }
    routed.push({ edge: e, points, label: null });
  });

  if (minX < originX) {
    const shift = originX - minX;
    for (const n of nodes) n.x += shift;
    for (const r of routed) for (const p of r.points) p.x += shift;
    maxX += shift;
  }

  return {
    nodes,
    edges: routed,
    drawing: { x: originX, y: originY, w: widest, h: drawingBottom - originY },
    width: maxX + GEO.margin,
    height: maxY + GEO.margin,
  };
}
