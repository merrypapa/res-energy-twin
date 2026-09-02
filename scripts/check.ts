import { readFileSync } from "node:fs";
import { loadDevices, loadPresetTopologies } from "../src/validate/index.js";
import { runRules } from "../src/rules/engine.js";
import { EMPTY_SITE, SiteContext } from "../src/schema/rule.js";

/**
 * 룰 엔진 CLI. UI의 Finding 패널이 생기기 전까지 이것이 출력 창구다.
 * 사용: npm run check [-- --site site.json] [--topology <id>]
 */
const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};

const sitePath = flag("site");
let site = EMPTY_SITE;
if (sitePath) {
  const parsed = SiteContext.safeParse(JSON.parse(readFileSync(sitePath, "utf8")));
  if (!parsed.success) {
    console.error(`site 파일 스키마 위반: ${sitePath}`);
    for (const i of parsed.error.issues) console.error(`  [${i.path.join(".")}] ${i.message}`);
    process.exit(1);
  }
  site = parsed.data;
}

const devices = loadDevices("device-library");
const topologies = loadPresetTopologies("configurations");

const blocking = [...devices.findings, ...topologies.findings].filter((f) => f.severity === "error");
if (blocking.length > 0) {
  for (const f of blocking) console.error(`ERROR ${f.code} ${f.where}: ${f.message}`);
  console.error("\n스키마 오류가 있는 상태로는 룰을 돌리지 않는다. npm run validate 먼저.");
  process.exit(1);
}

const only = flag("topology");
const targets = only ? topologies.items.filter((t) => t.id === only) : topologies.items;
if (targets.length === 0) {
  console.error(`알 수 없는 토폴로지: ${only}`);
  process.exit(1);
}

const mark = { error: "ERROR  ", warning: "WARN   ", info: "INFO   " } as const;
let warnings = 0;
let errors = 0;
const unverified = new Set<string>();

for (const t of targets) {
  const r = runRules(t, devices.items, site);
  console.log(`\n═══ ${t.id}`);
  for (const f of r.findings) {
    if (f.severity === "warning") warnings++;
    if (f.severity === "error") errors++;
    console.log(`${mark[f.severity]} ${f.code.padEnd(9)} ${f.message}`);
    const tail = [f.refs.length ? `refs: ${f.refs.join(", ")}` : null, f.code_ref].filter(Boolean);
    if (tail.length) console.log(`                  ${tail.join("  ·  ")}`);
  }
  for (const id of r.unverified) unverified.add(id);
}

console.log(`\ntopologies ${targets.length} · error ${errors} · warning ${warnings}`);
if (!sitePath) {
  console.log("site 컨텍스트 미제공 — 부하/모터 관련 판정은 보류됐다. --site <file.json>");
}
if (unverified.size > 0) {
  console.log(
    `\n조문 원문 미대조 룰: ${[...unverified].sort().join(", ")}\n` +
      `verified=false인 동안 이 출력은 사내 배포용 근거가 아니다. 전기 엔지니어 리뷰 필요.`,
  );
}

process.exit(errors > 0 ? 1 : 0);
