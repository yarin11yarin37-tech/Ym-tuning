import type { CatalogOption, ControllerKind, DefinitionFile } from '../../shared/workshop';

interface OptionSpec { id: string; kind: ControllerKind; group: string; requiredTags: string[] }

/**
 * Calibration option catalog. Availability is computed ONLY from maps present in the
 * controller's definition — never assumed from the vehicle make or the option name.
 * Emissions-control and anti-theft defeat options are permanently blocked.
 */
export const OPTION_SPECS: OptionSpec[] = [
  // ECU — engine
  { id: 'ecu.stage1', kind: 'ecu', group: 'stages', requiredTags: ['torque.request', 'torque.limit', 'boost.target', 'ignition.base'] },
  { id: 'ecu.stage2', kind: 'ecu', group: 'stages', requiredTags: ['torque.request', 'torque.limit', 'boost.target', 'ignition.base', 'fuel.lambda_target'] },
  { id: 'ecu.stage3', kind: 'ecu', group: 'stages', requiredTags: ['torque.limit', 'boost.target', 'boost.limit', 'ignition.base', 'fuel.lambda_target', 'fuel.injector'] },
  { id: 'ecu.custom', kind: 'ecu', group: 'stages', requiredTags: [] },
  { id: 'ecu.throttle', kind: 'ecu', group: 'driveability', requiredTags: ['throttle.pedal_map'] },
  { id: 'ecu.torque', kind: 'ecu', group: 'torque', requiredTags: ['torque.request', 'torque.limit'] },
  { id: 'ecu.boost', kind: 'ecu', group: 'airpath', requiredTags: ['boost.target', 'boost.limit'] },
  { id: 'ecu.ignition', kind: 'ecu', group: 'combustion', requiredTags: ['ignition.base'] },
  { id: 'ecu.lambda', kind: 'ecu', group: 'combustion', requiredTags: ['fuel.lambda_target'] },
  { id: 'ecu.revlimit', kind: 'ecu', group: 'limits', requiredTags: ['rpm.limit'] },
  { id: 'ecu.thermal', kind: 'ecu', group: 'protection', requiredTags: ['protect.thermal'] },
  { id: 'ecu.overrun', kind: 'ecu', group: 'sound', requiredTags: ['overrun.fuel_cut', 'overrun.ignition'] },
  // TCU — gearbox
  { id: 'tcu.shiftPoints', kind: 'tcu', group: 'shifting', requiredTags: ['shift.points'] },
  { id: 'tcu.shiftTime', kind: 'tcu', group: 'shifting', requiredTags: ['shift.time'] },
  { id: 'tcu.torqueIntervention', kind: 'tcu', group: 'shifting', requiredTags: ['shift.torque_reduction'] },
  { id: 'tcu.torqueLimit', kind: 'tcu', group: 'limits', requiredTags: ['tcu.torque_limit'] },
  { id: 'tcu.clutchPressure', kind: 'tcu', group: 'clutch', requiredTags: ['clutch.pressure'] },
  { id: 'tcu.modes', kind: 'tcu', group: 'modes', requiredTags: ['shift.mode'] },
  { id: 'tcu.performance', kind: 'tcu', group: 'performance', requiredTags: ['perf.launch'] },
  { id: 'tcu.protection', kind: 'tcu', group: 'protection', requiredTags: ['protect.temp'] },
];

/** Never offered, regardless of definition contents. */
export const BLOCKED_OPTIONS = ['block.catalyst', 'block.dpf', 'block.egr', 'block.o2', 'block.immobilizer'] as const;

export function buildCatalog(kind: ControllerKind, def?: DefinitionFile): CatalogOption[] {
  const tags = new Set(def?.maps.map((m) => m.tag) ?? []);
  const options: CatalogOption[] = OPTION_SPECS.filter((o) => o.kind === kind).map((o) => {
    const present = o.requiredTags.filter((t) => tags.has(t));
    const missing = o.requiredTags.filter((t) => !tags.has(t));
    let availability: CatalogOption['availability'];
    if (!def) availability = 'unavailable';
    else if (o.requiredTags.length === 0) availability = def.maps.length ? 'available' : 'unavailable';
    else availability = missing.length === 0 ? 'available' : present.length ? 'partial' : 'unavailable';
    return { ...o, availability, presentTags: present, missingTags: missing };
  });
  for (const id of BLOCKED_OPTIONS) {
    options.push({ id, kind, group: 'blocked', requiredTags: [], availability: 'blocked', presentTags: [], missingTags: [] });
  }
  return options;
}
