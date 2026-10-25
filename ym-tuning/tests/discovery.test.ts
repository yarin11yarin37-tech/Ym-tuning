import test from 'node:test';
import assert from 'node:assert/strict';
import { adviseNetwork, candidateAllowed, probeCandidates, sameSubnet, MAX_CANDIDATES } from '../electron/obd/discovery';
import { isLocalAddress } from '../electron/obd/validation';
import { startFakeElm } from './helpers/fakeElm';

const wifiOnly = [{ name: 'en0', address: '192.168.0.12', netmask: '255.255.255.0' }];
const wifiAndEthernet = [...wifiOnly, { name: 'en7', address: '10.0.1.20', netmask: '255.255.255.0' }];

test('subnet helpers', () => {
  assert.ok(sameSubnet('192.168.0.12', '192.168.0.10', '255.255.255.0'));
  assert.ok(!sameSubnet('192.168.1.12', '192.168.0.10', '255.255.255.0'));
  assert.ok(isLocalAddress('192.168.0.10') && isLocalAddress('10.1.2.3') && isLocalAddress('172.20.0.1'));
  assert.ok(!isLocalAddress('8.8.8.8') && !isLocalAddress('172.32.0.1'));
});

test('network advice explains when the adapter network is the only connection', () => {
  const a = adviseNetwork('192.168.0.10', wifiOnly);
  assert.equal(a.adapterInterface, 'en0');
  assert.equal(a.likelyNoInternet, true);
  const b = adviseNetwork('192.168.0.10', wifiAndEthernet);
  assert.equal(b.likelyNoInternet, false, 'second interface can carry internet');
  const c = adviseNetwork('192.168.5.10', wifiAndEthernet);
  assert.equal(c.adapterInterface, undefined);
});

test('discovery only probes approved candidates on attached subnets', async () => {
  assert.ok(candidateAllowed('192.168.0.10', wifiOnly));
  assert.ok(!candidateAllowed('192.168.7.10', wifiOnly));

  const elm = await startFakeElm();
  try {
    const list = [
      { host: '127.0.0.1', port: elm.port },
      { host: '192.168.7.10', port: 35000 }, // not on an attached subnet → never contacted
      { host: '8.8.8.8', port: 35000 }, // not local → rejected
      ...Array.from({ length: 10 }, (_, i) => ({ host: '127.0.0.1', port: 1 + i })),
    ];
    const res = await probeCandidates(list, wifiOnly);
    assert.equal(res.length, MAX_CANDIDATES, 'list is capped');
    const found = res.find((r) => r.port === elm.port);
    assert.equal(found?.ok, true);
    assert.match(found?.adapterId ?? '', /ELM327/);
    assert.equal(res.find((r) => r.host === '192.168.7.10')?.error, 'UNREACHABLE');
    assert.equal(res.find((r) => r.host === '8.8.8.8')?.error, 'INVALID_SETTINGS');
    // Only ATI was sent during probing — nothing else.
    assert.deepEqual([...new Set(elm.received)], ['ATI']);
  } finally {
    await elm.close();
  }
});
