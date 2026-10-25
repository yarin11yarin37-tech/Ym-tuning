/**
 * Workshop domain types: customers, vehicles, controllers, files, calibration, assistant,
 * hardware. Shared by main process and renderer. No runtime imports.
 */

export type ControllerKind = 'ecu' | 'tcu';
/** Where an identity value came from. */
export type IdProvenance = 'vehicle' | 'user' | 'imported' | 'simulated';
/** Where a file came from. 'read' = read from a controller with verified hardware — not possible yet. */
export type FileSource = 'read' | 'imported' | 'simulated';

export interface Customer { id: string; name: string; phone?: string; email?: string; notes?: string; createdAt: string }

export interface Vehicle {
  id: string; customerId?: string;
  vin?: string; vinProvenance?: IdProvenance;
  make?: string; model?: string; year?: number; engine?: string; gearbox?: string; plate?: string; notes?: string;
  createdAt: string;
}

export interface Controller {
  id: string; vehicleId: string; kind: ControllerKind; label?: string;
  hwId?: string; swId?: string; calId?: string; idProvenance: IdProvenance; createdAt: string;
}

export interface OriginalFile {
  id: string; controllerId: string; kind: ControllerKind; sha256: string; size: number; fileName: string;
  source: FileSource; createdAt: string; verifiedAt?: string; meta: Record<string, unknown>;
}

export interface Project {
  id: string; controllerId: string; kind: ControllerKind; name: string; originalId: string; notes?: string; createdAt: string;
}

export type CheckStatus = 'pass' | 'fail' | 'unavailable' | 'warn';
export interface CheckResult { id: string; status: CheckStatus; detail?: Record<string, string | number> }

export interface Version {
  id: string; projectId: string; parentId?: string; seq: number; sha256: string; label: string; note?: string;
  origin: 'working-copy' | 'manual-edit' | 'plan-applied'; checks: CheckResult[]; createdAt: string;
}

export interface IntegrityReport { originalId: string; sha256: string; ok: boolean; actual?: string; checkedAt: string }

/* ---------- Map definitions (YM definition format, ym-def/1) ---------- */

export type DataType = 'u8' | 'u16le' | 'u16be' | 's16le' | 's16be';

export interface AxisDef { name: string; unit: string; values: number[] }

export interface MapDef {
  id: string;
  name: string;
  /** Catalog tag, e.g. 'boost.target', 'shift.points', 'overrun.ignition'. */
  tag: string;
  address: number;
  rows: number;
  cols: number;
  dataType: DataType;
  scale: number;
  offset: number;
  unit: string;
  min?: number;
  max?: number;
  xAxis?: AxisDef;
  yAxis?: AxisDef;
  notes?: string;
}

export interface ConditionDef {
  id: string;
  /** e.g. 'cond.drive_mode', 'cond.ac', 'cond.coolant_temp', 'cond.vehicle_speed' */
  tag: string;
  name: string;
  /** For enumerated signals such as drive mode: the values the strategy can distinguish. */
  values?: string[];
}

export interface DefinitionFile {
  format: 'ym-def/1';
  name: string;
  controller: { kind: ControllerKind; hwIds?: string[]; swIds?: string[] };
  fileSize: number;
  maps: MapDef[];
  conditions?: ConditionDef[];
  /** Free text from the author about provenance of the definition. */
  source?: string;
}

export interface Definition {
  id: string; controllerId: string; kind: ControllerKind; name: string; sha256: string;
  source: 'imported' | 'simulated'; file: DefinitionFile; createdAt: string;
}

export interface MapData {
  map: MapDef;
  /** values[row][col] in physical units */
  values: number[][];
  outOfRange: number;
}

export interface CompatibilityReport {
  ok: boolean;
  checks: CheckResult[];
}

/* ---------- Diff ---------- */

export interface ByteRange { start: number; end: number }
export interface MapChange { mapId: string; name: string; unit: string; cells: { r: number; c: number; from: number; to: number }[] }
export interface DiffReport {
  aSha: string; bSha: string; sizeA: number; sizeB: number;
  changedBytes: number; ranges: ByteRange[];
  mapChanges: MapChange[];
  /** Ranges not covered by any defined map — unexplained changes. */
  unexplained: ByteRange[];
}

/* ---------- Catalog ---------- */

export type OptionAvailability = 'available' | 'partial' | 'unavailable' | 'blocked';
export interface CatalogOption {
  id: string;
  kind: ControllerKind;
  group: string;
  requiredTags: string[];
  availability: OptionAvailability;
  presentTags: string[];
  missingTags: string[];
}

/* ---------- Requests, plans, assistant ---------- */

export type RequestStatus = 'request' | 'plan' | 'approved' | 'applied' | 'verified' | 'written' | 'rejected';

export interface ExhaustSpec {
  intensity?: 'mild' | 'medium' | 'strong';
  onlyModes?: string[];
  disableModes?: string[];
  disableWithAc?: boolean;
  requireWarmEngine?: boolean;
  rpmMin?: number;
  rpmMax?: number;
}

export interface ParsedRequest {
  intent: 'stage' | 'exhaust' | 'tcu-shift' | 'compare' | 'map-edit' | 'explain' | 'unknown';
  kind: ControllerKind;
  stage?: 1 | 2 | 3;
  keepProtections?: boolean;
  respectTorqueLimits?: boolean;
  exhaust?: ExhaustSpec;
  edits?: { mapQuery: string; op: 'scale' | 'offset' | 'set'; value: number }[];
  blockedReasons: string[];
  missing: string[];
}

export interface PlanItem {
  id: string;
  tag: string;
  mapId?: string;
  mapName?: string;
  /** i18n key describing the item */
  descKey: string;
  operation?: { type: 'scale' | 'offset' | 'set'; value: number };
  status: 'ready' | 'needs-input' | 'unsupported';
  definitionSource?: 'imported' | 'simulated';
}

export interface ConditionSupport { key: string; supported: boolean; via?: string }

export interface Plan {
  kind: ControllerKind;
  intent: ParsedRequest['intent'];
  items: PlanItem[];
  conditions: ConditionSupport[];
  risks: string[];
  unresolved: string[];
  blocked: string[];
}

export interface CalibrationRequest {
  id: string; projectId?: string; kind: ControllerKind; text: string; parsed: ParsedRequest; plan?: Plan;
  status: RequestStatus; resultVersionId?: string; engine: 'local' | 'ai'; createdAt: string; updatedAt: string;
}

export interface AssistantStatus {
  aiConfigured: boolean;
  model?: string;
  engine: 'local' | 'ai';
}

export interface AssistantReply {
  request: CalibrationRequest;
  /** i18n-keyed message lines with params, rendered by the UI. */
  lines: { key: string; params?: Record<string, string | number> }[];
  aiText?: string;
  aiError?: string;
}

/* ---------- Review & write gate ---------- */

export interface ReviewPacket {
  controller: Controller;
  original: OriginalFile;
  originalIntegrity: IntegrityReport;
  version: Version;
  diff: DiffReport;
  definitionSource?: 'imported' | 'simulated';
  plan?: Plan;
  checks: CheckResult[];
  warnings: string[];
  restoreAvailable: boolean;
}

export interface WriteRequirement { id: string; met: boolean }
export interface WriteGateResult { allowed: false; requirements: WriteRequirement[] }

/* ---------- Diagnostics sessions ---------- */

export interface DiagSession { id: string; vehicleId?: string; mode: 'live' | 'demo'; title: string; data: unknown; createdAt: string }

/* ---------- Hardware abstraction ---------- */

export type CapabilityState = 'tested' | 'untested' | 'not-supported' | 'unknown';
export interface DeviceCapabilities {
  basicObd: CapabilityState;
  oemDiagnostics: CapabilityState;
  ecuRead: CapabilityState;
  ecuWrite: CapabilityState;
  tcuRead: CapabilityState;
  tcuWrite: CapabilityState;
  can: CapabilityState;
  canFd: CapabilityState;
  isoTp: CapabilityState;
  kLine: CapabilityState;
  doip: CapabilityState;
}

export interface HardwareDevice {
  id: string;
  transport: 'wifi-tcp' | 'usb-serial' | 'ym-vci';
  name: string;
  path?: string;
  /** true only when the device identified itself with a supported protocol */
  identified: boolean;
  capabilities: DeviceCapabilities;
}

export interface UsbScan { supported: boolean; devices: HardwareDevice[]; reasonKey?: string }

/* ---------- Network ---------- */

export interface DefaultRoute { iface?: string; gateway?: string; known: boolean }
export interface InternetCheck { online: boolean; latencyMs?: number; checkedAt: string; via?: string }

/* ---------- Audit ---------- */

export interface AuditEntry { id: number; ts: string; action: string; entity?: string; entityId?: string; outcome: 'ok' | 'blocked' | 'error' | 'info'; detail: Record<string, unknown> }

/* ---------- Renderer bridge for workshop features ---------- */
import type { Result } from './types';

export interface WorkshopApi {
  wsInfo(): Promise<Result<{ schemaVersion: number }>>;
  listCustomers(): Promise<Result<Customer[]>>;
  saveCustomer(c: Partial<Customer> & { name: string }): Promise<Result<Customer>>;
  listVehicles(): Promise<Result<Vehicle[]>>;
  saveVehicle(v: Partial<Vehicle>): Promise<Result<Vehicle>>;
  listControllers(kind?: ControllerKind): Promise<Result<Controller[]>>;
  addController(c: { vehicleId: string; kind: ControllerKind; label?: string; hwId?: string; swId?: string; calId?: string }): Promise<Result<Controller>>;
  listOriginals(): Promise<Result<OriginalFile[]>>;
  importOriginal(controllerId: string): Promise<Result<OriginalFile>>;
  verifyOriginal(originalId: string): Promise<Result<IntegrityReport>>;
  exportOriginal(originalId: string): Promise<Result<true>>;
  exportVersion(projectId: string, versionId: string): Promise<Result<true>>;
  listProjects(kind?: ControllerKind): Promise<Result<Project[]>>;
  createProject(controllerId: string, name: string): Promise<Result<{ project: Project; version: Version }>>;
  listVersions(projectId: string): Promise<Result<Version[]>>;
  importDefinition(controllerId: string): Promise<Result<Definition>>;
  getDefinition(controllerId: string): Promise<Result<Definition | null>>;
  readMaps(projectId: string, versionId: string): Promise<Result<{ definition?: Definition; maps: MapData[] }>>;
  editMap(projectId: string, versionId: string, mapId: string, edits: { r: number; c: number; value: number }[], note: string): Promise<Result<Version>>;
  runChecks(projectId: string, versionId: string): Promise<Result<CheckResult[]>>;
  diff(projectId: string, a: string | 'original', b: string): Promise<Result<DiffReport>>;
  catalog(controllerId: string): Promise<Result<{ options: CatalogOption[]; definition?: Definition }>>;
  compatibility(controllerId: string): Promise<Result<CompatibilityReport | null>>;
  review(projectId: string, versionId: string, requestId?: string): Promise<Result<ReviewPacket>>;
  readinessCheck(projectId: string, versionId: string, approved: boolean): Promise<Result<WriteGateResult>>;
  listRequests(projectId?: string): Promise<Result<CalibrationRequest[]>>;
  approveRequest(id: string): Promise<Result<CalibrationRequest>>;
  applyRequest(id: string): Promise<Result<{ request: CalibrationRequest; version: Version }>>;
  assistantStatus(): Promise<Result<AssistantStatus>>;
  assistantAsk(input: { text: string; kind: ControllerKind; projectId?: string }): Promise<Result<AssistantReply>>;
  assistantConfigure(apiKey: string | null, model?: string): Promise<Result<AssistantStatus>>;
  createDemoWorkspace(): Promise<Result<{ vehicleId: string; ecu: { controllerId: string; projectId: string }; tcu: { controllerId: string; projectId: string } }>>;
  listSessions(): Promise<Result<DiagSession[]>>;
  saveSession(s: { vehicleId?: string; mode: 'live' | 'demo'; title: string; data: unknown }): Promise<Result<DiagSession>>;
  exportReport(sessionId: string): Promise<Result<true>>;
  auditList(limit?: number): Promise<Result<AuditEntry[]>>;
  usbScan(): Promise<Result<UsbScan>>;
  protocolRoadmap(): Promise<Result<readonly { id: string; status: string }[]>>;
  defaultRoute(): Promise<Result<DefaultRoute>>;
  internetCheck(): Promise<Result<InternetCheck>>;
}

/** channel for each WorkshopApi method — the preload maps 1:1 using this table. */
export const WORKSHOP_METHOD_CHANNELS: Record<keyof WorkshopApi, string> = {
  wsInfo: 'ws:info',
  listCustomers: 'customers:list', saveCustomer: 'customers:save',
  listVehicles: 'vehicles:list', saveVehicle: 'vehicles:save',
  listControllers: 'controllers:list', addController: 'controllers:add',
  listOriginals: 'vault:originals', importOriginal: 'vault:importOriginal', verifyOriginal: 'vault:verify',
  exportOriginal: 'vault:exportOriginal', exportVersion: 'vault:exportVersion',
  listProjects: 'projects:list', createProject: 'projects:create', listVersions: 'projects:versions',
  importDefinition: 'defs:import', getDefinition: 'defs:get',
  readMaps: 'cal:maps', editMap: 'cal:edit', runChecks: 'cal:checks', diff: 'cal:diff', catalog: 'cal:catalog',
  compatibility: 'cal:compat', review: 'cal:review', readinessCheck: 'cal:readiness',
  listRequests: 'req:list', approveRequest: 'req:approve', applyRequest: 'req:apply',
  assistantStatus: 'asst:status', assistantAsk: 'asst:ask', assistantConfigure: 'asst:configure',
  createDemoWorkspace: 'demo:workspace',
  listSessions: 'sessions:list', saveSession: 'sessions:save', exportReport: 'sessions:exportReport',
  auditList: 'audit:list', usbScan: 'hw:usb', protocolRoadmap: 'hw:roadmap',
  defaultRoute: 'net:route', internetCheck: 'net:internet',
};
