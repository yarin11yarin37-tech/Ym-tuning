import type { DtcReport, LivePid, LiveReading, Sourced, VehicleIdentity } from '../../shared/types';
import { LIVE_PIDS } from '../../shared/types';

/**
 * Demonstration data source used when no adapter or vehicle is available.
 * Every value it returns is tagged 'simulated' so it can never be mistaken for vehicle data.
 * Values are deterministic functions of time since demo start — no randomness.
 */
const sim = <T,>(value: T, unit?: string): Sourced<T> => ({ value, unit, provenance: 'simulated', source: 'demo' });

export const DEMO_IDENTITY: VehicleIdentity = {
  vin: sim('YMTDEMV0000000001'),
  ecuName: sim('DEMO-ECU'),
  calibrationIds: [sim('DEMO-CAL-0001')],
  protocol: sim('ISO 15765-4 CAN (11/500)'),
  adapterId: sim('YM VCI DEMO'),
  supportedPids: ['04', '05', '0B', '0C', '0D', '0F', '10', '11', '2F', '42'],
};

const UNITS: Record<LivePid, string> = {
  '04': '%', '05': '°C', '0B': 'kPa', '0C': 'rpm', '0D': 'km/h', '0F': '°C', '10': 'g/s', '11': '%', '2F': '%', '42': 'V',
};

export class DemoBackend {
  private readonly t0 = Date.now();

  private valueAt(pid: LivePid, t: number): number {
    const warm = Math.min(1, t / 240); // engine warms up over 4 minutes
    switch (pid) {
      case '0C': return Math.round(780 + 22 * Math.sin(t * 0.9));
      case '0D': return 0;
      case '05': return Math.round(40 + 50 * warm);
      case '0F': return 31;
      case '11': return 14.9;
      case '04': return Math.round(21 + 2 * Math.sin(t * 0.7));
      case '0B': return Math.round(33 + Math.sin(t * 0.9));
      case '10': return Math.round((3.1 + 0.2 * Math.sin(t * 0.9)) * 100) / 100;
      case '2F': return 62.7;
      case '42': return Math.round((14.1 + 0.05 * Math.sin(t * 0.3)) * 100) / 100;
    }
  }

  async identify(): Promise<VehicleIdentity> {
    return DEMO_IDENTITY;
  }

  async readLive(pids: LivePid[]): Promise<LiveReading[]> {
    const t = (Date.now() - this.t0) / 1000;
    return pids
      .filter((p) => (LIVE_PIDS as string[]).includes(p))
      .map((pid) => ({ pid, value: sim(this.valueAt(pid, t), UNITS[pid]) }));
  }

  async readDtcs(): Promise<DtcReport> {
    return { stored: [sim('P0420')], pending: [], permanent: [] };
  }
}
