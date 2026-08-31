import raw from "./generated/data.json";
import { Device } from "../schema/device.js";
import { Topology } from "../schema/topology.js";
import { Scenario } from "../schema/scenario.js";
import type { Finding } from "../schema/common.js";

/**
 * 빌드 타임에 만들어진 번들을 다시 한 번 스키마로 통과시킨다.
 * 앱은 파일 시스템을 모르고, 검증되지 않은 데이터도 보지 않는다.
 */
const bundle = raw as {
  built_at: string;
  devices: unknown[];
  topologies: unknown[];
  scenarios: unknown[];
  data_findings: Finding[];
};

export const BUILT_AT = bundle.built_at;
export const DEVICES = bundle.devices.map((d) => Device.parse(d));
export const TOPOLOGIES = bundle.topologies.map((t) => Topology.parse(t));
export const SCENARIOS = bundle.scenarios.map((s) => Scenario.parse(s));
export const DATA_FINDINGS = bundle.data_findings;

export const VENDORS = [...new Set(TOPOLOGIES.map((t) => t.vendor))].sort();
