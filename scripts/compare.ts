import { readFileSync } from "node:fs";
import { loadDevices, loadPresetTopologies, loadScenarios } from "../src/validate/index.js";
import { compareTopologies, toMarkdown } from "../src/compare/index.js";
import { EMPTY_SITE, SiteContext } from "../src/schema/rule.js";

/**
 * 벤더별 구성 비교표. UI 비교 모드가 생기기 전까지 이것이 출력 창구다.
 * 사용: npm run compare [-- --scenario outage_islanded] [--site s.json] [--only <id,id>] [--diffs] [--json]
 */
const args = process.argv.slice(2);
const flag = (n: string): string | null => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
const has = (n: string) => args.includes(`--${n}`);

const devices = loadDevices("device-library");
const topologies = loadPresetTopologies("configurations");
const scenarios = loadScenarios("scenarios");

const blocking = [...devices.findings, ...topologies.findings, ...scenarios.findings].filter(
  (f) => f.severity === "error",
);
if (blocking.length > 0) {
  for (const f of blocking) console.error(`ERROR ${f.code} ${f.where}: ${f.message}`);
  process.exit(1);
}

const onlyArg = flag("only");
const only = onlyArg ? onlyArg.split(",").map((s) => s.trim()) : null;
/**
 * --only가 없으면 벤더별 첫 프리셋을 고른다.
 * 한 템플릿이 프리셋을 여러 개 갖게 된 뒤로 전부 넣으면 4분할 상한을 넘는다 —
 * 비교의 기본은 "같은 조건에서 벤더별"이지 "모든 프리셋"이 아니다.
 */
const firstPerVendor = () => {
  const seen = new Set<string>();
  return topologies.items.filter((t) => (seen.has(t.vendor) ? false : (seen.add(t.vendor), true)));
};
let selected = only
  ? topologies.items.filter((t) => only.some((o) => t.id.startsWith(o)))
  : firstPerVendor();

if (selected.length === 0) {
  console.error(`비교 대상이 없다: ${onlyArg}`);
  process.exit(1);
}
// 캔버스 분할 상한과 같다 (CLAUDE.md §6: 2~4분할).
if (selected.length > 4) {
  console.error(`비교는 4개까지다 (요청 ${selected.length}). --only 로 좁혀라.`);
  process.exit(1);
}
selected = [...selected].sort((a, b) => a.vendor.localeCompare(b.vendor));

const scenarioArg = flag("scenario");
const scenario = scenarioArg ? scenarios.items.find((s) => s.id === scenarioArg) : undefined;
if (scenarioArg && !scenario) {
  console.error(`알 수 없는 시나리오: ${scenarioArg}`);
  process.exit(1);
}

const sitePath = flag("site");
let site = EMPTY_SITE;
if (sitePath) {
  const parsed = SiteContext.safeParse(JSON.parse(readFileSync(sitePath, "utf8")));
  if (!parsed.success) {
    console.error(`site 파일 스키마 위반: ${sitePath}`);
    process.exit(1);
  }
  site = parsed.data;
}

const comparison = compareTopologies(selected, devices.items, { site, scenario });

if (has("json")) {
  console.log(JSON.stringify(comparison, null, 2));
  process.exit(0);
}

console.log(`# 구성 비교 — ${selected.length}종\n`);
for (const col of comparison.columns) {
  console.log(`- **${col.vendor}** — ${col.display_name}${col.draft ? "  `draft`" : ""}`);
}
console.log();
console.log(toMarkdown(comparison, { onlyDiffs: has("diffs") }));
console.log();
if (comparison.scenario_id === null) {
  console.log("급전 비교는 빠졌다. `--scenario outage_islanded` 로 켠다.");
}
console.log(`\n굵은 항목이 벤더 간 차이가 나는 지점이다 (${comparison.rows.filter((r) => r.differs).length}/${comparison.rows.length}).`);
for (const n of comparison.notes) console.log(`- ${n}`);
