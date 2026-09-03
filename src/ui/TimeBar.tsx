import type { Location } from "../schema/location.js";
import type { OperatingPoint } from "../analysis/operating-point.js";
import { formatHour } from "../analysis/operating-point.js";
import { dayCurve, daylight, SOLAR_MODEL, sunAt } from "../analysis/solar.js";

/**
 * 시간 축 — 하루가 흐르면 신호가 어떻게 변하는가.
 *
 * 곡선은 그날의 경사면 일사이고, 눈금은 지금 보고 있는 시각이다.
 * 재생을 멈추면 그 시각의 값이 그대로 정지 화면이 된다 — 애니메이션은 표현일 뿐,
 * 계산은 언제나 한 시점의 정상상태다.
 */
const W = 320;
const H = 54;

export function TimeBar({
  op,
  location,
  playing,
  onHour,
  onPlay,
}: {
  op: OperatingPoint;
  location: Location | null;
  playing: boolean;
  onHour: (hour: number) => void;
  onPlay: (playing: boolean) => void;
}) {
  const samples = location ? dayCurve(location, op.month, op.clearness) : [];
  const light = location ? daylight(location, op.month) : null;
  const sun = location ? sunAt(location.latitude_deg, op.month, op.hour, op.clearness) : null;
  const peak = Math.max(1, ...samples.map((s) => s.poa_wm2));

  const sx = (hour: number) => (hour / 24) * W;
  const sy = (v: number) => H - 12 - (v / peak) * (H - 20);
  const path = samples
    .map((s, i) => `${i === 0 ? "M" : "L"} ${sx(s.hour).toFixed(1)} ${sy(s.poa_wm2).toFixed(1)}`)
    .join(" ");

  return (
    <div className="timebar">
      <div className="timebar-head">
        <button type="button" className="toggle" onClick={() => onPlay(!playing)} disabled={location === null}>
          {playing ? "정지" : "재생"}
        </button>
        <span className="clock">{formatHour(op.hour)}</span>
        <span className="sub">
          {location ? `${location.display_name} · ${op.month}월` : "지역 미지정 — 일사를 직접 준다"}
        </span>
      </div>

      {location && (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="하루 일사 곡선">
            <path className="plot-axis" d={`M 0 ${H - 12} L ${W} ${H - 12}`} />
            {light && (
              <>
                <path className="plot-axis dashed" d={`M ${sx(light.sunrise)} 4 L ${sx(light.sunrise)} ${H - 12}`} />
                <path className="plot-axis dashed" d={`M ${sx(light.sunset)} 4 L ${sx(light.sunset)} ${H - 12}`} />
              </>
            )}
            <path className="trace" d={path} />
            <path className="now" d={`M ${sx(op.hour)} 2 L ${sx(op.hour)} ${H - 12}`} />
            <circle className="marker" cx={sx(op.hour)} cy={sy(sun?.poa_wm2 ?? 0)} r="3" />
            <text className="plot-note" x="0" y={H - 2}>00</text>
            <text className="plot-note" x={W / 2} y={H - 2} textAnchor="middle">12</text>
            <text className="plot-note" x={W} y={H - 2} textAnchor="end">24</text>
          </svg>

          <input
            className="time-slider"
            type="range"
            min="0"
            max="24"
            step="0.25"
            value={op.hour}
            onChange={(e) => onHour(Number(e.target.value))}
          />

          <p className="hint">
            경사면 일사 {Math.round(sun?.poa_wm2 ?? 0)} W/m² · 태양 고도 {(sun?.elevation_deg ?? 0).toFixed(1)}°
            {light && ` · 일출 ${formatHour(light.sunrise)} · 일몰 ${formatHour(light.sunset)}`}
          </p>
          <p className="hint">{SOLAR_MODEL.name} — {SOLAR_MODEL.note}</p>
        </>
      )}
    </div>
  );
}
