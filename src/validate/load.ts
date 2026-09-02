import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { Device } from "../schema/device.js";
import { ConfigTemplate } from "../schema/template.js";
import { NodeNote } from "../schema/note.js";
import { composePresets } from "../config/compose.js";
import { Topology } from "../schema/topology.js";
import { Scenario } from "../schema/scenario.js";
import type { Finding } from "../schema/common.js";

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.includes(extname(p))) out.push(p);
  }
  return out;
}

export interface LoadResult<T> {
  items: T[];
  findings: Finding[];
}

export function loadDevices(dir: string): LoadResult<Device> {
  const items: Device[] = [];
  const findings: Finding[] = [];
  for (const file of walk(dir, [".yaml", ".yml"])) {
    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(file, "utf8"));
    } catch (e) {
      findings.push({ severity: "error", code: "E000", message: `YAML 파싱 실패: ${String(e)}`, where: file });
      continue;
    }
    const parsed = Device.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        findings.push({
          severity: "error",
          code: "E001",
          message: `스키마 위반 [${issue.path.join(".")}] ${issue.message}`,
          where: file,
        });
      }
      continue;
    }
    items.push(parsed.data);
  }
  return { items, findings };
}

export function loadScenarios(dir: string): LoadResult<Scenario> {
  const items: Scenario[] = [];
  const findings: Finding[] = [];
  for (const file of walk(dir, [".json"])) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      findings.push({ severity: "error", code: "E000", message: `JSON 파싱 실패: ${String(e)}`, where: file });
      continue;
    }
    const parsed = Scenario.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        findings.push({
          severity: "error",
          code: "E001",
          message: `스키마 위반 [${issue.path.join(".")}] ${issue.message}`,
          where: file,
        });
      }
      continue;
    }
    items.push(parsed.data);
  }
  items.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { items, findings };
}

/** 구성 템플릿(configurations/*.yaml). topology JSON을 대신한다. */
export function loadConfigurations(dir: string): LoadResult<ConfigTemplate> {
  const items: ConfigTemplate[] = [];
  const findings: Finding[] = [];
  for (const file of walk(dir, [".yaml", ".yml"])) {
    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(file, "utf8"));
    } catch (e) {
      findings.push({ severity: "error", code: "E000", message: `YAML 파싱 실패: ${String(e)}`, where: file });
      continue;
    }
    const parsed = ConfigTemplate.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        findings.push({
          severity: "error",
          code: "E001",
          message: `스키마 위반 [${issue.path.join(".")}] ${issue.message}`,
          where: file,
        });
      }
      continue;
    }
    items.push(parsed.data);
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return { items, findings };
}

/** 템플릿에 선언된 프리셋 조합을 편다. 기존 topologies/*.json이 있던 자리다. */
export function presetTopologies(templates: ConfigTemplate[]): LoadResult<Topology> {
  const items: Topology[] = [];
  const findings: Finding[] = [];
  for (const tpl of templates) {
    for (const r of composePresets(tpl)) {
      items.push(r.topology);
      findings.push(...r.findings);
    }
  }
  return { items, findings };
}

/** 노드 포인트 노트(node-notes/*.yaml). */
export function loadNotes(dir: string): LoadResult<NodeNote> {
  const items: NodeNote[] = [];
  const findings: Finding[] = [];
  for (const file of walk(dir, [".yaml", ".yml"])) {
    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(file, "utf8"));
    } catch (e) {
      findings.push({ severity: "error", code: "E000", message: `YAML 파싱 실패: ${String(e)}`, where: file });
      continue;
    }
    const parsed = NodeNote.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        findings.push({
          severity: "error",
          code: "E001",
          message: `스키마 위반 [${issue.path.join(".")}] ${issue.message}`,
          where: file,
        });
      }
      continue;
    }
    items.push(parsed.data);
  }
  return { items, findings };
}

/** 편의 함수: 템플릿을 읽고 프리셋까지 편다. 예전 loadTopologies의 자리다. */
export function loadPresetTopologies(dir: string): LoadResult<Topology> & { templates: ConfigTemplate[] } {
  const cfg = loadConfigurations(dir);
  const presets = presetTopologies(cfg.items);
  return {
    templates: cfg.items,
    items: presets.items,
    findings: [...cfg.findings, ...presets.findings],
  };
}
