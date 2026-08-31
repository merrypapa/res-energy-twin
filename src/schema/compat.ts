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
