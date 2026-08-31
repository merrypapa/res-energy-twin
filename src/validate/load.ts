import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { Device } from "../schema/device.js";
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

export function loadTopologies(dir: string): LoadResult<Topology> {
  const items: Topology[] = [];
  const findings: Finding[] = [];
  for (const file of walk(dir, [".json"])) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      findings.push({ severity: "error", code: "E000", message: `JSON 파싱 실패: ${String(e)}`, where: file });
      continue;
    }
    const parsed = Topology.safeParse(raw);
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
