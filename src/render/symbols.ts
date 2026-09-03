import type { Device } from "../schema/device.js";

/**
 * 단선도 심볼. **device class 하나만 보고 고른다.**
 * 벤더나 제품 id로 분기하는 순간 이 프로젝트의 전제가 깨진다 (CLAUDE.md §2, §10).
 * 표기는 IEEE/ANSI 단선도 관례를 따른다. 아이콘 세트로 대체하지 않는다.
 *
 * 좌표계: 심볼 중심이 (0,0), 대략 44 × 38 안에 들어온다.
 * 원문 기호와의 대조는 전기 엔지니어 리뷰 대상이다 (TODO).
 */
export type DeviceClassName = Device["class"];

const sine = (cx: number, cy: number, w: number): string => {
  const h = w / 4;
  return `M ${cx - w / 2} ${cy} q ${w / 4} ${-h} ${w / 2} 0 q ${w / 4} ${h} ${w / 2} 0`;
};

/** 축전지: 긴 극판 / 짧은 극판 교대 */
const battery = (cx: number, cy: number, scale = 1): string => {
  const long = 11 * scale;
  const short = 6 * scale;
  const gap = 6 * scale;
  const xs = [-1.5 * gap, -0.5 * gap, 0.5 * gap, 1.5 * gap];
  return xs
    .map((dx, i) => {
      const h = i % 2 === 0 ? long : short;
      return `M ${cx + dx} ${cy - h / 2} L ${cx + dx} ${cy + h / 2}`;
    })
    .join(" ");
};

const SYMBOLS: Record<DeviceClassName, string> = {
  // 유틸리티 서비스: 원 + 성형(와이) 결선
  service_point: `
    <circle cx="0" cy="0" r="15" class="sym"/>
    <path class="sym" d="M 0 0 L 0 -9 M 0 0 L -7.8 4.5 M 0 0 L 7.8 4.5"/>`,

  // PV: 사각형 + 대각선(수광면) + 셀 분할
  pv_module: `
    <rect x="-20" y="-14" width="40" height="28" class="sym"/>
    <path class="sym" d="M -20 14 L 20 -14 M -6.7 -14 L -6.7 14 M 6.7 -14 L 6.7 14"/>`,

  // AC 모듈: 모듈 사각형 + 우하단에 교류 표기. DC 구간이 밖으로 나오지 않는다는 뜻이다
  ac_module: `
    <rect x="-20" y="-14" width="40" height="28" class="sym"/>
    <path class="sym" d="M -20 14 L 20 -14 M -6.7 -14 L -6.7 14"/>
    <path class="sym" d="${sine(11, 7, 13)}"/>`,

  // DC 축전지: 함체 안 축전지 + 직류 표기(=). 교류 인출이 없다 — 변환기가 없다
  dc_battery: `
    <rect x="-22" y="-15" width="44" height="30" rx="2" class="sym"/>
    <path class="sym" d="${battery(-8, 0, 0.85)}"/>
    <path class="sym" d="M 6 -3 L 16 -3 M 6 3 L 16 3"/>`,

  // 인버터: 사각형 대각 분할, 좌상 직류(=), 우하 교류(∿)
  microinverter: `
    <rect x="-19" y="-14" width="38" height="28" class="sym"/>
    <path class="sym" d="M -19 14 L 19 -14"/>
    <path class="sym" d="M -14 -7 L -6 -7 M -14 -3 L -6 -3"/>
    <path class="sym" d="${sine(10, 6, 14)}"/>`,

  string_inverter: `
    <rect x="-19" y="-14" width="38" height="28" class="sym"/>
    <path class="sym" d="M -19 14 L 19 -14"/>
    <path class="sym" d="M -14 -7 L -6 -7 M -14 -3 L -6 -3"/>
    <path class="sym" d="${sine(10, 6, 14)}"/>`,

  // 하이브리드(축전지 내장 인버터): 인버터 사각형 + 좌상에 축전지
  hybrid_inverter_battery: `
    <rect x="-22" y="-15" width="44" height="30" class="sym"/>
    <path class="sym" d="M -22 15 L 22 -15"/>
    <path class="sym" d="${battery(-11, -6, 0.7)}"/>
    <path class="sym" d="${sine(11, 7, 15)}"/>`,

  // AC 배터리: 함체 안에 축전지 + 교류 인출 (직류 입력이 없다는 점이 하이브리드와 다르다)
  ac_battery: `
    <rect x="-22" y="-15" width="44" height="30" rx="2" class="sym"/>
    <path class="sym" d="${battery(-9, 0, 0.85)}"/>
    <path class="sym" d="${sine(11, 0, 15)}"/>`,

  // MID: 함체 안의 개폐기(가동 접촉자). 개폐 상태는 시나리오가 정한다(스프린트 2)
  mid: `
    <rect x="-22" y="-16" width="44" height="32" rx="2" class="sym"/>
    <path class="sym" d="M -22 0 L -13 0 M 13 0 L 22 0"/>
    <circle cx="-13" cy="0" r="2.2" class="sym-dot"/>
    <circle cx="13" cy="0" r="2.2" class="sym-dot"/>
    <path class="sym" d="M -13 0 L 10 -10"/>`,

  // 결합반: 함체 안 모선에 다회로 합류
  combiner: `
    <rect x="-22" y="-16" width="44" height="32" rx="2" class="sym"/>
    <path class="sym-bus" d="M 2 -11 L 2 11"/>
    <path class="sym" d="M -16 -7 L 2 -7 M -16 0 L 2 0 M -16 7 L 2 7 M 2 0 L 16 0"/>`,

  // 배전반: 모선 + 분기 차단기
  main_panel: `
    <rect x="-22" y="-16" width="44" height="32" rx="2" class="sym"/>
    <path class="sym-bus" d="M 0 -12 L 0 12"/>
    <path class="sym" d="M 0 -8 L -12 -8 M 0 0 L -12 0 M 0 8 L -12 8 M 0 -8 L 12 -8 M 0 0 L 12 0 M 0 8 L 12 8"/>`,

  subpanel: `
    <rect x="-18" y="-13" width="36" height="26" rx="2" class="sym"/>
    <path class="sym-bus" d="M 0 -9 L 0 9"/>
    <path class="sym" d="M 0 -5 L -9 -5 M 0 5 L -9 5 M 0 -5 L 9 -5 M 0 5 L 9 5"/>`,
};

/** class에 심볼이 없으면 빈 함체로 떨어진다 — 조용히 다른 장비처럼 그리지 않는다. */
const FALLBACK = `<rect x="-20" y="-15" width="40" height="30" rx="2" class="sym"/>`;

/** 심볼 외곽 반폭/반높이. 도체를 심볼 가장자리에 붙이는 데 쓴다. */
const EXTENT: Record<DeviceClassName, readonly [number, number]> = {
  service_point: [15, 15],
  pv_module: [20, 14],
  ac_module: [20, 14],
  microinverter: [19, 14],
  string_inverter: [19, 14],
  hybrid_inverter_battery: [22, 15],
  ac_battery: [22, 15],
  dc_battery: [22, 15],
  mid: [22, 16],
  combiner: [22, 16],
  main_panel: [22, 16],
  subpanel: [18, 13],
};

export function symbolExtent(cls: DeviceClassName): readonly [number, number] {
  return EXTENT[cls] ?? [20, 15];
}

export function symbolFor(cls: DeviceClassName): string {
  return SYMBOLS[cls] ?? FALLBACK;
}

export function hasSymbol(cls: DeviceClassName): boolean {
  return cls in SYMBOLS;
}

/**
 * 노드 상자 폭. 배열로 반복되는 소자(모듈·마이크로인버터)는 좁게 잡는다 —
 * 20장을 한 랭크에 늘어놓아야 단선도로 읽힌다. class로만 판정한다.
 */
const NARROW: ReadonlySet<DeviceClassName> = new Set(["pv_module", "ac_module", "microinverter"]);

export function isNarrow(cls: DeviceClassName): boolean {
  return NARROW.has(cls);
}
