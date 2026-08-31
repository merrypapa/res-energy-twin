import type { Device } from "../schema/device.js";
import type { Topology } from "../schema/topology.js";
import { EMPTY_SITE, type RuleFinding, type SiteContext } from "../schema/rule.js";
import { buildRenderGraph } from "../graph/index.js";
import { RULES } from "../../rules/index.js";
import type { Rule, RuleContext } from "./types.js";

/**
 * 룰 엔진 — (topology, devices, site) => RuleFinding[].
 *
 * 순수 함수다. 룰이 던지면 삼키지 않고 error finding으로 바꿔 남긴다.
 * 룰 하나가 터져도 나머지 판정은 나와야 한다.
 */
export interface RuleRunResult {
  topology_id: string;
  findings: RuleFinding[];
  /** 원문 대조가 끝나지 않은 룰. 사내 배포 전 해소 대상이다. */
  unverified: string[];
}

export function runRules(
  topology: Topology,
  devices: Device[],
  site: SiteContext = EMPTY_SITE,
  rules: readonly Rule[] = RULES,
): RuleRunResult {
  const ctx: RuleContext = {
    topology,
    devices,
    graph: buildRenderGraph(topology, devices, ["power", "comms"]),
    site,
  };

  const findings: RuleFinding[] = [];
  for (const rule of rules) {
    try {
      findings.push(...rule.check(ctx));
    } catch (e) {
      findings.push({
        severity: "error",
        code: `${rule.id}.threw`,
        message: `룰 실행 실패: ${String(e)}`,
        refs: [topology.id],
        code_ref: rule.code_ref,
        verified: false,
      });
    }
  }

  const order = { error: 0, warning: 1, info: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code));

  const touched = new Set(findings.map((f) => f.code.split(".")[0]));
  return {
    topology_id: topology.id,
    findings,
    unverified: rules.filter((r) => !r.verified && touched.has(r.id)).map((r) => r.id),
  };
}

export * from "./types.js";
