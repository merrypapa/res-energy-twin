import type { Rule, RuleContext } from "../src/rules/types.js";
import { finding, SOURCE_CLASSES } from "../src/rules/types.js";
import type { RuleFinding } from "../src/schema/rule.js";

/**
 * 백업 부하 합계 vs 인버터 연속 출력.
 *
 * kW와 kVA를 섞지 않는다. 역률을 모르는 상태에서 kVA를 kW로 환산하면
 * 없는 정보를 만들어 내는 것이다. 단위가 갈리면 갈린 채로 보고한다.
 */
const rule: Rule = {
  id: "R030",
  title: "백업 부하 합계 대비 인버터 연속 출력",
  code_ref: null,
  verified: false,

  check(ctx: RuleContext): RuleFinding[] {
    const out: RuleFinding[] = [];
    const sources = ctx.graph.nodes.filter((n) => SOURCE_CLASSES.has(n.device.class));

    if (ctx.topology.backup_scope === "none") return out;
    if (sources.length === 0) return out;

    // 이 룰은 아일랜드 경계를 계산하지 않는다. whole_home이 아니면 과대평가가 된다.
    if (ctx.topology.backup_scope !== "whole_home") {
      out.push(
        finding(rule, {
          severity: "info",
          code: "R030.scope",
          message:
            `backup_scope=${ctx.topology.backup_scope} — 이 룰은 아일랜드 경계를 계산하지 않아 ` +
            `전 인버터를 백업 전원으로 합산한다. 실제 백업 용량보다 클 수 있다`,
          refs: sources.map((n) => n.ref),
        }),
      );
    }

    const kw = sources.filter((n) => n.device.ratings.continuous_ac_kw !== null);
    const kva = sources.filter((n) => n.device.ratings.continuous_ac_kva !== null);
    const unrated = sources.filter(
      (n) => n.device.ratings.continuous_ac_kw === null && n.device.ratings.continuous_ac_kva === null,
    );

    const kwSum = kw.reduce((s, n) => s + (n.device.ratings.continuous_ac_kw ?? 0) * n.count, 0);
    const kvaSum = kva.reduce((s, n) => s + (n.device.ratings.continuous_ac_kva ?? 0) * n.count, 0);

    if (unrated.length > 0) {
      out.push(
        finding(rule, {
          severity: "info",
          code: "R030.1",
          // 배열이 20노드로 펼쳐진 뒤로 같은 제품 id를 20번 나열하면 읽히지 않는다.
          message: `연속 출력 정격이 없는 전원 ${unrated.length}건은 합산에서 빠졌다 (${[
            ...new Set(unrated.map((n) => n.device.id)),
          ].join(", ")})`,
          refs: unrated.map((n) => n.ref),
        }),
      );
    }

    if (ctx.site.backup_load_kw === null) {
      out.push(
        finding(rule, {
          severity: "info",
          code: "R030.2",
          message:
            `백업 부하(site.backup_load_kw)가 없어 판정을 할 수 없다. ` +
            `현재 전원 합계: ${describe(kwSum, kvaSum)}`,
          refs: sources.map((n) => n.ref),
        }),
      );
      return out;
    }

    const load = ctx.site.backup_load_kw;

    if (kvaSum > 0 && kwSum === 0) {
      out.push(
        finding(rule, {
          severity: "info",
          code: "R030.3",
          message:
            `전원 정격이 kVA(${kvaSum} kVA)로만 주어져 kW 부하 ${load} kW와 직접 비교할 수 없다. ` +
            `역률을 알아야 판정 가능하다`,
          refs: sources.map((n) => n.ref),
        }),
      );
      return out;
    }

    if (kwSum < load) {
      out.push(
        finding(rule, {
          severity: "warning",
          code: "R030",
          message:
            `백업 부하 ${load} kW 가 인버터 연속 출력 ${kwSum} kW 를 초과한다. ` +
            `부하 차단 또는 백업 경계 축소 필요` +
            (kvaSum > 0 ? ` (별도로 ${kvaSum} kVA 전원이 있으나 단위가 달라 합산하지 않았다)` : ""),
          refs: sources.map((n) => n.ref),
        }),
      );
    } else {
      out.push(
        finding(rule, {
          severity: "info",
          code: "R030.ok",
          message: `백업 부하 ${load} kW ≤ 연속 출력 ${kwSum} kW`,
          refs: sources.map((n) => n.ref),
        }),
      );
    }

    return out;
  },
};

function describe(kwSum: number, kvaSum: number): string {
  const parts: string[] = [];
  if (kwSum > 0) parts.push(`${kwSum} kW`);
  if (kvaSum > 0) parts.push(`${kvaSum} kVA`);
  return parts.length > 0 ? parts.join(" + ") : "정격 없음";
}

export default rule;
