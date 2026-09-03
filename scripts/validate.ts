import {
  checkTopology,
  loadConfigurations,
  loadDevices,
  loadLocations,
  loadNotes,
  loadScenarios,
  presetTopologies,
  validateAll,
} from "../src/validate/index.js";
import { composeTopology, enumCombinations, describeOptions } from "../src/config/compose.js";
import { checkNoteCoverage } from "../src/analysis/notes.js";
import type { Finding } from "../src/schema/common.js";

const DEVICE_DIR = "device-library";
const CONFIG_DIR = "configurations";
const SCENARIO_DIR = "scenarios";
const NOTE_DIR = "node-notes";
const LOCATION_DIR = "locations";

const d = loadDevices(DEVICE_DIR);
const cfg = loadConfigurations(CONFIG_DIR);
const t = presetTopologies(cfg.items);
const sc = loadScenarios(SCENARIO_DIR);
const notes = loadNotes(NOTE_DIR);
const locations = loadLocations(LOCATION_DIR);

const findings: Finding[] = [
  ...d.findings,
  ...cfg.findings,
  ...t.findings,
  ...sc.findings,
  ...notes.findings,
  ...locations.findings,
  ...validateAll(d.items, t.items),
  ...checkNoteCoverage(notes.items, d.items),
];

/**
 * 옵션 조합 전수 검사.
 *
 * 프리셋만 검사하면 UI에서 고를 수 있는 조합이 깨져 있어도 CI가 통과한다.
 * 컴포저 결함(C0xx)은 error다 — 템플릿 작성 실수이므로 고쳐야 한다.
 * 반면 결선 자체의 판정(E0xx)은 조합에 따라 나오는 것이 정상이다
 * ("이 조합은 성립하지 않는다"가 이 도구의 답이다). 요약만 남긴다.
 */
let comboCount = 0;
for (const tpl of cfg.items) {
  for (const options of enumCombinations(tpl)) {
    comboCount++;
    const composed = composeTopology(tpl, options);
    findings.push(...composed.findings.filter((f) => f.code.startsWith("C")));
    const errors = checkTopology(composed.topology, d.items).filter((f) => f.severity === "error");
    if (errors.length > 0) {
      findings.push({
        severity: "info",
        code: "C040",
        message: `성립하지 않는 조합 [${describeOptions(tpl, composed.options)}] — ${[
          ...new Set(errors.map((e) => e.code)),
        ].join(", ")}`,
        where: tpl.id,
      });
    }
  }
}

const order = { error: 0, warning: 1, info: 2 } as const;
findings.sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code));

const mark = { error: "ERROR  ", warning: "WARN   ", info: "INFO   " } as const;
for (const f of findings) {
  console.log(`${mark[f.severity]} ${f.code}  ${f.where}\n         ${f.message}`);
}

const counts = {
  error: findings.filter((f) => f.severity === "error").length,
  warning: findings.filter((f) => f.severity === "warning").length,
  info: findings.filter((f) => f.severity === "info").length,
};
const todos = [...d.items, ...cfg.items, ...notes.items].reduce((n, x) => n + x.todos.length, 0);

console.log(
  `\ndevices ${d.items.length} · configurations ${cfg.items.length} · presets ${t.items.length} · ` +
    `조합 ${comboCount} · scenarios ${sc.items.length} · notes ${notes.items.length} · ` +
    `locations ${locations.items.length} · ` +
    `error ${counts.error} · warning ${counts.warning} · info ${counts.info} · open TODO ${todos}`,
);

process.exit(counts.error > 0 ? 1 : 0);
