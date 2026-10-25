/**
 * Controller file formats used by licensed read/write tools when they export unencrypted files:
 *   - raw binary  (.bin, .ori, .mod, .dump …)
 *   - Intel HEX   (.hex, .ihex)
 *   - Motorola S-record (.s19, .s28, .s37, .srec, .mot)
 *
 * Every record checksum is verified on import. The vault stores a raw memory image (what map
 * definitions address) plus the exact source file. Export writes the same format back, covering
 * only the address ranges present in the source file.
 *
 * Encrypted / tool-proprietary containers (e.g. "slave" files) are NOT supported — export an
 * unencrypted file from the master tool instead.
 */
import { WorkshopError } from '../services/errors';

export type FileFormat = 'raw' | 'ihex' | 'srec';

export interface ImageRange { start: number; end: number } // inclusive, absolute addresses

export interface FormatMeta {
  format: FileFormat;
  /** Absolute address of image byte 0. */
  baseAddress: number;
  /** Address ranges that were actually present in the source file. */
  ranges: ImageRange[];
  recordLength?: number;
  /** S-record data record type: 1 = 16-bit, 2 = 24-bit, 3 = 32-bit addresses. */
  srecType?: 1 | 2 | 3;
  srecHeaderHex?: string;
  lineEnding?: '\n' | '\r\n';
}

export interface ParsedFile { image: Uint8Array; meta: FormatMeta }

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

// Portable helpers (no Node Buffer) so the same code runs in the desktop app and in the browser.
const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};
const fromLatin1 = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const FILL = 0xff;

const bad = (m: string): never => {
  throw new WorkshopError('INVALID_INPUT', m);
};

/** Decide the format from content (not only the file name). */
export function detectFormat(_name: string, data: Uint8Array): FileFormat {
  const head = latin1(data.subarray(0, 64)).trimStart();
  const textLike = data.subarray(0, 4096).every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127));
  if (textLike && /^:[0-9A-Fa-f]{10}/.test(head)) return 'ihex';
  if (textLike && /^S[0-9][0-9A-Fa-f]{6}/.test(head)) return 'srec';
  return 'raw';
}

function lines(data: Uint8Array): { list: string[]; eol: '\n' | '\r\n' } {
  const text = latin1(data);
  return { list: text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

const hexBytes = (s: string) => {
  if (s.length % 2 || /[^0-9A-Fa-f]/.test(s)) bad('invalid hex characters');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const sum = (b: Uint8Array) => b.reduce((a, x) => (a + x) & 0xff, 0);

interface Chunk { addr: number; bytes: Uint8Array }

function assemble(chunks: Chunk[], meta: Omit<FormatMeta, 'baseAddress' | 'ranges'>): ParsedFile {
  if (!chunks.length) bad('file contains no data records');
  chunks.sort((a, b) => a.addr - b.addr);
  const base = chunks[0].addr;
  const end = Math.max(...chunks.map((c) => c.addr + c.bytes.length));
  if (end - base > MAX_IMAGE_BYTES) bad('image too large');
  const image = new Uint8Array(end - base).fill(FILL);
  const ranges: ImageRange[] = [];
  for (const c of chunks) {
    image.set(c.bytes, c.addr - base);
    const last = ranges[ranges.length - 1];
    if (last && c.addr <= last.end + 1) last.end = Math.max(last.end, c.addr + c.bytes.length - 1);
    else ranges.push({ start: c.addr, end: c.addr + c.bytes.length - 1 });
  }
  return { image, meta: { ...meta, baseAddress: base, ranges } };
}

export function parseIntelHex(data: Uint8Array): ParsedFile {
  const { list, eol } = lines(data);
  let upper = 0;
  let segment = 0;
  let eof = false;
  const chunks: Chunk[] = [];
  const lens = new Map<number, number>();
  list.forEach((line, i) => {
    if (eof) return;
    if (!line.startsWith(':')) bad(`line ${i + 1}: missing ':'`);
    const rec = hexBytes(line.slice(1));
    if (rec.length < 5 || rec.length !== rec[0] + 5) bad(`line ${i + 1}: bad length`);
    if (sum(rec) !== 0) bad(`line ${i + 1}: checksum mismatch`);
    const len = rec[0], off = (rec[1] << 8) | rec[2], type = rec[3], payload = rec.subarray(4, 4 + len);
    switch (type) {
      case 0x00:
        chunks.push({ addr: upper + segment + off, bytes: payload.slice() });
        lens.set(len, (lens.get(len) ?? 0) + 1);
        break;
      case 0x01: eof = true; break;
      case 0x02: segment = ((payload[0] << 8) | payload[1]) * 16; upper = 0; break;
      case 0x04: upper = ((payload[0] << 8) | payload[1]) * 0x10000; segment = 0; break;
      case 0x03: case 0x05: break; // start address — not part of the image
      default: bad(`line ${i + 1}: unknown record type ${type}`);
    }
  });
  if (!eof) bad('missing end-of-file record');
  const recordLength = [...lens.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 16;
  return assemble(chunks, { format: 'ihex', recordLength, lineEnding: eol });
}

export function parseSrec(data: Uint8Array): ParsedFile {
  const { list, eol } = lines(data);
  const chunks: Chunk[] = [];
  let srecType: 1 | 2 | 3 | undefined;
  let header = '';
  const lens = new Map<number, number>();
  list.forEach((line, i) => {
    if (!/^S[0-9]/.test(line)) bad(`line ${i + 1}: not an S-record`);
    const t = Number(line[1]);
    const rec = hexBytes(line.slice(2));
    if (rec.length < 3 || rec[0] !== rec.length - 1) bad(`line ${i + 1}: bad length`);
    if (((~sum(rec.subarray(0, rec.length - 1))) & 0xff) !== rec[rec.length - 1]) bad(`line ${i + 1}: checksum mismatch`);
    const body = rec.subarray(1, rec.length - 1);
    const addrLen = t === 0 || t === 1 || t === 5 || t === 9 ? 2 : t === 2 || t === 6 || t === 8 ? 3 : 4;
    if (t === 4) bad(`line ${i + 1}: reserved record type S4`);
    const addr = body.subarray(0, addrLen).reduce((a, b) => a * 256 + b, 0);
    const payload = body.subarray(addrLen);
    if (t === 0) header = toHex(payload);
    if (t >= 1 && t <= 3) {
      if (srecType && srecType !== t) bad('mixed S1/S2/S3 data records are not supported');
      srecType = t as 1 | 2 | 3;
      chunks.push({ addr, bytes: payload.slice() });
      lens.set(payload.length, (lens.get(payload.length) ?? 0) + 1);
    }
  });
  const recordLength = [...lens.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 32;
  return assemble(chunks, { format: 'srec', srecType: srecType ?? 3, srecHeaderHex: header, recordLength, lineEnding: eol });
}

export function parseControllerFile(name: string, data: Uint8Array): ParsedFile {
  const format = detectFormat(name, data);
  if (format === 'ihex') return parseIntelHex(data);
  if (format === 'srec') return parseSrec(data);
  if (data.length > MAX_IMAGE_BYTES) bad('image too large');
  return { image: data.slice(), meta: { format: 'raw', baseAddress: 0, ranges: [{ start: 0, end: data.length - 1 }] } };
}

const hx = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, '0');

function writeIntelHex(image: Uint8Array, meta: FormatMeta): Uint8Array {
  const out: string[] = [];
  const rl = meta.recordLength ?? 16;
  let upper = -1;
  const rec = (bytes: number[]) => {
    const b = Uint8Array.from(bytes);
    return ':' + Array.from(b, (x) => hx(x, 2)).join('') + hx((0x100 - sum(b)) & 0xff, 2);
  };
  for (const r of meta.ranges) {
    for (let a = r.start; a <= r.end; ) {
      const hi = Math.floor(a / 0x10000);
      if (hi !== upper) {
        out.push(rec([2, 0, 0, 4, (hi >> 8) & 0xff, hi & 0xff]));
        upper = hi;
      }
      const n = Math.min(rl, r.end - a + 1, 0x10000 - (a & 0xffff));
      const data = image.subarray(a - meta.baseAddress, a - meta.baseAddress + n);
      out.push(rec([n, (a >> 8) & 0xff, a & 0xff, 0, ...data]));
      a += n;
    }
  }
  out.push(':00000001FF');
  const eol = meta.lineEnding ?? '\n';
  return fromLatin1(out.join(eol) + eol);
}

function writeSrec(image: Uint8Array, meta: FormatMeta): Uint8Array {
  const t = meta.srecType ?? 3;
  const addrLenFor = (type: number) => (type === 0 || type === 1 || type === 5 || type === 9 ? 2 : type === 2 || type === 6 || type === 8 ? 3 : 4);
  const rl = meta.recordLength ?? 32;
  const out: string[] = [];
  const rec = (type: number, addr: number, data: Uint8Array) => {
    const a: number[] = [];
    for (let i = addrLenFor(type) - 1; i >= 0; i--) a.push(Math.floor(addr / 256 ** i) & 0xff);
    const body = Uint8Array.from([a.length + data.length + 1, ...a, ...data]);
    return `S${type}` + Array.from(body, (x) => hx(x, 2)).join('') + hx(~sum(body) & 0xff, 2);
  };
  out.push(rec(0, 0, hexBytes(meta.srecHeaderHex ?? '')));
  let count = 0;
  for (const r of meta.ranges) {
    for (let a = r.start; a <= r.end; ) {
      const n = Math.min(rl, r.end - a + 1);
      out.push(rec(t, a, image.subarray(a - meta.baseAddress, a - meta.baseAddress + n)));
      count++;
      a += n;
    }
  }
  if (count <= 0xffff) out.push(rec(5, count, new Uint8Array(0)));
  out.push(rec(10 - t, 0, new Uint8Array(0)));
  const eol = meta.lineEnding ?? '\n';
  return fromLatin1(out.join(eol) + eol);
}

/** Serialise an image back into the format described by `meta` ('raw' writes the image as-is). */
export function writeControllerFile(image: Uint8Array, meta: FormatMeta, as: FileFormat = meta.format): Uint8Array {
  if (as === 'raw') return image;
  if (as === 'ihex') return writeIntelHex(image, meta.format === 'ihex' ? meta : { ...meta, recordLength: 16 });
  return writeSrec(image, meta.format === 'srec' ? meta : { ...meta, srecType: 3, recordLength: 32 });
}

export const FORMAT_EXT: Record<FileFormat, string> = { raw: 'bin', ihex: 'hex', srec: 's19' };
