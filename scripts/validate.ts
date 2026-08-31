import { loadDevices, loadScenarios, loadTopologies, validateAll } from "../src/validate/index.js";
import type { Finding } from "../src/schema/common.js";

const DEVICE_DIR = "device-library";
const TOPOLOGY_DIR = "topologies";
const SCENARIO_DIR = "scenarios";

const d = loadDevices(DEVICE_DIR);
const t = loadTopologies(TOPOLOGY_DIR);
const sc = loadScenarios(SCENARIO_DIR);
const findings: Finding[] = [...d.findings, ...t.findings, ...sc.findings, ...validateAll(d.items, t.items)];

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
const todos = [...d.items, ...t.items].reduce((n, x) => n + x.todos.length, 0);

console.log(
  `\ndevices ${d.items.length} · topologies ${t.items.length} · scenarios ${sc.items.length} · ` +
    `error ${counts.error} · warning ${counts.warning} · info ${counts.info} · open TODO ${todos}`,
);

process.exit(counts.error > 0 ? 1 : 0);
