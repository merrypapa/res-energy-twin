import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadDevices, loadScenarios, loadTopologies, validateAll } from "../src/validate/index.js";

/**
 * 데이터 → UI가 읽을 단일 JSON. 빌드 타임에 전부 검증하고 실패하면 중단한다 (CLAUDE.md §7).
 * UI는 파일 시스템을 모른다 — 이 번들만 본다.
 */
const OUT = "src/ui/generated/data.json";

const devices = loadDevices("device-library");
const topologies = loadTopologies("topologies");
const scenarios = loadScenarios("scenarios");

const findings = [
  ...devices.findings,
  ...topologies.findings,
  ...scenarios.findings,
  ...validateAll(devices.items, topologies.items),
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
  topologies: topologies.items,
  scenarios: scenarios.items,
  /** 검증기가 낸 error 외 findings. UI가 데이터 품질을 그대로 보여준다. */
  data_findings: findings,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(bundle), "utf8");
console.log(
  `${OUT}  ·  devices ${devices.items.length} · topologies ${topologies.items.length} · ` +
    `scenarios ${scenarios.items.length} · findings ${findings.length}`,
);
