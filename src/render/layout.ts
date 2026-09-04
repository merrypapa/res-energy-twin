import type { RenderGraph, RGEdge } from "../graph/index.js";
import { isNarrow, symbolExtent, type DeviceClassName } from "./symbols.js";
import { portElectrical } from "../schema/electrical.js";
import { GEO } from "./theme.js";

/**
 * 계층 배치. 전력 흐름이 위 → 아래로 흐르도록 랭크를 매기고, 랭크 안에서
 * 교차가 줄어드는 순서를 찾는다. 통신 엣지는 배치에 영향을 주지 않는다
 * (통신선이 전력 계층 구조를 왜곡하면 단선도로 읽히지 않는다).
 *
 * 반복 노드는 **블록**으로 접는다. 모듈 20장을 한 줄로 늘어놓으면 도면이 2500px가 되어
 * 한 화면에 들어오지 않는다. 그래서
 *   - 1:1로 짝지어진 두 배열(모듈 ↔ 마이크로인버터)은 세로로 포개 한 칸으로 만들고,
 *   - 묶음(분기회로 · 스트링)마다 한 행을 쓰고, 행이 너무 길면 다시 접는다.
 * 접힌 행 사이는 뱀처럼 방향을 바꿔(serpentine) 트렁크 연결이 짧은 수직선이 된다.
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

/** 포트 단자 위치 — 도체가 제품에서 떠나는 지점. UI가 여기에 점을 찍는다. */
export interface PlacedPort {
  ref: string;
  portId: string;
  x: number;
  y: number;
}

export interface RoutedEdge {
  edge: RGEdge;
  points: Pt[];
  label: { text: string; x: number; y: number; anchor: "middle" | "start" } | null;
}

export interface Layout {
  nodes: PlacedNode[];
  ports: PlacedPort[];
  edges: RoutedEdge[];
  /** 노드가 차지하는 영역 */
  drawing: { x: number; y: number; w: number; h: number };
  /** AC 트렁크 버스에 물린 노드. 라벨이 버스를 침범하지 않게 렌더러가 쓴다. */
  trunkRefs: string[];
  width: number;
  /** 도면 영역 높이. 제목란은 포함하지 않는다 (svg.ts가 아래에 붙인다). */
  height: number;
}

/** 배열 블록: 반복 노드를 격자로 접은 덩어리. 셀 하나가 세로 스택(1~2단)이다. */
interface Block {
  key: string;
  /** 행 → 셀 → 스택(위에서 아래로) */
  rows: string[][][];
  depth: number;
}

type Item =
  | { kind: "node"; key: string }
  | { kind: "dummy"; key: string; edgeId: string }
  | { kind: "block"; key: string; block: Block };

const DUMMY_W = 20;

/** 노드 상자 폭. 배열 소자는 좁다 — class로만 판정한다. */
function nodeWidth(cls: DeviceClassName): number {
  return isNarrow(cls) ? GEO.arrayNodeW : GEO.nodeW;
}

/** 그룹 id에서 반복 노드의 이름을 꺼낸다. `pv#2` → `pv` */
function baseOf(group: string): string {
  return group.split("#")[0] ?? group;
}

interface Plan {
  /** 노드 ref → 배치 단위 키 */
  unitOf: Map<string, string>;
  blocks: Map<string, Block>;
}

/**
 * 반복 노드를 블록으로 묶는다.
 *
 * 1:1로 짝지어진 두 배열은 한 블록에 세로로 포갠다 — 모듈 i 바로 아래에 인버터 i가
 * 오면 대응이 눈에 보이고, 둘 사이 도체는 짧은 수직선이 된다.
 */
function planBlocks(g: RenderGraph): Plan {
  const unitOf = new Map<string, string>();
  const blocks = new Map<string, Block>();

  /** 반복 노드 이름 → 묶음별 멤버(선언 순서) */
  const byBase = new Map<string, Map<string, string[]>>();
  for (const n of g.nodes) {
    if (n.group === null) continue;
    const base = baseOf(n.group);
    const chunks = byBase.get(base) ?? byBase.set(base, new Map()).get(base)!;
    (chunks.get(n.group) ?? chunks.set(n.group, []).get(n.group)!).push(n.ref);
  }

  const flat = (base: string): string[] => [...(byBase.get(base)?.values() ?? [])].flat();

  /** base A의 i번째가 base B의 i번째와만 이어지는가 (1:1 대응) */
  const pairsWith = (a: string, b: string): boolean => {
    const A = flat(a);
    const B = flat(b);
    if (A.length !== B.length || A.length === 0) return false;
    const linked = new Set(
      g.edges
        .filter((e) => e.layer === "power")
        .map((e) => `${e.from.nodeRef}|${e.to.nodeRef}`),
    );
    return A.every((ref, i) => linked.has(`${ref}|${B[i]}`));
  };

  const bases = [...byBase.keys()];
  const partner = new Map<string, string>();
  for (const a of bases) {
    for (const b of bases) {
      if (a === b || partner.has(a) || [...partner.values()].includes(b)) continue;
      if (pairsWith(a, b)) partner.set(a, b);
    }
  }

  const consumed = new Set<string>();
  for (const base of bases) {
    if (consumed.has(base)) continue;
    const below = partner.get(base);
    if (below) consumed.add(below);
    consumed.add(base);

    const key = below ? `${base}+${below}` : base;
    const belowFlat = below ? flat(below) : [];
    const rows: string[][][] = [];
    let index = 0;
    for (const members of byBase.get(base)!.values()) {
      // 묶음(분기회로 · 스트링) 하나가 한 행이다. 너무 길면 뱀처럼 접는다.
      for (let start = 0; start < members.length; start += GEO.arrayMaxCols) {
        const slice = members.slice(start, start + GEO.arrayMaxCols);
        const cells = slice.map((ref, k) => {
          const stack = below ? [ref, belowFlat[index + start + k]!] : [ref];
          return stack;
        });
        const serpentine = (start / GEO.arrayMaxCols) % 2 === 1 ? [...cells].reverse() : cells;
        rows.push(serpentine);
      }
      index += members.length;
    }

    const block: Block = { key, rows, depth: below ? 2 : 1 };
    blocks.set(key, block);
    for (const row of rows) for (const cell of row) for (const ref of cell) unitOf.set(ref, key);
  }

  return { unitOf, blocks };
}

/** 배치 단위 키. 블록에 속한 노드는 블록 전체가 한 단위다. */
function unitKeyOf(plan: Plan, ref: string): string {
  return plan.unitOf.get(ref) ?? ref;
}

/**
 * 전력 엣지 기준 최장경로 랭크. 사이클이 있으면 남은 노드를 뒤에 몰아 배치한다.
 * 블록 단위로 축약한 그래프에서 매기고, 결과를 구성원에게 그대로 물려준다.
 */
function computeRanks(g: RenderGraph, plan: Plan): Map<string, number> {
  const units = [...new Set(g.nodes.map((n) => unitKeyOf(plan, n.ref)))];
  const power = g.edges
    .map((e) => ({ e, a: unitKeyOf(plan, e.from.nodeRef), b: unitKeyOf(plan, e.to.nodeRef) }))
    .filter((x) => x.e.layer === "power" && x.a !== x.b);

  const indeg = new Map<string, number>();
  const succ = new Map<string, string[]>();
  for (const u of units) {
    indeg.set(u, 0);
    succ.set(u, []);
  }
  for (const { a, b } of power) {
    succ.get(a)!.push(b);
    indeg.set(b, (indeg.get(b) ?? 0) + 1);
  }

  const rank = new Map<string, number>();
  const queue = units.filter((u) => (indeg.get(u) ?? 0) === 0);
  for (const u of queue) rank.set(u, 0);

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

  // 사이클에 걸려 확정되지 않은 단위 (데이터 오류에 가깝지만 그리기는 해야 한다)
  const maxRank = Math.max(0, ...rank.values());
  for (const u of units) if (!rank.has(u)) rank.set(u, maxRank + 1);

  // 전원(유입 엣지가 없는 단위)을 소비처 바로 위로 끌어내린다.
  for (const u of units) {
    const outs = succ.get(u) ?? [];
    const hasIncoming = power.some((x) => x.b === u);
    if (hasIncoming || outs.length === 0) continue;
    const tight = Math.min(...outs.map((s2) => rank.get(s2) ?? 0)) - 1;
    if (tight > (rank.get(u) ?? 0)) rank.set(u, tight);
  }

  // 비어 버린 랭크는 접는다 (빈 띠가 도면에 남지 않도록)
  const used = [...new Set(rank.values())].sort((a, b) => a - b);
  const remap = new Map(used.map((r, i) => [r, i]));
  for (const [u, r] of rank) rank.set(u, remap.get(r)!);

  const byNode = new Map<string, number>();
  for (const n of g.nodes) byNode.set(n.ref, rank.get(unitKeyOf(plan, n.ref))!);
  return byNode;
}

/** 인접 랭크 사이의 연결. 긴 엣지는 더미를 거쳐 한 칸씩 끊어 둔다. */
interface Segment {
  upper: string;
  lower: string;
  edgeId: string;
}

function buildLayers(g: RenderGraph, plan: Plan, rank: Map<string, number>, lane: ReadonlySet<string>) {
  const power = g.edges.filter((e) => e.layer === "power" && e.from.nodeRef !== e.to.nodeRef);
  /** 같은 랭크 안의 결선 — 직렬 스트링, AC 트렁크, 세로로 포갠 짝. */
  const flat = power.filter((e) => rank.get(e.from.nodeRef) === rank.get(e.to.nodeRef));
  const layered = power.filter((e) => rank.get(e.from.nodeRef) !== rank.get(e.to.nodeRef));

  const depth = Math.max(0, ...rank.values()) + 1;
  const layers: Item[][] = Array.from({ length: depth }, () => []);
  const placed = new Set<string>();
  for (const n of g.nodes) {
    const key = unitKeyOf(plan, n.ref);
    if (placed.has(key)) continue;
    placed.add(key);
    const block = plan.blocks.get(key);
    layers[rank.get(n.ref)!]!.push(
      block ? { kind: "block", key, block } : { kind: "node", key: n.ref },
    );
  }

  const segments: Segment[] = [];
  /** edgeId → 더미 key들(랭크 오름차순) */
  const chains = new Map<string, string[]>();

  for (const e of layered) {
    const r0 = rank.get(e.from.nodeRef)!;
    const r1 = rank.get(e.to.nodeRef)!;
    const step = r1 > r0 ? 1 : -1;
    const far = unitKeyOf(plan, e.to.nodeRef);
    const near = unitKeyOf(plan, e.from.nodeRef);
    // 레인으로 빠지는 엣지는 더미를 만들지 않는다 — 도면을 넓히기만 하고 쓰이지 않는다.
    if (lane.has(e.id)) {
      segments.push(step > 0 ? { upper: near, lower: far, edgeId: e.id } : { upper: far, lower: near, edgeId: e.id });
      chains.set(e.id, []);
      continue;
    }
    const chain: string[] = [];
    let prev = near;
    for (let r = r0 + step; r !== r1; r += step) {
      const key = `~${e.id}#${r}`;
      layers[r]!.push({ kind: "dummy", key, edgeId: e.id });
      chain.push(key);
      segments.push(step > 0 ? { upper: prev, lower: key, edgeId: e.id } : { upper: key, lower: prev, edgeId: e.id });
      prev = key;
    }
    segments.push(
      step > 0 ? { upper: prev, lower: far, edgeId: e.id } : { upper: far, lower: prev, edgeId: e.id },
    );
    chains.set(e.id, chain);
  }

  return { layers, segments, chains, flat, layered };
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
function orthogonal(input: Pt[], jogY?: number): Pt[] {
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
    if (a.x !== b.x && a.y !== b.y) {
      // 가로로 꺾이는 높이는 랭크 사이의 빈 띠(거터)를 쓴다. 중간값으로 꺾으면
      // 도체가 배열 한복판을 가로지른다 — 실제 도면이 어레이를 관통하지 않는 것과 같다.
      const lo = Math.min(a.y, b.y);
      const hi = Math.max(a.y, b.y);
      const my = jogY !== undefined && jogY > lo && jogY < hi ? jogY : (a.y + b.y) / 2;
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
  const plan = planBlocks(g);
  const classOf = (ref: string) => g.byRef.get(ref)!.device.class;
  const memberW = (ref: string) => nodeWidth(classOf(ref));

  const blockCols = (b: Block) => Math.max(...b.rows.map((r) => r.length));
  const blockCellW = (b: Block) =>
    Math.max(...b.rows.flat().flat().map(memberW));
  const blockRowH = (b: Block) => b.depth * GEO.nodeH + (b.depth - 1) * GEO.stackGap;
  const blockW = (b: Block) => blockCols(b) * blockCellW(b) + (blockCols(b) - 1) * GEO.arrayColGap;
  const blockH = (b: Block) => b.rows.length * blockRowH(b) + (b.rows.length - 1) * GEO.arrayRowGap;

  const rank = computeRanks(g, plan);

  /** 여러 행으로 접힌 블록에서 아래 랭크로 빠지는 엣지는 우측 레인을 탄다. */
  const laneEdges = new Set<string>();
  for (const e of g.edges) {
    if (e.layer !== "power") continue;
    const key = unitKeyOf(plan, e.from.nodeRef);
    const block = plan.blocks.get(key);
    if (!block || block.rows.length < 2) continue;
    if (rank.get(e.from.nodeRef) === rank.get(e.to.nodeRef)) continue;
    // 마지막 행에서 나가는 도체는 아래로 가로지를 것이 없다 — 레인까지 돌아갈 이유가 없다.
    const rowIndex = block.rows.findIndex((row) =>
      row.some((cell) => cell.includes(e.from.nodeRef)),
    );
    if (rowIndex === block.rows.length - 1) continue;
    laneEdges.add(e.id);
  }

  const { layers, segments, chains, flat, layered } = buildLayers(g, plan, rank, laneEdges);
  orderLayers(layers, segments);

  /**
   * AC 트렁크에 물린 노드. 이 노드에서 랭크를 넘어 나가는 도체는 노드 바닥이 아니라
   * 버스에서 출발해야 한다 — 그러지 않으면 트렁크와 홈런이 끊어져 보인다.
   */
  const onTrunk = new Set<string>();
  for (const e of flat) {
    if (
      portElectrical(e.from.port.type).domain !== "ac" ||
      portElectrical(e.to.port.type).domain !== "ac"
    )
      continue;
    onTrunk.add(e.from.nodeRef);
    onTrunk.add(e.to.nodeRef);
  }

  // ── 크기 ────────────────────────────────────────────────────
  const widthOf = (it: Item): number => {
    if (it.kind === "dummy") return DUMMY_W;
    if (it.kind === "node") return memberW(it.key);
    return blockW(it.block);
  };
  const heightOf = (it: Item): number => (it.kind === "block" ? blockH(it.block) : GEO.nodeH);
  const rankWidth = (layer: Item[]) =>
    layer.reduce((sum, it) => sum + widthOf(it), 0) + Math.max(0, layer.length - 1) * GEO.colGap;

  /**
   * 블록이 있는 랭크는 블록 구간을 랭크끼리 같은 x에 맞춘다.
   * 랭크마다 따로 가운데 정렬하면 옆에 붙은 함체 하나 때문에 배열이 통째로 어긋난다.
   */
  const segmentsOf = (layer: Item[]) => {
    const first = layer.findIndex((it) => it.kind === "block");
    if (first < 0) return null;
    let last = first;
    layer.forEach((it, i) => {
      if (it.kind === "block") last = i;
    });
    const pre = layer.slice(0, first);
    const span = layer.slice(first, last + 1);
    const post = layer.slice(last + 1);
    const w = (items: Item[]) => (items.length === 0 ? 0 : rankWidth(items) + GEO.colGap);
    return { pre, span, post, preW: w(pre), spanW: rankWidth(span), postW: w(post) };
  };

  const parts = layers.map(segmentsOf);
  const leftMax = Math.max(0, ...parts.map((p) => p?.preW ?? 0));
  const spanMax = Math.max(0, ...parts.map((p) => p?.spanW ?? 0));
  const rightMax = Math.max(0, ...parts.map((p) => p?.postW ?? 0));
  const widest = Math.max(GEO.nodeW, leftMax + spanMax + rightMax, ...layers.map(rankWidth));
  const originX = GEO.margin;
  const originY = GEO.margin;

  /** 랭크마다 높이가 다르다 — 접힌 블록은 여러 행을 차지한다. */
  const rankH = layers.map((layer) => Math.max(GEO.nodeH, ...layer.map(heightOf)));
  const rankY: number[] = [];
  {
    let y = originY;
    for (const h of rankH) {
      rankY.push(y);
      y += h + GEO.rankGap;
    }
  }

  const boxes = new Map<string, { x: number; y: number; w: number; h: number; rank: number }>();
  /** 블록 자체가 차지한 영역 — 레인 x를 잡는 데 쓴다 */
  const blockBox = new Map<string, { x: number; y: number; w: number; h: number }>();

  layers.forEach((layer, r) => {
    const part = parts[r] ?? null;
    const bandY = rankY[r]!;
    const bandH = rankH[r]!;

    const place = (items: Item[], from: number) => {
      let cursor = from;
      for (const it of items) {
        if (it.kind === "block") {
          const b = it.block;
          const cellW = blockCellW(b);
          const rowH = blockRowH(b);
          blockBox.set(it.key, { x: cursor, y: bandY, w: blockW(b), h: blockH(b) });
          b.rows.forEach((row, ri) => {
            const rowY = bandY + ri * (rowH + GEO.arrayRowGap);
            row.forEach((cell, ci) => {
              const cellX = cursor + ci * (cellW + GEO.arrayColGap);
              cell.forEach((ref, di) => {
                boxes.set(ref, {
                  x: cellX + (cellW - memberW(ref)) / 2,
                  y: rowY + di * (GEO.nodeH + GEO.stackGap),
                  w: memberW(ref),
                  h: GEO.nodeH,
                  rank: r,
                });
              });
            });
          });
        } else {
          // 단독 노드는 띠의 아래쪽에 붙인다. 접힌 블록 옆에서 가운데에 두면
          // 그 노드에서 나가는 도체가 배열 행 사이를 지나간다.
          boxes.set(it.key, {
            x: cursor,
            y: bandY + bandH - GEO.nodeH,
            w: widthOf(it),
            h: GEO.nodeH,
            rank: r,
          });
        }
        cursor += widthOf(it) + GEO.colGap;
      }
    };

    if (part === null) {
      place(layer, originX + (widest - rankWidth(layer)) / 2);
      return;
    }
    const spanStart = originX + leftMax + (spanMax - part.spanW) / 2;
    place(part.pre, spanStart - part.preW);
    place(part.span, spanStart);
    place(part.post, spanStart + part.spanW + GEO.colGap);
  });

  const nodes: PlacedNode[] = g.nodes.map((n) => {
    const b = boxes.get(n.ref)!;
    return { ref: n.ref, rank: b.rank, x: b.x, y: b.y, w: b.w, h: b.h };
  });

  const centerOf = (key: string): Pt => {
    const b = boxes.get(key)!;
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  };

  // ── 포트 앵커: 랭크를 넘는 전력선은 상/하단, 통신은 우측 ─────────
  const otherEdges = g.edges.filter((e) => e.layer !== "power");

  const nextX = (e: RGEdge, downward: boolean): number => {
    const chain = chains.get(e.id) ?? [];
    if (downward) return centerOf(chain[0] ?? e.to.nodeRef).x;
    return centerOf(chain[chain.length - 1] ?? e.from.nodeRef).x;
  };

  const anchors = new Map<string, Pt>(); // `${edgeId}|out` / `|in`
  const assign = (side: "out" | "in") => {
    const byNode = new Map<string, RGEdge[]>();
    for (const e of layered) {
      const ref = side === "out" ? e.from.nodeRef : e.to.nodeRef;
      (byNode.get(ref) ?? byNode.set(ref, []).get(ref)!).push(e);
    }
    for (const [ref, list] of byNode) {
      const b = boxes.get(ref)!;
      const sorted = [...list].sort((a, c) => nextX(a, side === "out") - nextX(c, side === "out"));
      const fromBus = side === "out" && onTrunk.has(ref);
      sorted.forEach((e, i) => {
        anchors.set(`${e.id}|${side}`, {
          // 트렁크에 물린 노드는 버스에서 곧장 빠진다. 노드 바닥에서 시작하면
          // 탭과 홈런이 따로 놀아 선이 끊어져 보인다.
          x: fromBus ? b.x + b.w / 2 : b.x + (b.w * (i + 1)) / (sorted.length + 1),
          y: side === "out" ? (fromBus ? b.y + GEO.trunkBusY : b.y + b.h) : b.y,
        });
      });
    }
  };
  assign("out");
  assign("in");

  const routed: RoutedEdge[] = [];
  let laneIndex = 0;
  for (const e of layered) {
    const start = anchors.get(`${e.id}|out`)!;
    const end = anchors.get(`${e.id}|in`)!;
    let points: Pt[];
    if (laneEdges.has(e.id)) {
      /**
       * 접힌 블록에서 나가는 도체는 블록 오른쪽 레인을 타고 내려간다.
       * 곧장 아래로 내리면 아래 행의 모듈들을 가로지른다 — 실제 도면의
       * 홈런 배선이 어레이를 관통하지 않는 것과 같은 이유다.
       */
      const bb = blockBox.get(unitKeyOf(plan, e.from.nodeRef))!;
      const laneX = bb.x + bb.w + GEO.laneGap + laneIndex * 10;
      laneIndex++;
      const drop = Math.min(end.y - 18, bb.y + bb.h + 18);
      points = orthogonal([
        start,
        { x: start.x, y: start.y + 14 },
        { x: laneX, y: start.y + 14 },
        { x: laneX, y: drop },
        { x: end.x, y: drop },
        end,
      ]);
    } else {
      const mids = (chains.get(e.id) ?? []).map(centerOf);
      const rFrom = rank.get(e.from.nodeRef)!;
      const rTo = rank.get(e.to.nodeRef)!;
      const upper = Math.min(rFrom, rTo);
      points = orthogonal([start, ...mids, end], rankY[upper]! + rankH[upper]! + GEO.rankGap / 2);
    }
    routed.push({ edge: e, points, label: labelFor(points, e.conductor) });
  }

  // ── 같은 랭크 안의 결선: 직렬 스트링 · AC 트렁크 · 세로로 포갠 짝 ──
  for (const e of flat) {
    const a = boxes.get(e.from.nodeRef)!;
    const b = boxes.get(e.to.nodeRef)!;
    const [aHalfW, aHalfH] = symbolExtent(classOf(e.from.nodeRef));
    const [bHalfW, bHalfH] = symbolExtent(classOf(e.to.nodeRef));
    const aCx = a.x + a.w / 2;
    const bCx = b.x + b.w / 2;
    const aCy = a.y + GEO.glyphCy;
    const bCy = b.y + GEO.glyphCy;

    const acBoth =
      portElectrical(e.from.port.type).domain === "ac" &&
      portElectrical(e.to.port.type).domain === "ac";

    let points: Pt[];
    if (Math.abs(aCy - bCy) < 1 && acBoth) {
      /**
       * AC 트렁크 — 버스 한 줄에 각 유닛이 짧은 탭으로 내려붙는다.
       *
       * 심볼끼리 수평으로 곧장 이으면 직렬로 읽힌다. 마이크로인버터는 서로 직렬이 아니라
       * 같은 분기회로에 **병렬**로 물린 전류원이고, 도체를 따라 전류가 누적되는 것이지
       * 유닛 출력이 커지는 것이 아니다. 이웃한 탭끼리 버스 구간을 공유하므로
       * 선분이 이어져 한 줄로 보인다.
       */
      const busY = a.y + GEO.trunkBusY;
      points = [
        { x: aCx, y: aCy + aHalfH },
        { x: aCx, y: busY },
        { x: bCx, y: busY },
        { x: bCx, y: bCy + bHalfH },
      ];
    } else if (Math.abs(aCy - bCy) < 1) {
      // 같은 행의 DC 직렬 스트링 — 심볼 옆구리끼리 곧장 잇는다. 실제로 직렬이다.
      const forward = a.x <= b.x;
      points = [
        { x: aCx + (forward ? aHalfW : -aHalfW), y: aCy },
        { x: bCx + (forward ? -bHalfW : bHalfW), y: bCy },
      ];
    } else if (Math.abs(aCx - bCx) < 1) {
      // 세로로 포갠 짝, 또는 접힌 행의 이음매 — 짧은 수직선
      const down = aCy < bCy;
      points = [
        { x: aCx, y: aCy + (down ? aHalfH : -aHalfH) },
        { x: bCx, y: bCy + (down ? -bHalfH : bHalfH) },
      ];
    } else {
      const down = aCy < bCy;
      points = orthogonal([
        { x: aCx, y: aCy + (down ? aHalfH : -aHalfH) },
        { x: bCx, y: bCy + (down ? -bHalfH : bHalfH) },
      ]);
    }
    routed.push({ edge: e, points, label: null });
  }

  // ── 통신/물리 레이어 ─────────────────────────────────────────
  const drawingRight = originX + widest;
  const drawingBottom = rankY[rankY.length - 1]! + (rankH[rankH.length - 1] ?? GEO.nodeH);

  const sideUsed = new Map<string, number>();
  const side = (ref: string, lane: number, dir: 1 | -1) => {
    const b = boxes.get(ref)!;
    const i = sideUsed.get(ref) ?? 0;
    sideUsed.set(ref, i + 1);
    const [halfW] = symbolExtent(classOf(ref));
    return {
      edge: b.x + b.w / 2 + dir * halfW,
      stub: dir > 0 ? b.x + b.w + GEO.commsStub + lane * 6 : b.x - GEO.commsStub - lane * 6,
      y: b.y + GEO.glyphCy + i * 7,
      gutterY: b.y + b.h + 12,
      rank: b.rank,
      cx: b.x + b.w / 2,
    };
  };

  const adjacentInRank = (p: string, q: string): boolean => {
    const a = boxes.get(p)!;
    const b = boxes.get(q)!;
    if (a.rank !== b.rank || Math.abs(a.y - b.y) > 1) return false;
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    return !g.nodes.some((n) => {
      const o = boxes.get(n.ref)!;
      return o.rank === a.rank && Math.abs(o.y - a.y) < 1 && o.x > lo && o.x < hi;
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

  for (const r of routed) for (const p of r.points) maxX = Math.max(maxX, p.x);

  if (minX < originX) {
    const shift = originX - minX;
    for (const n of nodes) n.x += shift;
    for (const [, b] of boxes) b.x += shift;
    for (const r of routed) for (const p of r.points) p.x += shift;
    maxX += shift;
  }

  // ── 포트 단자: 도체가 제품을 떠나는 지점 ─────────────────────
  const portAcc = new Map<string, { ref: string; portId: string; pts: Pt[] }>();
  const addPort = (ref: string, portId: string, p: Pt) => {
    const key = `${ref}.${portId}`;
    const entry = portAcc.get(key) ?? portAcc.set(key, { ref, portId, pts: [] }).get(key)!;
    entry.pts.push(p);
  };
  for (const r of routed) {
    addPort(r.edge.from.nodeRef, r.edge.from.portId, r.points[0]!);
    addPort(r.edge.to.nodeRef, r.edge.to.portId, r.points[r.points.length - 1]!);
  }
  const ports: PlacedPort[] = [...portAcc.values()].map((p) => ({
    ref: p.ref,
    portId: p.portId,
    x: p.pts.reduce((s, q) => s + q.x, 0) / p.pts.length,
    y: p.pts.reduce((s, q) => s + q.y, 0) / p.pts.length,
  }));

  return {
    nodes,
    trunkRefs: [...onTrunk].sort(),
    ports,
    edges: routed,
    drawing: { x: originX, y: originY, w: widest, h: drawingBottom - originY },
    width: maxX + GEO.margin,
    height: maxY + GEO.margin,
  };
}
