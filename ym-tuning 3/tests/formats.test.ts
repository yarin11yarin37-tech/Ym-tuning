import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectFormat, parseControllerFile, parseIntelHex, parseSrec, writeControllerFile } from '../electron/calibration/formats';
import { Workshop, memorySecret } from '../electron/workshop';
import { simulatedFile } from '../electron/calibration/demoData';
import { sha256 } from '../electron/services/vault';

/** Reference Intel HEX built by hand: 0x0800_0000 base, two ranges with a gap. */
function sampleHex(): string {
  const rec = (bytes: number[]) => ':' + bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('') +
    ((0x100 - bytes.reduce((a, b) => (a + b) & 0xff, 0)) & 0xff).toString(16).toUpperCase().padStart(2, '0');
  const data = (addr: number, d: number[]) => rec([d.length, (addr >> 8) & 0xff, addr & 0xff, 0, ...d]);
  return [
    rec([2, 0, 0, 4, 0x08, 0x00]),
    data(0x0000, Array.from({ length: 16 }, (_, i) => i)),
    data(0x0010, Array.from({ length: 16 }, (_, i) => 0x10 + i)),
    data(0x0100, [0xaa, 0xbb, 0xcc, 0xdd]),
    ':00000001FF',
  ].join('\n') + '\n';
}

test('format detection is content based', () => {
  assert.equal(detectFormat('x.bin', Buffer.from(sampleHex())), 'ihex');
  assert.equal(detectFormat('x.hex', Buffer.from('S00600004844521B\n')), 'srec');
  assert.equal(detectFormat('x.hex', new Uint8Array([0x3a, 0x00, 0xff, 0x13])), 'raw');
});

test('Intel HEX: parse, gaps filled, checksum enforced, byte-identical round trip', () => {
  const src = Buffer.from(sampleHex());
  const p = parseIntelHex(src);
  assert.equal(p.meta.baseAddress, 0x08000000);
  assert.deepEqual(p.meta.ranges, [{ start: 0x08000000, end: 0x0800001f }, { start: 0x08000100, end: 0x08000103 }]);
  assert.equal(p.image.length, 0x104);
  assert.equal(p.image[0x20], 0xff, 'gap is filled, not invented data');
  assert.equal(p.image[0x101], 0xbb);
  assert.equal(Buffer.from(writeControllerFile(p.image, p.meta)).toString(), src.toString(), 'unchanged image writes back identically');

  const broken = sampleHex().replace(':10000000000102', ':10000000000103');
  assert.throws(() => parseIntelHex(Buffer.from(broken)), /checksum/);
  assert.throws(() => parseIntelHex(Buffer.from(sampleHex().replace(':00000001FF\n', ''))), /end-of-file/);
});

test('S-record: parse and round trip through edits', () => {
  const p0 = parseIntelHex(Buffer.from(sampleHex()));
  const srec = writeControllerFile(p0.image, p0.meta, 'srec');
  assert.match(Buffer.from(srec).toString(), /^S0/);
  const p = parseSrec(srec);
  assert.equal(p.meta.srecType, 3);
  assert.deepEqual(p.meta.ranges, p0.meta.ranges);
  const edited = p.image.slice();
  edited[5] = 0x99;
  const back = parseControllerFile('x.s37', writeControllerFile(edited, p.meta));
  assert.equal(back.image[5], 0x99);
  assert.deepEqual(back.meta.ranges, p.meta.ranges);
  const bad = Buffer.from(srec).toString().replace(/S3(\w{8})/, (m) => m.slice(0, -1) + (m.endsWith('0') ? '1' : '0'));
  assert.throws(() => parseSrec(Buffer.from(bad)), /checksum/);
});

test('tool workflow: import HEX with tool info, edit, export in original format with report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ymfmt-'));
  const ws = new Workshop(dir, memorySecret());
  try {
    const { bytes, def } = simulatedFile('ecu');
    const meta = { format: 'raw' as const, baseAddress: 0x80000000, ranges: [{ start: 0x80000000, end: 0x80000000 + bytes.length - 1 }] };
    const hexFile = writeControllerFile(bytes, meta, 'ihex');
    const v = ws.records.saveVehicle({ make: 'בדיקה' });
    const c = ws.records.addController({ vehicleId: v.id, kind: 'ecu', hwId: 'SIM-ECU-HW-01', swId: 'SIM-ECU-SW-0100', idProvenance: 'user' });

    assert.throws(() => ws.calibration.importFromTool(c.id, { name: 'a.hex', data: hexFile }, { tool: 'nope' as any, readMethod: 'obd' }), (e: any) => e.code === 'INVALID_INPUT');
    const o = ws.calibration.importFromTool(c.id, { name: 'stock.hex', data: hexFile }, { tool: 'kess3', readMethod: 'bench' });
    assert.equal(o.sha256, sha256(bytes), 'original is the raw image');
    assert.equal(o.meta.sourceSha, sha256(hexFile), 'exact source file is kept too');
    assert.equal((o.meta.fileFormat as any).format, 'ihex');
    assert.equal(o.meta.tool, 'kess3');
    assert.equal(o.meta.toolProvenance, 'user');

    ws.calibration.importDefinition(c.id, JSON.stringify(def));
    const { project, version: v1 } = ws.vault.createProject(c.id, 'p');

    const same = ws.calibration.exportForTool(project.id, v1.id, 'original');
    assert.equal(same.info.identicalToSource, true);
    assert.equal(same.info.sha256, sha256(hexFile), 'unchanged export is byte-identical to what the tool produced');

    const v2 = ws.calibration.editMap(project.id, v1.id, 'rev_lim', [{ r: 0, c: 0, value: 7000 }], 'x');
    const out = ws.calibration.exportForTool(project.id, v2.id, 'original');
    assert.equal(out.info.format, 'ihex');
    assert.equal(out.info.identicalToSource, false);
    assert.match(out.info.fileName, /^stock_v2\.hex$/);
    const back = parseControllerFile('x', out.bytes);
    assert.equal(back.meta.baseAddress, 0x80000000);
    assert.equal(sha256(back.image), v2.sha256, 'exported file decodes to exactly the edited version');
    assert.match(out.report, /לא מתקן checksum/);
    assert.match(out.report, /KESS3/);
    assert.match(out.report, /מגבלת סל&quot;ד/);

    const raw = ws.calibration.exportForTool(project.id, v2.id, 'raw');
    assert.equal(sha256(raw.bytes), v2.sha256);
    assert.ok(ws.audit.list().some((a) => a.action === 'original.import'));
  } finally {
    ws.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
