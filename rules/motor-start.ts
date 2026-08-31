import type { Rule, RuleContext } from "../src/rules/types.js";
import { finding, SOURCE_CLASSES } from "../src/rules/types.js";
import type { RuleFinding } from "../src/schema/rule.js";

/**
 * 모터 기동 — 최대 LRA 부하 vs 장비 LRA 정격.
 *
 * 백업 중 에어컨이 뜨느냐를 가르는 항목이다. 연속 출력이 충분해도 기동 전류에서 걸린다.
 */
const rule: Rule = {
  id: "R040",
  title: "모터 기동 전류 대비 장비 LRA 정격",
  code_ref: null,
  verified: false,

  check(ctx: RuleContext): RuleFinding[] {
    if (ctx.topology.backup_scope === "none") return [];

    const sources = ctx.graph.nodes.filter((n) => SOURCE_CLASSES.has(n.device.class));
    if (sources.length === 0) return [];

    const rated = sources.filter((n) => n.device.ratings.lra !== null);
    const refs = sources.map((n) => n.ref);

    if (ctx.site.largest_motor_lra === null) {
      return [
        finding(rule, {
          severity: "info",
          code: "R040.1",
          message:
            `최대 모터 기동 전류(site.largest_motor_lra)가 없어 판정을 할 수 없다. ` +
            (rated.length > 0
              ? `장비 LRA 정격: ${rated.map((n) => `${n.label} ${n.device.ratings.lra}`).join(", ")}`
              : `장비 LRA 정격도 기재되지 않았다`),
          refs,
        }),
      ];
    }

    if (rated.length === 0) {
      return [
        finding(rule, {
          severity: "warning",
          code: "R040.2",
          message:
            `장비 LRA 정격이 기재되지 않아 모터 기동 ${ctx.site.largest_motor_lra}A 성립 여부를 ` +
            `판정할 수 없다. 매뉴얼 확인 필요`,
          refs,
        }),
      ];
    }

    // 여러 전원이 병렬로 기동을 분담하는지는 제품마다 다르다. 최대값 하나로만 본다.
    const best = rated.reduce((a, b) => ((a.device.ratings.lra ?? 0) >= (b.device.ratings.lra ?? 0) ? a : b));
    const capacity = best.device.ratings.lra ?? 0;

    if (ctx.site.largest_motor_lra > capacity) {
      return [
        finding(rule, {
          severity: "warning",
          code: "R040",
          message:
            `모터 기동 ${ctx.site.largest_motor_lra}A 가 ${best.label}의 LRA 정격 ${capacity}A 를 초과한다. ` +
            `소프트스타터 또는 해당 부하 백업 제외 검토 필요`,
          refs: [best.ref],
        }),
      ];
    }

    return [
      finding(rule, {
        severity: "info",
        code: "R040.ok",
        message: `모터 기동 ${ctx.site.largest_motor_lra}A ≤ ${best.label} LRA ${capacity}A`,
        refs: [best.ref],
      }),
    ];
  },
};

export default rule;
