import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workshop, memorySecret } from '../electron/workshop';
import { createWorkshopHandlers, WORKSHOP_CHANNELS, type Dialogs } from '../electron/workshopHandlers';
import { sha256 } from '../electron/services/vault';
import { simulatedFile } from '../electron/calibration/demoData';
import { parseRequest } from '../electron/calibration/request';
import { readMap } from '../electron/calibration/definitions';
import { renderReport } from '../electron/services/report';
import { parseDarwinRoute, parseLinuxRoute, parseWindowsRoute } from '../electron/network/internet';
import { adviseNetwork } from '../electron/obd/discovery';
import { parseWindowsSerial, scanUsb } from '../electron/hardware/usb';
import { WORKSHOP_METHOD_CHANNELS } from '../shared/workshop';

function fresh(fetchImpl?: typeof fetch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ymws-'));
  const ws = new Workshop(dir, memorySecret(), fetchImpl);
  return { ws, dir, done: () => { ws.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function vehicleWithControllers(ws: Workshop) {
  const v = ws.records.saveVehicle({ make: 'בדיקה', vin: '1G1JC5444R7252367', vinProvenance: 'user' });
  const ecu = ws.records.addController({ vehicleId: v.id, kind: 'ecu', hwId: 'SIM-ECU-HW-01', swId: 'SIM-ECU-SW-0100', idProvenance: 'user' });
  const tcu = ws.records.addController({ vehicleId: v.id, kind: 'tcu', hwId: 'SIM-TCU-HW-01', idProvenance: 'user' });
  return { v, ecu, tcu };
}

test('migrations are applied once and are idempotent', () => {
  const { ws, done } = fresh();
  try {
    assert.equal(ws.db.schemaVersion(), 1);
    assert.deepEqual(ws.db.migrate(), []);
  } finally {
    done();
  }
});

test('original backup: stored with SHA-256, verified, never overwritten or deleted', () => {
  const { ws, dir, done } = fresh();
  try {
    const { ecu } = vehicleWithControllers(ws);
    const { bytes } = simulatedFile('ecu');
    const o = ws.vault.storeOriginal({ controllerId: ecu.id, data: bytes, fileName: 'stock.bin', source: 'imported' });
    assert.equal(o.sha256, sha256(bytes));
    assert.equal(o.size, bytes.length);
    assert.equal(o.source, 'imported');
    assert.equal((o.meta as any).controller.hwId, 'SIM-ECU-HW-01');
    assert.equal(ws.vault.verifyOriginal(o.id).ok, true);

    // A second original for the same controller is refused.
    assert.throws(() => ws.vault.storeOriginal({ controllerId: ecu.id, data: new Uint8Array(4096), fileName: 'x.bin', source: 'imported' }), (e: any) => e.code === 'ORIGINAL_EXISTS');
    // The database itself refuses to change or delete it.
    assert.throws(() => ws.db.run('UPDATE originals SET sha256 = ? WHERE id = ?', ['0'.repeat(64), o.id]), /ORIGINAL_IMMUTABLE/);
    assert.throws(() => ws.db.run('DELETE FROM originals WHERE id = ?', [o.id]), /ORIGINAL_IMMUTABLE/);
    // On disk the blob is read-only and never rewritten.
    const blob = path.join(dir, 'vault', 'blobs', o.sha256.slice(0, 2), o.sha256);
    if (process.platform !== 'win32' && process.getuid?.() !== 0) assert.equal(fs.statSync(blob).mode & 0o222, 0);
    assert.equal(ws.vault.putBlob(bytes, true), o.sha256, 'storing identical bytes reuses the blob');

    // "read" from a controller is not possible yet.
    assert.throws(() => ws.vault.storeOriginal({ controllerId: ecu.id, data: bytes, fileName: 'r.bin', source: 'read' }), (e: any) => e.code === 'NOT_SUPPORTED');
  } finally {
    done();
  }
});

test('tampering with the stored original is detected and blocks new projects', () => {
  const { ws, dir, done } = fresh();
  try {
    const { ecu } = vehicleWithControllers(ws);
    const { bytes } = simulatedFile('ecu');
    const o = ws.vault.storeOriginal({ controllerId: ecu.id, data: bytes, fileName: 'stock.bin', source: 'imported' });
    const blob = path.join(dir, 'vault', 'blobs', o.sha256.slice(0, 2), o.sha256);
    fs.chmodSync(blob, 0o644);
    const bad = Buffer.from(bytes);
    bad[100] ^= 0xff;
    fs.writeFileSync(blob, bad);
    assert.equal(ws.vault.verifyOriginal(o.id).ok, false);
    assert.throws(() => ws.vault.createProject(ecu.id, 'p'), (e: any) => e.code === 'INTEGRITY');
    assert.ok(ws.audit.list().some((a) => a.action === 'original.verify' && a.outcome === 'error'));
  } finally {
    done();
  }
});

test('no project and no calibration without an original backup', () => {
  const { ws, done } = fresh();
  try {
    const { ecu } = vehicleWithControllers(ws);
    assert.throws(() => ws.vault.createProject(ecu.id, 'p'), (e: any) => e.code === 'NO_ORIGINAL');
  } finally {
    done();
  }
});

test('versioning: edits create new immutable versions; working copy is separate from original', () => {
  const { ws, done } = fresh();
  try {
    const demo = ws.calibration.createDemoWorkspace();
    const pid = demo.ecu.projectId;
    const [v1] = ws.vault.listVersions(pid);
    assert.equal(v1.origin, 'working-copy');
    const before = ws.calibration.readMaps(pid, v1.id).maps.find((m) => m.map.id === 'rev_lim')!.values[0][0];
    const v2 = ws.calibration.editMap(pid, v1.id, 'rev_lim', [{ r: 0, c: 0, value: 7000 }], 'הגבהת מגבלה');
    assert.equal(v2.seq, 2);
    assert.equal(v2.parentId, v1.id);
    assert.equal(ws.calibration.readMaps(pid, v2.id).maps.find((m) => m.map.id === 'rev_lim')!.values[0][0], 7000);
    assert.equal(ws.calibration.readMaps(pid, v1.id).maps.find((m) => m.map.id === 'rev_lim')!.values[0][0], before, 'v1 unchanged');
    const org = ws.vault.originalForController(demo.ecu.controllerId)!;
    assert.equal(ws.vault.verifyOriginal(org.id).ok, true, 'original untouched by edits');
    assert.throws(() => ws.db.run('UPDATE versions SET sha256 = ? WHERE id = ?', [org.sha256, v2.id]), /VERSION_IMMUTABLE/);

    // Values outside the definition range are refused, never clamped.
    assert.throws(() => ws.calibration.editMap(pid, v2.id, 'rev_lim', [{ r: 0, c: 0, value: 9000 }], ''), (e: any) => e.code === 'OUT_OF_RANGE');

    const diff = ws.calibration.diff(pid, 'original', v2.id);
    assert.equal(diff.mapChanges.length, 1);
    assert.deepEqual(diff.mapChanges[0].cells[0], { r: 0, c: 0, from: before, to: 7000 });
    assert.equal(diff.unexplained.length, 0);
    assert.ok(v2.checks.find((c) => c.id === 'changesInsideMaps')?.status === 'pass');
    assert.equal(v2.checks.find((c) => c.id === 'checksum')?.status, 'unavailable');
  } finally {
    done();
  }
});

test('imported and simulated files are labelled as such', () => {
  const { ws, done } = fresh();
  try {
    const demo = ws.calibration.createDemoWorkspace();
    for (const o of ws.vault.listOriginals()) assert.equal(o.source, 'simulated');
    assert.equal(ws.calibration.definitionFor(demo.ecu.controllerId)?.source, 'simulated');
    assert.equal(ws.records.getController(demo.tcu.controllerId)?.idProvenance, 'simulated');
    const review = ws.calibration.review(demo.ecu.projectId, ws.calibration.latestVersion(demo.ecu.projectId).id);
    assert.ok(review.warnings.includes('warn.originalSimulated'));
    assert.ok(review.warnings.includes('warn.definitionSimulated'));
    assert.equal(review.restoreAvailable, false);
  } finally {
    done();
  }
});

test('ECU and TCU are kept separate', () => {
  const { ws, done } = fresh();
  try {
    const { ecu, tcu } = vehicleWithControllers(ws);
    const e = simulatedFile('ecu'), t = simulatedFile('tcu');
    ws.vault.storeOriginal({ controllerId: ecu.id, data: e.bytes, fileName: 'e.bin', source: 'imported' });
    ws.vault.storeOriginal({ controllerId: tcu.id, data: t.bytes, fileName: 't.bin', source: 'imported' });
    // A TCU definition cannot be attached to an ECU and vice versa.
    assert.throws(() => ws.calibration.importDefinition(ecu.id, JSON.stringify(t.def)), (x: any) => x.code === 'INCOMPATIBLE');
    ws.calibration.importDefinition(ecu.id, JSON.stringify(e.def));
    ws.calibration.importDefinition(tcu.id, JSON.stringify(t.def));
    const pe = ws.vault.createProject(ecu.id, 'ECU').project;
    const pt = ws.vault.createProject(tcu.id, 'TCU').project;
    assert.equal(pe.kind, 'ecu');
    assert.equal(pt.kind, 'tcu');
    assert.notEqual(ws.vault.getOriginal(pe.originalId)!.sha256, ws.vault.getOriginal(pt.originalId)!.sha256);
    // A gearbox request cannot be filed against an engine project.
    const parsed = parseRequest('אני רוצה העברות גיר חלקות יותר', 'ecu');
    assert.equal(parsed.kind, 'tcu');
    assert.throws(() => ws.calibration.createRequest({ projectId: pe.id, kind: 'tcu', text: 'x', parsed, engine: 'local' }), (x: any) => x.code === 'INCOMPATIBLE');
    assert.equal(ws.vault.listProjects('ecu').length, 1);
    assert.equal(ws.vault.listProjects('tcu').length, 1);
  } finally {
    done();
  }
});

test('catalog reports unsupported features from the definition, and blocks emissions defeat', () => {
  const { ws, done } = fresh();
  try {
    const demo = ws.calibration.createDemoWorkspace();
    const ecu = ws.calibration.catalog(demo.ecu.controllerId).options;
    assert.equal(ecu.find((o) => o.id === 'ecu.stage1')?.availability, 'available');
    assert.equal(ecu.find((o) => o.id === 'ecu.stage3')?.availability, 'partial', 'injector map missing');
    assert.deepEqual(ecu.find((o) => o.id === 'ecu.stage3')?.missingTags, ['fuel.injector']);
    for (const b of ['block.catalyst', 'block.dpf', 'block.egr', 'block.o2', 'block.immobilizer']) {
      assert.equal(ecu.find((o) => o.id === b)?.availability, 'blocked');
    }
    const tcu = ws.calibration.catalog(demo.tcu.controllerId).options;
    assert.equal(tcu.find((o) => o.id === 'tcu.clutchPressure')?.availability, 'unavailable', 'never invented');
    assert.ok(tcu.every((o) => !o.id.startsWith('ecu.')));
    // Without a definition nothing is available.
    const { ecu: bare } = vehicleWithControllers(ws);
    assert.ok(ws.calibration.catalog(bare.id).options.filter((o) => o.group !== 'blocked').every((o) => o.availability === 'unavailable'));
  } finally {
    done();
  }
});

test('assistant understands the specification examples in Hebrew', () => {
  const p1 = parseRequest('אני רוצה Stage 1 עם שמירה על הגנות היצרן.', 'ecu');
  assert.equal(p1.intent, 'stage');
  assert.equal(p1.stage, 1);
  assert.equal(p1.keepProtections, true);

  const p2 = parseRequest('אני רוצה Pops & Bangs רק במצב Sport.', 'ecu');
  assert.equal(p2.intent, 'exhaust');
  assert.deepEqual(p2.exhaust?.onlyModes, ['sport']);
  assert.deepEqual(p2.missing, ['missing.intensity'], 'asks only for the missing detail that matters');

  const p3 = parseRequest('רוצה Pops & Bangs עדינים רק במצב Sport, בלי הפעלה במצב Normal ובלי הפעלה כאשר המזגן פועל, אם הבקר תומך בתנאים האלה.', 'ecu');
  assert.equal(p3.exhaust?.intensity, 'mild');
  assert.deepEqual(p3.exhaust?.disableModes, ['normal']);
  assert.equal(p3.exhaust?.disableWithAc, true);
  assert.deepEqual(p3.missing, []);

  const p4 = parseRequest('אני רוצה העברות גיר חלקות יותר בלי לעבור את מגבלות המומנט המאומתות.', 'ecu');
  assert.equal(p4.intent, 'tcu-shift');
  assert.equal(p4.kind, 'tcu');
  assert.equal(p4.respectTorqueLimits, true);

  assert.equal(parseRequest('השווה בין הקובץ המקורי לקובץ העבודה והסבר כל שינוי שזוהה.', 'ecu').intent, 'compare');

  for (const t of ['אני רוצה לבטל את הקטליזטור', 'תעשה DPF off', 'ביטול EGR', 'Pops & Bangs עם להבות']) {
    assert.ok(parseRequest(t, 'ecu').blockedReasons.length > 0, t);
  }
  assert.equal(parseRequest('Stage 1 עם שמירה על הגנות הקטליזטור', 'ecu').blockedReasons.length, 0, 'protecting the catalyst is fine');
});

test('assistant flow: plan → approval → applied to working copy → verified; never written', async () => {
  const { ws, done } = fresh();
  try {
    const demo = ws.calibration.createDemoWorkspace();
    const pid = demo.ecu.projectId;
    assert.equal(ws.assistant.status().engine, 'local');

    const ex = await ws.assistant.send({ text: 'רוצה Pops & Bangs עדינים רק במצב Sport, בלי הפעלה במצב Normal ובלי הפעלה כאשר המזגן פועל', kind: 'ecu', projectId: pid });
    const cond = Object.fromEntries(ex.request.plan!.conditions.map((c) => [c.key, c.supported]));
    assert.equal(cond['cond.onlyMode.sport'], true);
    assert.equal(cond['cond.disableMode.normal'], true);
    assert.equal(cond['cond.ac'], false, 'definition has no A/C signal → reported as unsupported');
    assert.ok(ex.request.plan!.items.every((i) => i.status !== 'ready'), 'no automatic ignition/fuel values');
    assert.ok(ex.request.plan!.risks.includes('risk.catalyst'));
    assert.throws(() => ws.calibration.approve(ex.request.id), (e: any) => e.code === 'NOT_SUPPORTED');

    const blocked = await ws.assistant.send({ text: 'Stage 2 ובלי קטליזטור', kind: 'ecu', projectId: pid });
    assert.equal(blocked.request.status, 'rejected');

    const r = await ws.assistant.send({ text: 'הגדל את יעד הגדישה ב-5%', kind: 'ecu', projectId: pid });
    assert.equal(r.request.status, 'plan');
    assert.equal(r.request.plan!.items[0].status, 'ready');
    assert.throws(() => ws.calibration.applyApproved(r.request.id), (e: any) => e.code === 'INVALID_INPUT', 'apply requires approval');
    ws.calibration.approve(r.request.id);
    const { request, version } = ws.calibration.applyApproved(r.request.id);
    assert.equal(request.status, 'verified');
    assert.equal(version.origin, 'plan-applied');
    const map = simulatedFile('ecu').def.maps.find((m) => m.id === 'boost_tgt')!;
    const before = readMap(simulatedFile('ecu').bytes, map).values[7][11];
    const after = readMap(ws.vault.readBlob(version.sha256), map).values[7][11];
    assert.ok(Math.abs(after - before * 1.05) < 0.002, `${before} → ${after}`);

    const tooMuch = await ws.assistant.send({ text: 'הגדל את יעד הגדישה ב-300%', kind: 'ecu', projectId: pid });
    ws.calibration.approve(tooMuch.request.id);
    assert.throws(() => ws.calibration.applyApproved(tooMuch.request.id), (e: any) => e.code === 'OUT_OF_RANGE');

    const cmp = await ws.assistant.send({ text: 'השווה בין הקובץ המקורי לקובץ העבודה', kind: 'ecu', projectId: pid });
    assert.ok(cmp.lines.some((l) => l.key === 'asst.compare.map' && l.params?.name === 'יעד גדישה'));

    // Physical write is never possible in this version.
    const gate = ws.calibration.writeGate(pid, version.id, true);
    assert.equal(gate.allowed, false);
    for (const req of ['checksumVerified', 'hardwareWriteCapable', 'verifiedWriteImplementation', 'verifiedRestore']) {
      assert.equal(gate.requirements.find((x) => x.id === req)?.met, false, req);
    }
    assert.ok(ws.calibration.listRequests(pid).every((x) => x.status !== 'written'));
    assert.ok(ws.audit.list().some((a) => a.action === 'ecu.write' && a.outcome === 'blocked'));
  } finally {
    done();
  }
});

test('AI engine is used only when configured, cannot remove safety blocks, and failures fall back', async () => {
  let calls = 0;
  const fake: typeof fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"intent":"stage","kind":"ecu","stage":2}' }] }), { status: 200 });
  };
  const { ws, done } = fresh(fake);
  try {
    ws.assistant.configure('sk-test-0000000000000000000000');
    assert.equal(ws.assistant.status().engine, 'ai');
    const r = await ws.assistant.send({ text: 'Stage 2 בלי קטליזטור', kind: 'ecu' });
    assert.equal(calls, 1);
    assert.equal(r.request.engine, 'ai');
    assert.equal(r.request.status, 'rejected', 'local safety rules still apply');
    assert.ok(r.lines.some((l) => l.key === 'asst.noProject'));
  } finally {
    done();
  }
  const failing: typeof fetch = async () => new Response('nope', { status: 500 });
  const f = fresh(failing);
  try {
    f.ws.assistant.configure('sk-test-0000000000000000000000');
    const r = await f.ws.assistant.send({ text: 'אני רוצה Stage 1', kind: 'ecu' });
    assert.equal(r.request.engine, 'local');
    assert.ok(r.aiError);
    assert.ok(r.lines.some((l) => l.key === 'asst.aiFailed'));
  } finally {
    f.done();
  }
});

test('action log records operations and is append-only', () => {
  const { ws, done } = fresh();
  try {
    ws.calibration.createDemoWorkspace();
    const actions = ws.audit.list().map((a) => a.action);
    for (const a of ['original.store', 'definition.import', 'project.create', 'controller.create', 'vehicle.create']) assert.ok(actions.includes(a), a);
    assert.throws(() => ws.db.run('DELETE FROM audit'), /AUDIT_APPEND_ONLY/);
    assert.throws(() => ws.db.run("UPDATE audit SET outcome = 'ok'"), /AUDIT_APPEND_ONLY/);
  } finally {
    done();
  }
});

test('IPC handlers validate input, use dialogs for files and never throw', async () => {
  const { ws, done } = fresh();
  let next: { name: string; data: Buffer } | null = null;
  const dialogs: Dialogs = { openFile: async () => next, saveFile: async () => null };
  const h = createWorkshopHandlers(ws, dialogs);
  try {
    const bad = await Promise.all([
      h['vault:verify']('../../etc/passwd'),
      h['cal:maps']('prj_x', 'ver_y'),
      h['controllers:add']({ vehicleId: 'nope', kind: 'ecu' }),
      h['asst:ask']({ text: 'x', kind: 'xyz' }),
      h['cal:edit']('prj_abcdefgh', 'ver_abcdefgh', 'm', 'not-an-array'),
    ]);
    for (const r of bad) assert.equal(r.ok, false);

    const v = (await h['vehicles:save']({ make: 'בדיקה' })) as any;
    const c = (await h['controllers:add']({ vehicleId: v.data.id, kind: 'ecu', idProvenance: 'vehicle' })) as any;
    assert.equal(c.data.idProvenance, 'user', 'the renderer cannot claim an identity was read from the vehicle');

    const cancelled = (await h['vault:importOriginal'](c.data.id, { tool: 'kess3', readMethod: 'obd' })) as any;
    assert.equal(cancelled.error.code, 'CANCELLED');
    next = { name: 'stock.bin', data: Buffer.from(simulatedFile('ecu').bytes) };
    const ok = (await h['vault:importOriginal'](c.data.id, { tool: 'kess3', readMethod: 'obd' })) as any;
    assert.equal(ok.ok, true);
    assert.equal(ok.data.source, 'imported');
    assert.equal(((await h['vault:importOriginal'](c.data.id, { tool: 'kess3', readMethod: 'obd' })) as any).error.code, 'ORIGINAL_EXISTS');

    // Every channel name is listed, and none is a write/flash channel.
    assert.deepEqual(Object.keys(h).sort(), [...WORKSHOP_CHANNELS].sort());
    assert.deepEqual(Object.values(WORKSHOP_METHOD_CHANNELS).sort(), [...WORKSHOP_CHANNELS].sort());
  } finally {
    done();
  }
});

test('network helpers parse default routes and detect internet routed via the adapter', () => {
  assert.deepEqual(parseDarwinRoute('   route to: default\n destination: default\n    gateway: 192.168.1.1\n  interface: en0\n'), { iface: 'en0', gateway: '192.168.1.1', known: true });
  assert.deepEqual(parseLinuxRoute('default via 10.0.0.1 dev eth0 proto dhcp metric 100'), { gateway: '10.0.0.1', iface: 'eth0', known: true });
  const win = 'Network Destination        Netmask          Gateway       Interface  Metric\n          0.0.0.0          0.0.0.0      192.168.0.10    192.168.0.12     55\n          0.0.0.0          0.0.0.0      10.0.1.1        10.0.1.20     25\n';
  assert.deepEqual(parseWindowsRoute(win), { gateway: '10.0.1.1', iface: '10.0.1.20', known: true });
  const ifs = [
    { name: 'en0', address: '192.168.0.12', netmask: '255.255.255.0' },
    { name: 'en7', address: '10.0.1.20', netmask: '255.255.255.0' },
  ];
  assert.equal(adviseNetwork('192.168.0.10', ifs, { iface: 'en7', known: true }).internetViaAdapter, false, 'internet kept on Ethernet');
  const a = adviseNetwork('192.168.0.10', ifs, { iface: 'en0', gateway: '192.168.0.10', known: true });
  assert.equal(a.internetViaAdapter, true);
  assert.equal(a.likelyNoInternet, true);
});

test('USB devices are listed but never presented as vehicle-capable', async () => {
  assert.deepEqual(parseWindowsSerial('COM3|USB Serial Device (COM3)\r\nnoise\r\nCOM7|CH340\r\n'), [
    { path: 'COM3', name: 'USB Serial Device (COM3)' },
    { path: 'COM7', name: 'CH340' },
  ]);
  const scan = await scanUsb('linux');
  for (const d of scan.devices) {
    assert.equal(d.identified, false);
    assert.ok(Object.values(d.capabilities).every((c) => c === 'not-supported'));
  }
  assert.equal((await scanUsb('aix' as any)).supported, false);
});

test('diagnostic report is Hebrew RTL, escapes vehicle data, and marks demo data', () => {
  const html = renderReport({
    title: 'בדיקה <script>', mode: 'demo', createdAt: '2026-10-25T10:00:00Z',
    data: { vin: { value: 'YMTDEMV0000000001', provenance: 'simulated' }, dtcs: { stored: [{ value: 'P0420', provenance: 'simulated' }], pending: [], permanent: [] } },
  });
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /מצב הדגמה/);
  assert.match(html, /יעילות הממיר הקטליטי/);
  assert.match(html, /<bdi dir="ltr">P0420<\/bdi>/);
});
