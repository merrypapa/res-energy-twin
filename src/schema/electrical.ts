import type { PortType } from "./device.js";

/**
 * 포트 타입의 공칭 전기적 성질.
 *
 * 여기 있는 값은 제품 스펙이 아니라 미국 주택 배전의 공칭값이다 —
 * 그래서 device-library가 아니라 스키마에 둔다. 제품별로 달라지는 값
 * (Vmp, 연속출력, 정격전류)은 절대 여기 오지 않는다.
 *
 * verified=false: ANSI C84.1 / NEC 계열 공칭 전압 표기를 원문 대조하지 않았다.
 * 신호 계산에 쓰이므로, 대조 전까지 화면에 "공칭값(대조 전)"으로 표기한다.
 */
export type Domain = "ac" | "dc" | "signal";

export interface PortElectrical {
  domain: Domain;
  /** AC 공칭 전압(V, rms). 선간(L1-L2) 기준. DC는 장치 정격에서 나오므로 null. */
  nominal_v: number | null;
  /** 중성선 대비 전압(V, rms). 단상 3선에서만 의미가 있다. */
  line_to_neutral_v: number | null;
  hz: number | null;
  /** 도체 구성 한 줄 설명. UI가 그대로 쓴다. */
  arrangement: string;
}

export const PORT_ELECTRICAL: Readonly<Record<PortType, PortElectrical>> = {
  ac_service_line: {
    domain: "ac",
    nominal_v: 240,
    line_to_neutral_v: 120,
    hz: 60,
    arrangement: "단상 3선 120/240V — L1 · L2 · N",
  },
  ac_240v_split: {
    domain: "ac",
    nominal_v: 240,
    line_to_neutral_v: 120,
    hz: 60,
    arrangement: "단상 3선 120/240V 분기 — L1 · L2 · N",
  },
  ac_120v_branch: {
    domain: "ac",
    nominal_v: 120,
    line_to_neutral_v: 120,
    hz: 60,
    arrangement: "단상 2선 120V 분기 — L · N",
  },
  dc_pv_module: {
    domain: "dc",
    nominal_v: null,
    line_to_neutral_v: null,
    hz: null,
    arrangement: "모듈 DC — 전압은 모듈 정격과 직렬 수에서 나온다",
  },
  dc_string: {
    domain: "dc",
    nominal_v: null,
    line_to_neutral_v: null,
    hz: null,
    arrangement: "스트링 DC — 전압은 직렬 모듈 수에 비례한다",
  },
  comms_ethernet: { domain: "signal", nominal_v: null, line_to_neutral_v: null, hz: null, arrangement: "이더넷" },
  comms_wireless: { domain: "signal", nominal_v: null, line_to_neutral_v: null, hz: null, arrangement: "무선" },
  comms_proprietary: { domain: "signal", nominal_v: null, line_to_neutral_v: null, hz: null, arrangement: "제조사 전용 통신" },
  ct_sense: { domain: "signal", nominal_v: null, line_to_neutral_v: null, hz: null, arrangement: "CT 계측 신호" },
};

export const ELECTRICAL_SOURCE = {
  ref: "미국 주택 배전 공칭 전압/주파수 (ANSI C84.1 계열)",
  verified: false,
  note: "공칭값이다. 실제 계통 전압은 사이트마다 다르고, 조문 원문 대조 전이다",
} as const;

export function portElectrical(type: PortType): PortElectrical {
  return PORT_ELECTRICAL[type];
}
