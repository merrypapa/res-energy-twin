import { z } from "zod";
import { Source, Todo } from "./common.js";

/**
 * 노드 포인트의 설계·기능 노트.
 *
 * 왜 데이터인가: "이 지점에서 무엇이 중요한가"는 제품 지식이다. UI나 렌더러에
 * 문자열로 박으면 벤더 분기문과 같은 실수가 된다 (CLAUDE.md §2, §10).
 * class 단위로 쓰고, 특정 제품에만 해당하면 device 단위로 덧붙인다.
 */
export const DesignPoint = z
  .object({
    title: z.string().min(1),
    body: z.string().min(1),
    /** 관련 수식. 값이 아니라 형태만 적는다 — 숫자는 신호 엔진이 계산해 채운다. */
    formula: z.string().nullable().default(null),
    /** 근거 조항. 모델 기억으로 조문을 인용하지 않는다 (CLAUDE.md §5). */
    code_ref: z.string().nullable().default(null),
    /** 원문 대조 여부. 기본 false. */
    verified: z.boolean().default(false),
  })
  .strict();

export const NodeNote = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** class 또는 device 중 하나로 붙는다. 둘 다 있으면 device가 더 구체적인 노트다. */
    applies_to: z
      .object({
        class: z.string().nullable().default(null),
        device: z.string().nullable().default(null),
      })
      .strict(),
    /** 이 노드가 계통 안에서 맡는 일. 한 문장. */
    role: z.string().min(1),
    design_points: z.array(DesignPoint).default([]),
    /** 설계 시 걸리는 지점. 판정이 아니라 확인 항목이다. */
    watch_outs: z.array(z.string()).default([]),
    sources: z.array(Source).default([]),
    todos: z.array(Todo).default([]),
  })
  .strict();

export type NodeNote = z.infer<typeof NodeNote>;
export type DesignPoint = z.infer<typeof DesignPoint>;
