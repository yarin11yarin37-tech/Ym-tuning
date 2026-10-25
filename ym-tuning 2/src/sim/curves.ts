import type { VehicleModel } from './vehicleModels';
import { fullLoadTorque, limiterRpm, type TuningProfile } from './tuningProfiles';
import { accelTime } from './simulator';
import type { Sourced } from '../../shared/types';

export interface CurvePoint {
  rpm: number;
  torqueNm: number;
  powerKw: number;
}

export function fullLoadCurve(model: VehicleModel, profile: TuningProfile, step = 250): CurvePoint[] {
  const out: CurvePoint[] = [];
  const top = limiterRpm(model, profile);
  const start = Math.ceil(model.idleRpm / step) * step;
  for (let rpm = start; rpm <= top; rpm += step) {
    const t = fullLoadTorque(model, profile, rpm);
    out.push({ rpm, torqueNm: round1(t), powerKw: round1((t * rpm) / 9549) });
  }
  return out;
}

/** Delivered torque fraction after a 0→100% throttle step, sampled every 50 ms for 2 s. */
export function throttleResponseCurve(model: VehicleModel, profile: TuningProfile): { t: number; frac: number }[] {
  const tau = model.responseTauS * profile.responseFactor;
  const out: { t: number; frac: number }[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i * 0.05;
    out.push({ t: round2(t), frac: round2(1 - Math.exp(-t / tau)) });
  }
  return out;
}

export interface PerformanceSummary {
  peakTorque: Sourced<number>;
  peakTorqueRpm: number;
  peakPower: Sourced<number>;
  peakPowerRpm: number;
  zeroTo100: Sourced<number> | null;
  response90: Sourced<number>;
}

export function summarize(model: VehicleModel, profile: TuningProfile, provenance: 'estimated' | 'user' = 'estimated'): PerformanceSummary {
  const curve = fullLoadCurve(model, profile, 50);
  const pt = curve.reduce((a, b) => (b.torqueNm > a.torqueNm ? b : a));
  const pp = curve.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
  const z = accelTime(model, profile);
  const src = 'model';
  return {
    peakTorque: { value: pt.torqueNm, unit: 'Nm', provenance, source: src },
    peakTorqueRpm: pt.rpm,
    peakPower: { value: pp.powerKw, unit: 'kW', provenance, source: src },
    peakPowerRpm: pp.rpm,
    zeroTo100: z === null ? null : { value: z, unit: 's', provenance: 'estimated', source: src },
    response90: {
      value: round2(model.responseTauS * profile.responseFactor * Math.log(10)),
      unit: 's',
      provenance: 'estimated',
      source: src,
    },
  };
}

export const kwToHp = (kw: number) => kw * 1.341;
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
