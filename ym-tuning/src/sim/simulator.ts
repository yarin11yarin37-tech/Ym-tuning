/**
 * Deterministic longitudinal vehicle simulator.
 *
 * Pure functions only: the same model, profile and input sequence always produce the same
 * output. No randomness, no wall-clock, and no I/O — this module cannot reach the vehicle,
 * the adapter or the IPC bridge (enforced by a test that scans its imports).
 */
import type { VehicleModel } from './vehicleModels';
import { fullLoadTorque, limiterRpm, type TuningProfile } from './tuningProfiles';

export const SIM_DT = 1 / 240;
const RHO = 1.2; // air density kg/m³
const G = 9.81;
const LIMITER_HYST = 150;

export interface SimState {
  t: number;
  rpm: number;
  speedMs: number;
  gear: number; // 1-based
  /** Delivered torque fraction 0..1 after response lag (turbo spool / intake). */
  torqueFrac: number;
  throttle: number;
  shiftTimer: number;
  shiftTargetGear: number;
  limiterCut: boolean;
  engineTorqueNm: number;
  powerKw: number;
}

export interface SimSnapshot {
  rpm: number;
  speedKmh: number;
  gear: number;
  throttle: number;
  torqueFrac: number;
  engineTorqueNm: number;
  powerKw: number;
  limiterCut: boolean;
  shifting: boolean;
}

export function initialState(model: VehicleModel): SimState {
  return {
    t: 0,
    rpm: model.idleRpm,
    speedMs: 0,
    gear: 1,
    torqueFrac: 0,
    throttle: 0,
    shiftTimer: 0,
    shiftTargetGear: 1,
    limiterCut: false,
    engineTorqueNm: 0,
    powerKw: 0,
  };
}

function gearRpm(model: VehicleModel, speedMs: number, gear: number): number {
  const wheelRpm = (speedMs / model.tireRadiusM) * (60 / (2 * Math.PI));
  return wheelRpm * model.gearRatios[gear - 1] * model.finalDrive;
}

function frictionTorque(model: VehicleModel, rpm: number): number {
  // Pumping + friction losses, grows with rpm and displacement.
  return model.displacementL * (8 + rpm * 0.004);
}

/** Advance one fixed sub-step. */
function subStep(s: SimState, throttleIn: number, model: VehicleModel, profile: TuningProfile): SimState {
  const dt = SIM_DT;
  const throttle = Math.min(1, Math.max(0, throttleIn));
  const lim = limiterRpm(model, profile);
  const nGears = model.gearRatios.length;
  let { rpm, speedMs, gear, torqueFrac, shiftTimer, shiftTargetGear, limiterCut } = s;

  // Torque response: first-order lag, faster on lift-off.
  const tauUp = model.responseTauS * profile.responseFactor;
  const tau = throttle > torqueFrac ? tauUp : 0.08;
  torqueFrac += (throttle - torqueFrac) * (1 - Math.exp(-dt / tau));

  // Rev limiter with hysteresis.
  if (rpm >= lim) limiterCut = true;
  else if (rpm < lim - LIMITER_HYST) limiterCut = false;

  const tFull = fullLoadTorque(model, profile, rpm);
  const fric = frictionTorque(model, rpm);
  let engineTorque = limiterCut ? -fric : torqueFrac * tFull - fric * (1 - torqueFrac);

  // Gear shifting: torque interrupted for shiftTimeS.
  const shifting = shiftTimer > 0;
  if (shifting) {
    shiftTimer = Math.max(0, shiftTimer - dt);
    if (shiftTimer === 0) gear = shiftTargetGear;
  }

  const coupledRpm = gearRpm(model, speedMs, gear);
  // Launch: below this engine speed the clutch/converter slips in first gear.
  const launchRpm = model.idleRpm + throttle * Math.min(2200, (model.redlineRpm - model.idleRpm) * 0.4);
  const slipping = gear === 1 && coupledRpm < launchRpm && !shifting;

  let driveTorque: number;
  if (shifting) {
    driveTorque = 0;
    const target = gearRpm(model, speedMs, shiftTargetGear);
    rpm += (Math.max(target, model.idleRpm) - rpm) * (1 - Math.exp(-dt / 0.05));
  } else if (slipping) {
    const targetRpm = Math.max(model.idleRpm, launchRpm);
    rpm += (targetRpm - rpm) * (1 - Math.exp(-dt / 0.12));
    driveTorque = throttle > 0.02 ? Math.max(0, engineTorque) : 0;
  } else {
    rpm = Math.max(coupledRpm, model.idleRpm);
    // Below idle coupling in higher gears the converter/clutch also slips — no engine braking at a crawl.
    driveTorque = coupledRpm < model.idleRpm ? Math.max(0, engineTorque) : engineTorque;
  }

  const ratio = model.gearRatios[gear - 1] * model.finalDrive;
  const wheelForce = (driveTorque * ratio * model.drivelineEff) / model.tireRadiusM;
  const drag = 0.5 * RHO * model.cdA * speedMs * speedMs;
  const rolling = speedMs > 0.05 ? model.rollingCoef * model.massKg * G : 0;
  // Rotating-mass factor: heavier in low gears.
  const effMass = model.massKg * (1.04 + 0.0025 * ratio * ratio);
  const accel = (wheelForce - drag - rolling) / effMass;
  speedMs = Math.max(0, speedMs + accel * dt);

  // Automatic gearbox.
  if (!shifting && shiftTimer === 0) {
    const upRpm = model.idleRpm + (lim - 250 - model.idleRpm) * (0.32 + 0.68 * throttle);
    const downRpm = model.idleRpm + 350 + throttle * 1400;
    if (gear < nGears && rpm >= upRpm && !slipping) {
      shiftTargetGear = gear + 1;
      shiftTimer = model.shiftTimeS;
    } else if (gear > 1 && coupledRpm < downRpm) {
      const lower = gearRpm(model, speedMs, gear - 1);
      if (lower < lim - 600 || speedMs < 1) {
        shiftTargetGear = gear - 1;
        shiftTimer = model.shiftTimeS * 0.8;
      }
    }
  }

  const delivered = shifting ? 0 : Math.max(0, engineTorque);
  return {
    t: s.t + dt,
    rpm,
    speedMs,
    gear,
    torqueFrac,
    throttle,
    shiftTimer,
    shiftTargetGear,
    limiterCut,
    engineTorqueNm: delivered,
    powerKw: (delivered * rpm) / 9549,
  };
}

/** Advance by `elapsed` seconds using fixed sub-steps. Leftover time is carried by the caller. */
export function advance(
  s: SimState,
  throttle: number,
  elapsed: number,
  model: VehicleModel,
  profile: TuningProfile,
): { state: SimState; leftover: number } {
  let state = s;
  let remaining = Math.min(elapsed, 0.25); // never try to catch up more than 250 ms (tab was hidden)
  while (remaining >= SIM_DT) {
    state = subStep(state, throttle, model, profile);
    remaining -= SIM_DT;
  }
  return { state, leftover: remaining };
}

export function snapshot(s: SimState): SimSnapshot {
  return {
    rpm: s.rpm,
    speedKmh: s.speedMs * 3.6,
    gear: s.gear,
    throttle: s.throttle,
    torqueFrac: s.torqueFrac,
    engineTorqueNm: s.engineTorqueNm,
    powerKw: s.powerKw,
    limiterCut: s.limiterCut,
    shifting: s.shiftTimer > 0,
  };
}

/** Run a full-throttle standing start; returns seconds to reach targetKmh (null if not reached in 40 s). */
export function accelTime(model: VehicleModel, profile: TuningProfile, targetKmh = 100): number | null {
  let s = initialState(model);
  while (s.t < 40) {
    s = subStep(s, 1, model, profile);
    if (s.speedMs * 3.6 >= targetKmh) return Math.round(s.t * 100) / 100;
  }
  return null;
}
