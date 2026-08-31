import type { Layer } from "../schema/common.js";
import { EMPTY_SITE, SiteContext } from "../schema/rule.js";

/**
 * 상태를 URL 해시에 담는다. 백엔드가 없으므로 링크가 곧 저장이다 —
 * "이 구성의 정전 시나리오 좀 봐줘"를 URL 하나로 보낼 수 있어야 한다.
 */
export interface UiState {
  selected: string[];
  layers: Layer[];
  scenarioId: string | null;
  trip: string;
  site: SiteContext;
}

const LAYERS: Layer[] = ["power", "comms", "physical"];

/** 순수 함수. location을 읽지 않으므로 테스트에서 문자열만 넘기면 된다. */
export function parseHash(hash: string, fallback: UiState): UiState {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  if ([...p.keys()].length === 0) return fallback;

  const list = (key: string): string[] =>
    (p.get(key) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const num = (key: string): number | null => {
    const raw = p.get(key);
    if (raw === null || raw.trim() === "") return null;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  const layers = list("layers").filter((l): l is Layer => (LAYERS as string[]).includes(l));
  const site = SiteContext.safeParse({
    utility: p.get("util") || null,
    backup_load_kw: num("load"),
    largest_motor_lra: num("lra"),
    service_a: num("service"),
  });

  return {
    selected: list("t").length > 0 ? list("t") : fallback.selected,
    layers: layers.length > 0 ? layers : fallback.layers,
    scenarioId: p.get("sc") || null,
    trip: p.get("trip") ?? "",
    site: site.success ? site.data : EMPTY_SITE,
  };
}

/** 순수 함수. 상태 → 해시 문자열. */
export function toHash(s: UiState): string {
  const p = new URLSearchParams();
  p.set("t", s.selected.join(","));
  p.set("layers", s.layers.join(","));
  if (s.scenarioId) p.set("sc", s.scenarioId);
  if (s.trip) p.set("trip", s.trip);
  if (s.site.backup_load_kw !== null) p.set("load", String(s.site.backup_load_kw));
  if (s.site.largest_motor_lra !== null) p.set("lra", String(s.site.largest_motor_lra));
  if (s.site.service_a !== null) p.set("service", String(s.site.service_a));
  if (s.site.utility) p.set("util", s.site.utility);
  return p.toString();
}

export function readState(fallback: UiState): UiState {
  return parseHash(location.hash, fallback);
}

export function writeState(s: UiState): void {
  history.replaceState(null, "", `#${toHash(s)}`);
}
