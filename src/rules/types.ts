import type { Device } from "../schema/device.js";
import type { Topology } from "../schema/topology.js";
import type { RuleFinding, SiteContext } from "../schema/rule.js";
import type { RenderGraph } from "../graph/index.js";

export interface RuleContext {
  topology: Topology;
  devices: Device[];
  graph: RenderGraph;
  site: SiteContext;
}

/**
 * 룰 하나. 순수 함수여야 한다 — 파일을 읽지 않고, 시각화를 모르고, 벤더로 분기하지 않는다.
 *
 * code_ref / verified는 룰 단위 기본값이고 개별 Finding이 이를 물려받는다.
 * 원문 대조를 마친 룰만 verified: true로 바꾼다. 그 전까지는 사내 배포용 근거가 아니다.
 */
export interface Rule {
  id: string;
  title: string;
  code_ref: string | null;
  verified: boolean;
  check(ctx: RuleContext): RuleFinding[];
}

/** 룰 정의의 code_ref/verified를 Finding에 물려주는 헬퍼. */
export function finding(
  rule: Pick<Rule, "code_ref" | "verified">,
  f: Omit<RuleFinding, "code_ref" | "verified">,
): RuleFinding {
  return { ...f, code_ref: rule.code_ref, verified: rule.verified };
}

/** 전력을 계통에 내보낼 수 있는 클래스. 벤더가 아니라 클래스로만 판정한다. */
export const SOURCE_CLASSES: ReadonlySet<string> = new Set([
  "microinverter",
  "string_inverter",
  "hybrid_inverter_battery",
  "ac_battery",
]);

/** 전원을 모아 한 회선으로 내보내는 클래스. 상류에서 보면 전원처럼 보인다. */
export const AGGREGATOR_CLASSES: ReadonlySet<string> = new Set(["combiner"]);

/** 분기회로 포트 타입 — 여기 붙는 전원이 백피드다. 서비스 도체(ac_service_line)와 구분된다. */
export const BRANCH_PORT_TYPES: ReadonlySet<string> = new Set(["ac_240v_split", "ac_120v_branch"]);
