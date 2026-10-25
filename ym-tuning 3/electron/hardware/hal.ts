/**
 * Hardware Abstraction Layer.
 *
 * The UI only ever sees `HardwareDevice` records with explicit capability states. A capability
 * is 'tested' only after it has been verified against real hardware; everything implemented
 * but not yet field-tested is 'untested'; everything else is 'not-supported'.
 *
 * Planned transports (roadmap, NOT implemented): native CAN, CAN-FD, ISO-TP over YM VCI,
 * K-Line, DoIP and manufacturer protocols. Each will be added only with a device, its
 * documentation and an implementation that has been tested.
 */
import type { DeviceCapabilities, HardwareDevice } from '../../shared/workshop';

export const NONE: DeviceCapabilities = {
  basicObd: 'not-supported', oemDiagnostics: 'not-supported', ecuRead: 'not-supported', ecuWrite: 'not-supported',
  tcuRead: 'not-supported', tcuWrite: 'not-supported', can: 'not-supported', canFd: 'not-supported',
  isoTp: 'not-supported', kLine: 'not-supported', doip: 'not-supported',
};

/** ELM327-compatible Wi-Fi adapters: basic OBD-II only. Verified against the emulator, not real hardware. */
export const ELM327_WIFI_CAPABILITIES: DeviceCapabilities = {
  ...NONE,
  basicObd: 'untested',
  // The adapter handles CAN/ISO-TP/K-Line internally for OBD-II requests; the app has no raw access.
  can: 'unknown',
  isoTp: 'unknown',
  kLine: 'unknown',
};

export function wifiDevice(host: string, port: number, adapterId: string): HardwareDevice {
  return {
    id: `wifi:${host}:${port}`,
    transport: 'wifi-tcp',
    name: adapterId,
    path: `${host}:${port}`,
    identified: true,
    capabilities: ELM327_WIFI_CAPABILITIES,
  };
}

/** Planned protocol roadmap shown in the YM VCI screen. Status values are honest by design. */
export const PROTOCOL_ROADMAP = [
  { id: 'wifiObd', status: 'implemented-untested' },
  { id: 'usbSerial', status: 'enumeration-only' },
  { id: 'can', status: 'planned' },
  { id: 'canFd', status: 'planned' },
  { id: 'isoTp', status: 'planned' },
  { id: 'kLine', status: 'planned' },
  { id: 'doip', status: 'planned' },
  { id: 'oem', status: 'planned' },
] as const;
