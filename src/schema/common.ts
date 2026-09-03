import { z } from "zod";

/** 데이터의 신뢰 수준. draft = 미검증, 사내 배포/비교 자료에 인용 금지. */
export const Status = z.enum(["verified", "draft"]);

/** 출처. 숫자 스펙이 하나라도 있으면 최소 1건 필요 (validate.ts에서 강제). */
export const Source = z.object({
  ref: z.string().min(1),
  /** 원문 링크(데이터시트·매뉴얼). UI가 그대로 건다. */
  url: z.string().url().nullable().default(null),
  date: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
});

export const Todo = z.string().min(1);

export const Layer = z.enum(["power", "comms", "physical"]);
export type Layer = z.infer<typeof Layer>;

export type Severity = "error" | "warning" | "info";

export interface Finding {
  severity: Severity;
  code: string;
  message: string;
  where: string;
}
