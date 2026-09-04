import type { Rule, RuleContext } from "../src/rules/types.js";
import { finding } from "../src/rules/types.js";
import type { RuleFinding } from "../src/schema/rule.js";

/**
 * 분기회로당 유닛 수 — 제조사가 정한 상한을 넘지 않는가.
 *
 * 마이크로인버터는 한 분기회로(트렁크)에 여러 대가 물린다. 몇 대까지 물릴 수 있는지는
 * 분기 차단기 정격과 유닛 정격 전류가 정하며, 제조사가 데이터시트에 상한으로 적는다.
 * 그 값이 없는 제품은 판정하지 않는다 — 상한을 추정하지 않는다.
 *
 * 대상은 AC 분기에 스스로 출력을 내보내는 장치뿐이다. 모듈처럼 DC만 내는 장치는
 * 분기회로에 물리는 유닛이 아니므로 세지 않는다 — 스트링 직렬 수는 전압이 정하는
 * 다른 문제고, 이 룰이 답할 질문이 아니다.
 */
const AC_BRANCH_PORTS = new Set(["ac_240v_split", "ac_120v_branch"]);
const rule: Rule = {
  id: "R070",
  title: "분기회로당 유닛 수 대비 제조사 상한",
  code_ref: null,
  verified: false,

  check(ctx: RuleContext): RuleFinding[] {
    const out: RuleFinding[] = [];

    /** 분기(트렁크) 단위 = 컴포저가 매긴 그룹. 그룹이 없으면 단독 유닛이라 셀 것이 없다. */
    const branches = new Map<string, { deviceId: string; refs: string[]; limit: number | null }>();
    for (const n of ctx.graph.nodes) {
      const group = ctx.topology.nodes.find((t) => t.ref === n.ref)?.group ?? null;
      if (group === null) continue;
      const feedsAcBranch = n.device.ports.some(
        (p) => AC_BRANCH_PORTS.has(p.type) && p.direction !== "in",
      );
      if (!feedsAcBranch) continue;
      const limit = n.device.ratings.max_units_per_branch;
      const key = `${group}|${n.device.id}`;
      const acc = branches.get(key) ?? { deviceId: n.device.id, refs: [], limit };
      acc.refs.push(n.ref);
      branches.set(key, acc);
    }

    const unknown = new Map<string, number>();
    for (const [key, b] of branches) {
      const group = key.split("|")[0]!;
      if (b.limit === null) {
        // 상한이 없는 제품은 조용히 넘기지 않되, 같은 제품이 여러 분기에 있으면 한 줄로 모은다.
        unknown.set(b.deviceId, (unknown.get(b.deviceId) ?? 0) + 1);
        continue;
      }
      if (b.refs.length > b.limit) {
        out.push(
          finding(rule, {
            severity: "warning",
            code: "R070",
            message:
              `${group} 분기에 ${b.deviceId} ${b.refs.length}대가 물렸다. ` +
              `제조사 상한은 ${b.limit}대다 — 분기를 나누거나 유닛 수를 줄여야 한다`,
            refs: b.refs,
          }),
        );
      } else {
        out.push(
          finding(rule, {
            severity: "info",
            code: "R070.ok",
            message: `${group} 분기: ${b.refs.length}대 ≤ 상한 ${b.limit}대`,
            refs: b.refs,
          }),
        );
      }
    }

    for (const [deviceId, count] of unknown) {
      out.push(
        finding(rule, {
          severity: "info",
          code: "R070.1",
          message:
            `${deviceId}: 분기회로당 최대 유닛 수(max_units_per_branch)가 없어 ` +
            `${count}개 분기의 유닛 수를 판정하지 않았다`,
          refs: [ctx.topology.id],
        }),
      );
    }

    return out;
  },
};

export default rule;
