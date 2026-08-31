import type { Device } from "../schema/device.js";
import type { Topology } from "../schema/topology.js";
import type { Scenario } from "../schema/scenario.js";
import { EMPTY_SITE, type SiteContext } from "../schema/rule.js";
import { buildRenderGraph, type RenderGraph, type RGNode } from "../graph/index.js";
import { evaluateScenario } from "../scenario/index.js";
import { runRules } from "../rules/engine.js";

/**
 * 벤더별 구성 비교. CLAUDE.md §3.3의 핵심 산출물이다 —
 * "동일 스키마로 표현되는 순간 부품 수 / 서브패널 필요 여부 / 결선 포인트 수가 자동으로 비교된다."
 *
 * 여기서 계산하는 값은 전부 스키마에서 도출된다. 벤더별 예외 항목은 없다.
 * 값이 없으면 빈칸이 아니라 "미확인"으로 나온다 — 빈칸은 0으로 읽힌다.
 */

export const UNKNOWN = "미확인";

export interface CompareColumn {
  id: string;
  vendor: string;
  display_name: string;
  draft: boolean;
}

export interface CompareRow {
  key: string;
  label: string;
  /** 열 순서는 columns와 같다. */
  cells: string[];
  /** 이 행에서 값이 갈리는가. 비교 모드의 요점이다. */
  differs: boolean;
}

export interface Comparison {
  columns: CompareColumn[];
  rows: CompareRow[];
  /** 비교에 쓴 시나리오 id. 급전 관련 행의 기준이다. */
  scenario_id: string | null;
  notes: string[];
}

export interface CompareOptions {
  site?: SiteContext;
  /** 급전 비교에 쓸 시나리오. 없으면 급전 관련 행이 빠진다. */
  scenario?: Scenario;
}

/** 집에 이미 있는 설비. 설치 부품 수에서 뺀다. */
const PREEXISTING_CLASSES: ReadonlySet<string> = new Set(["service_point", "main_panel"]);

const SUBPANEL_ORDER = ["yes", "conditional", "unknown", "no"] as const;
const SUBPANEL_LABEL: Record<string, string> = {
  yes: "필요",
  conditional: "조건부",
  unknown: UNKNOWN,
  no: "불필요",
};

interface Ctx {
  topology: Topology;
  graph: RenderGraph;
}

export function compareTopologies(
  topologies: Topology[],
  devices: Device[],
  opts: CompareOptions = {},
): Comparison {
  const site = opts.site ?? EMPTY_SITE;
  const ctxs: Ctx[] = topologies.map((t) => ({
    topology: t,
    graph: buildRenderGraph(t, devices, ["power", "comms", "physical"]),
  }));

  const rows: CompareRow[] = [];
  const add = (key: string, label: string, fn: (c: Ctx) => string) => {
    const cells = ctxs.map(fn);
    rows.push({ key, label, cells, differs: new Set(cells).size > 1 });
  };

  add("vendor", "벤더", (c) => c.topology.vendor);
  add("backup_scope", "백업 범위", (c) => backupScope(c.topology));
  add("coupling", "결합 방식", (c) => coupling(c.graph));
  add("parts", "설치 부품 수", (c) => `${installedParts(c.graph)}종`);
  add("nodes", "노드 수", (c) => `${c.graph.nodes.length}`);
  add("power_edges", "전력 결선 포인트", (c) => `${count(c, "power")}`);
  add("comms_edges", "통신 결선 포인트", (c) => `${count(c, "comms")}`);
  add("mid", "MID 제공", (c) => midSummary(c.graph));
  add("subpanel", "백업 서브패널", (c) => subpanel(c.graph));
  add("continuous", "연속 출력", (c) => continuousOutput(c.graph));
  add("energy", "축전지 용량", (c) => energy(c.graph));
  add("lra", "기동 정격(LRA)", (c) => lra(c.graph));

  if (opts.scenario) {
    const sc = opts.scenario;
    add("energized", `${sc.display_name} 활선 비율`, (c) => {
      const r = evaluateScenario(c.topology, devices, sc);
      const live = Object.values(r.energization).filter((v) => v === "live").length;
      return `${live}/${Object.keys(r.energization).length}`;
    });
    add("island", `${sc.display_name} 아일랜드 형성`, (c) => {
      const r = evaluateScenario(c.topology, devices, sc);
      return r.injectors.length > 0 ? r.injectors.join(", ") : "형성 안 됨";
    });
  }

  add("rule_warnings", "룰 경고", (c) => {
    const r = runRules(c.topology, devices, site);
    const n = r.findings.filter((f) => f.severity === "warning").length;
    const u = r.findings.filter((f) => f.code.includes(".") && f.severity === "info").length;
    return `${n}건 (판정 보류 ${u})`;
  });
  add("todos", "미해결 TODO", (c) => {
    const dev = new Set(c.topology.nodes.map((n) => n.device));
    const deviceTodos = devices.filter((d) => dev.has(d.id)).reduce((n, d) => n + d.todos.length, 0);
    return `${c.topology.todos.length + deviceTodos}건`;
  });

  return {
    columns: ctxs.map((c) => ({
      id: c.topology.id,
      vendor: c.topology.vendor,
      display_name: c.topology.display_name,
      draft: c.topology.status === "draft",
    })),
    rows,
    scenario_id: opts.scenario?.id ?? null,
    notes: buildNotes(ctxs),
  };
}

function count(c: Ctx, layer: string): number {
  return c.topology.edges.filter((e) => e.layer === layer).length;
}

function backupScope(t: Topology): string {
  return { none: "없음", partial: "부분", whole_home: "전체" }[t.backup_scope];
}

/**
 * PV가 어디서 AC로 바뀌는가. 모듈 단위면 AC 결합, 스트링이 인버터 DC 입력으로 가면 DC 결합.
 * 제품명이 아니라 연결 구조에서 나온다.
 */
function coupling(g: RenderGraph): string {
  const pvEdges = g.edges.filter(
    (e) =>
      e.layer === "power" &&
      [e.from, e.to].some((end) => g.byRef.get(end.nodeRef)?.device.class === "pv_module"),
  );
  if (pvEdges.length === 0) return "PV 없음";

  const targets = new Set<string>();
  for (const e of pvEdges) {
    for (const end of [e.from, e.to]) {
      const cls = g.byRef.get(end.nodeRef)?.device.class;
      if (cls !== undefined && cls !== "pv_module") targets.add(cls);
    }
  }
  if (targets.has("microinverter")) return targets.size > 1 ? "AC + DC 결합" : "AC 결합 (모듈 단위)";
  if (targets.has("string_inverter") || targets.has("hybrid_inverter_battery")) return "DC 결합 (스트링)";
  return UNKNOWN;
}

/** 집에 없던 것 중 설치해야 하는 제품 종류 수. PV 모듈은 어느 구성에나 있으므로 함께 센다. */
function installedParts(g: RenderGraph): number {
  return g.nodes.filter((n) => !PREEXISTING_CLASSES.has(n.device.class)).length;
}

function midSummary(g: RenderGraph): string {
  const providers = g.nodes.filter((n) => n.device.provides_mid === true);
  if (providers.length > 0) {
    return providers
      .map((n) => `${n.label}${n.device.class === "mid" ? " (별도 장치)" : " (내장)"}`)
      .join(", ");
  }
  return g.nodes.some((n) => n.device.provides_mid === null) ? `${UNKNOWN} (미확정)` : "없음";
}

function subpanel(g: RenderGraph): string {
  const values = g.nodes
    .filter((n) => !PREEXISTING_CLASSES.has(n.device.class))
    .map((n) => n.device.needs_backup_subpanel);
  for (const level of SUBPANEL_ORDER) {
    if (values.includes(level)) return SUBPANEL_LABEL[level] ?? UNKNOWN;
  }
  return UNKNOWN;
}

/** 정격 합산. kW와 kVA는 섞지 않는다 — 역률 없이 환산하면 없는 정보를 만드는 것이다. */
function continuousOutput(g: RenderGraph): string {
  const sources = g.nodes.filter((n) => isSource(n));
  if (sources.length === 0) return "전원 없음";
  const kw = sum(sources, (n) => n.device.ratings.continuous_ac_kw);
  const kva = sum(sources, (n) => n.device.ratings.continuous_ac_kva);
  const parts: string[] = [];
  if (kw !== null) parts.push(`${round(kw)} kW`);
  if (kva !== null) parts.push(`${round(kva)} kVA`);
  const unrated = sources.filter(
    (n) => n.device.ratings.continuous_ac_kw === null && n.device.ratings.continuous_ac_kva === null,
  ).length;
  if (parts.length === 0) return UNKNOWN;
  return unrated > 0 ? `${parts.join(" + ")} (미기재 ${unrated}건 제외)` : parts.join(" + ");
}

function energy(g: RenderGraph): string {
  const v = sum(g.nodes.filter(isSource), (n) => n.device.ratings.usable_energy_kwh);
  return v === null ? UNKNOWN : `${round(v)} kWh`;
}

function lra(g: RenderGraph): string {
  const values = g.nodes.filter(isSource).map((n) => n.device.ratings.lra).filter((v): v is number => v !== null);
  return values.length === 0 ? UNKNOWN : `${Math.max(...values)}`;
}

function isSource(n: RGNode): boolean {
  return ["microinverter", "string_inverter", "hybrid_inverter_battery", "ac_battery"].includes(
    n.device.class,
  );
}

function sum(nodes: RGNode[], pick: (n: RGNode) => number | null): number | null {
  let total = 0;
  let any = false;
  for (const n of nodes) {
    const v = pick(n);
    if (v === null) continue;
    total += v * n.count;
    any = true;
  }
  return any ? total : null;
}

const round = (n: number): string => (Number.isInteger(n) ? `${n}` : n.toFixed(2).replace(/0$/, ""));

function buildNotes(ctxs: Ctx[]): string[] {
  const notes: string[] = [];
  const drafts = ctxs.filter((c) => c.topology.status === "draft").map((c) => c.topology.id);
  if (drafts.length > 0) {
    notes.push(`draft 구성 ${drafts.length}건 — 대외 인용 금지: ${drafts.join(", ")}`);
  }
  const unknownMid = ctxs
    .filter((c) => c.graph.nodes.every((n) => n.device.provides_mid !== true))
    .map((c) => c.topology.id);
  if (unknownMid.length > 0) {
    notes.push(`MID 미확정 ${unknownMid.length}건 — 아일랜드 경계 비교가 성립하지 않는다: ${unknownMid.join(", ")}`);
  }
  notes.push(
    "예상 노무시간은 모델링하지 않았다. 결선 포인트 수가 대리 지표이나 시공 시간과 선형 관계가 아니다",
  );
  return notes;
}

/** 마크다운 표. CLI와 (앞으로의) UI가 같은 데이터를 쓴다. */
export function toMarkdown(c: Comparison, opts: { onlyDiffs?: boolean } = {}): string {
  const rows = opts.onlyDiffs ? c.rows.filter((r) => r.differs) : c.rows;
  const head = ["", ...c.columns.map((col) => `${col.vendor}${col.draft ? " *" : ""}`)];
  const lines = [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${[r.differs ? `**${r.label}**` : r.label, ...r.cells].join(" | ")} |`),
  ];
  return lines.join("\n");
}
