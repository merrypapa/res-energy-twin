import type { Device } from "../schema/device.js";

/**
 * 제품 스펙 요약 — 정격 표를 사람이 읽는 줄로 바꾼다.
 *
 * 어떤 정격을 어떤 단위로 보여줄지는 여기 표 하나로 끝난다. class나 벤더로 분기하지 않는다:
 * 값이 있는 항목만 순서대로 나온다. 없는 값은 "미확인"으로 남기고 지어내지 않는다.
 */
export interface SpecRow {
  label: string;
  value: string;
}

type Fmt = (v: number) => string;

const RATING_ROWS: ReadonlyArray<readonly [keyof Device["ratings"], string, Fmt]> = [
  ["usable_energy_kwh", "사용 가능 용량", (v) => `${v} kWh`],
  ["total_energy_kwh", "총 용량", (v) => `${v} kWh`],
  ["continuous_ac_kw", "연속 출력", (v) => `${v} kW`],
  ["continuous_ac_kva", "연속 출력", (v) => `${v} kVA`],
  ["peak_ac_kw", "피크 출력", (v) => `${v} kW`],
  ["peak_ac_kva", "피크 출력", (v) => `${v} kVA`],
  ["max_continuous_ac_a", "최대 연속 전류", (v) => `${v} A`],
  ["max_units_per_branch", "분기회로당 최대 유닛", (v) => `${v}대`],
  ["lra", "기동 정격 (LRA, 실효값)", (v) => `${v} A`],
  ["lra_peak_a", "기동 정격 (LRA, 첨두값)", (v) => `${v} A`],
  ["max_pv_dc_kw", "최대 PV 입력", (v) => `${v} kW DC`],
  ["pv_mppt_count", "MPPT 수", (v) => `${v}`],
  ["mppt_v_min", "MPPT 최소 전압", (v) => `${v} V`],
  ["mppt_v_max", "MPPT 최대 전압", (v) => `${v} V`],
  ["cec_efficiency_pct", "CEC 가중 효율", (v) => `${v} %`],
  ["round_trip_efficiency_pct", "왕복 효율", (v) => `${v} %`],
  ["pv_stc_w", "STC 출력", (v) => `${v} W`],
  ["module_efficiency_pct", "모듈 효율", (v) => `${v} %`],
  ["pv_vmp_v", "최대출력 전압 Vmp", (v) => `${v} V`],
  ["pv_imp_a", "최대출력 전류 Imp", (v) => `${v} A`],
  ["pv_voc_v", "개방 전압 Voc", (v) => `${v} V`],
  ["pv_isc_a", "단락 전류 Isc", (v) => `${v} A`],
  ["pv_temp_coeff_pmax_pct_per_c", "온도계수 PMax", (v) => `${v} %/°C`],
  ["pv_temp_coeff_voc_pct_per_c", "온도계수 Voc", (v) => `${v} %/°C`],
  ["busbar_a", "버스바 정격", (v) => `${v} A`],
  ["main_ocpd_a", "메인 OCPD", (v) => `${v} A`],
  ["service_a", "서비스 정격", (v) => `${v} A`],
];

export function specRows(device: Device): SpecRow[] {
  const rows: SpecRow[] = [];
  for (const [key, label, fmt] of RATING_ROWS) {
    const v = device.ratings[key];
    if (typeof v === "number") rows.push({ label, value: fmt(v) });
  }
  return rows;
}

/** 아직 확인되지 않아 화면에 "미확인"으로 나와야 하는 항목 수. */
export function unknownCount(device: Device): number {
  return Object.values(device.ratings).filter((v) => v === null).length;
}

export interface SpecSheet {
  device: Device;
  rows: SpecRow[];
  /** 이 구성에 몇 대 들어가는가 */
  units: number;
}

/** 토폴로지에 실제로 들어간 제품들. 같은 제품이 여러 노드면 대수로 합친다. */
export function specSheets(devices: readonly Device[], usedIds: readonly string[]): SpecSheet[] {
  const counts = new Map<string, number>();
  for (const id of usedIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const sheets: SpecSheet[] = [];
  for (const [id, units] of counts) {
    const device = devices.find((d) => d.id === id);
    if (!device) continue;
    sheets.push({ device, rows: specRows(device), units });
  }
  // 설치 부품이 앞에 오도록: 기존 설비(패널·인입점)를 뒤로 민다
  const PREEXISTING = new Set(["service_point", "main_panel"]);
  return sheets.sort((a, b) => {
    const pa = PREEXISTING.has(a.device.class) ? 1 : 0;
    const pb = PREEXISTING.has(b.device.class) ? 1 : 0;
    return pa - pb || a.device.display_name.localeCompare(b.device.display_name);
  });
}
