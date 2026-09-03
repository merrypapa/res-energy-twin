import type { Device } from "../schema/device.js";
import type { Topology } from "../schema/topology.js";
import type { Location } from "../schema/location.js";
import type { Finding } from "../schema/common.js";
import type { RuleFinding } from "../schema/rule.js";
import type { RenderGraph } from "../graph/index.js";
import type { PowerFlowResult } from "./powerflow.js";
import type { NodeSignalReport } from "./signals.js";
import type { OperatingPoint } from "./operating-point.js";
import { assumptionLines } from "./operating-point.js";
import { specRows } from "./spec.js";
import { SOLAR_MODEL } from "./solar.js";

/**
 * 화면 상태 → 텍스트 브리프.
 *
 * AI에게 묻든, 사람에게 붙여넣든 같은 글을 쓴다. 여기서 새로운 사실을 만들지 않는다 —
 * 검증을 통과한 데이터와 엔진이 계산한 값, 그리고 "무엇이 아직 확인되지 않았는가"를
 * 그대로 옮길 뿐이다. 브리프에 없는 것은 답에도 없어야 한다.
 */

/**
 * 답하는 쪽에 거는 제약. 이 도구의 규율(CLAUDE.md §10)을 그대로 넘긴다 —
 * 제품 스펙과 코드 조항을 기억으로 채우지 않는 것이 이 프로젝트의 전제이기 때문이다.
 */
export const ASK_INSTRUCTION = [
  "너는 미국 주택용 태양광+ESS 구성 레퍼런스 도구의 화면을 함께 보고 있는 전기 엔지니어다.",
  "아래 브리프는 이 도구가 검증한 데이터와 계산 결과다. 답은 한국어로, 브리프에 있는 근거로만 한다.",
  "",
  "지켜야 할 것:",
  "- 브리프에 없는 제품 스펙(정격·치수·인증)을 지어내지 마라. 없으면 '데이터에 없다'고 말해라.",
  "- NEC 조항 번호와 문구를 기억으로 인용하지 마라. 브리프의 code_ref를 그대로 옮기고,",
  "  verified=false면 '원문 대조 전'이라고 함께 밝혀라.",
  "- 계산값을 인용할 때는 그것이 어떤 가정 위의 값인지(효율·역률·맑은 하늘 근사·온도 미보정) 함께 말해라.",
  "- 시공·정정 판단을 최종 결론처럼 말하지 마라. 이 도구는 교육 및 비교 목적이다.",
  "- 모르면 모른다고 하고, 무엇을 확인하면 답할 수 있는지 알려줘라.",
].join("\n");

export interface BriefInput {
  topology: Topology;
  graph: RenderGraph | null;
  devices: readonly Device[];
  flow: PowerFlowResult | null;
  op: OperatingPoint;
  location: Location | null;
  scenarioName: string | null;
  options: Record<string, string | number>;
  ruleFindings: readonly RuleFinding[];
  dataFindings: readonly Finding[];
  /** 지금 고른 지점의 신호 (없으면 생략) */
  signal: NodeSignalReport | null;
  focusPort: string | null;
}

function line(label: string, value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "" : `- ${label}: ${value}`;
}

function block(title: string, lines: string[]): string {
  const body = lines.filter((l) => l !== "");
  return body.length === 0 ? "" : `## ${title}\n${body.join("\n")}`;
}

/** 구성에 실제로 들어간 제품과 그 정격 — 미확인 항목까지 함께 밝힌다. */
function productLines(input: BriefInput): string[] {
  const counts = new Map<string, number>();
  for (const n of input.topology.nodes) counts.set(n.device, (counts.get(n.device) ?? 0) + 1);
  const out: string[] = [];
  for (const [id, units] of counts) {
    const device = input.devices.find((d) => d.id === id);
    if (!device) continue;
    // 미확인 항목의 "개수"는 세지 않는다 — 그 class와 무관한 정격까지 세어 숫자가 부풀고,
    // 무엇이 비었는지는 아래 "아직 확인되지 않은 것"(device todos)이 훨씬 정확하게 말한다.
    const rows = specRows(device).map((r) => `${r.label} ${r.value}`);
    out.push(
      `- ${device.display_name} (${device.vendor}, ${device.class}) × ${units}` +
        `${rows.length > 0 ? ` — ${rows.join(", ")}` : " — 확인된 정격 없음"}` +
        `${device.status === "draft" ? " · draft(대외 인용 금지)" : ""}`,
    );
  }
  return out;
}

function signalLines(report: NodeSignalReport, focusPort: string | null): string[] {
  const ports = focusPort === null ? report.ports : report.ports.filter((p) => p.port_id === focusPort);
  const out: string[] = [`- 노드: ${report.label} (${report.device_id}, ${report.device_class})`];
  for (const p of ports) {
    if (p.domain === "signal") continue;
    out.push(
      `- 단자 ${p.port_id} (${p.domain === "ac" ? "교류" : "직류"}, ${p.arrangement}): ` +
        `P ${p.p_kw === null ? "미확인" : `${p.p_kw.toFixed(3)} kW`} · ` +
        `V ${p.v === null ? "미확인" : `${p.v.toFixed(1)} V`} · ` +
        `I ${p.i === null ? "미확인" : `${p.i.toFixed(2)} A`}`,
    );
    for (const b of p.basis) out.push(`  - 근거: ${b}`);
    for (const f of p.formulas) out.push(`  - ${f.label}: ${f.expr}`);
    for (const n of p.notes) out.push(`  - 주의: ${n}`);
  }
  return out;
}

export function buildBrief(input: BriefInput): string {
  const t = input.topology;
  const scope = { none: "백업 없음", partial: "부분 백업", whole_home: "전체 백업" }[t.backup_scope];

  const optionLines = Object.entries(input.options).map(([k, v]) => `- ${k}: ${String(v)}`);

  const structure = input.graph
    ? [
        line("노드 수", input.graph.nodes.length),
        line("전력 결선", input.graph.edges.filter((e) => e.layer === "power").length),
        line("통신 결선", input.graph.edges.filter((e) => e.layer === "comms").length),
        line(
          "MID(계통 분리) 제공",
          input.graph.nodes
            .filter((n) => n.device.provides_mid === true)
            .map((n) => n.label)
            .join(", ") || "없음 또는 미확인",
        ),
      ]
    : ["- 결선이 성립하지 않아 그래프를 만들지 못했다"];

  const balance = input.flow
    ? [
        line("PV", `${input.flow.pv_kw.toFixed(2)} kW`),
        line("축전지", `${input.flow.battery_kw.toFixed(2)} kW (음수=충전)`),
        line("계통", `${input.flow.grid_kw.toFixed(2)} kW (음수=수출)`),
        line("부하", `${input.flow.load_kw.toFixed(2)} kW`),
        input.flow.curtailed_kw > 0 ? line("제한(curtailment)", `${input.flow.curtailed_kw.toFixed(2)} kW`) : "",
      ]
    : [];

  const rules = input.ruleFindings.map(
    (f) =>
      `- [${f.severity}] ${f.code}: ${f.message}` +
      (f.code_ref ? ` (근거 ${f.code_ref}${f.verified ? "" : ", 원문 대조 전"})` : ""),
  );
  const data = input.dataFindings
    .filter((f) => f.severity !== "info")
    .map((f) => `- [${f.severity}] ${f.code} ${f.where}: ${f.message}`);

  const todos = [
    ...new Set(
      input.topology.nodes
        .map((n) => input.devices.find((d) => d.id === n.device))
        .filter((d): d is Device => d !== undefined)
        .flatMap((d) => d.todos.map((x) => `${d.id}: ${x}`)),
    ),
  ];

  return [
    `# 지금 화면의 구성`,
    "",
    block("구성", [
      line("id", t.id),
      line("벤더", t.vendor),
      line("이름", t.display_name),
      line("백업 범위", scope),
      line("데이터 상태", t.status === "draft" ? "draft — 대외 인용 금지" : "verified"),
      line("시나리오", input.scenarioName ?? "지정 없음(계통 정상)"),
    ]),
    block("선택한 옵션", optionLines),
    block("결선", structure),
    block("제품", productLines(input)),
    block("동작점", [
      ...assumptionLines(input.op, input.location).map((l) => `- ${l}`),
      input.location ? `- 일사 모델: ${SOLAR_MODEL.name} — ${SOLAR_MODEL.note}` : "",
    ]),
    block("전력 수지", balance),
    input.signal ? block("선택한 지점의 신호", signalLines(input.signal, input.focusPort)) : "",
    block("룰 판정", rules),
    block("데이터 검증(경고 이상)", data),
    block("아직 확인되지 않은 것", todos.map((x) => `- ${x}`)),
    "",
    "## 이 계산의 한계",
    "- 전력 수지다. 임피던스·전압 강하·무효전력·고조파를 풀지 않는다",
    "- 온도계수 미반영. 계산된 스트링 전압은 상온 STC 기준이다",
    "- 일사는 맑은 하늘 근사이며 기상·구름·음영을 반영하지 않는다. 시간 적분(kWh)은 하지 않는다",
    "- 코드 판정은 조문 원문 대조 전이다. 시공 설계 근거로 쓸 수 없다",
  ]
    .filter((s) => s !== "")
    .join("\n\n");
}
