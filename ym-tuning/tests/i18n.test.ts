import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { he } from '../src/i18n/he';
import { LIVE_PIDS } from '../shared/types';

const ROOT = process.cwd();
function walk(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}
const lookup = (key: string) => key.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), he);
const uiFiles = walk('src').filter((f) => /\.(tsx?|ts)$/.test(f) && !f.includes('i18n'));

test('every literal translation key used in the UI exists in Hebrew', () => {
  const missing: string[] = [];
  for (const f of uiFiles) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/\bt(?:List)?\(\s*'([a-zA-Z0-9_.]+)'/g)) {
      const v = lookup(m[1]);
      if (typeof v !== 'string' && !Array.isArray(v)) missing.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('dynamic key families are complete', () => {
  const codes = ['INVALID_SETTINGS', 'UNREACHABLE', 'TIMEOUT', 'CANCELLED', 'UNSUPPORTED_PROTOCOL', 'CONNECTION_LOST', 'NOT_CONNECTED', 'BUSY', 'COMMAND_REJECTED', 'NO_DATA', 'INTERNAL'];
  for (const c of codes) {
    assert.equal(typeof lookup(`errors.${c}.title`), 'string', c);
    assert.equal(typeof lookup(`errors.${c}.hint`), 'string', c);
  }
  for (const p of ['measured', 'vehicle', 'user', 'estimated', 'simulated']) {
    assert.equal(typeof lookup(`provenance.${p}`), 'string');
    assert.equal(typeof lookup(`provenance.${p}Long`), 'string');
  }
  for (const pid of LIVE_PIDS) assert.equal(typeof lookup(`diagnostics.pid.${pid}`), 'string', pid);
  for (const ph of ['idle', 'connecting', 'initializing', 'connected', 'lost', 'disconnecting', 'error', 'demo']) {
    assert.equal(typeof lookup(`vci.${ph}`), 'string', ph);
  }
  for (const p of ['stock', 'stage1', 'stage2', 'stage3', 'custom']) {
    assert.equal(typeof lookup(`lab.profiles.${p}`), 'string');
    assert.equal(typeof lookup(`lab.profileDesc.${p}`), 'string');
  }
  for (const k of ['home', 'connect', 'vehicle', 'diagnostics', 'lab', 'settings']) assert.equal(typeof lookup(`nav.${k}`), 'string');
});

test('no hard-coded English text in the interface', () => {
  const offenders: string[] = [];
  for (const f of uiFiles.filter((x) => x.endsWith('.tsx'))) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    // JSX text between tags
    for (const m of src.matchAll(/(?<![=-])>\s*([^<>{}\n]*[A-Za-z]{2,}[^<>{}\n]*)\s*</g)) {
      const text = m[1].trim();
      if (/[();=?|&]/.test(text)) continue; // TypeScript, not JSX text
      if (!/^(YM|TUNING)$/.test(text)) offenders.push(`${f}: "${text}"`);
    }
    // user-visible attributes
    for (const m of src.matchAll(/\b(aria-label|title|placeholder|alt)="([^"]*[A-Za-z][^"]*)"/g)) {
      offenders.push(`${f}: ${m[1]}="${m[2]}"`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('Hebrew dictionary values are Hebrew (allowing technical terms)', () => {
  const allowedLatin = /^(YM TUNING|YM VCI|kPa|°C)$/;
  const walkVals = (o: any, p: string, out: string[]) => {
    if (typeof o === 'string') {
      if (!/[֐-׿]/.test(o) && !allowedLatin.test(o) && !/^[\d\s°%.,:\-—()/]*$/.test(o)) out.push(`${p}: ${o}`);
    } else if (Array.isArray(o)) o.forEach((v, i) => walkVals(v, `${p}[${i}]`, out));
    else if (o && typeof o === 'object') for (const k of Object.keys(o)) walkVals(o[k], p ? `${p}.${k}` : k, out);
    return out;
  };
  assert.deepEqual(walkVals(he, '', []), []);
});
