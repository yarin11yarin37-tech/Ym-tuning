/**
 * Reference vehicle models for מעבדת ביצועים.
 *
 * These are generic reference models, NOT specific real vehicles and NOT measured data.
 * Parameters are typical published-range values for each engine/vehicle class and are
 * documented here so every estimate in the UI can be traced back to its assumptions.
 */

export type EngineKind = 'turbo-petrol' | 'na-petrol' | 'turbo-diesel';

export interface VehicleModel {
  id: string;
  /** i18n key for the display name */
  nameKey: string;
  engine: EngineKind;
  cylinders: number;
  displacementL: number;
  idleRpm: number;
  redlineRpm: number;
  limiterRpm: number;
  /** Stock full-load torque curve: [rpm, Nm], ascending rpm. */
  torqueCurve: [number, number][];
  gearRatios: number[];
  finalDrive: number;
  tireRadiusM: number;
  massKg: number;
  /** Drag area Cd·A in m² */
  cdA: number;
  rollingCoef: number;
  drivelineEff: number;
  /** Time constant of torque build-up after a throttle step (turbo spool / intake dynamics), seconds. */
  responseTauS: number;
  /** Shift duration of the modelled automatic gearbox, seconds. */
  shiftTimeS: number;
}

export const VEHICLE_MODELS: VehicleModel[] = [
  {
    id: 'ref-turbo-20',
    nameKey: 'lab.models.refTurbo20',
    engine: 'turbo-petrol',
    cylinders: 4,
    displacementL: 2.0,
    idleRpm: 800,
    redlineRpm: 6500,
    limiterRpm: 6800,
    torqueCurve: [
      [800, 160], [1000, 200], [1500, 280], [2000, 350], [3000, 350], [4000, 350],
      [5000, 330], [5500, 310], [6000, 285], [6500, 250], [6800, 230],
    ],
    gearRatios: [3.46, 2.05, 1.37, 1.03, 0.84, 0.69],
    finalDrive: 3.65,
    tireRadiusM: 0.317,
    massKg: 1525,
    cdA: 0.68,
    rollingCoef: 0.012,
    drivelineEff: 0.88,
    responseTauS: 0.35,
    shiftTimeS: 0.22,
  },
  {
    id: 'ref-na-16',
    nameKey: 'lab.models.refNa16',
    engine: 'na-petrol',
    cylinders: 4,
    displacementL: 1.6,
    idleRpm: 750,
    redlineRpm: 6800,
    limiterRpm: 7000,
    torqueCurve: [
      [750, 95], [1000, 110], [2000, 135], [3000, 145], [4000, 155], [4500, 158],
      [5000, 155], [6000, 145], [6500, 135], [7000, 120],
    ],
    gearRatios: [3.73, 2.05, 1.36, 1.03, 0.82],
    finalDrive: 4.06,
    tireRadiusM: 0.305,
    massKg: 1300,
    cdA: 0.65,
    rollingCoef: 0.012,
    drivelineEff: 0.9,
    responseTauS: 0.12,
    shiftTimeS: 0.25,
  },
  {
    id: 'ref-diesel-20',
    nameKey: 'lab.models.refDiesel20',
    engine: 'turbo-diesel',
    cylinders: 4,
    displacementL: 2.0,
    idleRpm: 750,
    redlineRpm: 4500,
    limiterRpm: 4700,
    torqueCurve: [
      [750, 170], [1000, 220], [1500, 330], [1750, 400], [2500, 400], [3000, 370],
      [3500, 330], [4000, 290], [4500, 240], [4700, 210],
    ],
    gearRatios: [4.69, 2.53, 1.56, 1.14, 0.85, 0.67],
    finalDrive: 3.24,
    tireRadiusM: 0.33,
    massKg: 1700,
    cdA: 0.75,
    rollingCoef: 0.013,
    drivelineEff: 0.87,
    responseTauS: 0.5,
    shiftTimeS: 0.28,
  },
];

export function getModel(id: string): VehicleModel {
  return VEHICLE_MODELS.find((m) => m.id === id) ?? VEHICLE_MODELS[0];
}

/** Linear interpolation on the torque curve, clamped to its ends. */
export function interpCurve(curve: [number, number][], rpm: number): number {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [r1, t1] = curve[i];
    if (rpm <= r1) {
      const [r0, t0] = curve[i - 1];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return curve[curve.length - 1][1];
}

export function peakTorque(model: VehicleModel): number {
  return Math.max(...model.torqueCurve.map(([, t]) => t));
}

/**
 * Scale a reference model so its peak torque matches a figure supplied by the user
 * (e.g. from the manufacturer's spec sheet for the connected vehicle).
 */
export function scaleModelToTorque(model: VehicleModel, userPeakNm: number): VehicleModel {
  const k = userPeakNm / peakTorque(model);
  return {
    ...model,
    id: `${model.id}~user`,
    torqueCurve: model.torqueCurve.map(([r, t]) => [r, Math.round(t * k * 10) / 10]),
  };
}
