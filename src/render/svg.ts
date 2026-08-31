import type { Device } from "../schema/device.js";
import type { Layer } from "../schema/common.js";
import type { Topology } from "../schema/topology.js";
import { buildRenderGraph, edgeState, nodeState, type EnergizationMap, type RenderGraph } from "./graph.js";
import { layoutGraph, type Layout, type Pt, type RoutedEdge } from "./layout.js";
import { symbolFor } from "./symbols.js";
import { GEO, STROKE, THEME } from "./theme.js";
import { esc, textWidth, wrap } from "./text.js";

export interface RenderOptions {
  /** 그릴 레이어. UI 토글이 붙기 전까지는 인자로 받는다. */
  layers?: readonly Layer[];
  /** 엣지 급전 상태. 스프린트 2 시나리오 엔진의 출력이 그대로 들어온다. */
  energization?: EnergizationMap;
  /** 제목란에 찍을 날짜. 미지정이면 표기하지 않는다(출력 결정론 유지). */
  date?: string | null;
  /** 시나리오 이름(제목란 표기용). 스프린트 1에서는 계통 정상 상태만 그린다. */
  scenario?: string | null;
}

const DISCLAIMER =
  "교육 및 비교 목적의 구성 도면이다. 퍼밋 도면·PE 날인 설계·시공 근거로 사용할 수 없다. 정격과 결선은 제조사 매뉴얼 원문 대조 전 값이다.";

function path(points: Pt[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${round(p.x)} ${round(p.y)}`).join(" ");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function styles(): string {
  return `
  .bg { fill: ${THEME.bg}; }
  .grid-minor { stroke: ${THEME.gridMinor}; stroke-width: 0.5; }
  .grid-major { stroke: ${THEME.gridMajor}; stroke-width: 0.7; }
  text { font-family: ${THEME.font}; fill: ${THEME.ink}; }
  .label { font-size: ${GEO.fontLabel}px; }
  .meta, .edge-label { font-size: ${GEO.fontMeta}px; fill: ${THEME.inkSoft}; }
  .title { font-size: 15px; }
  .title-meta { font-size: 11px; fill: ${THEME.inkSoft}; }
  .disclaimer { font-size: 10px; fill: ${THEME.inkSoft}; }
  .sym, .sym-bus { fill: none; stroke: ${THEME.ink}; stroke-width: ${STROKE.symbol};
                   stroke-linecap: round; stroke-linejoin: round; }
  .sym-bus { stroke-width: 3; }
  .sym-dot { fill: ${THEME.ink}; stroke: none; }
  .conductor { fill: none; stroke: ${THEME.ink}; stroke-linecap: square; stroke-linejoin: miter; }
  .conductor.power { stroke-width: ${STROKE.power}; }
  .conductor.comms { stroke-width: ${STROKE.comms}; stroke-dasharray: 5 4; }
  .conductor.physical { stroke-width: ${STROKE.physical}; stroke-dasharray: 1 4; }
  .dead .sym, .dead .sym-bus, .dead .sym-dot, .dead text { stroke: ${THEME.dead}; }
  .dead .sym-dot { fill: ${THEME.dead}; }
  .dead text { fill: ${THEME.dead}; stroke: none; }
  .conductor.dead { stroke: ${THEME.dead}; }
  .edge-label.dead { fill: ${THEME.dead}; }
  .rule { stroke: ${THEME.rule}; stroke-width: 0.8; }
  .halo { fill: ${THEME.bg}; stroke: none; }`;
}

function background(w: number, h: number): string {
  return `<defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path class="grid-minor" d="M 8 0 V 40 M 16 0 V 40 M 24 0 V 40 M 32 0 V 40 M 0 8 H 40 M 0 16 H 40 M 0 24 H 40 M 0 32 H 40" fill="none"/>
      <path class="grid-major" d="M 0 0 V 40 M 0 0 H 40" fill="none"/>
    </pattern>
  </defs>
  <rect class="bg" x="0" y="0" width="${w}" height="${h}"/>
  <rect x="0" y="0" width="${w}" height="${h}" fill="url(#grid)"/>`;
}

function renderEdge(r: RoutedEdge, state: "live" | "dead"): string {
  const cls = `conductor ${r.edge.layer} ${state}`;
  // data-edge는 스프린트 2 이후 UI가 엣지를 집어내는 손잡이다.
  const line = `<path data-edge="${esc(r.edge.id)}" class="${cls}" d="${path(r.points)}"/>`;
  if (!r.label) return line;
  const w = textWidth(r.label.text, GEO.fontEdge);
  const lx = r.label.anchor === "middle" ? r.label.x - w / 2 : r.label.x;
  const halo = `<rect class="halo" x="${round(lx - 3)}" y="${round(r.label.y - GEO.fontEdge)}" width="${round(w + 6)}" height="${GEO.fontEdge + 4}"/>`;
  const text = `<text class="edge-label ${state}" x="${round(r.label.x)}" y="${round(r.label.y)}" text-anchor="${r.label.anchor}">${esc(r.label.text)}</text>`;
  return `${line}${halo}${text}`;
}

function renderNode(g: RenderGraph, layout: Layout, ref: string, state: "live" | "dead"): string {
  const node = g.byRef.get(ref)!;
  const box = layout.nodes.find((n) => n.ref === ref)!;
  const cx = box.x + box.w / 2;
  const glyphCy = box.y + GEO.glyphCy;

  const labelLines = wrap(node.label, GEO.fontLabel, box.w - 8, 2);
  const metaBits: string[] = [];
  if (node.count > 1) metaBits.push(`×${node.count}`);
  if (node.meta) metaBits.push(node.meta);
  const metaText = metaBits.join("  ·  ");

  // 심볼 아래 남는 절반에 텍스트 덩어리를 세로 중앙 정렬한다.
  const blockH = labelLines.length * 15 + (metaText ? 13 : 0);
  const textTop = box.y + box.h / 2 + (box.h / 2 - blockH) / 2;

  // 노드에는 배경판을 깔지 않는다 — 카드처럼 보이지 않게(CLAUDE.md §6).
  // 배치가 도체를 노드 위로 지나가게 하지 않으므로 가릴 것도 없다.
  const parts: string[] = [];
  parts.push(`<g class="node ${state}" data-ref="${esc(ref)}" data-class="${esc(node.device.class)}">`);
  parts.push(`<g transform="translate(${round(cx)} ${round(glyphCy)})">${symbolFor(node.device.class)}</g>`);

  let baseline = textTop + 11;
  for (const line of labelLines) {
    parts.push(
      `<text class="label" x="${round(cx)}" y="${round(baseline)}" text-anchor="middle">${esc(line)}</text>`,
    );
    baseline += 15;
  }
  if (metaText) {
    parts.push(
      `<text class="meta" x="${round(cx)}" y="${round(baseline)}" text-anchor="middle">${esc(metaText)}</text>`,
    );
  }
  parts.push("</g>");
  return parts.join("");
}

/** 범례는 가로 한 줄. 좁은 캔버스에서도 제목과 겹치지 않는다. */
function legend(x: number, y: number, layers: readonly Layer[]): string {
  const items: Array<[string, string]> = [["power", "전력 회로"]];
  if (layers.includes("comms")) items.push(["comms", "통신 · CT"]);
  if (layers.includes("physical")) items.push(["physical", "물리 배치"]);
  items.push(["dead", "사선(비급전)"]);

  let cursor = x;
  return items
    .map(([kind, label]) => {
      const cls = kind === "dead" ? "conductor power dead" : `conductor ${kind}`;
      const sample = `<path class="${cls}" d="M ${round(cursor)} ${y} L ${round(cursor + 22)} ${y}"/>`;
      const text = `<text class="title-meta" x="${round(cursor + 28)}" y="${y + 3.5}">${esc(label)}</text>`;
      cursor += 28 + textWidth(label, 11) + 20;
      return sample + text;
    })
    .join("");
}

/** 제목란(title block). 높이는 disclaimer 줄 수에 따라 달라진다. */
function titleBlock(
  t: Topology,
  width: number,
  top: number,
  opts: RenderOptions,
  layers: readonly Layer[],
): { markup: string; height: number } {
  const x = GEO.margin;
  const right = width - GEO.margin;
  const avail = right - x;

  const scopeLabel = { none: "백업 없음", partial: "부분 백업", whole_home: "전체 백업" }[t.backup_scope];
  const line2 = [t.id, t.vendor, scopeLabel, t.status === "draft" ? "draft — 대외 인용 금지" : "verified"].join("  ·  ");
  const line3 = [
    `노드 ${t.nodes.length}`,
    `엣지 ${t.edges.length}`,
    `레이어 ${layers.join("/")}`,
    opts.scenario ? `시나리오 ${opts.scenario}` : "시나리오 grid_normal",
    opts.date ? `작성 ${opts.date}` : null,
  ]
    .filter((s): s is string => s !== null)
    .join("  ·  ");

  const titleLines = wrap(t.display_name, 15, avail, 2);
  const metaLines = [line2, line3].flatMap((l) => wrap(l, 11, avail, 2));
  const notice = wrap(DISCLAIMER, 10, avail, 4);

  const parts: string[] = [`<path class="rule" d="M ${x} ${round(top)} L ${round(right)} ${round(top)}"/>`];
  let y = top + 22;
  for (const line of titleLines) {
    parts.push(`<text class="title" x="${x}" y="${round(y)}">${esc(line)}</text>`);
    y += 19;
  }
  y += 1;
  for (const line of metaLines) {
    parts.push(`<text class="title-meta" x="${x}" y="${round(y)}">${esc(line)}</text>`);
    y += 15;
  }
  y += 6;
  parts.push(legend(x, round(y), layers));
  y += 14;
  parts.push(`<path class="rule" d="M ${x} ${round(y)} L ${round(right)} ${round(y)}"/>`);
  y += 15;
  for (const line of notice) {
    parts.push(`<text class="disclaimer" x="${x}" y="${round(y)}">${esc(line)}</text>`);
    y += 13;
  }

  return { markup: parts.join("\n  "), height: y - top + 4 };
}

/** topology 하나를 단선도 SVG 문자열로 만든다. */
export function renderTopology(topology: Topology, devices: Device[], opts: RenderOptions = {}): string {
  const layers = opts.layers ?? (["power", "comms"] as const);
  const energization = opts.energization ?? {};
  const graph = buildRenderGraph(topology, devices, layers);
  const layout = layoutGraph(graph);

  const body: string[] = [];
  // 통신 → 전력 순서로 깔아 전력 회로가 위에 오게 한다.
  for (const r of layout.edges.filter((e) => e.edge.layer !== "power")) {
    body.push(renderEdge(r, edgeState(r.edge, energization)));
  }
  for (const r of layout.edges.filter((e) => e.edge.layer === "power")) {
    body.push(renderEdge(r, edgeState(r.edge, energization)));
  }
  for (const n of graph.nodes) {
    body.push(renderNode(graph, layout, n.ref, nodeState(graph, n.ref, energization)));
  }

  const w = round(layout.width);
  const block = titleBlock(topology, layout.width, layout.height, opts, layers);
  const h = round(layout.height + block.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(topology.display_name)} 단선도">
  <title>${esc(topology.display_name)} — 단선도</title>
  <style>${styles()}</style>
  ${background(w, h)}
  ${body.join("\n  ")}
  ${block.markup}
</svg>
`;
}
