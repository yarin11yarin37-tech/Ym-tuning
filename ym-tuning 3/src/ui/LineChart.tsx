import { useMemo, useState, type PointerEvent } from 'react';
import type { Provenance } from '../../shared/types';
import { fmt } from '../i18n';
import { ProvenanceBadge } from './primitives';

export interface Series {
  id: string;
  label: string;
  tone: 'stock' | 'selected' | 'dyno' | 'stock2' | 'selected2';
  dashed?: boolean;
  provenance: Provenance;
  points: { x: number; y: number }[];
  /** 'left' (default) or 'right' y-axis */
  axis?: 'left' | 'right';
}

interface Props {
  series: Series[];
  xLabel: string;
  yLabel: string;
  yRightLabel?: string;
  xDigits?: number;
  title: string;
  height?: number;
  /** viewBox width — smaller values render larger text in narrow panels */
  width?: number;
}

const PAD_L = 48, PAD_R = 48, PAD_T = 30, PAD_B = 34;

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/**
 * Compact SVG line chart. The plot area is LTR (x grows to the right, as on every dyno sheet);
 * legend and labels around it follow the Hebrew RTL layout.
 */
export function LineChart({ series, xLabel, yLabel, yRightLabel, xDigits = 0, title, height = 260, width = 640 }: Props) {
  const H = height;
  const W = width;
  const [hoverX, setHoverX] = useState<number | null>(null);
  const geo = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    const xMin = Math.min(...all.map((p) => p.x));
    const xMax = Math.max(...all.map((p) => p.x));
    const yL = niceMax(Math.max(1, ...series.filter((s) => s.axis !== 'right').flatMap((s) => s.points.map((p) => p.y))));
    const yR = niceMax(Math.max(1, ...series.filter((s) => s.axis === 'right').flatMap((s) => s.points.map((p) => p.y))));
    const sx = (x: number) => PAD_L + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD_L - PAD_R);
    const sy = (y: number, right?: boolean) => H - PAD_B - (y / (right ? yR : yL)) * (H - PAD_T - PAD_B);
    return { xMin, xMax, yL, yR, sx, sy };
  }, [series, H, W]);

  const { xMin, xMax, yL, yR, sx, sy } = geo;
  const hasRight = series.some((s) => s.axis === 'right');
  const xTicks = Array.from({ length: 6 }, (_, i) => xMin + ((xMax - xMin) * i) / 5);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    if (px < PAD_L || px > W - PAD_R) return setHoverX(null);
    setHoverX(xMin + ((px - PAD_L) / (W - PAD_L - PAD_R)) * (xMax - xMin));
  };

  const nearest = (s: Series, x: number) =>
    s.points.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a), s.points[0]);

  return (
    <figure className="chart">
      <figcaption className="chart__head">
        <span className="chart__title">{title}</span>
        <span className="chart__legend">
          {series.map((s) => (
            <span key={s.id} className={`chart__key chart__key--${s.tone}${s.dashed ? ' is-dashed' : ''}`}>
              <span className="chart__swatch" aria-hidden="true" />
              {s.label}
              <ProvenanceBadge p={s.provenance} compact />
            </span>
          ))}
        </span>
      </figcaption>
      <div dir="ltr" className="chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHoverX(null)} role="img" aria-label={title}>
          {yTicks.map((f) => (
            <g key={f}>
              <line x1={PAD_L} x2={W - PAD_R} y1={sy(f * yL)} y2={sy(f * yL)} className="chart__grid" />
              <text x={PAD_L - 8} y={sy(f * yL)} className="chart__tick" textAnchor="end" dominantBaseline="central">
                {fmt(f * yL)}
              </text>
              {hasRight && (
                <text x={W - PAD_R + 8} y={sy(f * yR, true)} className="chart__tick" textAnchor="start" dominantBaseline="central">
                  {fmt(f * yR)}
                </text>
              )}
            </g>
          ))}
          {xTicks.map((x) => (
            <text key={x} x={sx(x)} y={H - PAD_B + 16} className="chart__tick" textAnchor="middle">
              {fmt(x, xDigits)}
            </text>
          ))}
          <text x={(W) / 2} y={H - 4} className="chart__axis" textAnchor="middle">{xLabel}</text>
          <text x={8} y={12} className="chart__axis" textAnchor="start">{yLabel}</text>
          {hasRight && yRightLabel && (
            <text x={W - 8} y={12} className="chart__axis" textAnchor="end">{yRightLabel}</text>
          )}
          {series.map((s) => (
            <polyline
              key={s.id}
              className={`chart__line chart__line--${s.tone}${s.dashed ? ' is-dashed' : ''}`}
              points={s.points.map((p) => `${sx(p.x)},${sy(p.y, s.axis === 'right')}`).join(' ')}
            />
          ))}
          {hoverX !== null && (
            <g className="chart__hover">
              <line x1={sx(hoverX)} x2={sx(hoverX)} y1={PAD_T} y2={H - PAD_B} />
              {series.map((s) => {
                const p = nearest(s, hoverX);
                return <circle key={s.id} cx={sx(p.x)} cy={sy(p.y, s.axis === 'right')} r={3.5} className={`chart__dot chart__dot--${s.tone}`} />;
              })}
            </g>
          )}
        </svg>
      </div>
      {hoverX !== null && (
        <div className="chart__readout">
          <span className="num">{fmt(nearest(series[0], hoverX).x, xDigits)}</span> {xLabel}
          {series.map((s) => (
            <span key={s.id} className={`chart__rv chart__rv--${s.tone}`}>
              {s.label}: <span className="num">{fmt(nearest(s, hoverX).y, 1)}</span>
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}
