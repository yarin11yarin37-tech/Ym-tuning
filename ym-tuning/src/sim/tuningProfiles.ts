import type { EngineKind, VehicleModel } from './vehicleModels';
import { interpCurve } from './vehicleModels';

/**
 * HYPOTHETICAL tuning profiles. Selecting one changes only the simulation model — nothing is
 * written to any ECU. Gains are typical published ranges for generic calibrations and are
 * labelled as estimates everywhere they appear.
 */
export type ProfileId = 'stock' | 'stage1' | 'stage2' | 'stage3' | 'custom';

export interface TuningProfile {
  id: ProfileId;
  /** Torque gain in percent at low (≈30% of rev range), mid (≈55%) and top (limiter) rpm. */
  lowGainPct: number;
  midGainPct: number;
  topGainPct: number;
  /** Change to the rev limiter, rpm. */
  revLimitDeltaRpm: number;
  /** Multiplier on the torque build-up time constant (<1 = sharper response). */
  responseFactor: number;
}

export const PRESET_PROFILES: Record<Exclude<ProfileId, 'custom'>, TuningProfile> = {
  stock: { id: 'stock', lowGainPct: 0, midGainPct: 0, topGainPct: 0, revLimitDeltaRpm: 0, responseFactor: 1 },
  // Software-only calibration on otherwise stock hardware.
  stage1: { id: 'stage1', lowGainPct: 8, midGainPct: 15, topGainPct: 10, revLimitDeltaRpm: 0, responseFactor: 0.9 },
  // Assumes supporting hardware: intake, exhaust/downpipe, intercooler.
  stage2: { id: 'stage2', lowGainPct: 12, midGainPct: 25, topGainPct: 22, revLimitDeltaRpm: 200, responseFactor: 0.85 },
  // Assumes a larger turbocharger and fuel-system upgrades: more top end, slower spool.
  stage3: { id: 'stage3', lowGainPct: 0, midGainPct: 35, topGainPct: 45, revLimitDeltaRpm: 400, responseFactor: 1.25 },
};

export const DEFAULT_CUSTOM: TuningProfile = {
  id: 'custom', lowGainPct: 10, midGainPct: 18, topGainPct: 12, revLimitDeltaRpm: 100, responseFactor: 0.9,
};

/** Naturally aspirated engines gain far less from calibration alone. */
export const ENGINE_GAIN_SCALE: Record<EngineKind, number> = {
  'turbo-petrol': 1,
  'turbo-diesel': 1,
  'na-petrol': 0.35,
};

export function clampProfile(p: TuningProfile): TuningProfile {
  const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));
  return {
    ...p,
    lowGainPct: c(p.lowGainPct, 0, 60),
    midGainPct: c(p.midGainPct, 0, 60),
    topGainPct: c(p.topGainPct, 0, 60),
    revLimitDeltaRpm: c(p.revLimitDeltaRpm, 0, 800),
    responseFactor: c(p.responseFactor, 0.6, 1.5),
  };
}

export function limiterRpm(model: VehicleModel, profile: TuningProfile): number {
  return model.limiterRpm + profile.revLimitDeltaRpm;
}

/** Gain fraction applied at a given rpm: piecewise-linear over the normalised rev range. */
export function gainAt(model: VehicleModel, profile: TuningProfile, rpm: number): number {
  const lim = model.limiterRpm;
  const x = (rpm - model.idleRpm) / (lim - model.idleRpm);
  const pts: [number, number][] = [
    [0, profile.lowGainPct * 0.5],
    [0.3, profile.lowGainPct],
    [0.55, profile.midGainPct],
    [1, profile.topGainPct],
  ];
  return (interpCurve(pts, x) / 100) * ENGINE_GAIN_SCALE[model.engine];
}

/** Full-load torque for a model + profile at rpm. Beyond the stock curve, torque tapers. */
export function fullLoadTorque(model: VehicleModel, profile: TuningProfile, rpm: number): number {
  let base = interpCurve(model.torqueCurve, Math.min(rpm, model.limiterRpm));
  if (rpm > model.limiterRpm) base *= Math.max(0.6, 1 - (rpm - model.limiterRpm) / 2000);
  return base * (1 + gainAt(model, profile, rpm));
}
