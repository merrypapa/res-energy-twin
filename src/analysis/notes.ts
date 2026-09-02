import type { Device } from "../schema/device.js";
import type { NodeNote } from "../schema/note.js";
import type { Finding } from "../schema/common.js";

/**
 * 노드 노트 해석 — device → 적용되는 노트들.
 *
 * class 노트가 먼저, device 노트가 뒤에 온다. 덮어쓰지 않고 쌓는다:
 * "이 클래스의 지점에서 늘 중요한 것" 다음에 "이 제품에서 추가로 중요한 것"이 온다.
 */
export function notesFor(notes: readonly NodeNote[], device: Device): NodeNote[] {
  const byClass = notes.filter((n) => n.applies_to.class === device.class && n.applies_to.device === null);
  const byDevice = notes.filter((n) => n.applies_to.device === device.id);
  return [...byClass, ...byDevice];
}

/** 노트 없는 class가 있으면 알린다. 데이터 공백을 조용히 두지 않는다. */
export function checkNoteCoverage(notes: readonly NodeNote[], devices: readonly Device[]): Finding[] {
  const covered = new Set(notes.filter((n) => n.applies_to.class !== null).map((n) => n.applies_to.class));
  const used = new Set(devices.map((d) => d.class));
  const findings: Finding[] = [];
  for (const cls of [...used].sort()) {
    if (!covered.has(cls)) {
      findings.push({ severity: "info", code: "N010", message: `노드 노트 없음: class ${cls}`, where: "node-notes" });
    }
  }
  for (const n of notes) {
    if (n.applies_to.class === null && n.applies_to.device === null) {
      findings.push({ severity: "error", code: "N011", message: "applies_to에 class도 device도 없다", where: n.id });
    }
    if (n.sources.length === 0) {
      findings.push({ severity: "info", code: "N012", message: "노트에 출처가 없다", where: n.id });
    }
  }
  return findings;
}
