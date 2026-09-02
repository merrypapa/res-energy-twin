import type { IvCurve, Waveform } from "../analysis/signals.js";

/**
 * 신호 그래프. SVG를 직접 그린다 (CLAUDE.md §7 — 라이브러리는 필요성이 증명된 뒤에).
 *
 * 색 규칙(§6)은 도면과 같다: 색은 활선/사선만 나른다. 그래서 그래프는 잉크 한 색이고,
 * 계열 구분은 그래프를 나누는 것으로 한다 — 한 축에 여러 색 선을 겹치지 않는다.
 */

const W = 320;

interface PlotProps {
  x: number[];
  y: number[];
  title: string;
  unit: string;
  height?: number;
  /** 표시할 점 (MPP 등) */
  marker?: { x: number; y: number; label: string } | null;
  /** x축 라벨 (왼쪽/오른쪽) */
  xLabels?: [string, string];
}

function fmt(n: number): string {
  const a = Math.abs(n);
  if (a >= 100) return n.toFixed(0);
  if (a >= 10) return n.toFixed(1);
  if (a >= 1) return n.toFixed(2);
  return n.toFixed(3);
}

export function LinePlot({ x, y, title, unit, height = 72, marker = null, xLabels }: PlotProps) {
  if (x.length === 0 || y.length === 0) return null;
  const padL = 4;
  const padR = 4;
  const top = 12;
  const bottom = 12;
  const innerW = W - padL - padR;
  const innerH = height - top - bottom;

  const xMin = Math.min(...x);
  const xMax = Math.max(...x);
  const yMinRaw = Math.min(...y, 0);
  const yMaxRaw = Math.max(...y, 0);
  const span = yMaxRaw - yMinRaw || 1;
  const yMin = yMinRaw - span * 0.08;
  const yMax = yMaxRaw + span * 0.08;

  const sx = (v: number) => padL + ((v - xMin) / (xMax - xMin || 1)) * innerW;
  const sy = (v: number) => top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const d = x.map((v, i) => `${i === 0 ? "M" : "L"} ${sx(v).toFixed(1)} ${sy(y[i] ?? 0).toFixed(1)}`).join(" ");
  const zeroY = sy(0);

  return (
    <figure className="plot">
      <figcaption>
        <span className="plot-title">{title}</span>
        <span className="plot-range">
          {fmt(yMinRaw)} … {fmt(yMaxRaw)} {unit}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-label={title}>
        <path className="plot-axis" d={`M ${padL} ${zeroY} L ${W - padR} ${zeroY}`} />
        <path className="trace" d={d} />
        {marker && (
          <>
            <circle className="marker" cx={sx(marker.x)} cy={sy(marker.y)} r="3" />
            <text className="plot-note" x={Math.min(sx(marker.x) + 6, W - 90)} y={sy(marker.y) - 5}>
              {marker.label}
            </text>
          </>
        )}
        {xLabels && (
          <>
            <text className="plot-note" x={padL} y={height - 2}>
              {xLabels[0]}
            </text>
            <text className="plot-note" x={W - padR} y={height - 2} textAnchor="end">
              {xLabels[1]}
            </text>
          </>
        )}
      </svg>
    </figure>
  );
}

/** 한 주기 단위로 v · i · p를 세로로 쌓는다. 시간축이 같아 위상 관계가 그대로 읽힌다. */
export function WaveformChart({ wave }: { wave: Waveform }) {
  const ms = wave.t.map((t) => t * 1000);
  const end = `${((wave.cycles / wave.hz) * 1000).toFixed(1)} ms (${wave.cycles}주기)`;
  return (
    <div className="waveform">
      <LinePlot x={ms} y={wave.v} title="순시 전압 v(t)" unit="V" xLabels={["0", end]} />
      <LinePlot x={ms} y={wave.i} title="순시 전류 i(t)" unit="A" xLabels={["0", end]} />
      <LinePlot x={ms} y={wave.p.map((p) => p / 1000)} title="순시 전력 p(t) = v·i" unit="kW" xLabels={["0", end]} />
    </div>
  );
}

export function IvChart({ iv }: { iv: IvCurve }) {
  return (
    <div className="waveform">
      <LinePlot
        x={iv.v}
        y={iv.i}
        title="I–V 곡선"
        unit="A"
        marker={{ x: iv.mpp.v, y: iv.mpp.i, label: `MPP ${fmt(iv.mpp.v)}V / ${fmt(iv.mpp.i)}A` }}
        xLabels={["0 V", `${fmt(iv.voc)} V (Voc)`]}
      />
      <LinePlot
        x={iv.v}
        y={iv.p}
        title="P–V 곡선"
        unit="W"
        marker={{ x: iv.mpp.v, y: iv.mpp.p, label: `${fmt(iv.mpp.p)} W` }}
        xLabels={["0 V", `${fmt(iv.voc)} V`]}
      />
      <p className="plot-caption">{iv.model}</p>
    </div>
  );
}
