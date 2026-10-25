import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { checkCommand } from '../electron/obd/commandPolicy';
import { Elm327Session } from '../electron/obd/elm327';
import { IPC_CHANNELS } from '../electron/ipcHandlers';
import { YM_API_METHODS } from '../shared/types';

const ROOT = path.resolve(process.cwd());
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
function walk(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}

test('command policy allows only read-only diagnostics', () => {
  for (const ok of ['ATZ', 'ATI', 'ATE0', 'ATSP0', 'ATDP', '010C', '01 0D', '0100', '03', '07', '0A', '0902', '090A']) {
    assert.equal(checkCommand(ok).allowed, true, ok);
  }
  for (const bad of [
    '04', // clear DTCs
    '0801', // on-board control
    '1003', '1101', '2701', '2EF190', '2F0101', '3101', '3400', '3601', // UDS writes / programming
    'ATMA', 'ATBD', 'ATPP0CSV00', 'ATSH7E0', 'ATCRA7E8', 'ATWM', // raw bus / EEPROM
    '01', '0', '', '010C\r04', '010C;04', 'AT Z X',
  ]) {
    assert.equal(checkCommand(bad).allowed, false, bad);
  }
});

test('session refuses disallowed commands before writing anything to the adapter', async () => {
  const writes: string[] = [];
  const transport = Object.assign(new EventEmitter(), {
    kind: 'fake',
    connect: async () => undefined,
    write: (d: string) => writes.push(d),
    close: async () => undefined,
    isOpen: () => true,
  });
  const s = new Elm327Session(transport as any, 200);
  await assert.rejects(s.send('04'), (e: any) => e.code === 'COMMAND_REJECTED');
  await assert.rejects(s.send('2F0101'), (e: any) => e.code === 'COMMAND_REJECTED');
  assert.deepEqual(writes, []);
});

test('the renderer bridge has no write, raw-command or vehicle-control surface', () => {
  const forbidden = /(write|raw|send|exec|flash|program|throttle|actuat|clear|control|invoke)/i;
  for (const m of YM_API_METHODS) assert.doesNotMatch(m, forbidden, m);
  for (const c of IPC_CHANNELS) assert.doesNotMatch(c, forbidden, c);

  const preload = read('electron/preload.ts');
  const used = [...preload.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const ch of used) assert.ok((IPC_CHANNELS as readonly string[]).includes(ch), `preload uses unknown channel ${ch}`);
  assert.doesNotMatch(preload, /ipcRenderer\.(send|sendSync)\(/);
  assert.match(preload, /exposeInMainWorld\('ymApi'/);
});

test('simulator and performance lab cannot reach the vehicle', () => {
  const files = [...walk('src/sim'), 'src/screens/LabScreen.tsx', 'src/screens/lab/LiveStage.tsx'];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /ymApi|getApi|useSession\(\)\.api|\.api\b|readLive|ipcRenderer|electron/, f);
  }
  // The lab may read the session only for identity/mode, never call into the bridge.
  for (const f of walk('src/sim')) assert.doesNotMatch(read(f), /from '\.\.\/state|from '\.\.\/\.\.\/state/, f);
});

test('Electron window is locked down', () => {
  const main = read('electron/main.ts');
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /isTrustedSender/);
});
