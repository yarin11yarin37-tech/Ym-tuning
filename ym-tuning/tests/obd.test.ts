import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ObdService } from '../electron/obd/obdService';
import { ProfileStore } from '../electron/profileStore';
import { createHandlers } from '../electron/ipcHandlers';
import { startFakeElm, profile } from './helpers/fakeElm';

async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}

test('connects to an ELM327 emulator, identifies the vehicle and reads data', async () => {
  const elm = await startFakeElm();
  const svc = new ObdService();
  try {
    const st = await svc.connect(profile(elm.port));
    assert.equal(st.phase, 'connected');
    assert.match(st.adapterId ?? '', /ELM327/);
    assert.equal(st.protocol, 'ISO 15765-4 (CAN 11/500)');

    const id = await svc.identifyVehicle();
    assert.equal(id.vin?.value, '1G1JC5444R7252367');
    assert.equal(id.vin?.provenance, 'vehicle');
    assert.equal(id.ecuName, null, 'ECU name the vehicle did not report stays null');
    assert.ok(id.supportedPids.includes('0C'));
    assert.ok(id.supportedPids.includes('42'));

    const live = await svc.readLive(['0C', '0D', '05', '2F']);
    assert.equal(live.find((r) => r.pid === '0C')?.value?.value, 1726);
    assert.equal(live.find((r) => r.pid === '0D')?.value?.value, 50);
    assert.equal(live.find((r) => r.pid === '05')?.value?.value, 83);
    assert.equal(live.find((r) => r.pid === '2F')?.unavailable, true, 'unsupported PID is not queried and not invented');
    assert.ok(live.every((r) => !r.value || r.value.provenance === 'vehicle'));

    const dtc = await svc.readDtcs();
    assert.deepEqual(dtc.stored.map((d) => d.value), ['P0133', 'U1016']);
    assert.deepEqual(dtc.pending, []);
    assert.deepEqual(dtc.permanent, []);

    // Read-only: nothing that writes was ever sent.
    assert.ok(!elm.received.some((c) => /^(04|08|2E|2F|31|34|36)/.test(c) && !c.startsWith('AT')));
  } finally {
    await svc.disconnect();
    await elm.close();
  }
});

test('invalid settings are rejected without opening a socket', async () => {
  const svc = new ObdService(() => {
    throw new Error('transport must not be created');
  });
  for (const bad of [
    profile(35000, { host: '8.8.8.8' }),
    profile(0),
    profile(70000),
    profile(35000, { host: 'not-an-ip' }),
    profile(35000, { connectTimeoutMs: 10 }),
  ]) {
    const st = await svc.connect(bad as any);
    assert.equal(st.phase, 'error');
    assert.equal(st.error?.code, 'INVALID_SETTINGS');
  }
});

test('closed port → UNREACHABLE', async () => {
  const svc = new ObdService();
  const st = await svc.connect(profile(await freePort()));
  assert.equal(st.phase, 'error');
  assert.equal(st.error?.code, 'UNREACHABLE');
});

test('adapter that accepts TCP but never answers → TIMEOUT', async () => {
  const elm = await startFakeElm({ silent: ['ATZ'] });
  const svc = new ObdService();
  try {
    const t0 = Date.now();
    const st = await svc.connect(profile(elm.port));
    assert.equal(st.phase, 'error');
    assert.equal(st.error?.code, 'TIMEOUT');
    assert.ok(Date.now() - t0 < 5000);
  } finally {
    await elm.close();
  }
});

test('TCP connect timeout to a host that does not answer', async () => {
  const svc = new ObdService();
  const st = await svc.connect(profile(35000, { host: '10.255.255.1', connectTimeoutMs: 600 }));
  assert.equal(st.phase, 'error');
  // Depending on the network the OS may refuse immediately instead of timing out.
  assert.ok(['TIMEOUT', 'UNREACHABLE'].includes(st.error!.code), st.error!.code);
});

test('a device that is not an OBD adapter → UNSUPPORTED_PROTOCOL', async () => {
  const elm = await startFakeElm({ responses: { ATZ: 'HTTP/1.1 400 Bad Request', ATI: 'HTTP/1.1 400 Bad Request' } });
  const svc = new ObdService();
  try {
    const st = await svc.connect(profile(elm.port));
    assert.equal(st.error?.code, 'UNSUPPORTED_PROTOCOL');
  } finally {
    await elm.close();
  }
});

test('connection attempt can be cancelled', async () => {
  const elm = await startFakeElm({ delayMs: 400 });
  const svc = new ObdService();
  try {
    const pending = svc.connect(profile(elm.port, { commandTimeoutMs: 2000 }));
    setTimeout(() => svc.cancelConnect(), 150);
    const st = await pending;
    assert.equal(st.phase, 'error');
    assert.equal(st.error?.code, 'CANCELLED');
  } finally {
    await elm.close();
  }
});

test('lost connection is reported, reads fail cleanly, reconnect recovers', async () => {
  const elm = await startFakeElm();
  const svc = new ObdService();
  const phases: string[] = [];
  svc.on('status', (s) => phases.push(s.phase));
  try {
    assert.equal((await svc.connect(profile(elm.port))).phase, 'connected');
    elm.dropAll();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(svc.getStatus().phase, 'lost');
    assert.equal(svc.getStatus().error?.code, 'CONNECTION_LOST');
    await assert.rejects(svc.readLive(['0C']), (e: any) => e.code === 'NOT_CONNECTED');

    const again = await svc.reconnect();
    assert.equal(again.phase, 'connected');
    assert.equal((await svc.readLive(['0C']))[0].value?.value, 1726);

    await svc.disconnect();
    assert.equal(svc.getStatus().phase, 'idle');
    // Disconnect twice is harmless.
    await svc.disconnect();
    assert.ok(phases.includes('lost') && phases.includes('connected') && phases.at(-1) === 'idle');
  } finally {
    await elm.close();
  }
});

test('IPC handlers turn every failure into a Result instead of throwing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ymt-'));
  const handlers = createHandlers(new ObdService(), new ProfileStore(dir));
  const bad = [
    await handlers['obd:identify'](),
    await handlers['obd:readLive'](['0C']),
    await handlers['obd:readLive'](['FF']),
    await handlers['obd:readLive']('0C'),
    await handlers['obd:readDtcs'](),
    await handlers['obd:connect']('missing'),
    await handlers['obd:connect']({ evil: true }),
    await handlers['profiles:save']({ id: 'x', name: 'x', kind: 'wifi-tcp', host: '1.1.1.1', port: 35000, connectTimeoutMs: 1000, commandTimeoutMs: 1000 }),
    await handlers['net:probe']([]),
    await handlers['net:advice']('nope'),
  ];
  for (const r of bad) assert.equal(r.ok, false);

  const saved = await handlers['profiles:save'](profile(35000, { id: 'garage', name: 'מוסך' }));
  assert.equal(saved.ok, true);
  const list = await handlers['profiles:list']();
  assert.equal(list.ok && (list.data as any[]).length, 1);
  await fs.rm(dir, { recursive: true, force: true });
});
