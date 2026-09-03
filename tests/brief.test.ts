import { describe, expect, it } from "vitest";
import { loadConfigurations, loadDevices, loadLocations, loadScenarios } from "../src/validate/index.js";
import { composeTopology } from "../src/config/compose.js";
import { buildRenderGraph } from "../src/graph/index.js";
import { evaluateScenario } from "../src/scenario/index.js";
import { runRules } from "../src/rules/engine.js";
import { computePowerFlow } from "../src/analysis/powerflow.js";
import { nodeSignals } from "../src/analysis/signals.js";
import { ASK_INSTRUCTION, buildBrief } from "../src/analysis/brief.js";
import { OperatingPoint, withSolar } from "../src/analysis/operating-point.js";

const devices = loadDevices("device-library").items;
const templates = loadConfigurations("configurations").items;
const locations = loadLocations("locations").items;
const scenarios = loadScenarios("scenarios").items;

function brief(templateId: string, options = {}, withSignal = true) {
  const composed = composeTopology(templates.find((t) => t.id === templateId)!, options);
  const topology = composed.topology;
  const graph = buildRenderGraph(topology, devices, ["power", "comms"]);
  const location = locations.find((l) => l.id === "los-angeles-ca")!;
  const op = withSolar(
    OperatingPoint.parse({ location_id: location.id, month: 6, hour: 12, house_load_kw: 3 }),
    location,
  );
  const scenario = scenarios.find((s) => s.id === "outage_islanded")!;
  const run = evaluateScenario(topology, devices, scenario);
  const flow = computePowerFlow(graph, op, { scenario, energization: run.energization });
  return buildBrief({
    topology,
    graph,
    devices,
    flow,
    op,
    location,
    scenarioName: scenario.display_name,
    options: composed.options,
    ruleFindings: runRules(topology, devices).findings,
    dataFindings: composed.findings,
    signal: withSignal ? nodeSignals(graph, "mi-10", flow, op) : null,
    focusPort: withSignal ? "ac_out" : null,
  });
}

describe("AI 브리프 — 화면에 있는 것만 넘긴다", () => {
  const text = brief("enphase-4g");

  it("구성과 옵션이 들어간다", () => {
    expect(text).toContain("enphase-4g-meter-collar-whole-home");
    expect(text).toContain("backup_mode");
    expect(text).toContain("전체 백업");
  });

  it("제품과 미확인 항목이 함께 들어간다 — 확정된 것처럼 보이지 않게", () => {
    expect(text).toContain("IQ8M");
    expect(text).toContain("draft(대외 인용 금지)");
    expect(text).toContain("확인된 정격 없음");
    expect(text).toContain("아직 확인되지 않은 것");
  });

  it("동작점과 전력 수지가 들어간다", () => {
    expect(text).toContain("로스앤젤레스");
    expect(text).toMatch(/일사 \d+%/);
    expect(text).toContain("PV");
    expect(text).toContain("축전지");
  });

  it("선택한 지점의 신호와 수식이 들어간다", () => {
    expect(text).toContain("단자 ac_out");
    expect(text).toContain("I = P / (V_LL · PF)");
  });

  it("룰 판정에 근거 조항과 대조 여부가 함께 붙는다", () => {
    expect(text).toMatch(/근거 NEC [^)]*원문 대조 전/);
  });

  it("계산의 한계를 반드시 말한다", () => {
    expect(text).toContain("임피던스·전압 강하·무효전력");
    expect(text).toContain("시간 적분(kWh)은 하지 않는다");
    expect(text).toContain("시공 설계 근거로 쓸 수 없다");
  });

  it("답하는 쪽에 거는 제약이 이 프로젝트의 규율과 같다", () => {
    expect(ASK_INSTRUCTION).toContain("지어내지 마라");
    expect(ASK_INSTRUCTION).toContain("기억으로 인용하지 마라");
    expect(ASK_INSTRUCTION).toContain("교육 및 비교 목적");
  });

  it("한 번에 보낼 수 있는 크기 안에 들어온다 (64 KiB)", () => {
    for (const id of templates.map((t) => t.id)) {
      // 템플릿마다 노드 이름이 달라 신호 없이 잰다. 신호가 붙어도 한 노드 분량뿐이다.
      const size = new TextEncoder().encode(`${ASK_INSTRUCTION}\n\n${brief(id, {}, false)}`).length;
      expect(`${id}: ${size < 64 * 1024}`).toBe(`${id}: true`);
    }
  });

  it("노드를 고르지 않아도 브리프가 나온다", () => {
    const without = brief("enphase-4g", {}, false);
    expect(without).toContain("# 지금 화면의 구성");
    expect(without).not.toContain("선택한 지점의 신호");
  });
});
