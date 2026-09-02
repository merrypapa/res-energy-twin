import { z } from "zod";

/**
 * 동작점 — 신호 계산의 입력.
 *
 * 이것은 발전량 시뮬레이션이 아니다 (CLAUDE.md §1 비목적). 정격과 결선에서
 * "지금 이 순간 각 지점에 얼마가 흐르는가"를 한 점만 계산한다. 시간 적분도,
 * 기상 데이터도, SOC 궤적도 없다.
 *
 * efficiency / power_factor는 제품 스펙이 아니라 **명시적 가정값**이다.
 * device-library에 넣지 않는 이유가 그것이다 — 확인된 값이 생기면 그때 옮긴다.
 */
export const OperatingPoint = z
  .object({
    /** 일사 강도비 G/1000 W/m². 1.0 = STC */
    irradiance: z.number().min(0).max(1.2).default(0.8),
    /** 주택 부하(kW). null이면 부하를 모르는 상태로 계산한다 */
    house_load_kw: z.number().min(0).nullable().default(null),
    /** 인버터 변환 효율 가정 */
    inverter_efficiency: z.number().min(0.5).max(1).default(0.97),
    /** 역률 가정 */
    power_factor: z.number().min(0.5).max(1).default(1.0),
  })
  .strict();

export type OperatingPoint = z.infer<typeof OperatingPoint>;
export const DEFAULT_OP: OperatingPoint = OperatingPoint.parse({});

export function assumptionLines(op: OperatingPoint): string[] {
  return [
    `일사 ${Math.round(op.irradiance * 100)}% (G = ${Math.round(op.irradiance * 1000)} W/m², STC 대비)`,
    op.house_load_kw === null ? "주택 부하 미지정 — 발전 전량을 상류로 보낸다" : `주택 부하 ${op.house_load_kw} kW`,
    `인버터 효율 ${(op.inverter_efficiency * 100).toFixed(0)}% · 역률 ${op.power_factor.toFixed(2)} (가정값, 제품 스펙 아님)`,
    "온도계수 미반영 — 모듈 전압은 STC 값 그대로 쓴다",
  ];
}
