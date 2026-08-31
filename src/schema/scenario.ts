import { z } from "zod";

/**
 * 운전 상태 정의. 시나리오는 데이터다 — 엔진은 이 값들만 보고 급전을 계산한다.
 *
 * 의도적으로 모델링하지 않는 것: 발전량(kW), SOC(%), 부하 크기.
 * 이 도구는 "어디에 전기가 살아 있고 어느 방향으로 흐르는가"만 답한다.
 * 크기를 다루기 시작하면 발전량 시뮬레이터가 되고, 그건 비목적이다(CLAUDE.md §1).
 */

/** 계통(유틸리티) 가용 여부. */
export const GridState = z.enum(["present", "absent"]);
export type GridState = z.infer<typeof GridState>;

/** PV 발전 가능 여부. 일사량/발전량은 모델링하지 않는다. */
export const PvState = z.enum(["producing", "dark"]);
export type PvState = z.infer<typeof PvState>;

/**
 * 축전지 상태.
 * available = 방전 가능 · depleted = 잔량 없음(기동 불가) · offline = 차단/고장
 */
export const BatteryState = z.enum(["available", "depleted", "offline"]);
export type BatteryState = z.infer<typeof BatteryState>;

export const Scenario = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/, "id는 소문자-언더스코어 슬러그"),
    display_name: z.string().min(1),
    description: z.string().min(1),
    /** UI 표시 순서. 상태 전이 순서가 아니다. */
    order: z.number().int().nonnegative(),
    grid: GridState,
    pv: PvState,
    battery: BatteryState,
    /**
     * 이 시나리오에서 항상 개방되는 노드 ref.
     * MID는 여기 적지 않는다 — 계통 부재 시 provides_mid 장치가 자동 개방된다.
     */
    open_nodes: z.array(z.string()).default([]),
    /**
     * 트립 대상을 호출자가 지정해야 하는가(fault 계열).
     * true인데 지정이 없으면 엔진이 info를 남기고 트립 없이 평가한다.
     */
    requires_trip_target: z.boolean().default(false),
    /** 부하 차단 시나리오인가. 부하 노드가 모델링되기 전까지 엔진이 gap을 보고한다. */
    load_shed: z.boolean().default(false),
    notes: z.array(z.string()).default([]),
  })
  .strict();

export type Scenario = z.infer<typeof Scenario>;
