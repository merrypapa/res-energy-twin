import type { Rule } from "../src/rules/types.js";
import interconnection120 from "./interconnection-120.js";
import supplySideTap from "./supply-side-tap.js";
import backupCapacity from "./backup-capacity.js";
import motorStart from "./motor-start.js";
import utilityApproval from "./utility-approval.js";
import branchUnits from "./branch-units.js";

/**
 * 룰 레지스트리. 파일을 추가하고 여기 등록하면 끝이다.
 *
 * 포트 타입 불일치와 requires_one_of 누락은 여기 없다 —
 * 그건 데이터 정합성이라 검증기(src/validate/checks.ts, E023/E025)가 이미 본다.
 * 룰 엔진은 "이 데이터가 말이 되는가"가 아니라 "이 구성이 이 집에 성립하는가"를 답한다.
 */
export const RULES: readonly Rule[] = [
  interconnection120,
  supplySideTap,
  backupCapacity,
  motorStart,
  utilityApproval,
  branchUnits,
];
