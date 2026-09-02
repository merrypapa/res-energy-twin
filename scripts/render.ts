import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDevices, loadPresetTopologies, loadScenarios } from "../src/validate/index.js";
import { renderTopology } from "../src/render/index.js";
import { evaluateScenario } from "../src/scenario/index.js";
import type { Layer } from "../src/schema/common.js";

/**
 * 데이터 → 단선도 SVG.
 * 사용: npm run render [-- --layers power,comms] [--out out] [--scenario <id>|all] [--open ref,ref]
 *
 * --scenario 없이 돌리면 급전 계산 없이(전부 활선) 그린다 — 스프린트 1과 같은 출력.
 */
const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};

const outDir = flag("out") ?? "out";
const layers = (flag("layers") ?? "power,comms").split(",").map((s) => s.trim()) as Layer[];
const date = flag("date") ?? new Date().toISOString().slice(0, 10);
const scenarioArg = flag("scenario");
const open = (flag("open") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const devices = loadDevices("device-library");
const topologies = loadPresetTopologies("configurations");
const scenarios = loadScenarios("scenarios");

const blocking = [...devices.findings, ...topologies.findings, ...scenarios.findings].filter(
  (f) => f.severity === "error",
);
if (blocking.length > 0) {
  for (const f of blocking) console.error(`ERROR ${f.code} ${f.where}: ${f.message}`);
  console.error("\n스키마 오류가 있는 상태로는 도면을 그리지 않는다. npm run validate 먼저.");
  process.exit(1);
}

const selected =
  scenarioArg === null
    ? [null]
    : scenarioArg === "all"
      ? scenarios.items
      : scenarios.items.filter((s) => s.id === scenarioArg);

if (selected.length === 0) {
  console.error(`알 수 없는 시나리오: ${scenarioArg}`);
  console.error(`가능한 값: ${scenarios.items.map((s) => s.id).join(", ")}, all`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

let written = 0;
for (const t of topologies.items) {
  for (const sc of selected) {
    const result = sc ? evaluateScenario(t, devices.items, sc, { open }) : null;
    const svg = renderTopology(t, devices.items, {
      layers,
      date,
      ...(result && sc ? { energization: result.energization, scenario: sc.id } : {}),
    });
    const file = join(outDir, sc ? `${t.id}.${sc.id}.svg` : `${t.id}.svg`);
    writeFileSync(file, svg, "utf8");
    written++;

    const live = result
      ? Object.values(result.energization).filter((v) => v === "live").length
      : t.edges.filter((e) => layers.includes(e.layer)).length;
    const total = result ? Object.keys(result.energization).length : live;
    const suffix = result
      ? ` · 활선 ${live}/${total}${result.open_nodes.length ? ` · 개방 ${result.open_nodes.join(",")}` : ""}`
      : "";
    console.log(`${file}  ·  노드 ${t.nodes.length} · 엣지 ${t.edges.length}${suffix}`);

    for (const f of result?.findings ?? []) {
      if (f.severity !== "info") console.log(`    ${f.severity.toUpperCase()} ${f.code} ${f.message}`);
    }
  }
}

console.log(`\n파일 ${written} · topologies ${topologies.items.length} · layers ${layers.join("/")} → ${outDir}/`);
