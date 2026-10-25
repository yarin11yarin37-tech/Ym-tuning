/**
 * Decoders for ELM327-style ASCII responses (headers off). Each function is pure and is
 * covered by unit tests with captured response formats from CAN and legacy protocols.
 */
import type { LivePid } from '../../shared/types';

export const NO_DATA_MARKERS = ['NO DATA', 'NODATA', 'UNABLE TO CONNECT', 'UNABLETOCONNECT', 'STOPPED', 'CAN ERROR', 'CANERROR', 'BUS INIT', 'BUSINIT', 'ERROR', '?'];

export function isNoData(raw: string): boolean {
  const u = raw.toUpperCase();
  return NO_DATA_MARKERS.some((m) => (m === '?' ? u.trim() === '?' : u.includes(m)));
}

/** Clean an adapter response into lines of bare hex, dropping prompts, echoes and status text. */
export function responseLines(raw: string): string[] {
  return raw
    .replace(/>/g, '')
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.toUpperCase() !== 'SEARCHING...' && !l.toUpperCase().startsWith('BUS INIT'))
    .map((l) => l.replace(/\s+/g, '').toUpperCase());
}

/** Text responses (ATI, ATDP): keep inner spaces, drop prompt/echo noise. */
export function textResponse(raw: string): string {
  return raw
    .replace(/>/g, '')
    .split(/[\r\n]+/)
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter((l) => l.length > 0 && !/^(SEARCHING|OK$)/i.test(l) && !/^AT[A-Z0-9@]+$/i.test(l)) // drop echoed commands
    .join(' ');
}

/**
 * Join a possibly multi-frame response into one hex string.
 * Handles CAN ISO-TP output ("014" length line followed by "0:..." "1:..." frames) and
 * single-line responses. Legacy multi-line responses are returned per line by `responseLines`.
 */
export function joinFrames(lines: string[]): string {
  const framed = lines.filter((l) => /^[0-9A-F]:/.test(l));
  if (framed.length > 0) return framed.map((l) => l.slice(2)).join('');
  return lines.filter((l) => /^[0-9A-F]+$/.test(l)).join('');
}

export function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/** Find the data bytes that follow `41 <pid>` in a mode 01 response. */
export function mode01Bytes(raw: string, pid: string): number[] | null {
  if (isNoData(raw)) return null;
  const lines = responseLines(raw);
  const marker = `41${pid.toUpperCase()}`;
  for (const line of lines) {
    const idx = line.indexOf(marker);
    if (idx >= 0) return hexToBytes(line.slice(idx + marker.length));
  }
  return null;
}

export interface PidDef {
  pid: LivePid;
  unit: string;
  bytes: number;
  decode: (b: number[]) => number;
}

export const PID_DEFS: Record<LivePid, PidDef> = {
  '04': { pid: '04', unit: '%', bytes: 1, decode: ([a]) => (a * 100) / 255 },
  '05': { pid: '05', unit: '°C', bytes: 1, decode: ([a]) => a - 40 },
  '0B': { pid: '0B', unit: 'kPa', bytes: 1, decode: ([a]) => a },
  '0C': { pid: '0C', unit: 'rpm', bytes: 2, decode: ([a, b]) => (a * 256 + b) / 4 },
  '0D': { pid: '0D', unit: 'km/h', bytes: 1, decode: ([a]) => a },
  '0F': { pid: '0F', unit: '°C', bytes: 1, decode: ([a]) => a - 40 },
  '10': { pid: '10', unit: 'g/s', bytes: 2, decode: ([a, b]) => (a * 256 + b) / 100 },
  '11': { pid: '11', unit: '%', bytes: 1, decode: ([a]) => (a * 100) / 255 },
  '2F': { pid: '2F', unit: '%', bytes: 1, decode: ([a]) => (a * 100) / 255 },
  '42': { pid: '42', unit: 'V', bytes: 2, decode: ([a, b]) => (a * 256 + b) / 1000 },
};

export function decodePid(pid: LivePid, raw: string): number | null {
  const def = PID_DEFS[pid];
  const bytes = mode01Bytes(raw, pid);
  if (!bytes || bytes.length < def.bytes) return null;
  return Math.round(def.decode(bytes) * 100) / 100;
}

/** Decode a "supported PIDs" bitmap response (0100 / 0120 / 0140 ...). */
export function decodeSupportedPids(raw: string, basePid: number): string[] {
  const bytes = mode01Bytes(raw, basePid.toString(16).padStart(2, '0'));
  if (!bytes || bytes.length < 4) return [];
  const out: string[] = [];
  for (let i = 0; i < 32; i++) {
    const byte = bytes[Math.floor(i / 8)];
    if (byte & (0x80 >> i % 8)) out.push((basePid + i + 1).toString(16).toUpperCase().padStart(2, '0'));
  }
  return out;
}

const DTC_PREFIX = ['P', 'C', 'B', 'U'];

export function dtcFromBytes(a: number, b: number): string {
  const letter = DTC_PREFIX[a >> 6];
  const d1 = (a >> 4) & 0x3;
  const rest = ((a & 0x0f) << 8) | b;
  return `${letter}${d1}${rest.toString(16).toUpperCase().padStart(3, '0')}`;
}

/** Decode mode 03 / 07 / 0A responses. responseByte is 0x43, 0x47 or 0x4A. */
export function decodeDtcs(raw: string, responseByte: number): string[] {
  if (isNoData(raw)) return [];
  const lines = responseLines(raw);
  const marker = responseByte.toString(16).toUpperCase();
  const framed = lines.some((l) => /^[0-9A-F]:/.test(l));
  const segments = framed ? [joinFrames(lines)] : lines;
  const codes: string[] = [];
  for (const seg of segments) {
    const idx = seg.indexOf(marker);
    if (idx < 0) continue;
    let bytes = hexToBytes(seg.slice(idx + 2));
    if (framed) {
      // Multi-frame CAN: first byte is the DTC count; frames may carry padding after it.
      const count = bytes[0] ?? 0;
      bytes = bytes.slice(1, 1 + count * 2);
    } else if (bytes.length % 2 === 1) {
      // Single-frame CAN responses also carry a count byte, which makes the length odd.
      bytes = bytes.slice(1);
    }
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) continue;
      codes.push(dtcFromBytes(bytes[i], bytes[i + 1]));
    }
  }
  return Array.from(new Set(codes));
}

/** Decode an ASCII mode 09 response (VIN = 0902, calibration ID = 0904, ECU name = 090A). */
export function decodeMode09Ascii(raw: string, infoType: string): string | null {
  if (isNoData(raw)) return null;
  const lines = responseLines(raw);
  const marker = `49${infoType.toUpperCase()}`;
  let hex = '';
  if (lines.some((l) => /^[0-9A-F]:/.test(l))) {
    const joined = joinFrames(lines);
    const idx = joined.indexOf(marker);
    if (idx < 0) return null;
    hex = joined.slice(idx + 4 + 2); // skip marker and the item-count byte
  } else {
    // Legacy protocols: one line per message, each "49 02 <seq> <4 data bytes>".
    for (const l of lines) {
      const idx = l.indexOf(marker);
      if (idx >= 0) hex += l.slice(idx + 4 + 2);
    }
  }
  const text = hexToBytes(hex)
    .filter((b) => b >= 0x20 && b < 0x7f)
    .map((b) => String.fromCharCode(b))
    .join('')
    .trim();
  return text.length > 0 ? text : null;
}

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
export function isPlausibleVin(v: string | null): v is string {
  return !!v && VIN_RE.test(v);
}
