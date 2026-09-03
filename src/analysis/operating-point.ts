import { z } from "zod";
import type { Location } from "../schema/location.js";
import { irradianceRatio, sunAt } from "./solar.js";

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
    /**
     * 일사 강도비 G/1000 W/m². 1.0 = STC.
     * location이 지정되면 이 값은 (위도, 월, 시각)에서 계산돼 덮어써진다 — withSolar() 참조.
     */
    irradiance: z.number().min(0).max(1.2).default(0.8),
    /** 사이트 위치 id. null이면 일사를 직접 준다 */
    location_id: z.string().nullable().default(null),
    /** 월(1–12). 계절이 이 값으로 들어온다 */
    month: z.number().int().min(1).max(12).default(6),
    /** 현지 시각(0–24). 하루의 신호 변화가 이 축을 따라간다 */
    hour: z.number().min(0).max(24).default(12),
    /** 맑음 대비 감쇠(0–1). 구름을 모델링하는 것이 아니다 */
    clearness: z.number().min(0).max(1).default(1),
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

/**
 * 위치·월·시각에서 일사를 계산해 채운 동작점.
 * 위치가 없으면 손으로 준 irradiance를 그대로 쓴다 — 값을 지어내지 않는다.
 */
export function withSolar(op: OperatingPoint, location: Location | null): OperatingPoint {
  if (location === null) return op;
  return { ...op, irradiance: Math.min(1.2, irradianceRatio(location, op.month, op.hour, op.clearness)) };
}

export function formatHour(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.round((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function assumptionLines(op: OperatingPoint, location: Location | null = null): string[] {
  const solar =
    location === null
      ? []
      : [
          `${location.display_name} · ${op.month}월 · ${formatHour(op.hour)} · 태양 고도 ` +
            `${sunAt(location.latitude_deg, op.month, op.hour, op.clearness).elevation_deg.toFixed(1)}°` +
            (op.clearness < 1 ? ` · 맑음 대비 ${Math.round(op.clearness * 100)}%` : ""),
        ];
  return [
    ...solar,
    `일사 ${Math.round(op.irradiance * 100)}% (G = ${Math.round(op.irradiance * 1000)} W/m², STC 대비)`,
    op.house_load_kw === null ? "주택 부하 미지정 — 발전 전량을 상류로 보낸다" : `주택 부하 ${op.house_load_kw} kW`,
    `인버터 효율 ${(op.inverter_efficiency * 100).toFixed(0)}% · 역률 ${op.power_factor.toFixed(2)} (가정값, 제품 스펙 아님)`,
    "온도계수 미반영 — 모듈 전압은 STC 값 그대로 쓴다",
  ];
}
