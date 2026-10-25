import type { WorkshopApi } from './workshop';

/**
 * Types shared between the Electron main process and the renderer.
 * This file must stay free of runtime imports from either side.
 */

/** Where a value came from. Every value shown to the user carries one. */
export type Provenance =
  | 'measured' // 1. measured from a verified source
  | 'vehicle' // 2. read from the vehicle through a supported diagnostic protocol
  | 'user' // 3. supplied by the user
  | 'imported' // 3b. imported from a file (not read from the vehicle)
  | 'estimated' // 4. estimated from a documented model
  | 'simulated'; // 5. simulated for demonstration

export interface Sourced<T = number> {
  value: T;
  unit?: string;
  provenance: Provenance;
  /** Free-text source detail, e.g. "OBD-II mode 01 PID 0C" or a dyno file name. */
  source?: string;
}

export type ObdErrorCode =
  | 'INVALID_SETTINGS'
  | 'UNREACHABLE'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'UNSUPPORTED_PROTOCOL'
  | 'CONNECTION_LOST'
  | 'NOT_CONNECTED'
  | 'BUSY'
  | 'COMMAND_REJECTED'
  | 'NO_DATA'
  | 'INTERNAL'
  // workshop / file / calibration errors
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'NOT_SUPPORTED'
  | 'ORIGINAL_EXISTS'
  | 'NO_ORIGINAL'
  | 'INTEGRITY'
  | 'INCOMPATIBLE'
  | 'OUT_OF_RANGE'
  | 'WRITE_BLOCKED'
  | 'AI_UNAVAILABLE';

export interface ObdErrorInfo {
  code: ObdErrorCode;
  /** Technical detail for logs and the diagnostics panel (not shown as the main message). */
  detail?: string;
}

/** Only TCP is implemented. Other kinds are listed so the UI can explain they are not yet supported. */
export type TransportKind = 'wifi-tcp';

export interface ConnectionProfile {
  id: string;
  name: string;
  kind: TransportKind;
  host: string;
  port: number;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
}

export type ConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'initializing'
  | 'connected'
  | 'lost'
  | 'disconnecting'
  | 'error';

export interface ConnectionStatus {
  phase: ConnectionPhase;
  profileId?: string;
  host?: string;
  port?: number;
  adapterId?: string;
  protocol?: string;
  error?: ObdErrorInfo;
  /** Monotonic counter so the renderer can ignore stale events. */
  seq: number;
}

export interface VehicleIdentity {
  vin: Sourced<string> | null;
  ecuName: Sourced<string> | null;
  protocol: Sourced<string> | null;
  adapterId: Sourced<string> | null;
  supportedPids: string[];
  calibrationIds: Sourced<string>[];
}

export type LivePid = '04' | '05' | '0B' | '0C' | '0D' | '0F' | '10' | '11' | '2F' | '42';

export interface LiveReading {
  pid: LivePid;
  value: Sourced<number> | null;
  /** Set when the ECU did not answer this PID. */
  unavailable?: boolean;
}

export interface DtcReport {
  stored: Sourced<string>[];
  pending: Sourced<string>[];
  permanent: Sourced<string>[];
}

export interface NetworkInterfaceInfo {
  name: string;
  address: string;
  netmask: string;
}

export interface NetworkAdvice {
  interfaces: NetworkInterfaceInfo[];
  /** Interface on the same subnet as the adapter, if any. */
  adapterInterface?: string;
  /** true when the only active IPv4 interface is the adapter network. */
  likelyNoInternet: boolean;
  /** OS default route (read-only), when it could be determined. */
  defaultRoute?: { iface?: string; gateway?: string; known: boolean };
  /** true when the OS default route points at the adapter's network. */
  internetViaAdapter: boolean;
}

export interface ProbeResult {
  host: string;
  port: number;
  ok: boolean;
  adapterId?: string;
  error?: ObdErrorCode;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ObdErrorInfo };

/** OBD adapter surface of the bridge. */
export interface ObdApi {
  listProfiles(): Promise<Result<ConnectionProfile[]>>;
  saveProfile(p: ConnectionProfile): Promise<Result<ConnectionProfile>>;
  deleteProfile(id: string): Promise<Result<true>>;
  connect(profileId: string): Promise<Result<ConnectionStatus>>;
  cancelConnect(): Promise<Result<true>>;
  disconnect(): Promise<Result<true>>;
  reconnect(): Promise<Result<ConnectionStatus>>;
  getStatus(): Promise<Result<ConnectionStatus>>;
  identifyVehicle(): Promise<Result<VehicleIdentity>>;
  readLive(pids: LivePid[]): Promise<Result<LiveReading[]>>;
  readDtcs(): Promise<Result<DtcReport>>;
  networkAdvice(host: string): Promise<Result<NetworkAdvice>>;
  probeCandidates(candidates: { host: string; port: number }[]): Promise<Result<ProbeResult[]>>;
  onStatus(cb: (s: ConnectionStatus) => void): () => void;
}

/** The complete surface the preload script exposes. Nothing else crosses the bridge. */
export interface YmApi extends ObdApi, WorkshopApi {
  /** 'web' when running as the in-browser demo (no vehicle, adapter or file-system access). */
  runtime?: 'desktop' | 'web';
}

/** Method names on ObdApi — used by tests to prove no control/write surface exists. */
export const YM_API_METHODS = [
  'listProfiles',
  'saveProfile',
  'deleteProfile',
  'connect',
  'cancelConnect',
  'disconnect',
  'reconnect',
  'getStatus',
  'identifyVehicle',
  'readLive',
  'readDtcs',
  'networkAdvice',
  'probeCandidates',
  'onStatus',
] as const;

export const LIVE_PIDS: LivePid[] = ['0C', '0D', '05', '0F', '11', '04', '0B', '10', '2F', '42'];
