import type { Scenario } from "../schema/scenario.js";
import type { SiteContext } from "../schema/rule.js";
import type { Location } from "../schema/location.js";
import type { EnergizationMap, RenderGraph } from "../graph/index.js";
import { OperatingPoint, withSolar } from "./operating-point.js";
import { computePowerFlow } from "./powerflow.js";
import { portNetPower } from "./signals.js";
import { sunAt } from "./solar.js";

/**
 * 하루 곡선 — 시각만 바꿔 조류를 다시 풀고, 한 노드의 포트별 전력을 모은다.
 *
 * 순수 함수다. 시간 적분도 누적 발전량도 계산하지 않는다 — 매 시각이 각각 독립적인
 * 정상상태 한 점이고, 그 점들을 늘어놓은 것뿐이다.
 */
export interface DayProfile {
  hours: number[];
  /** 경사면 일사(W/m²) */
  poa: number[];
  /** 포트 id → 시각별 유효전력(kW). 포트를 나가는 방향이 양이다 */
  ports: Record<string, number[]>;
  step: number;
}

export interface DayContext {
  op: OperatingPoint;
  location: Location;
  scenario?: Scenario | null;
  energization?: EnergizationMap | null;
  site?: SiteContext | null;
}

export function dayProfile(
  graph: RenderGraph,
  ref: string,
  ctx: DayContext,
  step = 0.5,
): DayProfile {
  const node = graph.byRef.get(ref);
  if (!node) throw new Error(`알 수 없는 노드: ${ref}`);

  const hours: number[] = [];
  const poa: number[] = [];
  const ports: Record<string, number[]> = {};
  for (const p of node.device.ports) ports[p.id] = [];

  for (let h = 0; h <= 24 + 1e-9; h += step) {
    const op = withSolar(OperatingPoint.parse({ ...ctx.op, hour: h }), ctx.location);
    const flow = computePowerFlow(graph, op, {
      scenario: ctx.scenario ?? null,
      energization: ctx.energization ?? null,
      site: ctx.site ?? null,
    });
    hours.push(h);
    poa.push(sunAt(ctx.location.latitude_deg, op.month, h, op.clearness).poa_wm2);
    for (const p of node.device.ports) {
      ports[p.id]!.push(portNetPower(graph, ref, p.id, flow) ?? 0);
    }
  }

  return { hours, poa, ports, step };
}
