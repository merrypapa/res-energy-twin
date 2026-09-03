import type { Location } from "../schema/location.js";

/**
 * 태양 위치와 맑은 하늘 일사 근사.
 *
 * **이것은 발전량 시뮬레이션이 아니다.** 기상 데이터도, 구름도, 음영도, 온도도,
 * 반사·오염 손실도 없다. 위도와 날짜와 시각으로 태양 고도를 구하고, 맑은 하늘을
 * 가정해 경사면 일사를 근사한 값이다. 하루 동안 신호가 어떻게 움직이는지 보기 위한
 * 것이며, 실제 발전량 예측에 쓸 수 없다.
 *
 * 쓰는 근사:
 *   적위      δ = 23.45° · sin(360°·(284+n)/365)          (Cooper 근사)
 *   시간각    ω = 15°·(t − 12)                            (진태양시 ≈ 시계 시각으로 둔다)
 *   고도      sin α = sinφ·sinδ + cosφ·cosδ·cosω
 *   대기질량  AM = 1 / sin α
 *   직달      DNI = 1353 · 0.7^(AM^0.678)                 (Meinel 계열 경험식)
 *   경사면    G = DNI·cos θ + 0.1·DNI·sin α               (경사 = 위도, 정남향 가정)
 *
 * 경사를 위도와 같게 두면 cos θ = cos δ · cos ω로 정리된다 — 남향 고정 경사의 표준 가정이다.
 */
export const SOLAR_MODEL = {
  name: "맑은 하늘 근사 (Cooper 적위 + Meinel 직달)",
  note: "기상·구름·음영·온도·오염 미반영. 경사 = 위도, 정남향. 서머타임과 경도 보정 없음",
  verified: false,
} as const;

const RAD = Math.PI / 180;
/** 태양상수(W/m²). 대기 밖 법선면 일사 */
const SOLAR_CONSTANT = 1353;

/** 월(1–12)의 대표일 — 각 달 15일을 쓴다. */
export function dayOfYear(month: number): number {
  const clamped = Math.min(12, Math.max(1, Math.round(month)));
  return 30 * (clamped - 1) + 15;
}

/** 적위(도). 계절이 이 값 하나로 들어온다. */
export function declinationDeg(month: number): number {
  return 23.45 * Math.sin(RAD * ((360 * (284 + dayOfYear(month))) / 365));
}

export interface SunState {
  /** 태양 고도(도). 0 이하면 밤이다 */
  elevation_deg: number;
  /** 경사면 일사(W/m²) */
  poa_wm2: number;
  /** 법선면 직달(W/m²) */
  dni_wm2: number;
  declination_deg: number;
  hour_angle_deg: number;
  air_mass: number | null;
}

/**
 * 시각(0–24, 현지 시계 시각)에서의 태양 상태.
 * clearness는 0–1의 감쇠 계수다 — 구름을 모델링하는 것이 아니라 "맑음 대비 몇 %"다.
 */
export function sunAt(latitudeDeg: number, month: number, hour: number, clearness = 1): SunState {
  const dec = declinationDeg(month);
  const omega = 15 * (hour - 12);
  const sinAlpha =
    Math.sin(RAD * latitudeDeg) * Math.sin(RAD * dec) +
    Math.cos(RAD * latitudeDeg) * Math.cos(RAD * dec) * Math.cos(RAD * omega);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinAlpha))) / RAD;

  if (sinAlpha <= 0) {
    return {
      elevation_deg: elevation,
      poa_wm2: 0,
      dni_wm2: 0,
      declination_deg: dec,
      hour_angle_deg: omega,
      air_mass: null,
    };
  }

  const airMass = Math.min(38, 1 / sinAlpha);
  const dni = SOLAR_CONSTANT * Math.pow(0.7, Math.pow(airMass, 0.678));
  // 경사 = 위도, 정남향 → cos θ = cos δ · cos ω
  const cosTheta = Math.max(0, Math.cos(RAD * dec) * Math.cos(RAD * omega));
  const poa = (dni * cosTheta + 0.1 * dni * sinAlpha) * Math.max(0, Math.min(1, clearness));

  return {
    elevation_deg: elevation,
    poa_wm2: poa,
    dni_wm2: dni,
    declination_deg: dec,
    hour_angle_deg: omega,
    air_mass: airMass,
  };
}

/** 동작점이 쓰는 일사비 G/1000. 1.0이 STC다. */
export function irradianceRatio(location: Location, month: number, hour: number, clearness = 1): number {
  return sunAt(location.latitude_deg, month, hour, clearness).poa_wm2 / 1000;
}

export interface DaySample {
  hour: number;
  poa_wm2: number;
  elevation_deg: number;
}

/** 하루 곡선. 그래프의 x축이자 재생 슬라이더의 배경이다. */
export function dayCurve(location: Location, month: number, clearness = 1, step = 0.25): DaySample[] {
  const out: DaySample[] = [];
  for (let h = 0; h <= 24 + 1e-9; h += step) {
    const s = sunAt(location.latitude_deg, month, h, clearness);
    out.push({ hour: h, poa_wm2: s.poa_wm2, elevation_deg: s.elevation_deg });
  }
  return out;
}

/** 일출·일몰(시). 고도가 0을 지나는 지점. 값이 없으면 백야/극야다. */
export function daylight(location: Location, month: number): { sunrise: number; sunset: number } | null {
  const dec = declinationDeg(month);
  const cosH = -Math.tan(RAD * location.latitude_deg) * Math.tan(RAD * dec);
  if (cosH <= -1 || cosH >= 1) return null;
  const half = Math.acos(cosH) / RAD / 15;
  return { sunrise: 12 - half, sunset: 12 + half };
}
