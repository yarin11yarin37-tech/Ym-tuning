import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_MODELS, getModel, scaleModelToTorque, peakTorque } from '../src/sim/vehicleModels';
import { PRESET_PROFILES, clampProfile, limiterRpm } from '../src/sim/tuningProfiles';
import { advance, initialState, snapshot, accelTime } from '../src/sim/simulator';
import { summarize, fullLoadCurve } from '../src/sim/curves';
import { parseDynoCsv } from '../src/sim/dynoImport';

/** Drive a fixed pedal script and record snapshots. */
function run(modelId: string, profileId: keyof typeof PRESET_PROFILES, frameMs = 16.7) {
  const m = getModel(modelId);
  const p = PRESET_PROFILES[profileId];
  let s = initialState(m);
  let carry = 0;
  const out = [];
  for (let i = 0; i < 900; i++) {
    const th = i < 400 ? 1 : i < 500 ? 0.3 : i < 600 ? 0 : 0.8;
    const r = advance(s, th, frameMs / 1000 + carry, m, p);
    s = r.state;
    carry = r.leftover;
    out.push(snapshot(s));
  }
  return out;
}

test('simulation is deterministic — same input, same output', () => {
  for (const m of VEHICLE_MODELS) {
    assert.deepEqual(run(m.id, 'stage2'), run(m.id, 'stage2'));
  }
});

test('simulation runs without hardware and stays within physical limits', () => {
  for (const m of VEHICLE_MODELS) {
    for (const pid of Object.keys(PRESET_PROFILES) as (keyof typeof PRESET_PROFILES)[]) {
      const lim = limiterRpm(m, PRESET_PROFILES[pid]);
      const snaps = run(m.id, pid);
      for (const s of snaps) {
        assert.ok(Number.isFinite(s.rpm) && Number.isFinite(s.speedKmh));
        assert.ok(s.rpm >= m.idleRpm - 1 && s.rpm <= lim + 120, `${m.id}/${pid} rpm ${s.rpm}`);
        assert.ok(s.speedKmh >= 0 && s.speedKmh < 320);
        assert.ok(s.gear >= 1 && s.gear <= m.gearRatios.length);
      }
      assert.ok(Math.max(...snaps.map((s) => s.gear)) >= 2, 'gearbox shifts');
    }
  }
});

test('reset returns to a clean idle state', () => {
  const m = VEHICLE_MODELS[0];
  const s = initialState(m);
  assert.equal(s.rpm, m.idleRpm);
  assert.equal(s.speedMs, 0);
  assert.equal(s.gear, 1);
});

test('profiles change the model in the expected direction', () => {
  const m = getModel('ref-turbo-20');
  const stock = summarize(m, PRESET_PROFILES.stock);
  const s1 = summarize(m, PRESET_PROFILES.stage1);
  const s3 = summarize(m, PRESET_PROFILES.stage3);
  assert.ok(s1.peakTorque.value > stock.peakTorque.value);
  assert.ok(s3.peakPower.value > s1.peakPower.value);
  assert.ok(s1.zeroTo100!.value < stock.zeroTo100!.value);
  assert.ok(s3.response90.value > stock.response90.value, 'stage 3 bigger turbo responds slower');
  const t = accelTime(m, PRESET_PROFILES.stock)!;
  assert.ok(t > 5 && t < 10, `plausible 0-100: ${t}`);
});

test('naturally aspirated engines gain much less', () => {
  const na = getModel('ref-na-16');
  const turbo = getModel('ref-turbo-20');
  const gain = (m: typeof na) => summarize(m, PRESET_PROFILES.stage1).peakTorque.value / summarize(m, PRESET_PROFILES.stock).peakTorque.value;
  assert.ok(gain(na) < gain(turbo));
});

test('model outputs are labelled as estimates, never as measured or vehicle data', () => {
  for (const m of VEHICLE_MODELS) {
    const s = summarize(m, PRESET_PROFILES.stage2);
    for (const v of [s.peakTorque, s.peakPower, s.zeroTo100, s.response90]) {
      if (v) assert.ok(!['measured', 'vehicle'].includes(v.provenance));
    }
  }
});

test('custom profile is clamped to sane ranges', () => {
  const c = clampProfile({ id: 'custom', lowGainPct: -5, midGainPct: 500, topGainPct: NaN, revLimitDeltaRpm: 9999, responseFactor: 0.1 });
  assert.deepEqual([c.lowGainPct, c.midGainPct, c.topGainPct, c.revLimitDeltaRpm, c.responseFactor], [0, 60, 0, 800, 0.6]);
});

test('user-supplied stock torque rescales the reference model', () => {
  const m = scaleModelToTorque(getModel('ref-turbo-20'), 420);
  assert.equal(Math.round(peakTorque(m)), 420);
  assert.ok(fullLoadCurve(m, PRESET_PROFILES.stock).length > 10);
});

test('dyno CSV import', () => {
  const ok = parseDynoCsv('rpm,torque_nm,power_kw\n2000,300,62.8\n3000,340,106.8\n4000,330,138.2\n', 'run1.csv');
  assert.ok(ok.ok && ok.points.length === 3);
  const hp = parseDynoCsv('rpm;power_hp\n2000;100\n3000;160\n4000;200\n', 'x.csv');
  assert.ok(hp.ok && Math.round(hp.points[2].torqueNm) === 356);
  assert.equal(parseDynoCsv('a,b\n1,2\n3,4\n5,6', 'x').ok, false);
  assert.equal(parseDynoCsv('rpm,torque_nm\n', 'x').ok, false);
});
