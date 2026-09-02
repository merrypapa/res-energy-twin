import type { Port } from "./device.js";

/**
 * 포트 타입 호환 표. 여기 없는 조합은 연결 불가로 판정한다.
 * 벤더가 아니라 전기적 인터페이스로만 판정하는 것이 이 프로젝트의 전제다.
 */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["dc_pv_module", "dc_pv_module"],
  ["dc_pv_module", "dc_string"],
  ["dc_string", "dc_string"],
  ["ac_service_line", "ac_service_line"],
  /**
   * 서비스 도체 ↔ 240V 분기. 전기적으로는 같은 단상 3선 120/240V다.
   * 부분 백업에서 메인 패널의 분기 차단기가 MID/컨트롤러를 먹이는 구성이 실제로 있어
   * 연결 자체는 허용한다. 공급측 탭이냐 부하측 인터커넥션이냐의 구분은
   * 연결 가능 여부가 아니라 룰 엔진(rules/supply-side-tap)이 판정한다.
   * TODO: 도체 등급(서비스/피더/분기)을 별도 필드로 분리하면 이 예외를 없앨 수 있다.
   */
  ["ac_service_line", "ac_240v_split"],
  ["ac_240v_split", "ac_240v_split"],
  ["ac_240v_split", "ac_120v_branch"],
  ["ac_120v_branch", "ac_120v_branch"],
  ["comms_ethernet", "comms_ethernet"],
  ["comms_wireless", "comms_wireless"],
  ["comms_proprietary", "comms_proprietary"],
  ["ct_sense", "ct_sense"],
];

export function portsCompatible(a: Port, b: Port): boolean {
  const ok = PAIRS.some(
    ([x, y]) => (a.type === x && b.type === y) || (a.type === y && b.type === x),
  );
  if (!ok) return false;
  if (a.direction === "in" && b.direction === "in") return false;
  if (a.direction === "out" && b.direction === "out") return false;
  return true;
}
