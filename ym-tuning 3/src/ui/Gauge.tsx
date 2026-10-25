import { fmt } from '../i18n';

interface GaugeProps {
  value: number;
  max: number;
  /** Start of the red zone (e.g. redline). */
  redFrom?: number;
  label: string;
  unit: string;
  /** Major tick spacing in value units. */
  step: number;
  /** Divide tick labels by this (e.g. 1000 to show rpm in thousands). */
  tickDivisor?: number;
  /** Optional ghost needle (stock comparison). */
  ghost?: number | null;
  ghostLabel?: string;
  alert?: boolean;
}

const START = -225; // degrees, 0 = 3 o'clock, clockwise positive in SVG
const SWEEP = 270;

function polar(r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: 120 + r * Math.cos(rad), y: 120 + r * Math.sin(rad) };
}

function arc(r: number, a0: number, a1: number) {
  const p0 = polar(r, a0), p1 = polar(r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`;
}

/** Instrument dial. Dials read clockwise in every locale, so the SVG is direction-neutral. */
export function Gauge({ value, max, redFrom, label, unit, step, tickDivisor = 1, ghost, ghostLabel, alert }: GaugeProps) {
  const clamp = (v: number) => Math.min(max, Math.max(0, v));
  const ang = (v: number) => START + (clamp(v) / max) * SWEEP;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-6; v += step) ticks.push(v);
  const minor: number[] = [];
  for (let v = 0; v <= max + 1e-6; v += step / 5) minor.push(v);

  return (
    <figure className={`gauge${alert ? ' gauge--alert' : ''}`} aria-label={`${label}: ${fmt(value)} ${unit}`}>
      <svg viewBox="0 0 240 240" role="img" aria-hidden="true">
        <path d={arc(100, START, START + SWEEP)} className="gauge__track" />
        {redFrom !== undefined && <path d={arc(100, ang(redFrom), START + SWEEP)} className="gauge__red" />}
        <path d={arc(100, START, ang(value))} className="gauge__fill" />
        {minor.map((v) => {
          const a = polar(92, ang(v)), b = polar(86, ang(v));
          return <line key={`m${v}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="gauge__minor" />;
        })}
        {ticks.map((v) => {
          const a = polar(92, ang(v)), b = polar(80, ang(v)), l = polar(66, ang(v));
          return (
            <g key={v}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="gauge__tick" />
              <text x={l.x} y={l.y} className="gauge__num" textAnchor="middle" dominantBaseline="central">
                {Math.round(v / tickDivisor)}
              </text>
            </g>
          );
        })}
        {ghost !== undefined && ghost !== null && (
          <g transform={`rotate(${ang(ghost)} 120 120)`} className="gauge__ghost">
            <line x1="120" y1="120" x2="208" y2="120" />
          </g>
        )}
        <g transform={`rotate(${ang(value)} 120 120)`} className="gauge__needle">
          <line x1="104" y1="120" x2="212" y2="120" />
        </g>
        <circle cx="120" cy="120" r="7" className="gauge__hub" />
      </svg>
      <figcaption className="gauge__readout">
        <span className="gauge__value num">{fmt(value)}</span>
        <span className="gauge__unit">{unit}</span>
        <span className="gauge__label">{label}</span>
        {ghost !== undefined && ghost !== null && ghostLabel && (
          <span className="gauge__ghostval">
            {ghostLabel}: <span className="num">{fmt(ghost)}</span>
          </span>
        )}
      </figcaption>
    </figure>
  );
}
