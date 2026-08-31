import type { Device } from "../schema/device.js";
import type { Topology } from "../schema/topology.js";
import type { Scenario } from "../schema/scenario.js";
import type { Finding } from "../schema/common.js";
import {
  buildRenderGraph,
  type Energization,
  type EnergizationMap,
  type RenderGraph,
  type RGEdge,
  type RGNode,
} from "../graph/index.js";

/**
 * 시나리오 엔진 — (topology, devices, scenario) => 급전 상태 + 흐름 방향.
 *
 * 순수 함수다. 파일을 읽지 않고, 시각화를 모르고, 벤더로 분기하지 않는다.
 * 출력의 energization은 렌더러가 이미 받고 있는 형식 그대로다(스프린트 1 계약).
 *
 * 모델링하지 않는 것: 전력량, 전압 강하, 위상, SOC.
 * 답하는 것은 "어디가 살아 있고 어느 방향으로 흐르는가" 뿐이다.
 */

/** edge.from → edge.to 기준. 크기는 담지 않는다. */
export type Flow = "forward" | "reverse" | "none";

export interface ScenarioResult {
  topology_id: string;
  scenario_id: string;
  /** 렌더러에 그대로 주입된다. */
  energization: EnergizationMap;
  flows: Readonly<Record<string, Flow>>;
  nodes: Readonly<Record<string, Energization>>;
  /** 개방된 노드 — 계통 부재 시 자동 개방된 MID + 지정 트립. */
  open_nodes: readonly string[];
  /** AC를 실제로 낸 노드. 아일랜드를 세운 주체를 포함한다. */
  injectors: readonly string[];
  findings: Finding[];
}

export interface EvaluateOptions {
  /** 지정 트립 대상 노드 ref. fault 시나리오가 요구한다. */
  open?: readonly string[];
}

/** 축전지를 품은 클래스 — 잔량 상태가 출력 가능 여부를 가른다. */
const BATTERY_CLASSES = new Set(["ac_battery", "hybrid_inverter_battery"]);
/** DC를 AC로 바꿔 계통에 내보내는 클래스. */
const INVERTER_CLASSES = new Set([
  "microinverter",
  "string_inverter",
  "hybrid_inverter_battery",
  "ac_battery",
]);

type PortDomain = "ac" | "dc" | "other";

function portDomain(type: string): PortDomain {
  if (type.startsWith("ac_")) return "ac";
  if (type.startsWith("dc_")) return "dc";
  return "other";
}

/** 이 장치가 지금 내보낼 에너지를 실제로 가지고 있는가. */
function hasEnergy(node: RGNode, sc: Scenario): boolean {
  const cls = node.device.class;
  if (BATTERY_CLASSES.has(cls)) {
    if (sc.battery === "offline") return false;
    if (sc.battery === "available") return true;
    // depleted — 하이브리드는 PV를 직접 변환해 낼 여지가 있다(성립 여부는 아래에서 따로 판정).
    return cls === "hybrid_inverter_battery" && sc.pv === "producing";
  }
  if (cls === "microinverter" || cls === "string_inverter") return sc.pv === "producing";
  return false;
}

/**
 * 계통 기준 없이 스스로 전압을 세울 수 있는가.
 * grid_forming이 null(미확인)이면 false다 — 확인 전까지 성립을 주장하지 않는다.
 */
function canFormIsland(node: RGNode, sc: Scenario): boolean {
  if (!hasEnergy(node, sc)) return false;
  if (node.device.grid_forming !== true) return false;
  // 잔량이 없는 상태에서 세우려면 블랙스타트가 별도로 확인돼야 한다.
  if (sc.battery === "depleted") return node.device.black_start_capable === true;
  return true;
}

function isInverter(node: RGNode): boolean {
  return INVERTER_CLASSES.has(node.device.class);
}

/**
 * 이 노드가 스스로 내보내는 전력의 도메인.
 * 인버터는 AC를 낸다 — DC 포트로는 내보내지 않는다(어레이를 역급전하지 않는다).
 */
function injectionDomain(node: RGNode): PortDomain {
  return node.device.class === "pv_module" ? "dc" : "ac";
}

interface Traversal {
  live: Set<string>;
  liveEdges: Map<string, Flow>;
}

/**
 * 급전 전파. 노드를 건너는 규칙만으로 경로가 정해진다.
 *
 * - 개방된 노드는 통과시키지 않는다(도달한 엣지 자체는 살아 있다 — MID 부하측이 그렇다)
 * - AC → DC 역전파는 막는다. 야간에 인버터가 어레이를 역급전하지 않는다
 * - DC → AC 변환은 그 인버터가 실제로 출력 중일 때만 열린다
 */
function propagate(
  graph: RenderGraph,
  seeds: readonly string[],
  open: ReadonlySet<string>,
  injecting: ReadonlySet<string>,
): Traversal {
  const edgesByNode = new Map<string, RGEdge[]>();
  for (const e of graph.edges) {
    for (const ref of [e.from.nodeRef, e.to.nodeRef]) {
      const list = edgesByNode.get(ref);
      if (list) list.push(e);
      else edgesByNode.set(ref, [e]);
    }
  }

  const live = new Set<string>();
  const liveEdges = new Map<string, Flow>();
  // 도착 포트 도메인. seed는 자체 출력이므로 도착 경로가 없다.
  const queue: Array<{ ref: string; arrivedOn: PortDomain | null }> = [];

  for (const ref of seeds) {
    if (!graph.byRef.has(ref)) continue;
    live.add(ref);
    queue.push({ ref, arrivedOn: null });
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const key = `${cur.ref}|${cur.arrivedOn ?? "-"}`;
    if (visited.has(key)) continue;
    visited.add(key);

    if (open.has(cur.ref) && cur.arrivedOn !== null) continue; // 개방 노드는 통과 불가

    for (const e of edgesByNode.get(cur.ref) ?? []) {
      const outgoing = e.from.nodeRef === cur.ref;
      const nearPort = outgoing ? e.from.port : e.to.port;
      const farEnd = outgoing ? e.to : e.from;
      const nearDomain = portDomain(nearPort.type);

      if (cur.arrivedOn !== null) {
        // 노드를 관통하는 경우에만 도메인 규칙을 적용한다.
        if (cur.arrivedOn === "ac" && nearDomain === "dc") continue;
        if (cur.arrivedOn === "dc" && nearDomain === "ac" && !injecting.has(cur.ref)) continue;
      } else if (nearDomain !== injectionDomain(graph.byRef.get(cur.ref)!)) {
        // 시드는 자기가 내는 도메인으로만 나간다. 축전지가 야간에 DC측을 살리지 않는다.
        continue;
      }

      if (!liveEdges.has(e.id)) liveEdges.set(e.id, outgoing ? "forward" : "reverse");
      if (!live.has(farEnd.nodeRef)) live.add(farEnd.nodeRef);
      queue.push({ ref: farEnd.nodeRef, arrivedOn: portDomain(farEnd.port.type) });
    }
  }

  return { live, liveEdges };
}

export function evaluateScenario(
  topology: Topology,
  devices: Device[],
  scenario: Scenario,
  opts: EvaluateOptions = {},
): ScenarioResult {
  const graph = buildRenderGraph(topology, devices, ["power"]);
  const findings: Finding[] = [];
  const where = `${topology.id}@${scenario.id}`;

  // ── 개방 지점 ──────────────────────────────────────────────
  const open = new Set<string>();
  const requested = [...scenario.open_nodes, ...(opts.open ?? [])];
  for (const ref of requested) {
    if (!graph.byRef.has(ref)) {
      findings.push({
        severity: "error",
        code: "S010",
        message: `개방 대상 노드 ${ref}가 토폴로지에 없다`,
        where,
      });
      continue;
    }
    open.add(ref);
  }
  if (scenario.grid === "absent") {
    for (const n of graph.nodes) if (n.device.provides_mid) open.add(n.ref);
  }
  if (scenario.requires_trip_target && requested.length === 0) {
    findings.push({
      severity: "info",
      code: "S011",
      message: "트립 대상이 지정되지 않아 개방 없이 평가했다. open 인자로 노드 ref를 넘겨라",
      where,
    });
  }

  // ── 급전 시작점 ────────────────────────────────────────────
  const seeds: string[] = [];
  for (const n of graph.nodes) {
    if (open.has(n.ref)) continue; // 개방/트립된 장치는 아무것도 내보내지 않는다
    if (n.device.class === "service_point" && scenario.grid === "present") seeds.push(n.ref);
    if (n.device.class === "pv_module" && scenario.pv === "producing") seeds.push(n.ref);
  }

  // AC를 내는 노드. 계통이 있으면 추종 운전이 가능하고, 없으면 누군가 먼저 세워야 한다.
  const injecting = new Set<string>();
  for (const n of graph.nodes) {
    if (!isInverter(n) || open.has(n.ref)) continue;
    if (scenario.grid === "present" ? hasEnergy(n, scenario) : canFormIsland(n, scenario)) {
      injecting.add(n.ref);
      seeds.push(n.ref);
    }
  }

  // 추종 인버터는 AC 기준이 살아난 뒤에야 출력한다 — 고정점까지 반복한다.
  let run = propagate(graph, seeds, open, injecting);
  for (let guard = 0; guard < graph.nodes.length + 1; guard++) {
    let changed = false;
    for (const n of graph.nodes) {
      if (injecting.has(n.ref) || open.has(n.ref) || !isInverter(n) || !hasEnergy(n, scenario)) continue;
      const acLive = graph.edges.some(
        (e) =>
          run.liveEdges.has(e.id) &&
          ((e.from.nodeRef === n.ref && portDomain(e.from.port.type) === "ac") ||
            (e.to.nodeRef === n.ref && portDomain(e.to.port.type) === "ac")),
      );
      if (acLive) {
        injecting.add(n.ref);
        seeds.push(n.ref);
        changed = true;
      }
    }
    if (!changed) break;
    run = propagate(graph, seeds, open, injecting);
  }

  // ── 결과 조립 ──────────────────────────────────────────────
  const energization: Record<string, Energization> = {};
  const flows: Record<string, Flow> = {};
  for (const e of graph.edges) {
    const flow = run.liveEdges.get(e.id);
    energization[e.id] = flow ? "live" : "dead";
    flows[e.id] = flow ?? "none";
  }
  const nodes: Record<string, Energization> = {};
  for (const n of graph.nodes) nodes[n.ref] = run.live.has(n.ref) ? "live" : "dead";

  findings.push(...diagnose(graph, scenario, injecting, nodes, where));

  return {
    topology_id: topology.id,
    scenario_id: scenario.id,
    energization,
    flows,
    nodes,
    open_nodes: [...open].sort(),
    injectors: [...injecting].sort(),
    findings,
  };
}

/** 결과 자체가 아니라 "이 결과를 믿어도 되는가"를 보고한다. */
function diagnose(
  graph: RenderGraph,
  sc: Scenario,
  injecting: ReadonlySet<string>,
  nodes: Readonly<Record<string, Energization>>,
  where: string,
): Finding[] {
  const out: Finding[] = [];

  if (sc.grid === "absent") {
    for (const n of graph.nodes) {
      if (!isInverter(n) || n.device.grid_forming !== null) continue;
      out.push({
        severity: "warning",
        code: "S020",
        message: `${n.device.id}: grid_forming 미확인 — 아일랜드 형성 주체로 쓰지 않았다. 매뉴얼 확인 필요`,
        where,
      });
    }
    if (injecting.size === 0) {
      out.push({
        severity: "warning",
        code: "S021",
        message: "아일랜드를 세운 장치가 없다. 이 상태에서 백업 부하는 전부 사선이다",
        where,
      });
    }
  }

  if (sc.battery === "depleted") {
    const capable = graph.nodes.filter((n) => n.device.black_start_capable === true);
    if (capable.length === 0) {
      out.push({
        severity: "warning",
        code: "S022",
        message:
          "black_start_capable=true인 장치가 없어 기동 성립 여부를 판정할 수 없다. 불가로 처리했다",
        where,
      });
    }
  }

  if (sc.load_shed) {
    out.push({
      severity: "info",
      code: "S030",
      message:
        "부하(분기회로) 노드가 토폴로지에 없어 차단 대상이 없다. 부하 모델링 전까지 급전 결과는 야간 아일랜딩과 같다",
      where,
    });
  }

  const dead = graph.nodes.filter((n) => nodes[n.ref] === "dead").map((n) => n.ref);
  if (dead.length > 0) {
    out.push({
      severity: "info",
      code: "S040",
      message: `사선 노드: ${dead.join(", ")}`,
      where,
    });
  }

  return out;
}
