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
const lookupIn = (o: any, key: string): any => {
  if (!o || typeof o !== 'object') return undefined;
  if (key in o) return o[key];
  const parts = key.split('.');
  for (let i = parts.length - 1; i >= 1; i--) {
    const head = parts.slice(0, i).join('.');
    if (head in o) {
      const r = lookupIn(o[head], parts.slice(i).join('.'));
      if (r !== undefined) return r;
    }
  }
  return undefined;
};
const lookup = (key: string) => lookupIn(he, key);
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
  for (const p of ['measured', 'vehicle', 'user', 'imported', 'estimated', 'simulated']) {
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
  // Technical identifiers that are correctly shown in their original Latin form.
  const technicalKeys = /^(vci2\.(cap|proto)\.|catalog\.opt\.ecu\.stage\d|review\.sha|connect2\.catUsb)/;
  const walkVals = (o: any, p: string, out: string[]) => {
    if (typeof o === 'string') {
      if (!/[֐-׿]/.test(o) && !allowedLatin.test(o) && !technicalKeys.test(p) && !/^[\d\s°%.,:\-—()/]*$/.test(o)) out.push(`${p}: ${o}`);
    } else if (Array.isArray(o)) o.forEach((v, i) => walkVals(v, `${p}[${i}]`, out));
    else if (o && typeof o === 'object') for (const k of Object.keys(o)) walkVals(o[k], p ? `${p}.${k}` : k, out);
    return out;
  };
  assert.deepEqual(walkVals(he, '', []), []);
});

test('every key the workshop services can emit has a Hebrew string', async () => {
  const { OPTION_SPECS, BLOCKED_OPTIONS } = await import('../electron/calibration/catalog');
  const missing: string[] = [];
  const need = (k: string) => { const v = lookup(k); if (typeof v !== 'string') missing.push(k); };
  for (const o of OPTION_SPECS) { need(`catalog.opt.${o.id}`); need(`catalog.group.${o.group}`); for (const tag of o.requiredTags) need(`plan.tag.${tag.replace(/\./g, '_')}`); }
  for (const b of BLOCKED_OPTIONS) { need(`catalog.opt.${b}`); need(`blockedReason.${b}`); }
  need('blockedReason.block.flames');
  for (const a of ['available', 'partial', 'unavailable', 'blocked']) need(`catalog.avail.${a}`);
  for (const r of ['drivetrain', 'knock', 'egt', 'warranty', 'inspection', 'catalyst', 'exhaustValves', 'fuel', 'noiseLaw', 'clutchWear', 'tcuAdaptation']) need(`risk.${r}`);
  for (const u of ['noDefinition', 'definitionUnverified', 'checksum', 'noWrite', 'noRestore', 'noAutoIgnitionFuel']) need(`unresolved.${u}`);
  for (const w of ['noDefinition', 'definitionUnverified', 'definitionSimulated', 'originalSimulated', 'originalImported', 'controllerIdNotRead', 'unexplainedChanges', 'checksumUnavailable', 'noRestore']) need(`warn.${w}`);
  for (const c of ['kind', 'fileSize', 'hwId', 'swId', 'definitionVerified', 'originalIntact', 'sizeMatch', 'compatibility', 'changesInsideMaps', 'valuesInRange', 'checksum', 'pass', 'fail', 'warn', 'unavailable']) need(`check.${c}`);
  for (const s of ['request', 'plan', 'approved', 'applied', 'verified', 'written', 'rejected']) need(`reqStatus.${s}`);
  for (const r of ['controllerIdentityVerified', 'fileCompatible', 'originalVerified', 'checksumVerified', 'voltageStable', 'safetyChecksPassed', 'explicitApproval', 'hardwareWriteCapable', 'verifiedWriteImplementation', 'verifiedRestore']) need(`review.req.${r}`);
  for (const i of ['stage', 'exhaust', 'tcu-shift', 'compare', 'map-edit', 'explain', 'unknown']) need(`asst.understood.${i}`);
  for (const k of ['asst.engineLine.local', 'asst.engineLine.ai', 'asst.aiFailed', 'asst.blocked', 'asst.noProject', 'asst.missing.intensity', 'asst.missing.intent', 'asst.missing.text', 'asst.compare.summary', 'asst.compare.map', 'asst.compare.unexplained', 'asst.compare.none', 'asst.plan.summary', 'asst.plan.conditions', 'asst.next.approve', 'asst.next.needsInput', 'asst.never.write']) need(k);
  for (const m of ['sport', 'normal', 'eco', 'comfort']) { need(`plan.cond.onlyMode.${m}`); need(`plan.cond.disableMode.${m}`); }
  for (const c of ['ac', 'coolant', 'rpmWindow']) need(`plan.cond.${c}`);
  for (const c of ['basicObd', 'oemDiagnostics', 'ecuRead', 'ecuWrite', 'tcuRead', 'tcuWrite', 'can', 'canFd', 'isoTp', 'kLine', 'doip']) need(`vci2.cap.${c}`);
  for (const p of ['wifiObd', 'usbSerial', 'can', 'canFd', 'isoTp', 'kLine', 'doip', 'oem']) need(`vci2.proto.${p}`);
  for (const o of ['working-copy', 'manual-edit', 'plan-applied']) need(`calenv.origin.${o}`);
  for (const k of ['readFailed', 'platform']) need(`usb.reason.${k}`);
  assert.deepEqual(missing, []);
});
