import type { Rule, RuleContext } from "../src/rules/types.js";
import { finding, AGGREGATOR_CLASSES, SOURCE_CLASSES } from "../src/rules/types.js";
import type { RuleFinding } from "../src/schema/rule.js";

/**
 * 서플라이 사이드(라인측) 탭 구성 여부.
 *
 * 전원이 서비스 도체(ac_service_line)에 직접 붙으면 라인측 탭이다.
 * 부하측 인터커넥션(120% 룰)과는 적용 조항이 갈리므로 먼저 어느 쪽인지 판정한다.
 */
const rule: Rule = {
  id: "R020",
  title: "서플라이 사이드 탭 구성",
  code_ref: "NEC 705.11 계열 — 원문 대조 필요",
  verified: false,

  check(ctx: RuleContext): RuleFinding[] {
    const taps = ctx.graph.edges.filter((e) => {
      if (e.layer !== "power") return false;
      for (const [near, far] of [
        [e.from, e.to],
        [e.to, e.from],
      ] as const) {
        if (near.port.type !== "ac_service_line") continue;
        const farNode = ctx.graph.byRef.get(far.nodeRef);
        if (!farNode) continue;
        if (SOURCE_CLASSES.has(farNode.device.class) || AGGREGATOR_CLASSES.has(farNode.device.class)) {
          return true;
        }
      }
      return false;
    });

    if (taps.length === 0) {
      return [
        finding(rule, {
          severity: "info",
          code: "R020.none",
          message: "라인측 탭 없음 — 전원이 전부 분기회로에 붙은 부하측 인터커넥션이다",
          refs: [ctx.topology.id],
        }),
      ];
    }

    return [
      finding(rule, {
        severity: "warning",
        code: "R020",
        message:
          `라인측 탭 ${taps.length}건. 서비스 도체 정격, 탭 도체 보호, 표시 요건 등 ` +
          `해당 조항의 조건 충족 여부를 원문으로 확인해야 한다`,
        refs: taps.map((e) => e.id),
      }),
    ];
  },
};

export default rule;
