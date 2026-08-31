import type { Device } from "../schema/device.js";
import type { Topology } from "../schema/topology.js";
import type { Finding } from "../schema/common.js";
import { portsCompatible } from "../schema/compat.js";

const err = (code: string, message: string, where: string): Finding => ({ severity: "error", code, message, where });
const warn = (code: string, message: string, where: string): Finding => ({ severity: "warning", code, message, where });
const info = (code: string, message: string, where: string): Finding => ({ severity: "info", code, message, where });

/** 숫자 스펙이 있으면 출처가 있어야 한다. 추정치가 확정값처럼 굳는 것을 막는다. */
export function checkSourcedNumbers(devices: Device[]): Finding[] {
  const findings: Finding[] = [];
  for (const d of devices) {
    const hasNumber = Object.values(d.ratings).some((v) => typeof v === "number");
    if (hasNumber && d.sources.length === 0) {
      findings.push(err("E010", "숫자 스펙이 있으나 sources가 비어 있음", d.id));
    }
    for (const s of d.sources) {
      if (s.date === null) {
        findings.push(info("I010", `출처에 date 없음: ${s.ref}`, d.id));
      }
    }
  }
  return findings;
}

export function checkDuplicateIds(devices: Device[], topologies: Topology[]): Finding[] {
  const findings: Finding[] = [];
  const seen = new Map<string, number>();
  for (const d of devices) seen.set(d.id, (seen.get(d.id) ?? 0) + 1);
  for (const [id, n] of seen) if (n > 1) findings.push(err("E011", `device id 중복 (${n}건)`, id));

  const tseen = new Map<string, number>();
  for (const t of topologies) tseen.set(t.id, (tseen.get(t.id) ?? 0) + 1);
  for (const [id, n] of tseen) if (n > 1) findings.push(err("E012", `topology id 중복 (${n}건)`, id));
  return findings;
}

/** 토폴로지 참조 정합성: 노드의 device, 엣지의 node.port, 포트 타입/방향, 연결 수. */
export function checkTopology(t: Topology, devices: Device[]): Finding[] {
  const findings: Finding[] = [];
  const byId = new Map(devices.map((d) => [d.id, d]));
  const nodeDevice = new Map<string, Device>();

  for (const n of t.nodes) {
    const d = byId.get(n.device);
    if (!d) {
      findings.push(err("E020", `알 수 없는 device: ${n.device}`, `${t.id}#${n.ref}`));
      continue;
    }
    nodeDevice.set(n.ref, d);
    if (d.status === "draft") {
      findings.push(info("I020", `draft 상태 device 사용: ${d.id}`, `${t.id}#${n.ref}`));
    }
  }

  const usage = new Map<string, number>();

  for (const e of t.edges) {
    const ends = [e.from, e.to].map((ref) => {
      const [nodeRef, portId] = ref.split(".") as [string, string];
      const dev = nodeDevice.get(nodeRef);
      if (!dev) {
        findings.push(err("E021", `엣지가 존재하지 않는 노드를 참조: ${nodeRef}`, `${t.id}:${e.from}→${e.to}`));
        return null;
      }
      const port = dev.ports.find((p) => p.id === portId);
      if (!port) {
        findings.push(err("E022", `${dev.id}에 포트 없음: ${portId}`, `${t.id}:${e.from}→${e.to}`));
        return null;
      }
      const key = `${nodeRef}.${portId}`;
      usage.set(key, (usage.get(key) ?? 0) + 1);
      return { port, key };
    });

    const [a, b] = ends;
    if (!a || !b) continue;
    if (!portsCompatible(a.port, b.port)) {
      findings.push(
        err(
          "E023",
          `포트 타입/방향 비호환: ${a.port.type}(${a.port.direction}) ↔ ${b.port.type}(${b.port.direction})`,
          `${t.id}:${e.from}→${e.to}`,
        ),
      );
    }
  }

  for (const [key, n] of usage) {
    const [nodeRef, portId] = key.split(".") as [string, string];
    const port = nodeDevice.get(nodeRef)?.ports.find((p) => p.id === portId);
    if (port && n > port.max_connections) {
      findings.push(err("E024", `포트 연결 수 초과: ${n} > ${port.max_connections}`, `${t.id}#${key}`));
    }
  }

  // requires_one_of
  const presentIds = new Set([...nodeDevice.values()].map((d) => d.id));
  for (const [ref, d] of nodeDevice) {
    if (d.requires_one_of.length === 0) continue;
    if (!d.requires_one_of.some((id) => presentIds.has(id))) {
      findings.push(
        err("E025", `${d.id}의 필수 동반 장비 없음 (후보: ${d.requires_one_of.join(", ")})`, `${t.id}#${ref}`),
      );
    }
  }

  // 백업 구성인데 MID가 없다
  if (t.backup_scope !== "none") {
    const hasMid = [...nodeDevice.values()].some((d) => d.provides_mid);
    if (!hasMid) {
      findings.push(warn("W030", `backup_scope=${t.backup_scope}이나 MID 제공 장치가 없음`, t.id));
    }
  }

  if (t.status === "draft") findings.push(info("I021", "draft 토폴로지 — 대외 인용 금지", t.id));
  return findings;
}

export function checkOrphans(devices: Device[], topologies: Topology[]): Finding[] {
  const used = new Set(topologies.flatMap((t) => t.nodes.map((n) => n.device)));
  return devices.filter((d) => !used.has(d.id)).map((d) => info("I040", "어떤 토폴로지에서도 사용되지 않음", d.id));
}

export function validateAll(devices: Device[], topologies: Topology[]): Finding[] {
  return [
    ...checkDuplicateIds(devices, topologies),
    ...checkSourcedNumbers(devices),
    ...topologies.flatMap((t) => checkTopology(t, devices)),
    ...checkOrphans(devices, topologies),
  ];
}
