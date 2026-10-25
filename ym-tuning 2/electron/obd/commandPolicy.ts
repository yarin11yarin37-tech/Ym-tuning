/**
 * Command policy — the single gate every byte sent to an adapter passes through.
 *
 * Default policy is READ-ONLY. Only adapter setup commands and OBD-II read services are
 * allowed. Anything that could change vehicle or ECU state is rejected here, regardless of
 * what any higher layer asks for:
 *   - Mode 04 (clear DTCs / reset emission monitors)
 *   - Mode 08 (on-board system control / actuator tests)
 *   - UDS / KWP services (0x10 session, 0x11 reset, 0x27 security, 0x2E write, 0x2F IO control,
 *     0x31 routine control, 0x34/0x36/0x37 download/transfer — i.e. ECU programming)
 *   - Adapter commands that write to the bus as raw frames or change adapter EEPROM.
 *
 * ECU programming is out of scope for Wi-Fi ELM327-class adapters and is not implemented.
 */

const AT_ALLOWED = new Set([
  'ATZ', // reset adapter
  'ATWS', // warm start
  'ATE0', // echo off
  'ATL0', // linefeeds off
  'ATS0', // spaces off
  'ATS1',
  'ATH0', // headers off
  'ATH1',
  'ATSP0', // automatic protocol
  'ATAT1', // adaptive timing
  'ATI', // adapter id
  'AT@1', // device description
  'ATDP', // describe protocol
  'ATDPN', // protocol number
  'ATRV', // battery voltage at the adapter
]);

/** OBD-II read services: mode 01 (live), 03 (stored DTC), 07 (pending), 09 (vehicle info), 0A (permanent). */
const OBD_READ = /^(01[0-9A-F]{2}|03|07|0A|09(00|02|04|0A))$/;

export type PolicyDecision = { allowed: true } | { allowed: false; reason: string };

export function normaliseCommand(cmd: string): string {
  return String(cmd).toUpperCase().replace(/\s+/g, '');
}

export function checkCommand(cmd: string): PolicyDecision {
  const c = normaliseCommand(cmd);
  if (c.length === 0 || c.length > 12) return { allowed: false, reason: 'empty or oversized command' };
  if (/[^0-9A-Z@]/.test(c)) return { allowed: false, reason: 'illegal characters' };
  if (c.startsWith('AT')) {
    return AT_ALLOWED.has(c) ? { allowed: true } : { allowed: false, reason: `AT command not allowed: ${c}` };
  }
  if (OBD_READ.test(c)) return { allowed: true };
  return { allowed: false, reason: `not a read-only diagnostic request: ${c}` };
}
