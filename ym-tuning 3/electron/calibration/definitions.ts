/**
 * YM definition files (ym-def/1): describe where maps live in a controller file and how to
 * scale them. Definitions are imported from outside the app and are NEVER treated as verified
 * by YM TUNING. There is no automatic map detection ("guessing") anywhere in the app.
 */
import type { CheckResult, CompatibilityReport, Controller, DataType, DefinitionFile, MapData, MapDef } from '../../shared/workshop';
import { WorkshopError } from '../services/errors';

const SIZE: Record<DataType, number> = { u8: 1, u16le: 2, u16be: 2, s16le: 2, s16be: 2 };
const RANGE: Record<DataType, [number, number]> = {
  u8: [0, 255], u16le: [0, 65535], u16be: [0, 65535], s16le: [-32768, 32767], s16be: [-32768, 32767],
};
const TAG_RE = /^[a-z]+(\.[a-z_]+)+$/;

export function cellBytes(m: MapDef) {
  return SIZE[m.dataType];
}
export function mapByteLength(m: MapDef) {
  return m.rows * m.cols * SIZE[m.dataType];
}

/** Strict structural validation of an untrusted definition file. */
export function parseDefinition(text: string): DefinitionFile {
  let d: any;
  try {
    d = JSON.parse(text);
  } catch {
    throw new WorkshopError('INVALID_INPUT', 'definition is not valid JSON');
  }
  const bad = (m: string): never => {
    throw new WorkshopError('INVALID_INPUT', `definition: ${m}`);
  };
  if (!d || d.format !== 'ym-def/1') bad('format must be ym-def/1');
  if (typeof d.name !== 'string' || !d.name.trim()) bad('name');
  if (!d.controller || (d.controller.kind !== 'ecu' && d.controller.kind !== 'tcu')) bad('controller.kind');
  if (!Number.isInteger(d.fileSize) || d.fileSize < 1024) bad('fileSize');
  if (!Array.isArray(d.maps) || d.maps.length === 0 || d.maps.length > 2000) bad('maps');
  const ids = new Set<string>();
  for (const m of d.maps as any[]) {
    if (typeof m.id !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(m.id) || ids.has(m.id)) bad(`map id ${m?.id}`);
    ids.add(m.id);
    if (typeof m.name !== 'string' || !m.name) bad(`map ${m.id} name`);
    if (typeof m.tag !== 'string' || !TAG_RE.test(m.tag)) bad(`map ${m.id} tag`);
    if (!(m.dataType in SIZE)) bad(`map ${m.id} dataType`);
    for (const k of ['address', 'rows', 'cols']) if (!Number.isInteger(m[k]) || m[k] < (k === 'address' ? 0 : 1)) bad(`map ${m.id} ${k}`);
    if (m.rows * m.cols > 4096) bad(`map ${m.id} too large`);
    if (typeof m.scale !== 'number' || m.scale === 0 || !Number.isFinite(m.scale)) bad(`map ${m.id} scale`);
    if (typeof m.offset !== 'number' || !Number.isFinite(m.offset)) bad(`map ${m.id} offset`);
    if (typeof m.unit !== 'string') bad(`map ${m.id} unit`);
    if (m.address + mapByteLength(m) > d.fileSize) bad(`map ${m.id} outside file`);
    for (const ax of ['xAxis', 'yAxis']) {
      const a = m[ax];
      if (a === undefined) continue;
      const n = ax === 'xAxis' ? m.cols : m.rows;
      if (!Array.isArray(a.values) || a.values.length !== n || !a.values.every((v: unknown) => typeof v === 'number')) bad(`map ${m.id} ${ax}`);
    }
  }
  for (const c of (d.conditions ?? []) as any[]) {
    if (typeof c.id !== 'string' || typeof c.tag !== 'string' || !TAG_RE.test(c.tag)) bad('condition');
  }
  return d as DefinitionFile;
}

/** Does this definition fit this controller and this file? */
export function checkCompatibility(def: DefinitionFile, controller: Controller, fileSize: number): CompatibilityReport {
  const checks: CheckResult[] = [];
  checks.push({ id: 'kind', status: def.controller.kind === controller.kind ? 'pass' : 'fail' });
  checks.push({ id: 'fileSize', status: def.fileSize === fileSize ? 'pass' : 'fail', detail: { expected: def.fileSize, actual: fileSize } });
  const idCheck = (list: string[] | undefined, value: string | undefined, id: string) => {
    if (!list?.length) checks.push({ id, status: 'unavailable' });
    else if (!value) checks.push({ id, status: 'warn' });
    else checks.push({ id, status: list.includes(value) ? 'pass' : 'fail' });
  };
  idCheck(def.controller.hwIds, controller.hwId, 'hwId');
  idCheck(def.controller.swIds, controller.swId, 'swId');
  checks.push({ id: 'definitionVerified', status: 'unavailable' });
  return { ok: !checks.some((c) => c.status === 'fail'), checks };
}

function readRaw(buf: Uint8Array, offset: number, t: DataType): number {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  switch (t) {
    case 'u8': return dv.getUint8(offset);
    case 'u16le': return dv.getUint16(offset, true);
    case 'u16be': return dv.getUint16(offset, false);
    case 's16le': return dv.getInt16(offset, true);
    case 's16be': return dv.getInt16(offset, false);
  }
}

function writeRaw(buf: Uint8Array, offset: number, t: DataType, v: number) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  switch (t) {
    case 'u8': return dv.setUint8(offset, v);
    case 'u16le': return dv.setUint16(offset, v, true);
    case 'u16be': return dv.setUint16(offset, v, false);
    case 's16le': return dv.setInt16(offset, v, true);
    case 's16be': return dv.setInt16(offset, v, false);
  }
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

export function readMap(buf: Uint8Array, m: MapDef): MapData {
  const values: number[][] = [];
  let outOfRange = 0;
  const w = SIZE[m.dataType];
  for (let r = 0; r < m.rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < m.cols; c++) {
      const raw = readRaw(buf, m.address + (r * m.cols + c) * w, m.dataType);
      const v = round(raw * m.scale + m.offset);
      if ((m.min !== undefined && v < m.min) || (m.max !== undefined && v > m.max)) outOfRange++;
      row.push(v);
    }
    values.push(row);
  }
  return { map: m, values, outOfRange };
}

export interface CellEdit { r: number; c: number; value: number }

/**
 * Apply physical-unit edits to a copy of the buffer. Rejects values outside the definition's
 * min/max or the data type range — values are never silently clamped.
 */
export function applyEdits(buf: Uint8Array, m: MapDef, edits: CellEdit[]): Uint8Array {
  const out = new Uint8Array(buf);
  const w = SIZE[m.dataType];
  const [lo, hi] = RANGE[m.dataType];
  for (const e of edits) {
    if (!Number.isInteger(e.r) || !Number.isInteger(e.c) || e.r < 0 || e.c < 0 || e.r >= m.rows || e.c >= m.cols) {
      throw new WorkshopError('INVALID_INPUT', `cell ${e.r},${e.c}`);
    }
    if (!Number.isFinite(e.value)) throw new WorkshopError('INVALID_INPUT', 'value');
    if ((m.min !== undefined && e.value < m.min) || (m.max !== undefined && e.value > m.max)) {
      throw new WorkshopError('OUT_OF_RANGE', `${m.id}[${e.r},${e.c}]=${e.value} outside ${m.min}..${m.max}`);
    }
    const raw = Math.round((e.value - m.offset) / m.scale);
    if (raw < lo || raw > hi) throw new WorkshopError('OUT_OF_RANGE', `${m.id} raw ${raw}`);
    writeRaw(out, m.address + (e.r * m.cols + e.c) * w, m.dataType, raw);
  }
  return out;
}

/** Build cell edits for a whole-map operation with a user-supplied value. */
export function operationEdits(data: MapData, op: { type: 'scale' | 'offset' | 'set'; value: number }): CellEdit[] {
  const edits: CellEdit[] = [];
  data.values.forEach((row, r) =>
    row.forEach((v, c) => {
      const value = op.type === 'scale' ? v * (1 + op.value / 100) : op.type === 'offset' ? v + op.value : op.value;
      edits.push({ r, c, value: round(value) });
    }),
  );
  return edits;
}
