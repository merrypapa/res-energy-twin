import { z } from "zod";
import { Source, Todo } from "./common.js";

/**
 * 함체 내부 구성. 단선도는 한 함체를 한 상자로 그린다 — 그것이 단선도의 정의다.
 * 그 안이 실제로 어떻게 갈라지는지(ESS = 변환기 + 셀, 결합반 = 모선 + 차단기들)는
 * 여기에 적고, 장치를 고르면 따로 보여준다.
 *
 * 이것은 결선 그래프가 아니다. 전력 조류도 룰 판정도 이 값을 보지 않는다 —
 * 확인되지 않은 내부 구조가 계산에 새어 들어가면 안 된다. 읽기 위한 기술이다.
 */
export const InternalKind = z.enum([
  "converter",   // 인버터·PCS 등 변환부
  "cells",       // 축전지 셀 뭉치
  "breaker",     // 차단기 · 개폐기
  "lug",         // 접속 러그. 차단기가 아니다 — 과전류 보호가 없다
  "busbar",      // 모선
  "meter",       // 계량·계측
  "contactor",   // 계통 분리 접점
  "controller",  // 제어·통신부
  "other",
]);
export type InternalKind = z.infer<typeof InternalKind>;

export const InternalBlock = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]+$/),
    display_name: z.string().min(1),
    kind: InternalKind,
    /** 이 블록이 물리는 외부 포트 id. 내부 전용이면 null */
    port: z.string().nullable().default(null),
    /** 차단기·모선 정격(A). 모르면 null — 추정해 넣지 않는다 */
    ocpd_a: z.number().positive().nullable().default(null),
    /** 같은 종류가 여러 개인 자리(차단기 뱅크 등). 개수를 모르면 null */
    count: z.number().int().positive().nullable().default(1),
    note: z.string().nullable().default(null),
  })
  .strict();

export const InternalLink = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    domain: z.enum(["ac", "dc", "signal"]),
  })
  .strict();

export const Internals = z
  .object({
    blocks: z.array(InternalBlock).min(1),
    links: z.array(InternalLink).default([]),
    sources: z.array(Source).default([]),
    todos: z.array(Todo).default([]),
  })
  .strict();

export type InternalBlock = z.infer<typeof InternalBlock>;
export type InternalLink = z.infer<typeof InternalLink>;
export type Internals = z.infer<typeof Internals>;
