import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDtcs, decodeMode09Ascii, decodePid, decodeSupportedPids, dtcFromBytes, isPlausibleVin } from '../electron/obd/decode';

test('mode 01 PIDs decode with and without spaces', () => {
  assert.equal(decodePid('0C', '41 0C 1A F8\r\r'), 1726);
  assert.equal(decodePid('0C', '410C1AF8'), 1726);
  assert.equal(decodePid('0D', '410D32'), 50);
  assert.equal(decodePid('05', '41057B'), 83);
  assert.equal(decodePid('42', '41 42 37 2A'), 14.12);
  assert.equal(decodePid('11', '411126'), 14.9);
  assert.equal(decodePid('0C', 'NO DATA'), null);
  assert.equal(decodePid('0C', '410C'), null, 'truncated answer is not invented');
  assert.equal(decodePid('0C', 'SEARCHING...\rUNABLE TO CONNECT'), null);
});

test('supported-PID bitmap', () => {
  const p = decodeSupportedPids('4100BE3FA813', 0);
  assert.deepEqual(p.slice(0, 6), ['01', '03', '04', '05', '06', '07']);
  assert.ok(p.includes('0C') && p.includes('20') && !p.includes('02'));
});

test('DTC decoding — CAN with count byte, legacy, letters', () => {
  assert.equal(dtcFromBytes(0x01, 0x33), 'P0133');
  assert.equal(dtcFromBytes(0x41, 0x23), 'C0123');
  assert.equal(dtcFromBytes(0x81, 0x00), 'B0100');
  assert.equal(dtcFromBytes(0xd0, 0x16), 'U1016');
  assert.deepEqual(decodeDtcs('43020133D016', 0x43), ['P0133', 'U1016']);
  assert.deepEqual(decodeDtcs('43 01 33 00 00 00 00\r43 04 20 00 00 00 00', 0x43), ['P0133', 'P0420']);
  assert.deepEqual(decodeDtcs('4300', 0x43), []);
  assert.deepEqual(decodeDtcs('NO DATA', 0x47), []);
  assert.deepEqual(decodeDtcs('00A\r0:430401330420\r1:0D016C03000000', 0x43), ['P0133', 'P0420', 'P0D01', 'C2C03']);
});

test('VIN decoding — CAN multi-frame and legacy multi-line', () => {
  const can = '014\r0:490201314731\r1:4A433534343452\r2:37323532333637\r';
  assert.equal(decodeMode09Ascii(can, '02'), '1G1JC5444R7252367');
  const legacy =
    '49 02 01 00 00 00 31\r49 02 02 47 31 4A 43\r49 02 03 35 34 34 34\r49 02 04 52 37 32 35\r49 02 05 32 33 36 37';
  assert.equal(decodeMode09Ascii(legacy, '02'), '1G1JC5444R7252367');
  assert.equal(decodeMode09Ascii('NO DATA', '02'), null);
  assert.ok(isPlausibleVin('1G1JC5444R7252367'));
  assert.ok(!isPlausibleVin('1G1JC5444R725236O'), 'letter O is not valid in a VIN');
});
