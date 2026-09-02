import { loadDevices, loadPresetTopologies, loadScenarios } from "./src/validate/index.js";
import { buildRenderGraph } from "./src/graph/index.js";
import { computePowerFlow } from "./src/analysis/powerflow.js";
import { nodeSignals } from "./src/analysis/signals.js";
import { OperatingPoint } from "./src/analysis/operating-point.js";
import { evaluateScenario } from "./src/scenario/index.js";

const d = loadDevices("device-library").items;
const ts = loadPresetTopologies("configurations").items;
const scenarios = loadScenarios("scenarios").items;
const op = OperatingPoint.parse({ irradiance: 0.8, house_load_kw: 3 });

for (const id of ["enphase-4g-meter-collar-whole-home", "tesla-pw3-backup-switch-whole-home"]) {
  const t = ts.find((x) => x.id === id)!;
  const g = buildRenderGraph(t, d, ["power", "comms"]);
  for (const scId of ["grid_normal", "outage_islanded"]) {
    const sc = scenarios.find((s) => s.id === scId)!;
    const run = evaluateScenario(t, d, sc);
    const flow = computePowerFlow(g, op, { scenario: sc, energization: run.energization });
    console.log(`\n== ${id} / ${scId}: PV ${flow.pv_kw.toFixed(2)} 배터리 ${flow.battery_kw.toFixed(2)} 계통 ${flow.grid_kw.toFixed(2)} 부하 ${flow.load_kw} (${flow.load_node})`);
    for (const ref of ["pv-01", "mi-01", "mi-10", "comb", "msp", "batt", "pw3", "svc"]) {
      if (!g.byRef.has(ref)) continue;
      const r = nodeSignals(g, ref, flow, op);
      console.log(` ${ref}: ` + r.ports.filter((p) => p.domain !== "signal").map((p) => `${p.port_id} P=${p.p_kw?.toFixed(3) ?? "-"}kW V=${p.v?.toFixed(1) ?? "-"} I=${p.i?.toFixed(2) ?? "-"}`).join(" | "));
    }
  }
}
const t = ts.find((x) => x.id === "enphase-4g-meter-collar-whole-home")!;
const g = buildRenderGraph(t, d, ["power", "comms"]);
const flow = computePowerFlow(g, op, {});
const r = nodeSignals(g, "mi-10", flow, op);
console.log("\n-- mi-10 상세");
for (const p of r.ports) { console.log(p.port_id, p.basis.join(" / ")); for (const f of p.formulas) console.log("   ", f.label, ":", f.expr); }
