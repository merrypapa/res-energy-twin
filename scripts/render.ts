import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDevices, loadTopologies } from "../src/validate/index.js";
import { renderTopology } from "../src/render/index.js";
import type { Layer } from "../src/schema/common.js";

/**
 * 데이터 → 단선도 SVG. UI는 아직 없다 (스프린트 1).
 * 사용: npm run render [-- --layers power,comms] [--out out]
 */
const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};

const outDir = flag("out") ?? "out";
const layers = (flag("layers") ?? "power,comms").split(",").map((s) => s.trim()) as Layer[];
const date = flag("date") ?? new Date().toISOString().slice(0, 10);

const devices = loadDevices("device-library");
const topologies = loadTopologies("topologies");

const blocking = [...devices.findings, ...topologies.findings].filter((f) => f.severity === "error");
if (blocking.length > 0) {
  for (const f of blocking) console.error(`ERROR ${f.code} ${f.where}: ${f.message}`);
  console.error("\n스키마 오류가 있는 상태로는 도면을 그리지 않는다. npm run validate 먼저.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

for (const t of topologies.items) {
  const svg = renderTopology(t, devices.items, { layers, date });
  const file = join(outDir, `${t.id}.svg`);
  writeFileSync(file, svg, "utf8");
  const bytes = Buffer.byteLength(svg, "utf8");
  console.log(`${file}  ·  노드 ${t.nodes.length} · 엣지 ${t.edges.length} · ${(bytes / 1024).toFixed(1)} KB`);
}

console.log(`\ntopologies ${topologies.items.length} · layers ${layers.join("/")} → ${outDir}/`);
