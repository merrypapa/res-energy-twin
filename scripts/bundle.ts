import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  loadConfigurations,
  loadDevices,
  loadNotes,
  loadScenarios,
  presetTopologies,
  validateAll,
} from "../src/validate/index.js";
import { checkNoteCoverage } from "../src/analysis/notes.js";

/**
 * 데이터 → UI가 읽을 단일 JSON. 빌드 타임에 전부 검증하고 실패하면 중단한다 (CLAUDE.md §7).
 * UI는 파일 시스템을 모른다 — 이 번들만 본다.
 *
 * 템플릿(옵션 축)을 그대로 싣는다. UI의 구성 선택은 브라우저에서 컴포저를 돌린 결과이며,
 * 화면 전용 데이터를 따로 만들지 않는다.
 */
const OUT = "src/ui/generated/data.json";

const devices = loadDevices("device-library");
const configurations = loadConfigurations("configurations");
const topologies = presetTopologies(configurations.items);
const scenarios = loadScenarios("scenarios");
const notes = loadNotes("node-notes");

const findings = [
  ...devices.findings,
  ...configurations.findings,
  ...topologies.findings,
  ...scenarios.findings,
  ...notes.findings,
  ...validateAll(devices.items, topologies.items),
  ...checkNoteCoverage(notes.items, devices.items),
];
const errors = findings.filter((f) => f.severity === "error");
if (errors.length > 0) {
  for (const f of errors) console.error(`ERROR ${f.code} ${f.where}: ${f.message}`);
  console.error("\n스키마 오류가 있는 데이터로 앱을 빌드하지 않는다.");
  process.exit(1);
}

const bundle = {
  built_at: new Date().toISOString().slice(0, 10),
  devices: devices.items,
  configurations: configurations.items,
  topologies: topologies.items,
  scenarios: scenarios.items,
  notes: notes.items,
  /** 검증기가 낸 error 외 findings. UI가 데이터 품질을 그대로 보여준다. */
  data_findings: findings,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(bundle), "utf8");
console.log(
  `${OUT}  ·  devices ${devices.items.length} · configurations ${configurations.items.length} · ` +
    `presets ${topologies.items.length} · scenarios ${scenarios.items.length} · notes ${notes.items.length} · ` +
    `findings ${findings.length}`,
);
