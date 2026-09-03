import type { Finding } from "../schema/common.js";
import type { PortType } from "../schema/device.js";
import { portElectrical, type Domain } from "../schema/electrical.js";
import type { RenderGraph, RGEdge, RGNode } from "../graph/index.js";
import type { OperatingPoint } from "./operating-point.js";
import type { PowerFlowResult } from "./powerflow.js";

/**
 * 노드 포인트 신호 — (그래프, 노드, 조류, 동작점) => 포트별 전압·전류·전력.
 *
 * 순수 함수다. 여기서 나오는 모든 숫자는 세 가지에서만 나온다:
 *   ① device-library의 정격  ② 포트 타입의 공칭 전압  ③ 조류 계산 결과
 * 어느 하나가 없으면 그 값은 null이고, 왜 없는지 notes에 남는다.
 * 그래프는 이 구조체를 그리기만 한다 — 화면에서 값을 만들지 않는다.
 */

export interface Formula {
  label: string;
  /** 값이 대입된 식. 기호만 있는 식은 노드 노트(design_points)가 갖는다. */
  expr: string;
}

export interface Waveform {
  hz: number;
  /** 한 주기를 몇 등분했는가 */
  per_cycle: number;
  cycles: number;
  t: number[];
  /** 순시 전압(V) */
  v: number[];
  /** 순시 전류(A) */
  i: number[];
  /** 순시 전력(W) */
  p: number[];
}

export interface PortSignal {
  port_id: string;
  type: PortType;
  domain: Domain;
  direction: "in" | "out" | "bidirectional";
  arrangement: string;
  /** 이 포트에 붙은 도체들 */
  edges: string[];
  /** 상대 쪽 노드 라벨 */
  peers: string[];
  /** 이 포트를 나가는 방향을 양으로 한 유효전력(kW) */
  p_kw: number | null;
  /** AC는 선간 실효 전압, DC는 이 지점의 전위차 */
  v: number | null;
  i: number | null;
  waveform: Waveform | null;
  formulas: Formula[];
  /** 이 값이 왜 이렇게 나오는지의 구조적 근거 (직렬 몇 번째, 트렁크 상류 몇 대) */
  basis: string[];
  notes: string[];
}

export interface IvCurve {
  v: number[];
  i: number[];
  p: number[];
  mpp: { v: number; i: number; p: number };
  voc: number;
  isc: number;
  /** 곡선 산출에 쓴 모델 이름. 실측이 아니라는 사실을 화면에 그대로 띄운다. */
  model: string;
}

export interface NodeSignalReport {
  ref: string;
  label: string;
  device_id: string;
  device_class: string;
  ports: PortSignal[];
  iv: IvCurve | null;
  findings: Finding[];
}

/**
 * 이 포트를 나가는 방향을 양으로 한 유효전력(kW). 붙은 도체가 없으면 null.
 * 신호 패널과 하루 곡선이 같은 정의를 쓰도록 여기 한 곳에 둔다.
 */
export function portNetPower(
  graph: RenderGraph,
  ref: string,
  portId: string,
  flow: PowerFlowResult,
): number | null {
  const attached = graph.edges.filter(
    (e) =>
      (e.from.nodeRef === ref && e.from.portId === portId) ||
      (e.to.nodeRef === ref && e.to.portId === portId),
  );
  if (attached.length === 0) return null;
  let sum = 0;
  for (const e of attached) {
    const value = flow.edges[e.id] ?? 0;
    sum += e.from.nodeRef === ref ? value : -value;
  }
  return sum;
}

const SQRT2 = Math.SQRT2;
const PER_CYCLE = 48;
const CYCLES = 2;

function fmt(n: number, digits = 2): string {
  return Number(n.toFixed(digits)).toString();
}

/** 같은 그룹 안에서 이 노드보다 상류에 있는 노드 수 (직렬 순번 · 트렁크 상류 유닛). */
function upstreamInGroup(graph: RenderGraph, node: RGNode): number {
  if (node.group === null) return 0;
  const inGroup = (ref: string) => graph.byRef.get(ref)?.group === node.group;
  const back = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.layer !== "power") continue;
    if (!inGroup(e.from.nodeRef) || !inGroup(e.to.nodeRef)) continue;
    (back.get(e.to.nodeRef) ?? back.set(e.to.nodeRef, []).get(e.to.nodeRef)!).push(e.from.nodeRef);
  }
  const seen = new Set<string>();
  const queue = [node.ref];
  while (queue.length > 0) {
    for (const prev of back.get(queue.shift()!) ?? []) {
      if (seen.has(prev)) continue;
      seen.add(prev);
      queue.push(prev);
    }
  }
  return seen.size;
}

/** 이 DC 지점의 전류를 정하는 모듈. 직렬 회로에서 전류는 모듈 정격이 정한다. */
function dcSourceModule(graph: RenderGraph, node: RGNode, edges: RGEdge[]): RGNode | null {
  if (node.device.class === "pv_module") return node;
  for (const e of edges) {
    for (const ref of [e.from.nodeRef, e.to.nodeRef]) {
      const peer = graph.byRef.get(ref);
      if (peer && peer.device.class === "pv_module") return peer;
    }
  }
  // 스트링 종단이 아니라 인버터 쪽이면 그래프에서 모듈을 한 번 더 찾는다.
  return graph.nodes.find((n) => n.device.class === "pv_module") ?? null;
}

function waveform(vRms: number, iRms: number, hz: number, delivering: boolean): Waveform {
  const t: number[] = [];
  const v: number[] = [];
  const i: number[] = [];
  const p: number[] = [];
  const w = 2 * Math.PI * hz;
  const phase = delivering ? 0 : Math.PI; // 흡수하면 전류가 180° 뒤집힌다 — 평균 전력이 음이다
  const total = PER_CYCLE * CYCLES;
  for (let k = 0; k <= total; k++) {
    const tk = k / (PER_CYCLE * hz);
    const vk = SQRT2 * vRms * Math.sin(w * tk);
    const ik = SQRT2 * iRms * Math.sin(w * tk - phase);
    t.push(tk);
    v.push(vk);
    i.push(ik);
    p.push(vk * ik);
  }
  return { hz, per_cycle: PER_CYCLE, cycles: CYCLES, t, v, i, p };
}

/**
 * 모듈 I–V 곡선. 4파라미터 지수 근사다 — 실측 곡선도, 단일 다이오드 정해도 아니다.
 * 화면에 모델 이름을 함께 띄워 "이 곡선은 근사"라는 사실을 숨기지 않는다.
 */
function ivCurve(node: RGNode, irradiance: number): IvCurve | null {
  const r = node.device.ratings;
  if (r.pv_voc_v === null || r.pv_isc_a === null || r.pv_vmp_v === null || r.pv_imp_a === null) return null;
  const voc = r.pv_voc_v;
  const isc = r.pv_isc_a * Math.max(irradiance, 0.001);
  const vmp = r.pv_vmp_v;
  const imp = r.pv_imp_a * Math.max(irradiance, 0.001);
  const iscStc = r.pv_isc_a;
  const impStc = r.pv_imp_a;

  const c2 = (vmp / voc - 1) / Math.log(1 - impStc / iscStc);
  const c1 = (1 - impStc / iscStc) * Math.exp(-vmp / (c2 * voc));

  const v: number[] = [];
  const i: number[] = [];
  const p: number[] = [];
  const steps = 60;
  for (let k = 0; k <= steps; k++) {
    const vk = (voc * k) / steps;
    const ik = Math.max(0, isc * (1 - c1 * (Math.exp(vk / (c2 * voc)) - 1)));
    v.push(vk);
    i.push(ik);
    p.push(vk * ik);
  }
  return {
    v,
    i,
    p,
    mpp: { v: vmp, i: imp, p: vmp * imp },
    voc,
    isc,
    model: "4파라미터 지수 근사 (실측 곡선 아님)",
  };
}

export function nodeSignals(
  graph: RenderGraph,
  ref: string,
  flow: PowerFlowResult,
  op: OperatingPoint,
): NodeSignalReport {
  const node = graph.byRef.get(ref);
  if (!node) throw new Error(`알 수 없는 노드: ${ref}`);
  const findings: Finding[] = [];
  const upstream = upstreamInGroup(graph, node);

  const ports: PortSignal[] = node.device.ports.map((port) => {
    const attached = graph.edges.filter(
      (e) =>
        (e.from.nodeRef === ref && e.from.portId === port.id) ||
        (e.to.nodeRef === ref && e.to.portId === port.id),
    );
    const el = portElectrical(port.type);
    const notes: string[] = [];
    const basis: string[] = [];
    const formulas: Formula[] = [];

    const pKw = portNetPower(graph, ref, port.id, flow);

    const peers = attached.map((e) => {
      const other = e.from.nodeRef === ref ? e.to.nodeRef : e.from.nodeRef;
      return graph.byRef.get(other)?.label ?? other;
    });

    if (el.domain === "signal") {
      notes.push("통신·계측 회선이다. 전력을 나르지 않으므로 전압·전류를 계산하지 않는다");
      return {
        port_id: port.id,
        type: port.type,
        domain: el.domain,
        direction: port.direction,
        arrangement: el.arrangement,
        edges: attached.map((e) => e.id),
        peers,
        p_kw: null,
        v: null,
        i: null,
        waveform: null,
        formulas,
        basis,
        notes,
      };
    }

    if (attached.length === 0) {
      notes.push("이 포트에 붙은 도체가 없다 — 이 구성에서는 쓰이지 않는 포트다");
    }

    let v: number | null = null;
    let i: number | null = null;
    let wave: Waveform | null = null;

    if (el.domain === "ac") {
      v = el.nominal_v;
      if (v !== null && pKw !== null) {
        i = (Math.abs(pKw) * 1000) / (v * op.power_factor);
        formulas.push({
          label: "실효 전류",
          expr: `I = P / (V_LL · PF) = ${fmt(Math.abs(pKw))} kW / (${v} V × ${fmt(op.power_factor)}) = ${fmt(i, 1)} A`,
        });
        formulas.push({
          label: "순시 전압",
          expr: `v(t) = √2 · ${v} · sin(2π·${el.hz}·t) → 피크 ${fmt(SQRT2 * v, 0)} V`,
        });
        formulas.push({
          label: "순시 전력",
          expr: `p(t) = v·i = P·(1 − cos 2ωt) → 평균 ${fmt(Math.abs(pKw))} kW, 2ω(=${(el.hz ?? 60) * 2} Hz)로 맥동`,
        });
        if (el.line_to_neutral_v !== null) {
          formulas.push({
            label: "단상 3선",
            expr: `V_L-N = ${el.line_to_neutral_v} V, V_L-L = ${v} V. 120V 부하는 한 레그, 240V 부하는 두 레그에 걸린다`,
          });
        }
        wave = waveform(v, i, el.hz ?? 60, pKw >= 0);
        basis.push(pKw >= 0 ? "이 포트에서 전력이 나간다(공급)" : "이 포트로 전력이 들어온다(흡수)");
      } else if (pKw === null) {
        notes.push("붙은 도체가 없어 전류를 계산하지 않았다");
      }
      if (upstream > 0 && node.group !== null) {
        basis.push(`같은 배열에서 이 유닛보다 상류에 ${upstream}대가 있다 — 트렁크 전류가 그만큼 누적된 지점이다`);
        formulas.push({
          label: "트렁크 누적 전류",
          expr: `I_트렁크 = Σ I_유닛 ≈ ${upstream + 1} × I_유닛 (모든 유닛이 같은 출력일 때)`,
        });
      }
    } else {
      // DC: 전류는 모듈 정격이 정한다. 전압은 직렬로 쌓인 결과다.
      const module = dcSourceModule(graph, node, attached);
      const imp = module?.device.ratings.pv_imp_a ?? null;
      const vmp = module?.device.ratings.pv_vmp_v ?? null;
      /** 이 포트에 물린 스트링 수. 병렬이면 전압은 그대로고 전류가 배로 늘어난다. */
      const parallel = attached.length;
      if (parallel === 0) {
        // 도체가 없으면 전류도 없다. 정격만 보고 값을 지어내지 않는다.
      } else if (imp === null || vmp === null) {
        notes.push("모듈 전기 정격(pv_imp_a / pv_vmp_v)이 없어 DC 전압·전류를 계산할 수 없다");
        findings.push({
          severity: "warning",
          code: "G010",
          message: `${node.device.id}: DC 지점의 전압·전류를 계산할 모듈 정격이 없다`,
          where: ref,
        });
      } else {
        i = imp * op.irradiance * parallel;
        formulas.push({
          label: "스트링 전류",
          expr:
            parallel > 1
              ? `I = n_병렬 · I_mp · G/1000 = ${parallel} × ${fmt(imp)} A × ${fmt(op.irradiance)} = ${fmt(i)} A ` +
                `(병렬이면 전류가 더해지고 전압은 그대로다)`
              : `I ≈ I_mp · G/1000 = ${fmt(imp)} A × ${fmt(op.irradiance)} = ${fmt(i)} A (직렬 회로에서 전류는 어디서나 같다)`,
        });
        if (pKw !== null && i > 0) {
          v = (Math.abs(pKw) * 1000) / i;
          const series = Math.max(1, Math.round(v / vmp));
          formulas.push({
            label: "직렬 전압",
            expr: `V = Σ V_mp = ${series} × ${fmt(vmp)} V = ${fmt(v, 1)} V (P/I로 되짚어도 같다)`,
          });
          basis.push(
            parallel > 1
              ? `직렬 ${series}장 × 병렬 ${parallel}스트링이 물린 지점이다`
              : `이 지점까지 직렬로 ${series}장이 쌓였다`,
          );
        }
        if (node.device.class === "pv_module") {
          const stc = node.device.ratings.pv_stc_w;
          if (stc !== null) {
            formulas.push({
              label: "모듈 출력",
              expr: `P = P_STC · G/1000 = ${stc} W × ${fmt(op.irradiance)} = ${fmt(stc * op.irradiance, 0)} W (온도계수 미반영)`,
            });
          }
        }
      }
      if (upstream > 0 && node.device.class === "pv_module") {
        basis.push(`스트링에서 ${upstream + 1}번째 모듈이다 — 여기까지의 전압이 이 지점의 대지 전위차를 만든다`);
      }
    }

    return {
      port_id: port.id,
      type: port.type,
      domain: el.domain,
      direction: port.direction,
      arrangement: el.arrangement,
      edges: attached.map((e) => e.id),
      peers,
      p_kw: pKw,
      v,
      i,
      waveform: wave,
      formulas,
      basis,
      notes,
    };
  });

  return {
    ref,
    label: node.label,
    device_id: node.device.id,
    device_class: node.device.class,
    ports,
    iv: node.device.class === "pv_module" ? ivCurve(node, op.irradiance) : null,
    findings,
  };
}
