import type { ByteRange, DefinitionFile, DiffReport, MapChange } from '../../shared/workshop';
import { mapByteLength, readMap } from './definitions';

/** Byte ranges that differ between two equally sized buffers (adjacent differences merged). */
export function changedRanges(a: Uint8Array, b: Uint8Array): ByteRange[] {
  const n = Math.min(a.length, b.length);
  const out: ByteRange[] = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    const diff = a[i] !== b[i];
    if (diff && start < 0) start = i;
    if (!diff && start >= 0) {
      out.push({ start, end: i - 1 });
      start = -1;
    }
  }
  if (start >= 0) out.push({ start, end: n - 1 });
  if (a.length !== b.length) out.push({ start: n, end: Math.max(a.length, b.length) - 1 });
  return out;
}

export function diffFiles(a: Uint8Array, b: Uint8Array, aSha: string, bSha: string, def?: DefinitionFile): DiffReport {
  const ranges = changedRanges(a, b);
  const changedBytes = ranges.reduce((s, r) => s + (r.end - r.start + 1), 0);
  const mapChanges: MapChange[] = [];
  let unexplained = ranges;

  if (def && a.length === b.length) {
    const covered = (i: number) => def.maps.some((m) => i >= m.address && i < m.address + mapByteLength(m));
    unexplained = [];
    for (const r of ranges) {
      let s = -1;
      for (let i = r.start; i <= r.end + 1; i++) {
        const out = i <= r.end && !covered(i);
        if (out && s < 0) s = i;
        if (!out && s >= 0) {
          unexplained.push({ start: s, end: i - 1 });
          s = -1;
        }
      }
    }
    for (const m of def.maps) {
      const lo = m.address, hi = m.address + mapByteLength(m) - 1;
      if (!ranges.some((r) => r.start <= hi && r.end >= lo)) continue;
      const va = readMap(a, m).values, vb = readMap(b, m).values;
      const cells: MapChange['cells'] = [];
      va.forEach((row, r) => row.forEach((v, c) => v !== vb[r][c] && cells.push({ r, c, from: v, to: vb[r][c] })));
      if (cells.length) mapChanges.push({ mapId: m.id, name: m.name, unit: m.unit, cells });
    }
  }
  return { aSha, bSha, sizeA: a.length, sizeB: b.length, changedBytes, ranges: ranges.slice(0, 500), mapChanges, unexplained: unexplained.slice(0, 500) };
}
