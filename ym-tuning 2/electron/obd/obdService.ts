import { EventEmitter } from 'node:events';
import type {
  ConnectionProfile,
  ConnectionStatus,
  DtcReport,
  LivePid,
  LiveReading,
  Sourced,
  VehicleIdentity,
} from '../../shared/types';
import { LIVE_PIDS } from '../../shared/types';
import { ObdError, toErrorInfo } from './errors';
import { Elm327Session } from './elm327';
import { TcpTransport, type Transport } from './transport';
import {
  PID_DEFS,
  decodeDtcs,
  decodeMode09Ascii,
  decodePid,
  decodeSupportedPids,
  isNoData,
  isPlausibleVin,
  textResponse,
} from './decode';
import { validateProfile } from './validation';

export type TransportFactory = (p: ConnectionProfile) => Transport;

const defaultFactory: TransportFactory = (p) =>
  new TcpTransport({ host: p.host, port: p.port, connectTimeoutMs: p.connectTimeoutMs });

/** ELM327 identity strings from genuine chips and common compatible firmwares. */
const ELM_LIKE = /(ELM ?327|OBDLINK|STN\d{4}|VLINKER|OBDII)/i;

function vehicleValue<T>(value: T, source: string, unit?: string): Sourced<T> {
  return { value, unit, provenance: 'vehicle', source };
}

/**
 * Owns the single adapter connection. Emits 'status' (ConnectionStatus) on every change.
 * Never throws to callers for network conditions — every failure becomes a status/error code.
 */
export class ObdService extends EventEmitter {
  private transport: Transport | null = null;
  private session: Elm327Session | null = null;
  private abort: AbortController | null = null;
  private lastProfile: ConnectionProfile | null = null;
  private supported: Set<string> | null = null;
  private status: ConnectionStatus = { phase: 'idle', seq: 0 };
  /** VIN returned by the vehicle in the current session (used to verify 'vehicle' provenance claims). */
  lastVin: string | null = null;

  constructor(private readonly factory: TransportFactory = defaultFactory) {
    super();
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  private setStatus(patch: Omit<Partial<ConnectionStatus>, 'seq'>, replace = false) {
    const base = replace ? { phase: 'idle' as const } : this.status;
    this.status = { ...base, ...patch, seq: this.status.seq + 1 } as ConnectionStatus;
    this.emit('status', this.status);
  }

  async connect(input: ConnectionProfile): Promise<ConnectionStatus> {
    const v = validateProfile(input);
    if (!v.ok) {
      this.setStatus({ phase: 'error', error: v.error }, true);
      return this.status;
    }
    if (this.status.phase === 'connecting' || this.status.phase === 'initializing') {
      throw new ObdError('BUSY', 'a connection attempt is already running');
    }
    await this.teardown();

    const profile = v.data;
    this.lastProfile = profile;
    this.supported = null;
    const abort = new AbortController();
    this.abort = abort;
    const base = { profileId: profile.id, host: profile.host, port: profile.port };
    this.setStatus({ phase: 'connecting', ...base }, true);

    const transport = this.factory(profile);
    this.transport = transport;
    try {
      await transport.connect(abort.signal);
      if (abort.signal.aborted) throw new ObdError('CANCELLED');
      this.setStatus({ phase: 'initializing', ...base });

      const session = new Elm327Session(transport, profile.commandTimeoutMs);
      this.session = session;
      transport.on('close', (unexpected: boolean) => {
        if (unexpected && this.transport === transport) {
          this.session = null;
          this.transport = null;
          this.setStatus({ phase: 'lost', ...base, error: { code: 'CONNECTION_LOST' } });
        }
      });

      const step = async (cmd: string, timeout?: number) => {
        if (abort.signal.aborted) throw new ObdError('CANCELLED');
        return session.send(cmd, timeout);
      };

      await step('ATZ', Math.max(profile.commandTimeoutMs, 3000));
      for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1']) await step(c);
      const ati = textResponse(await step('ATI'));
      if (!ELM_LIKE.test(ati)) {
        throw new ObdError('UNSUPPORTED_PROTOCOL', `adapter did not identify as ELM327-compatible: "${ati.slice(0, 40)}"`);
      }
      await step('ATSP0');
      // First request triggers protocol search; vehicle may be off — that is not a transport failure.
      const probe = await step('0100', Math.max(profile.commandTimeoutMs, 8000));
      let protocol: string | undefined;
      if (!isNoData(probe)) {
        this.supported = new Set(decodeSupportedPids(probe, 0x00));
        protocol = textResponse(await step('ATDP')).replace(/^AUTO,\s*/i, '') || undefined;
      }
      this.setStatus({ phase: 'connected', ...base, adapterId: ati, protocol, error: undefined });
      return this.status;
    } catch (e) {
      const info = toErrorInfo(e);
      await this.teardown();
      this.setStatus({ phase: 'error', ...base, error: info }, true);
      return this.status;
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  cancelConnect(): void {
    this.abort?.abort();
  }

  async reconnect(): Promise<ConnectionStatus> {
    if (!this.lastProfile) {
      this.setStatus({ phase: 'error', error: { code: 'NOT_CONNECTED', detail: 'no previous profile' } }, true);
      return this.status;
    }
    return this.connect(this.lastProfile);
  }

  async disconnect(): Promise<void> {
    this.abort?.abort();
    if (this.transport) this.setStatus({ phase: 'disconnecting' });
    await this.teardown();
    this.setStatus({ phase: 'idle' }, true);
  }

  private async teardown() {
    this.lastVin = null;
    const t = this.transport;
    this.transport = null;
    this.session = null;
    if (t) {
      try {
        await t.close();
      } catch {
        /* closing a dead socket is fine */
      }
    }
  }

  private requireSession(): Elm327Session {
    if (!this.session || this.status.phase !== 'connected') throw new ObdError('NOT_CONNECTED');
    return this.session;
  }

  async identifyVehicle(): Promise<VehicleIdentity> {
    const s = this.requireSession();
    const vinRaw = decodeMode09Ascii(await s.send('0902'), '02');
    const ecuRaw = decodeMode09Ascii(await s.send('090A'), '0A');
    const calRaw = decodeMode09Ascii(await s.send('0904'), '04');

    const supported = new Set(this.supported ?? []);
    for (const base of [0x20, 0x40]) {
      if (!supported.has(base.toString(16).toUpperCase().padStart(2, '0'))) break;
      decodeSupportedPids(await s.send(`01${base.toString(16).toUpperCase()}`), base).forEach((p) => supported.add(p));
    }
    this.supported = supported;

    this.lastVin = isPlausibleVin(vinRaw) ? vinRaw : null;
    return {
      vin: isPlausibleVin(vinRaw) ? vehicleValue(vinRaw, 'OBD-II 09 02') : null,
      ecuName: ecuRaw ? vehicleValue(ecuRaw, 'OBD-II 09 0A') : null,
      calibrationIds: calRaw ? [vehicleValue(calRaw, 'OBD-II 09 04')] : [],
      protocol: this.status.protocol ? vehicleValue(this.status.protocol, 'ATDP') : null,
      adapterId: this.status.adapterId ? vehicleValue(this.status.adapterId, 'ATI') : null,
      supportedPids: Array.from(supported).sort(),
    };
  }

  async readLive(pids: LivePid[]): Promise<LiveReading[]> {
    const s = this.requireSession();
    const wanted = pids.filter((p) => (LIVE_PIDS as string[]).includes(p));
    const out: LiveReading[] = [];
    for (const pid of wanted) {
      if (this.supported && !this.supported.has(pid)) {
        out.push({ pid, value: null, unavailable: true });
        continue;
      }
      const v = decodePid(pid, await s.send(`01${pid}`));
      out.push(
        v === null
          ? { pid, value: null, unavailable: true }
          : { pid, value: vehicleValue(v, `OBD-II 01 ${pid}`, PID_DEFS[pid].unit) },
      );
    }
    return out;
  }

  async readDtcs(): Promise<DtcReport> {
    const s = this.requireSession();
    const tag = (codes: string[], src: string) => codes.map((c) => vehicleValue(c, src));
    return {
      stored: tag(decodeDtcs(await s.send('03'), 0x43), 'OBD-II 03'),
      pending: tag(decodeDtcs(await s.send('07'), 0x47), 'OBD-II 07'),
      permanent: tag(decodeDtcs(await s.send('0A'), 0x4a), 'OBD-II 0A'),
    };
  }
}
