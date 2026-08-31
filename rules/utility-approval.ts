import type { Rule, RuleContext } from "../src/rules/types.js";
import { finding } from "../src/rules/types.js";
import type { RuleFinding } from "../src/schema/rule.js";

/**
 * 유틸리티 승인이 필요한 장치의 승인 상태.
 *
 * 미터 컬러류가 대표적이다 — 미터 소켓 뒤에 들어가므로 유틸리티별로 허용 여부가 갈리고,
 * 승인 현황은 시간에 따라 변한다. 그래서 "승인됨"도 확인일 없이는 근거가 되지 않는다.
 */
const rule: Rule = {
  id: "R050",
  title: "유틸리티 승인 필요 장치의 승인 상태",
  code_ref: null,
  verified: false,

  check(ctx: RuleContext): RuleFinding[] {
    const out: RuleFinding[] = [];

    for (const node of ctx.graph.nodes) {
      const ua = node.device.utility_approval;
      if (!ua || !ua.required) continue;

      const site = ctx.site.utility ? `${ctx.site.utility} 기준 ` : "";
      const note = ua.note ? ` — ${ua.note}` : "";
      const dated = node.device.sources.some((s) => s.date !== null);

      if (ua.status === "approved") {
        out.push(
          finding(rule, {
            severity: dated ? "info" : "warning",
            code: dated ? "R050.ok" : "R050.3",
            message: dated
              ? `${node.label}: ${site}승인됨${note}`
              : `${node.label}: 승인됨으로 기재되어 있으나 확인일이 없다. 승인 현황은 변한다${note}`,
            refs: [node.ref],
          }),
        );
        continue;
      }

      if (ua.status === "not_applicable") continue;

      out.push(
        finding(rule, {
          severity: "warning",
          code: ua.status === "partial" ? "R050.1" : "R050.2",
          message:
            ua.status === "partial"
              ? `${node.label}: 일부 유틸리티만 승인. ${site}적용 가능 여부를 개별 확인해야 한다${note}`
              : `${node.label}: 승인 상태 ${ua.status}. ${site}확인 전까지 이 구성을 제안할 수 없다${note}`,
          refs: [node.ref],
        }),
      );
    }

    return out;
  },
};

export default rule;
