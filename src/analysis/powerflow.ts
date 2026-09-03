import type { Finding } from "../schema/common.js";
import type { Scenario } from "../schema/scenario.js";
import type { SiteContext } from "../schema/rule.js";
import { edgeState, type EnergizationMap, type RenderGraph, type RGEdge, type RGNode } from "../graph/index.js";
import { portElectrical, type Domain } from "../schema/electrical.js";
import type { OperatingPoint } from "./operating-point.js";

/**
 * 전력 조류 — (그래프, 시나리오, 동작점) => 엣지별 유효전력(kW).
 *
 * 순수 함수다. 부하조류 해석(load flow)이 아니라 **전력 수지**다: 임피던스도,
 * 전압 강하도, 무효전력도 풀지 않는다. 각 전원의 출력을 정하고, 그 전력이
 * 부하 지점까지 가는 경로 위 도체에 더한다. 그것으로 각 지점의 전류가 나온다.
 *
 * 이 한계는 화면에 그대로 표기된다 — 계산이 아는 것보다 더 말하지 않는다.
 */

/** 엣지 id → 유효전력(kW). 양수면 edge.from → edge.to 방향. */
export type EdgePower = Readonly<Record<string, number>>;

type PortDomain = Domain;

export interface PowerFlowResult {
  edges: EdgePower;
  /** 부하가 걸린 노드 (계산의 싱크). 백업 경계 밖이 죽으면 서브패널로 옮겨간다. */
  load_node: string | null;
  load_kw: number;
  /** 부하 지점에 도달한 PV 발전(kW, 변환 손실 반영 후) */
  pv_kw: number;
  /** 축전지 순 출력(kW). 음수면 충전 */
  battery_kw: number;
  /** 계통 순 수전(kW). 음수면 수출 */
  grid_kw: number;
  /** 아일랜드 수급 한계로 버린 PV(kW) */
  curtailed_kw: number;
  /** 인버터 AC 정격에서 잘린 PV(kW). DC/AC 비가 1을 넘으면 여기서 손실이 난다 */
  clipped_kw: number;
  findings: Finding[];
}

const INVERTER_CLASSES = new Set([
  "microinverter",
  "string_inverter",
  "hybrid_inverter_battery",
  "ac_battery",
]);
const BATTERY_CLASSES = new Set(["ac_battery", "hybrid_inverter_battery", "dc_battery"]);
/** 일사를 전력으로 바꾸는 클래스. */
const PV_CLASSES = new Set(["pv_module"]);

function isLive(e: RGEdge, energization: EnergizationMap | null): boolean {
  return energization === null || edgeState(e, energization) === "live";
}

/** 변환기의 연속 AC 출력 한계(kW). kVA만 있으면 역률 가정으로 환산한다. */
function acRateKw(node: RGNode, pf: number): number | null {
  const r = node.device.ratings;
  if (r.continuous_ac_kw !== null) return r.continuous_ac_kw;
  if (r.continuous_ac_kva !== null) return r.continuous_ac_kva * pf;
  return null;
}

/**
 * 전원 → 부하 지점 경로. 전력 엣지 위 최단 경로(홉 수 기준)를 쓴다.
 * 주택 시스템의 전력 회로는 사실상 트리라 경로가 갈리지 않는다 — 갈리면 finding으로 알린다.
 */
function pathTo(
  graph: RenderGraph,
  from: string,
  to: string,
  energization: EnergizationMap | null,
): Array<{ edge: RGEdge; forward: boolean }> | null {
  const adj = new Map<string, Array<{ edge: RGEdge; forward: boolean; next: string }>>();
  for (const e of graph.edges) {
    if (e.layer !== "power" || !isLive(e, energization)) continue;
    (adj.get(e.from.nodeRef) ?? adj.set(e.from.nodeRef, []).get(e.from.nodeRef)!).push({
      edge: e,
      forward: true,
      next: e.to.nodeRef,
    });
    (adj.get(e.to.nodeRef) ?? adj.set(e.to.nodeRef, []).get(e.to.nodeRef)!).push({
      edge: e,
      forward: false,
      next: e.from.nodeRef,
    });
  }

  const prev = new Map<string, { ref: string; edge: RGEdge; forward: boolean }>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const link of adj.get(cur) ?? []) {
      if (seen.has(link.next)) continue;
      seen.add(link.next);
      prev.set(link.next, { ref: cur, edge: link.edge, forward: link.forward });
      queue.push(link.next);
    }
  }
  if (!seen.has(to)) return null;

  const out: Array<{ edge: RGEdge; forward: boolean }> = [];
  let cur = to;
  while (cur !== from) {
    const step = prev.get(cur);
    if (!step) return null;
    out.unshift({ edge: step.edge, forward: step.forward });
    cur = step.ref;
  }
  return out;
}

/**
 * 경로를 따라가며 전력을 싣는다.
 *
 * 변환 손실은 **DC로 들어와 AC로 나가는 지점에서 한 번만** 먹인다.
 * 마이크로인버터 트렁크처럼 인버터를 줄줄이 통과하는 경로에서 홉마다 효율을 곱하면
 * η^n이 되어 하류로 갈수록 전력이 사라진다 — 트렁크는 변환이 아니라 통과다.
 */
function pushAlong(
  graph: RenderGraph,
  path: Array<{ edge: RGEdge; forward: boolean }>,
  start: string,
  kw: number,
  efficiency: number,
  acc: Record<string, number>,
): number {
  let value = kw;
  let at = start;
  // 시작 노드는 자기가 내는 도메인으로 나간다 (모듈은 DC, 축전지·계통은 AC).
  const startClass = graph.byRef.get(start)?.device.class ?? "";
  let arrived: PortDomain = PV_CLASSES.has(startClass) || startClass === "dc_battery" ? "dc" : "ac";
  for (const step of path) {
    const nearType = step.forward ? step.edge.from.port.type : step.edge.to.port.type;
    const farType = step.forward ? step.edge.to.port.type : step.edge.from.port.type;
    const leaving = portElectrical(nearType).domain;
    const node = graph.byRef.get(at);
    if (node && INVERTER_CLASSES.has(node.device.class) && arrived === "dc" && leaving === "ac") {
      value *= efficiency;
    }
    acc[step.edge.id] = (acc[step.edge.id] ?? 0) + (step.forward ? value : -value);
    at = step.forward ? step.edge.to.nodeRef : step.edge.from.nodeRef;
    arrived = portElectrical(farType).domain;
  }
  return value;
}

/**
 * 경로 위에서 DC를 AC로 바꾸는 첫 노드. pushAlong이 효율을 먹이는 바로 그 지점이다.
 * 클리핑은 여기서 일어난다 — 그 뒤의 트렁크는 통과일 뿐 변환이 아니다.
 */
function conversionNode(
  graph: RenderGraph,
  path: Array<{ edge: RGEdge; forward: boolean }>,
  start: string,
): string | null {
  let at = start;
  const startClass = graph.byRef.get(start)?.device.class ?? "";
  let arrived: PortDomain = PV_CLASSES.has(startClass) || startClass === "dc_battery" ? "dc" : "ac";
  for (const step of path) {
    const nearType = step.forward ? step.edge.from.port.type : step.edge.to.port.type;
    const farType = step.forward ? step.edge.to.port.type : step.edge.from.port.type;
    const leaving = portElectrical(nearType).domain;
    const node = graph.byRef.get(at);
    if (node && INVERTER_CLASSES.has(node.device.class) && arrived === "dc" && leaving === "ac") return at;
    at = step.forward ? step.edge.to.nodeRef : step.edge.from.nodeRef;
    arrived = portElectrical(farType).domain;
  }
  return null;
}

/** 부하가 걸리는 노드. 백업 경계 밖 패널이 죽으면 살아 있는 서브패널로 옮긴다. */
function findLoadNode(graph: RenderGraph, energization: EnergizationMap | null): string | null {
  const live = (ref: string): boolean => {
    if (energization === null) return true;
    return graph.edges.some(
      (e) => e.layer === "power" && (e.from.nodeRef === ref || e.to.nodeRef === ref) && edgeState(e, energization) === "live",
    );
  };
  const main = graph.nodes.find((n) => n.device.class === "main_panel");
  if (main && live(main.ref)) return main.ref;
  const sub = graph.nodes.find((n) => n.device.class === "subpanel");
  if (sub && live(sub.ref)) return sub.ref;
  return main?.ref ?? sub?.ref ?? null;
}

export function computePowerFlow(
  graph: RenderGraph,
  op: OperatingPoint,
  ctx: {
    scenario?: Scenario | null;
    energization?: EnergizationMap | null;
    site?: SiteContext | null;
  } = {},
): PowerFlowResult {
  const findings: Finding[] = [];
  const energization = ctx.energization ?? null;
  const scenario = ctx.scenario ?? null;
  const edges: Record<string, number> = {};
  for (const e of graph.edges) edges[e.id] = 0;

  const loadNode = findLoadNode(graph, energization);
  const islanded = scenario !== null && scenario.grid === "absent";
  const pvProducing = scenario === null || scenario.pv === "producing";
  const batteryUsable = scenario === null || scenario.battery === "available";

  // 백업 경계 안쪽만 살아 있으면 부하도 백업 부하만 남는다.
  const backupOnly = loadNode !== null && graph.byRef.get(loadNode)?.device.class === "subpanel";
  const loadKw =
    (backupOnly ? (ctx.site?.backup_load_kw ?? op.house_load_kw) : op.house_load_kw) ?? 0;

  // ── PV 발전 ────────────────────────────────────────────
  let pvAtLoad = 0;
  const pvPaths: Array<{
    ref: string;
    kw: number;
    path: Array<{ edge: RGEdge; forward: boolean }>;
    /** 이 경로가 AC로 바뀌는 변환기 ref. 클리핑이 걸리는 지점이다 */
    inverter?: string | null;
  }> = [];
  const missingSpec = new Set<string>();
  for (const n of graph.nodes) {
    if (!PV_CLASSES.has(n.device.class)) continue;
    const stc = n.device.ratings.pv_stc_w;
    if (stc === null) {
      missingSpec.add(n.device.id);
      continue;
    }
    if (!pvProducing) continue;
    const kw = (stc * op.irradiance) / 1000;
    if (loadNode === null) continue;
    const path = pathTo(graph, n.ref, loadNode, energization);
    if (path === null) continue; // 사선 구간에 갇힌 모듈 — 부하에 도달하지 못한다
    pvPaths.push({ ref: n.ref, kw, path });
  }
  for (const d of missingSpec) {
    findings.push({
      severity: "warning",
      code: "P010",
      message: `${d}: PV 전기 정격(pv_stc_w 등)이 없어 이 모듈의 기여를 0으로 뒀다. 신호가 실제보다 작다`,
      where: "powerflow",
    });
  }

  // ── 축전지 · 계통 ──────────────────────────────────────
  const batteries = graph.nodes.filter((n) => BATTERY_CLASSES.has(n.device.class));
  let rate = 0;
  let rateKnown = batteries.length > 0;
  for (const b of batteries) {
    const r = acRateKw(b, op.power_factor);
    if (r === null) {
      rateKnown = false;
      findings.push({
        severity: "warning",
        code: "P011",
        message: `${b.device.id}: 연속 출력 정격이 없어 충·방전 한계를 적용하지 못했다`,
        where: "powerflow",
      });
    } else rate += r;
  }
  const cap = rateKnown ? rate : Number.POSITIVE_INFINITY;

  // ── 인버터 클리핑 ──────────────────────────────────────
  //
  // 모듈의 DC 출력이 변환기의 AC 정격을 넘으면 상단이 잘린다. 어레이를 인버터보다
  // 크게 잡는 것은 흔한 설계이므로(DC/AC 비 > 1) 맑은 한낮에는 정상적으로 잘린다.
  // 자르지 않으면 신호가 실제보다 크게 나온다.
  const dcByInverter = new Map<string, number>();
  for (const p of pvPaths) {
    p.inverter = conversionNode(graph, p.path, p.ref);
    if (p.inverter === null) continue;
    dcByInverter.set(p.inverter, (dcByInverter.get(p.inverter) ?? 0) + p.kw);
  }

  /** 변환기 ref → 통과 배율(1이면 클리핑 없음) */
  const clipScale = new Map<string, number>();
  let clipped = 0;
  /** 같은 제품이 여러 대면 finding을 하나로 모은다 — 마이크로인버터 20대에 20줄을 쓰지 않는다 */
  const clipByDevice = new Map<string, { units: number; dc: number; ac: number; lost: number }>();
  const noRating = new Map<string, number>();

  for (const [ref, dcKw] of dcByInverter) {
    const node = graph.byRef.get(ref);
    if (!node) continue;
    const rate = acRateKw(node, op.power_factor);
    if (rate === null) {
      noRating.set(node.device.id, (noRating.get(node.device.id) ?? 0) + 1);
      continue;
    }
    const potentialAc = dcKw * op.inverter_efficiency;
    if (potentialAc <= rate + 1e-9) continue;
    clipScale.set(ref, rate / potentialAc);
    const lost = potentialAc - rate;
    clipped += lost;
    const acc = clipByDevice.get(node.device.id) ?? { units: 0, dc: 0, ac: rate, lost: 0 };
    acc.units += 1;
    acc.dc += dcKw;
    acc.lost += lost;
    clipByDevice.set(node.device.id, acc);
  }

  for (const [id, a] of clipByDevice) {
    const perUnitDc = a.dc / a.units;
    findings.push({
      severity: "info",
      code: "P030",
      message:
        `${id}${a.units > 1 ? ` ${a.units}대` : ""}: DC ${fmt(perUnitDc)} kW가 AC 정격 ${fmt(a.ac)} kW를 넘어 ` +
        `클리핑됐다 (DC/AC 비 ${(perUnitDc / a.ac).toFixed(2)}). 합계 ${fmt(a.lost)} kW 손실`,
      where: "powerflow",
    });
  }
  for (const [id, units] of noRating) {
    findings.push({
      severity: "warning",
      code: "P031",
      message:
        `${id}${units > 1 ? ` ${units}대` : ""}: 연속 AC 정격이 없어 클리핑 한계를 적용하지 못했다. ` +
        `DC/AC 비가 1을 넘으면 신호가 실제보다 크다`,
      where: "powerflow",
    });
  }

  // 총 PV(손실 반영 전) — 배분 비율 계산용. 클리핑을 먼저 먹인다(하드웨어 한계가 먼저다).
  const pvRaw = pvPaths.reduce((s, p) => s + p.kw * (p.inverter ? (clipScale.get(p.inverter) ?? 1) : 1), 0);

  // 실제로 실을 PV. 아일랜드에서는 부하 + 충전 여력을 넘는 발전을 실을 수 없다.
  let scale = 1;
  let curtailed = 0;
  if (islanded && pvRaw > 0) {
    const room = loadKw + (batteryUsable ? cap : 0);
    const deliverable = Math.min(pvRaw * op.inverter_efficiency, room);
    if (deliverable < pvRaw * op.inverter_efficiency) {
      scale = deliverable / (pvRaw * op.inverter_efficiency);
      curtailed = pvRaw * op.inverter_efficiency - deliverable;
      findings.push({
        severity: "info",
        code: "P020",
        message:
          `아일랜드에서 부하(${loadKw.toFixed(2)} kW)와 충전 여력을 넘는 PV를 실을 수 없어 ` +
          `${curtailed.toFixed(2)} kW를 제한(curtailment)했다`,
        where: "powerflow",
      });
    }
  }

  for (const p of pvPaths) {
    const clip = p.inverter ? (clipScale.get(p.inverter) ?? 1) : 1;
    pvAtLoad += pushAlong(graph, p.path, p.ref, p.kw * clip * scale, op.inverter_efficiency, edges);
  }

  let batteryKw = 0;
  let gridKw = 0;
  const surplus = pvAtLoad - loadKw;
  if (islanded) {
    batteryKw = batteryUsable ? Math.max(-cap, Math.min(cap, -surplus)) : 0;
    gridKw = 0;
    const short = loadKw - pvAtLoad - Math.max(0, batteryKw);
    if (short > 0.001) {
      findings.push({
        severity: "warning",
        code: "P021",
        message: `아일랜드에서 부하보다 공급이 ${short.toFixed(2)} kW 모자란다. 실제로는 부하 차단 또는 정지다`,
        where: "powerflow",
      });
    }
  } else {
    // 자가소비 → 잉여는 충전 → 남으면 수출. 방전은 부족분만큼.
    batteryKw = batteryUsable ? Math.max(-cap, Math.min(cap, -surplus)) : 0;
    if (op.house_load_kw === null) batteryKw = 0; // 부하를 모르면 축전지 거동을 지어내지 않는다
    gridKw = loadKw - pvAtLoad - batteryKw;
  }

  // 축전지 · 계통 전력을 경로에 싣는다.
  if (loadNode !== null) {
    if (Math.abs(batteryKw) > 1e-9 && batteries.length > 0) {
      const share = batteryKw / batteries.length;
      for (const b of batteries) {
        const path = pathTo(graph, b.ref, loadNode, energization);
        if (path) pushAlong(graph, path, b.ref, share, 1, edges);
      }
    }
    if (Math.abs(gridKw) > 1e-9) {
      const svc = graph.nodes.find((n) => n.device.class === "service_point");
      const path = svc ? pathTo(graph, svc.ref, loadNode, energization) : null;
      if (svc && path) pushAlong(graph, path, svc.ref, gridKw, 1, edges);
    }
  }

  if (loadNode === null) {
    findings.push({
      severity: "info",
      code: "P012",
      message: "부하 지점(패널 노드)이 없어 전력 수지를 계산하지 않았다",
      where: "powerflow",
    });
  }
  if (op.house_load_kw === null) {
    findings.push({
      severity: "info",
      code: "P013",
      message: "주택 부하가 지정되지 않았다. 발전 전량이 상류(계통)로 흐르는 것으로 계산했다",
      where: "powerflow",
    });
  }

  return {
    edges,
    load_node: loadNode,
    load_kw: loadKw,
    pv_kw: pvAtLoad,
    battery_kw: batteryKw,
    grid_kw: gridKw,
    curtailed_kw: curtailed,
    clipped_kw: clipped,
    findings,
  };
}

const fmt = (n: number): string => (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2));
