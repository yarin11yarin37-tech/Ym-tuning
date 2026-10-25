import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebWorkshop, sha256, type WebFiles } from '../src/web/webWorkshop';
import { simulatedFile } from '../electron/calibration/demoData';
import { parseControllerFile, writeControllerFile } from '../electron/calibration/formats';

function harness() {
  let next: { name: string; data: Uint8Array } | null = null;
  const downloads: { name: string; data: Uint8Array | string }[] = [];
  const files: WebFiles = { openFile: async () => next, download: (name, data) => downloads.push({ name, data }) };
  return { api: createWebWorkshop(files), downloads, setNext: (f: typeof next) => { next = f; } };
}
const ok = <T,>(r: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data;
};

test('web demo: full calibration flow runs in the browser with the same rules', async () => {
  const { api, downloads } = harness();
  const demo = ok(await api.createDemoWorkspace());
  const pid = demo.ecu.projectId;
  const [v1] = ok(await api.listVersions(pid));
  const maps = ok(await api.readMaps(pid, v1.id));
  assert.equal(maps.definition?.source, 'simulated');
  assert.ok(maps.maps.length > 5);

  const out = ok(await api.editMap(pid, v1.id, 'rev_lim', [{ r: 0, c: 0, value: 7000 }], 'x'));
  assert.equal(out.seq, 2);
  const bad = await api.editMap(pid, out.id, 'rev_lim', [{ r: 0, c: 0, value: 9000 }], '');
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.error.code, 'OUT_OF_RANGE');

  const reply = ok(await api.assistantAsk({ text: 'הגדל את יעד הגדישה ב-5%', kind: 'ecu', projectId: pid }));
  assert.equal(reply.request.status, 'plan');
  assert.ok(reply.lines.some((l) => l.key === 'asst.engineLine.local'));
  assert.equal((await api.applyRequest(reply.request.id)).ok, false, 'apply needs approval');
  ok(await api.approveRequest(reply.request.id));
  const applied = ok(await api.applyRequest(reply.request.id));
  assert.equal(applied.request.status, 'verified');

  const blocked = ok(await api.assistantAsk({ text: 'Stage 2 ובלי קטליזטור', kind: 'ecu', projectId: pid }));
  assert.equal(blocked.request.status, 'rejected');

  const ex = ok(await api.assistantAsk({ text: 'Pops & Bangs עדינים רק במצב Sport, בלי הפעלה כשהמזגן פועל', kind: 'ecu', projectId: pid }));
  assert.equal(ex.request.plan!.conditions.find((c) => c.key === 'cond.ac')?.supported, false);

  const gate = ok(await api.readinessCheck(pid, applied.version.id, true));
  assert.equal(gate.allowed, false);

  const exp = ok(await api.exportVersion(pid, applied.version.id, 'original'));
  assert.equal(exp.format, 'raw');
  assert.equal(downloads.length, 2);
  assert.match(downloads[1].name, /ym-report\.html$/);

  const cat = ok(await api.catalog(demo.tcu.controllerId));
  assert.equal(cat.options.find((o) => o.id === 'tcu.clutchPressure')?.availability, 'unavailable');
  assert.ok(ok(await api.auditList()).some((a) => a.action === 'ecu.write' && a.outcome === 'blocked'));
});

test('web demo: import from a tool file, originals cannot be replaced, no vehicle claims', async () => {
  const { api, setNext } = harness();
  const v = ok(await api.saveVehicle({ make: 'בדיקה', vin: '1G1JC5444R7252367', vinProvenance: 'vehicle' }));
  assert.equal(v.vinProvenance, 'user', 'the browser cannot read a vehicle');
  const c = ok(await api.addController({ vehicleId: v.id, kind: 'ecu', hwId: 'SIM-ECU-HW-01', swId: 'SIM-ECU-SW-0100' }));
  const { bytes } = simulatedFile('ecu');
  const hex = writeControllerFile(bytes, { format: 'raw', baseAddress: 0x80000000, ranges: [{ start: 0x80000000, end: 0x80000000 + bytes.length - 1 }] }, 'ihex');

  setNext(null);
  const cancelled = await api.importOriginal(c.id, { tool: 'autotuner', readMethod: 'obd' });
  assert.equal(!cancelled.ok && cancelled.error.code, 'CANCELLED');

  setNext({ name: 'stock.hex', data: hex });
  const o = ok(await api.importOriginal(c.id, { tool: 'autotuner', readMethod: 'obd' }));
  assert.equal(o.sha256, await sha256(bytes));
  assert.equal(o.meta.sourceSha, await sha256(hex));

  setNext({ name: 'other.bin', data: bytes });
  const again = await api.importOriginal(c.id, { tool: 'kess3', readMethod: 'obd' });
  assert.equal(!again.ok && again.error.code, 'ORIGINAL_EXISTS');

  setNext({ name: 'def.json', data: new TextEncoder().encode(JSON.stringify({ ...simulatedFile('ecu').def, source: 'x' })) });
  ok(await api.importDefinition(c.id));
  const { project, version } = ok(await api.createProject(c.id, 'p'));
  const exp = ok(await api.exportVersion(project.id, version.id, 'original'));
  assert.equal(exp.identicalToSource, true);
  assert.equal(exp.sha256, await sha256(hex));
  assert.equal(parseControllerFile('x', hex).meta.baseAddress, 0x80000000);
});
