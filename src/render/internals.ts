import type { Device } from "../schema/device.js";
import type { InternalBlock, InternalLink } from "../schema/internals.js";
import { GEO, STROKE, THEME } from "./theme.js";

/**
 * 함체 내부 블록도.
 *
 * 단선도가 아니다 — 단선도는 한 함체를 한 상자로 그리는 것이 정의다.
 * 이것은 그 상자 안을 여는 별도의 그림이고, 전력 조류도 룰 판정도 이 그림을 보지 않는다.
 *
 * 도면 규칙은 그대로 따른다: 종이 배경, 잉크 한 색, 함체 경계는 파선.
 * 벤더로 분기하지 않는다 — 블록의 kind만 보고 그린다.
 */

const BOX_W = 156;
const BOX_H = 54;
const COL_GAP = 44;
const ROW_GAP = 16;
const PAD = 20;
const HEAD = 26;

/** kind → 상자 안에 적을 한 글자짜리 구분. 아이콘 세트를 쓰지 않는다. */
const KIND_LABEL: Record<string, string> = {
  converter: "변환",
  cells: "셀",
  breaker: "차단",
  lug: "러그",
  busbar: "모선",
  meter: "계측",
  contactor: "접점",
  controller: "제어",
  other: "",
};

/** 링크를 따라 좌→우 랭크를 매긴다. 순환이 있어도 멈춘다. */
function rankBlocks(blocks: InternalBlock[], links: InternalLink[]): Map<string, number> {
  const rank = new Map<string, number>(blocks.map((b) => [b.id, 0]));
  for (let pass = 0; pass < blocks.length; pass++) {
    let moved = false;
    for (const l of links) {
      const from = rank.get(l.from);
      const to = rank.get(l.to);
      if (from === undefined || to === undefined) continue;
      if (to <= from) {
        rank.set(l.to, from + 1);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return rank;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 상자에 적을 둘째 줄. 값이 없으면 "미확인"이라고 쓴다 — 빈칸은 0으로 읽힌다. */
function metaOf(b: InternalBlock): string {
  const rated = b.kind === "breaker" || b.kind === "busbar";
  const countUnknown = b.count === null;
  const ratingUnknown = rated && b.ocpd_a === null;
  // 상자 폭이 좁다. "수량 미확인 · 정격 미확인"처럼 늘어놓지 않고 한 마디로 묶는다.
  if (countUnknown && ratingUnknown) return "수량·정격 미확인";
  const parts: string[] = [];
  if (countUnknown) parts.push("수량 미확인");
  else if (b.count !== null && b.count > 1) parts.push(`×${b.count}`);
  if (rated) parts.push(b.ocpd_a === null ? "정격 미확인" : `${b.ocpd_a} A`);
  return parts.join(" · ");
}

export function renderInternals(device: Device, opts: { date?: string } = {}): string | null {
  const internals = device.internals;
  if (internals === null) return null;

  const blocks = internals.blocks;
  const rank = rankBlocks(blocks, internals.links);
  const cols = new Map<number, InternalBlock[]>();
  for (const b of blocks) {
    const r = rank.get(b.id) ?? 0;
    (cols.get(r) ?? cols.set(r, []).get(r)!).push(b);
  }

  const colKeys = [...cols.keys()].sort((a, b) => a - b);
  const rows = Math.max(...colKeys.map((k) => cols.get(k)!.length));
  const w = PAD * 2 + colKeys.length * BOX_W + (colKeys.length - 1) * COL_GAP;
  const h = PAD * 2 + HEAD + rows * BOX_H + (rows - 1) * ROW_GAP;

  const at = new Map<string, { x: number; y: number }>();
  for (const [ci, key] of colKeys.entries()) {
    const list = cols.get(key)!;
    const colH = list.length * BOX_H + (list.length - 1) * ROW_GAP;
    const top = PAD + HEAD + (h - PAD * 2 - HEAD - colH) / 2;
    for (const [ri, b] of list.entries()) {
      at.set(b.id, { x: PAD + ci * (BOX_W + COL_GAP), y: top + ri * (BOX_H + ROW_GAP) });
    }
  }

  const body: string[] = [];

  // 함체 경계 — 파선. 이 상자가 단선도에서는 한 노드였다.
  body.push(
    `<rect class="case" x="8" y="8" width="${w - 16}" height="${h - 16}" rx="3"/>`,
    `<text class="case-label" x="18" y="26">${esc(device.display_name)} — 함체 내부</text>`,
  );

  for (const l of internals.links) {
    const a = at.get(l.from);
    const b = at.get(l.to);
    if (!a || !b) continue;
    const x1 = a.x + BOX_W;
    const y1 = a.y + BOX_H / 2;
    const x2 = b.x;
    const y2 = b.y + BOX_H / 2;
    const mid = (x1 + x2) / 2;
    body.push(
      `<path class="link ${l.domain}" d="M ${x1} ${y1} H ${mid} V ${y2} H ${x2}"/>`,
    );
  }

  for (const b of blocks) {
    const p = at.get(b.id)!;
    const meta = metaOf(b);
    body.push(
      `<g>`,
      `<rect class="block" x="${p.x}" y="${p.y}" width="${BOX_W}" height="${BOX_H}"/>`,
      `<text class="kind" x="${p.x + 8}" y="${p.y + 14}">${esc(KIND_LABEL[b.kind] ?? "")}</text>`,
      `<text class="name" x="${p.x + BOX_W / 2}" y="${p.y + 33}" text-anchor="middle">${esc(b.display_name)}</text>`,
      meta === ""
        ? ""
        : `<text class="meta" x="${p.x + BOX_W / 2}" y="${p.y + 47}" text-anchor="middle">${esc(meta)}</text>`,
      b.port === null
        ? ""
        : `<text class="port" x="${p.x + BOX_W - 8}" y="${p.y + 14}" text-anchor="end">${esc(b.port)}</text>`,
      `</g>`,
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" `,
    `preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(device.display_name)} 함체 내부 구성">`,
    `<title>${esc(device.display_name)} — 함체 내부 구성</title>`,
    `<style>`,
    `.bg { fill: ${THEME.bg}; }`,
    `.case { fill: none; stroke: ${THEME.rule}; stroke-width: 1; stroke-dasharray: 5 4; }`,
    `.block { fill: ${THEME.bg}; stroke: ${THEME.ink}; stroke-width: ${STROKE.symbol}; }`,
    `.link { fill: none; stroke: ${THEME.ink}; stroke-width: ${STROKE.power}; }`,
    `.link.signal { stroke-width: ${STROKE.comms}; stroke-dasharray: 4 3; }`,
    `.link.dc { stroke-width: ${STROKE.power}; }`,
    `text { font-family: ${THEME.font}; fill: ${THEME.ink}; }`,
    `.case-label { font-size: ${GEO.fontMeta}px; fill: ${THEME.inkSoft}; }`,
    `.name { font-size: ${GEO.fontLabel}px; }`,
    `.kind, .meta, .port { font-size: ${GEO.fontEdge}px; fill: ${THEME.inkSoft}; }`,
    `</style>`,
    `<rect class="bg" x="0" y="0" width="${w}" height="${h}"/>`,
    ...body,
    `</svg>`,
  ].join("");
}
