import { z } from "zod";
import { Layer, Source, Status, Todo } from "./common.js";
import { Conductor, PortRef } from "./topology.js";

/**
 * 구성 템플릿 — 옵션 축을 가진 결선 그래프.
 *
 * 왜 topology JSON을 대체하는가: 같은 벤더라도 grid support / 부분 백업 / 전체 백업,
 * MSC냐 게이트웨이냐, 배터리를 몇 대 병렬하느냐에 따라 결선이 달라진다. 그 조합을
 * 파일 하나씩 손으로 쓰면 벤더 4종 × 조합 수만큼 파일이 생기고 서로 어긋난다.
 * 축을 데이터로 선언하고 조합은 컴포저(순수 함수)가 만든다.
 *
 * 컴포저의 출력은 기존과 동일한 Topology다 — 렌더러 · 시나리오 · 룰 · 비교는
 * 이 변경을 모른다.
 */

/** 옵션 값. enum은 문자열, int는 정수. */
export const OptionValue = z.union([z.string(), z.number().int()]);
export type OptionValue = z.infer<typeof OptionValue>;

export const OptionChoice = z
  .object({
    value: z.string().min(1),
    label: z.string().min(1),
    /** 이 선택지가 무엇을 바꾸는지. UI가 그대로 보여준다. */
    note: z.string().nullable().default(null),
  })
  .strict();

export const EnumAxis = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string().min(1),
    kind: z.literal("enum"),
    choices: z.array(OptionChoice).min(1),
    default: z.string().min(1),
    note: z.string().nullable().default(null),
  })
  .strict();

export const IntAxis = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string().min(1),
    kind: z.literal("int"),
    /** 0을 허용한다 — "배터리 없음"은 유효한 구성이다. */
    min: z.number().int().nonnegative(),
    max: z.number().int().positive(),
    step: z.number().int().positive().default(1),
    default: z.number().int().nonnegative(),
    unit: z.string().nullable().default(null),
    note: z.string().nullable().default(null),
  })
  .strict();

export const OptionAxis = z.discriminatedUnion("kind", [EnumAxis, IntAxis]);
export type OptionAxis = z.infer<typeof OptionAxis>;

/**
 * 등장 조건. `{ backup_mode: ["whole_home"] }` = backup_mode가 whole_home일 때만.
 * 키가 여러 개면 AND. 표현식 DSL을 만들지 않는다 — 파서가 생기는 순간 데이터가 코드가 된다.
 */
export const When = z.record(z.string(), z.array(z.string()).min(1));
export type When = z.infer<typeof When>;

/** 반복 노드. count/chunk는 옵션 축 id를 가리킨다. */
export const Repeat = z
  .object({
    /** 총 개수를 정하는 옵션 축 id */
    count: z.string().min(1),
    /**
     * 묶음 크기를 정하는 옵션 축 id. 직렬 스트링의 모듈 수, AC 분기회로당 유닛 수.
     * null이면 전체가 한 묶음이다.
     */
    chunk: z.string().nullable().default(null),
  })
  .strict();

/**
 * 반복 노드 사이의 결선 방식.
 * - single: 양끝 모두 단독 노드
 * - pairwise: 같은 개수의 두 반복 그룹을 인덱스끼리 (모듈 i → 마이크로인버터 i)
 * - chain: 같은 반복 그룹 안에서 i → i+1 (직렬 스트링, AC 트렁크). 묶음 경계를 넘지 않는다
 * - chunk_last: 각 묶음의 마지막 노드 → 도착 노드 (스트링 끝 → MPPT, 트렁크 끝 → 결합반).
 *   도착지가 여럿이면 묶음을 순서대로 나눠 붙인다 (스트링 2개 → 인버터 2대)
 * - first: 다중 유닛 중 대표 하나만 (통신 리더 유닛)
 * - each: 반복 노드 전부 → 단독 노드 (포트 max_connections가 감당할 때만)
 */
export const Fanout = z.enum(["single", "pairwise", "chain", "chunk_last", "each", "first"]);
export type Fanout = z.infer<typeof Fanout>;

export const TemplateNode = z
  .object({
    ref: z.string().regex(/^[a-z0-9_-]+$/),
    /** 고정 device id. device_from을 쓰면 그 축의 값이 이 자리를 대신한다(기본값 역할). */
    device: z.string().min(1),
    /**
     * device를 고르는 옵션 축 id. 축의 선택지 값이 곧 device id다 —
     * "모듈/인버터/ESS를 고른다"가 이것으로 표현된다. 축 값이 비면 device로 떨어진다.
     */
    device_from: z.string().nullable().default(null),
    label: z.string().nullable().default(null),
    count: z.number().int().positive().default(1),
    /** 개수를 옵션 축에서 받는다(배터리 확장 · 병렬 인버터). repeat과 함께 쓰지 않는다. */
    count_from: z.string().nullable().default(null),
    repeat: Repeat.nullable().default(null),
    when: When.default({}),
  })
  .strict();

export const TemplateEdge = z
  .object({
    from: PortRef,
    to: PortRef,
    layer: Layer.default("power"),
    conductor: Conductor.nullable().default(null),
    fanout: Fanout.default("single"),
    when: When.default({}),
  })
  .strict();

/** 이름 붙은 조합. 기존 topology 파일의 id를 그대로 물려받아 링크가 깨지지 않게 한다. */
export const Preset = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    display_name: z.string().min(1),
    options: z.record(z.string(), OptionValue).default({}),
    note: z.string().nullable().default(null),
  })
  .strict();

export const ConfigTemplate = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    vendor: z.string().min(1),
    display_name: z.string().min(1),
    status: Status,
    /**
     * vendor = 그 회사의 실제 구성. workbench = 제품을 직접 골라 조합하는 실험용.
     * 벤더 비교(4분할)의 기본 대상은 vendor만이다 — workbench는 벤더가 아니다.
     */
    role: z.enum(["vendor", "workbench"]).default("vendor"),
    /**
     * backup_mode 축이 없을 때 쓰는 고정 범위.
     * backup_mode 축이 있으면 그 값(none|partial|whole_home)이 그대로 backup_scope가 된다.
     */
    backup_scope: z.enum(["none", "partial", "whole_home"]).default("none"),
    options: z.array(OptionAxis).default([]),
    nodes: z.array(TemplateNode).min(1),
    edges: z.array(TemplateEdge).min(1),
    presets: z.array(Preset).min(1),
    sources: z.array(Source).default([]),
    todos: z.array(Todo).default([]),
  })
  .strict();

export type ConfigTemplate = z.infer<typeof ConfigTemplate>;
export type TemplateNode = z.infer<typeof TemplateNode>;
export type TemplateEdge = z.infer<typeof TemplateEdge>;
export type Preset = z.infer<typeof Preset>;
