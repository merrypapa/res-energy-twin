import { z } from "zod";
import type { Severity } from "./common.js";

/**
 * 사이트 고유 조건. 토폴로지에는 담기지 않는 값이다 — 같은 구성도 집마다 성립 여부가 갈린다.
 * 전부 nullable이고, 값이 없으면 룰은 "판정 불가"를 보고한다. 기본값을 추정해 넣지 않는다.
 */
export const SiteContext = z
  .object({
    /** 유틸리티 사업자. 미터 컬러류 승인 판정에 쓴다. */
    utility: z.string().nullable().default(null),
    /** 백업 경계 안쪽 부하 합계(kW). */
    backup_load_kw: z.number().positive().nullable().default(null),
    /** 백업 대상 중 가장 큰 모터 부하의 기동 전류(LRA). 보통 에어컨 압축기다. */
    largest_motor_lra: z.number().positive().nullable().default(null),
    /** 서비스 정격(A). 토폴로지의 service_point와 다를 수 있다. */
    service_a: z.number().positive().nullable().default(null),
  })
  .strict();

export type SiteContext = z.infer<typeof SiteContext>;

export const EMPTY_SITE: SiteContext = SiteContext.parse({});

/**
 * 룰 결과. 검증기의 Finding과 달리 refs(관련 노드/엣지)와 근거 조항을 갖는다.
 *
 * verified=false는 "조문 원문을 대조하지 않았다"는 뜻이고 기본값이다.
 * CLAUDE.md §5: 코드 조항을 모델 기억으로 인용하지 않는다.
 */
export interface RuleFinding {
  severity: Severity;
  code: string;
  message: string;
  /** 관련 노드 ref 또는 엣지 id. 도면에서 하이라이트할 대상이다. */
  refs: string[];
  code_ref: string | null;
  verified: boolean;
}
