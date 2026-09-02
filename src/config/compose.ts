import type { Finding } from "../schema/common.js";
import { Topology } from "../schema/topology.js";
import type {
  ConfigTemplate,
  OptionAxis,
  OptionValue,
  Preset,
  TemplateEdge,
  TemplateNode,
  When,
} from "../schema/template.js";

/**
 * 컴포저 — (템플릿, 옵션) => Topology.
 *
 * 순수 함수다. 파일을 읽지 않고, 시각화를 모르고, 벤더로 분기하지 않는다.
 * 출력은 기존 Topology 스키마 그대로여서 렌더러 · 시나리오 · 룰 · 비교는
 * 이 레이어의 존재를 모른다.
 */

export type Options = Record<string, OptionValue>;

export interface ComposeResult {
  topology: Topology;
  /** 실제로 적용된 옵션 (기본값 채움 · 범위 보정 후) */
  options: Options;
  findings: Finding[];
}

/** 백업 구성 축. 값이 곧 topology.backup_scope다 — 중간 매핑 표를 두지 않는다. */
export const BACKUP_AXIS = "backup_mode";

export function defaultOptions(tpl: ConfigTemplate): Options {
  const out: Options = {};
  for (const axis of tpl.options) out[axis.id] = axis.default;
  return out;
}

/** 옵션을 축에 맞춰 정규화한다. 모르는 축·범위 밖 값은 버리지 않고 보고한다. */
export function resolveOptions(tpl: ConfigTemplate, given: Options = {}): { options: Options; findings: Finding[] } {
  const findings: Finding[] = [];
  const byId = new Map<string, OptionAxis>(tpl.options.map((a) => [a.id, a]));
  const options = defaultOptions(tpl);

  for (const [id, raw] of Object.entries(given)) {
    const axis = byId.get(id);
    if (!axis) {
      findings.push({ severity: "warning", code: "C010", message: `알 수 없는 옵션 축: ${id}`, where: tpl.id });
      continue;
    }
    if (axis.kind === "enum") {
      const value = String(raw);
      if (!axis.choices.some((c) => c.value === value)) {
        findings.push({
          severity: "error",
          code: "C011",
          message: `${id}: 선택지에 없는 값 ${value} (가능: ${axis.choices.map((c) => c.value).join(", ")})`,
          where: tpl.id,
        });
        continue;
      }
      options[id] = value;
    } else {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n)) {
        findings.push({ severity: "error", code: "C012", message: `${id}: 정수가 아니다 (${String(raw)})`, where: tpl.id });
        continue;
      }
      const clamped = Math.min(axis.max, Math.max(axis.min, n));
      if (clamped !== n) {
        findings.push({
          severity: "warning",
          code: "C013",
          message: `${id}: ${n}은 범위 밖이라 ${clamped}로 보정했다 (${axis.min}~${axis.max})`,
          where: tpl.id,
        });
      }
      options[id] = clamped;
    }
  }
  return { options, findings };
}

function matches(when: When, options: Options): boolean {
  return Object.entries(when).every(([id, allowed]) => allowed.includes(String(options[id])));
}

function intOption(options: Options, id: string | null, fallback: number): number {
  if (id === null) return fallback;
  const v = options[id];
  return typeof v === "number" && v >= 0 ? v : fallback;
}

interface Member {
  ref: string;
  index: number;
  chunk: number;
  group: string | null;
}

interface Expanded {
  node: TemplateNode;
  members: Member[];
  /** 묶음별 멤버 (chain / chunk_last가 쓴다) */
  chunks: Member[][];
}

const pad = (i: number, total: number): string =>
  total >= 10 ? String(i).padStart(String(total).length, "0") : String(i);

/** 반복·개수 옵션을 실제 노드 인스턴스로 편다. */
function expandNode(node: TemplateNode, options: Options): Expanded {
  const total = node.repeat
    ? intOption(options, node.repeat.count, node.count)
    : intOption(options, node.count_from, node.count);
  const chunkSize = node.repeat ? intOption(options, node.repeat.chunk, total) : total;

  const members: Member[] = [];
  for (let i = 1; i <= total; i++) {
    const chunk = Math.floor((i - 1) / Math.max(1, chunkSize));
    members.push({
      ref: total === 1 ? node.ref : `${node.ref}-${pad(i, total)}`,
      index: i,
      chunk,
      group: total === 1 ? null : `${node.ref}#${chunk + 1}`,
    });
  }

  const chunks: Member[][] = [];
  for (const m of members) (chunks[m.chunk] ??= []).push(m);
  return { node, members, chunks: chunks.filter((c) => c !== undefined) };
}

function edgeFindings(code: string, message: string, where: string): Finding {
  return { severity: "error", code, message, where };
}

/** "ref.port" → [ref, port] */
function split(portRef: string): [string, string] {
  const [ref, port] = portRef.split(".") as [string, string];
  return [ref, port];
}

function resolveEdges(
  tpl: ConfigTemplate,
  edges: TemplateEdge[],
  expanded: Map<string, Expanded>,
  options: Options,
): { edges: Topology["edges"]; findings: Finding[] } {
  const out: Topology["edges"] = [];
  const findings: Finding[] = [];

  for (const e of edges) {
    if (!matches(e.when, options)) continue;
    const [fromRef, fromPort] = split(e.from);
    const [toRef, toPort] = split(e.to);
    const where = `${tpl.id}:${e.from}→${e.to}`;
    const a = expanded.get(fromRef);
    const b = expanded.get(toRef);
    if (!a || !b) {
      findings.push(
        edgeFindings(
          "C020",
          `엣지가 이 조합에 없는 노드를 참조한다: ${!a ? fromRef : toRef}. 엣지에도 같은 when을 달아야 한다`,
          where,
        ),
      );
      continue;
    }
    const push = (from: string, to: string) =>
      out.push({ from: `${from}.${fromPort}`, to: `${to}.${toPort}`, layer: e.layer, conductor: e.conductor });

    switch (e.fanout) {
      case "single": {
        if (a.members.length === 0 || b.members.length === 0) break;
        if (a.members.length !== 1 || b.members.length !== 1) {
          findings.push(
            edgeFindings("C021", `fanout=single인데 한쪽이 다중 노드다 (${a.members.length}↔${b.members.length})`, where),
          );
          continue;
        }
        push(a.members[0]!.ref, b.members[0]!.ref);
        break;
      }
      case "pairwise": {
        if (a.members.length !== b.members.length) {
          findings.push(
            edgeFindings("C022", `fanout=pairwise인데 개수가 다르다 (${a.members.length} vs ${b.members.length})`, where),
          );
          continue;
        }
        a.members.forEach((m, i) => push(m.ref, b.members[i]!.ref));
        break;
      }
      case "chain": {
        if (fromRef !== toRef) {
          findings.push(edgeFindings("C023", "fanout=chain은 같은 반복 노드 안에서만 쓴다", where));
          continue;
        }
        for (const chunk of a.chunks) {
          for (let i = 0; i < chunk.length - 1; i++) push(chunk[i]!.ref, chunk[i + 1]!.ref);
        }
        break;
      }
      case "chunk_last": {
        if (b.members.length === 0) break; // 도착지가 없는 조합(배터리 0대 등)은 결선도 없다
        // 도착지가 여럿이면 묶음을 순서대로 나눠 붙인다 — 스트링 2개를 인버터 2대에 배분한다
        a.chunks.forEach((chunk, i) => push(chunk[chunk.length - 1]!.ref, b.members[i % b.members.length]!.ref));
        break;
      }
      case "first": {
        // 다중 유닛 중 대표 하나만 연결한다 (통신 리더 유닛)
        if (a.members.length === 0 || b.members.length === 0) break;
        push(a.members[0]!.ref, b.members[0]!.ref);
        break;
      }
      case "each": {
        if (a.members.length > 1 && b.members.length > 1) {
          findings.push(edgeFindings("C025", "fanout=each는 한쪽이 단독일 때만 쓴다", where));
          continue;
        }
        if (b.members.length === 1) for (const m of a.members) push(m.ref, b.members[0]!.ref);
        else for (const m of b.members) push(a.members[0]!.ref, m.ref);
        break;
      }
    }
  }
  return { edges: out, findings };
}

/** 옵션 조합을 사람이 읽는 한 줄로. 도면 제목란과 비교표에 쓰인다. */
export function describeOptions(tpl: ConfigTemplate, options: Options): string {
  return tpl.options
    .map((axis) => {
      const v = options[axis.id];
      if (axis.kind === "enum") {
        const choice = axis.choices.find((c) => c.value === String(v));
        return `${axis.label} ${choice?.label ?? String(v)}`;
      }
      return `${axis.label} ${String(v)}${axis.unit ?? ""}`;
    })
    .join(" · ");
}

/** 조합을 id에 담는다. 같은 조합은 항상 같은 id — 링크가 재현 가능해야 한다. */
export function optionsSlug(tpl: ConfigTemplate, options: Options): string {
  const clean = (v: string) => v.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  return tpl.options.map((axis) => `${clean(axis.id)}-${clean(String(options[axis.id]))}`).join("-");
}

export function composeTopology(tpl: ConfigTemplate, given: Options = {}, preset?: Preset): ComposeResult {
  const { options, findings } = resolveOptions(tpl, given);

  const expanded = new Map<string, Expanded>();
  const nodes: Topology["nodes"] = [];
  for (const n of tpl.nodes) {
    if (!matches(n.when, options)) continue;
    const ex = expandNode(n, options);
    expanded.set(n.ref, ex);
    for (const m of ex.members) {
      const base = n.label ?? null;
      nodes.push({
        ref: m.ref,
        device: n.device,
        label: ex.members.length > 1 && base ? `${base} ${pad(m.index, ex.members.length)}` : base,
        count: 1,
        group: m.group,
      });
    }
  }

  const resolved = resolveEdges(tpl, tpl.edges, expanded, options);
  findings.push(...resolved.findings);

  const hasBackupAxis = tpl.options.some((a) => a.id === BACKUP_AXIS);
  const scope = hasBackupAxis ? String(options[BACKUP_AXIS]) : tpl.backup_scope;

  const parsed = Topology.safeParse({
    id: preset ? preset.id : `${tpl.id}--${optionsSlug(tpl, options)}`,
    vendor: tpl.vendor,
    display_name: preset ? preset.display_name : `${tpl.display_name} — ${describeOptions(tpl, options)}`,
    status: tpl.status,
    backup_scope: scope,
    nodes,
    edges: resolved.edges,
    sources: tpl.sources,
    todos: tpl.todos,
  });

  if (!parsed.success) {
    // 컴포저가 스키마를 어긴 그래프를 만들었다면 데이터가 아니라 컴포저 결함이다.
    throw new Error(`${tpl.id}: 컴포저 출력이 Topology 스키마를 위반했다 — ${parsed.error.message}`);
  }
  return { topology: parsed.data, options, findings };
}

/** 템플릿에 선언된 이름 붙은 조합들. 기존 topology 파일의 자리를 대신한다. */
export function composePresets(tpl: ConfigTemplate): ComposeResult[] {
  return tpl.presets.map((p) => composeTopology(tpl, p.options, p));
}

/**
 * enum 축의 모든 조합 (int 축은 기본값 고정).
 * 검증 CLI가 "어떤 조합에서도 결선이 깨지지 않는가"를 확인하는 데 쓴다.
 */
export function enumCombinations(tpl: ConfigTemplate, limit = 64): Options[] {
  let combos: Options[] = [defaultOptions(tpl)];
  for (const axis of tpl.options) {
    if (axis.kind !== "enum") continue;
    const next: Options[] = [];
    for (const base of combos) {
      for (const choice of axis.choices) {
        next.push({ ...base, [axis.id]: choice.value });
        if (next.length >= limit) return next;
      }
    }
    combos = next;
  }
  return combos;
}
