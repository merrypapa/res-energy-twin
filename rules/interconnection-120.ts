import type { Rule, RuleContext } from "../src/rules/types.js";
import { finding, AGGREGATOR_CLASSES, BRANCH_PORT_TYPES, SOURCE_CLASSES } from "../src/rules/types.js";
import type { RuleFinding } from "../src/schema/rule.js";

/**
 * 버스바 정격 대비 전원 합산 — 인터커넥션 120% 룰.
 *
 * 판정: 메인 OCPD + 백피드 OCPD 합 ≤ 버스바 정격 × 1.2
 *
 * 백피드는 "분기회로 포트에 붙은 전원"으로 식별한다. 서비스 도체(ac_service_line)로
 * 들어오는 것은 공급이지 백피드가 아니다. 포트 id가 아니라 포트 type으로 가른다.
 */
const rule: Rule = {
  id: "R010",
  title: "버스바 정격 대비 전원 합산 (120% 룰)",
  code_ref: "NEC 705.12(B) 계열 — 원문 대조 필요",
  verified: false,

  check(ctx: RuleContext): RuleFinding[] {
    const out: RuleFinding[] = [];

    for (const node of ctx.graph.nodes) {
      if (node.device.class !== "main_panel" && node.device.class !== "subpanel") continue;

      const busbar = node.device.ratings.busbar_a;
      const main = node.device.ratings.main_ocpd_a;

      const backfeeds = ctx.graph.edges.filter((e) => {
        const near = e.from.nodeRef === node.ref ? e.from : e.to.nodeRef === node.ref ? e.to : null;
        if (!near || e.layer !== "power") return false;
        if (!BRANCH_PORT_TYPES.has(near.port.type)) return false;
        const farRef = e.from.nodeRef === node.ref ? e.to.nodeRef : e.from.nodeRef;
        const far = ctx.graph.byRef.get(farRef);
        if (!far) return false;
        return SOURCE_CLASSES.has(far.device.class) || AGGREGATOR_CLASSES.has(far.device.class);
      });

      if (backfeeds.length === 0) continue;

      const refs = [node.ref, ...backfeeds.map((e) => e.id)];

      if (busbar === null) {
        out.push(
          finding(rule, {
            severity: "info",
            code: "R010.1",
            message: `${node.label}: 버스바 정격이 없어 120% 판정을 할 수 없다`,
            refs,
          }),
        );
        continue;
      }

      const missing = backfeeds.filter((e) => ocpdOf(ctx, e.id) === null);
      if (missing.length > 0) {
        out.push(
          finding(rule, {
            severity: "info",
            code: "R010.2",
            message:
              `${node.label}: 백피드 도체 ${missing.length}건의 OCPD가 기재되지 않아 판정을 할 수 없다 ` +
              `(${missing.map((e) => e.id).join(", ")})`,
            refs,
          }),
        );
        continue;
      }

      const backfeedSum = backfeeds.reduce((n, e) => n + (ocpdOf(ctx, e.id) ?? 0), 0);
      const mainPart = main ?? 0;
      const allowed = busbar * 1.2;
      const total = mainPart + backfeedSum;

      if (main === null) {
        out.push(
          finding(rule, {
            severity: "info",
            code: "R010.3",
            message: `${node.label}: 메인 OCPD가 없어 백피드분(${backfeedSum}A)만 계산했다`,
            refs,
          }),
        );
      }

      if (total > allowed) {
        out.push(
          finding(rule, {
            severity: "warning",
            code: "R010",
            message:
              `${node.label}: 메인 ${mainPart}A + 백피드 ${backfeedSum}A = ${total}A 가 ` +
              `버스바 ${busbar}A의 120%(${allowed}A)를 초과한다. ` +
              `버스바 상향, 백피드 정격 축소, 또는 라인측 탭 등 다른 인터커넥션 방식 검토 필요`,
            refs,
          }),
        );
      } else {
        out.push(
          finding(rule, {
            severity: "info",
            code: "R010.ok",
            message: `${node.label}: ${total}A ≤ ${allowed}A — 120% 한도 안`,
            refs,
          }),
        );
      }
    }

    return out;
  },
};

/** 엣지의 도체 OCPD. 그래프는 라벨 문자열만 갖고 있어 원본 토폴로지에서 읽는다. */
function ocpdOf(ctx: RuleContext, edgeId: string): number | null {
  const e = ctx.topology.edges.find((x) => `${x.from}->${x.to}` === edgeId);
  return e?.conductor?.ocpd_a ?? null;
}

export default rule;
