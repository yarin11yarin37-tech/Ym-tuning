/**
 * SIMULATED controller files and definitions for demonstration mode.
 * They are generated deterministically, are not taken from any real vehicle, and are always
 * stored with source = 'simulated' so they can never be confused with real files.
 */
import type { ControllerKind, DefinitionFile, MapDef } from '../../shared/workshop';
import { applyEdits } from './definitions';

const rpmAxis = (n: number, from = 1000, to = 6500) => Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * i) / (n - 1)));
const lin = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

const ECU_MAPS: MapDef[] = [
  { id: 'trq_req', name: 'בקשת מומנט מהדוושה', tag: 'torque.request', address: 0x4000, rows: 8, cols: 8, dataType: 'u16le', scale: 0.1, offset: 0, unit: 'Nm', min: 0, max: 600,
    xAxis: { name: 'סל"ד', unit: 'rpm', values: rpmAxis(8) }, yAxis: { name: 'דוושה', unit: '%', values: lin(8, 0, 100) } },
  { id: 'trq_lim', name: 'מגבלת מומנט', tag: 'torque.limit', address: 0x4100, rows: 1, cols: 12, dataType: 'u16le', scale: 0.1, offset: 0, unit: 'Nm', min: 0, max: 600,
    xAxis: { name: 'סל"ד', unit: 'rpm', values: rpmAxis(12) } },
  { id: 'boost_tgt', name: 'יעד גדישה', tag: 'boost.target', address: 0x4200, rows: 8, cols: 12, dataType: 'u16le', scale: 0.001, offset: 0, unit: 'bar', min: 0, max: 2.5,
    xAxis: { name: 'סל"ד', unit: 'rpm', values: rpmAxis(12) }, yAxis: { name: 'עומס', unit: '%', values: lin(8, 10, 100) } },
  { id: 'boost_lim', name: 'מגבלת גדישה', tag: 'boost.limit', address: 0x4400, rows: 1, cols: 12, dataType: 'u16le', scale: 0.001, offset: 0, unit: 'bar', min: 0, max: 2.5,
    xAxis: { name: 'סל"ד', unit: 'rpm', values: rpmAxis(12) } },
  { id: 'ign_base', name: 'הצתה בסיסית', tag: 'ignition.base', address: 0x4500, rows: 12, cols: 12, dataType: 's16le', scale: 0.1, offset: 0, unit: '°', min: -15, max: 50,
    xAxis: { name: 'סל"ד', unit: 'rpm', values: rpmAxis(12, 800) }, yAxis: { name: 'עומס', unit: '%', values: lin(12, 10, 100) } },
  { id: 'lambda_tgt', name: 'יעד Lambda בעומס מלא', tag: 'fuel.lambda_target', address: 0x4800, rows: 8, cols: 12, dataType: 'u16le', scale: 0.001, offset: 0, unit: 'λ', min: 0.7, max: 1.1,
    xAxis: { name: 'סל"ד', unit: 'rpm', values: rpmAxis(12) }, yAxis: { name: 'עומס', unit: '%', values: lin(8, 30, 100) } },
  { id: 'pedal_map', name: 'מפת דוושה', tag: 'throttle.pedal_map', address: 0x4a00, rows: 8, cols: 10, dataType: 'u16le', scale: 0.1, offset: 0, unit: '%', min: 0, max: 100,
    xAxis: { name: 'סל"ד', unit: 'rpm', values: rpmAxis(10) }, yAxis: { name: 'דוושה', unit: '%', values: lin(8, 0, 100) } },
  { id: 'rev_lim', name: 'מגבלת סל"ד', tag: 'rpm.limit', address: 0x4b00, rows: 1, cols: 1, dataType: 'u16le', scale: 1, offset: 0, unit: 'rpm', min: 5000, max: 7500 },
  { id: 'cmp_prot', name: 'הגנת רכיבים — העשרה לפי טמפרטורת פליטה', tag: 'protect.thermal', address: 0x4b10, rows: 1, cols: 8, dataType: 'u16le', scale: 0.001, offset: 0, unit: 'λ', min: 0.7, max: 1.1,
    xAxis: { name: 'טמפ׳ פליטה', unit: '°C', values: lin(8, 750, 1000) } },
  { id: 'ovr_cut', name: 'סף ניתוק דלק בשחרור דוושה', tag: 'overrun.fuel_cut', address: 0x4b30, rows: 1, cols: 6, dataType: 'u16le', scale: 1, offset: 0, unit: 'rpm', min: 900, max: 7000,
    xAxis: { name: 'טמפ׳ נוזל קירור', unit: '°C', values: lin(6, 0, 100) } },
  { id: 'ovr_ign', name: 'הצתה בשחרור דוושה', tag: 'overrun.ignition', address: 0x4b40, rows: 4, cols: 8, dataType: 's16le', scale: 0.1, offset: 0, unit: '°', min: -20, max: 40,
    xAxis: { name: 'סל"ד', unit: 'rpm', values: rpmAxis(8, 1500, 6000) }, yAxis: { name: 'מצב נהיגה', unit: '', values: [0, 1, 2, 3] } },
];

const TCU_MAPS: MapDef[] = [
  { id: 'shift_up', name: 'נקודות העברה כלפי מעלה', tag: 'shift.points', address: 0x2000, rows: 6, cols: 8, dataType: 'u16le', scale: 0.1, offset: 0, unit: 'km/h', min: 0, max: 280,
    xAxis: { name: 'דוושה', unit: '%', values: lin(8, 0, 100) }, yAxis: { name: 'הילוך', unit: '', values: [1, 2, 3, 4, 5, 6] } },
  { id: 'shift_time', name: 'זמן העברה יעד', tag: 'shift.time', address: 0x2100, rows: 1, cols: 6, dataType: 'u16le', scale: 1, offset: 0, unit: 'ms', min: 150, max: 1200,
    xAxis: { name: 'הילוך', unit: '', values: [1, 2, 3, 4, 5, 6] } },
  { id: 'shift_trq', name: 'הפחתת מומנט בזמן החלפה', tag: 'shift.torque_reduction', address: 0x2120, rows: 1, cols: 6, dataType: 'u8', scale: 1, offset: 0, unit: '%', min: 0, max: 100,
    xAxis: { name: 'הילוך', unit: '', values: [1, 2, 3, 4, 5, 6] } },
  { id: 'tcu_trq_lim', name: 'מגבלת מומנט כניסה לגיר', tag: 'tcu.torque_limit', address: 0x2140, rows: 1, cols: 6, dataType: 'u16le', scale: 0.1, offset: 0, unit: 'Nm', min: 0, max: 700,
    xAxis: { name: 'הילוך', unit: '', values: [1, 2, 3, 4, 5, 6] } },
  { id: 'prot_temp', name: 'הגנת טמפרטורת שמן גיר', tag: 'protect.temp', address: 0x2160, rows: 1, cols: 4, dataType: 'u16le', scale: 0.1, offset: -40, unit: '°C', min: -40, max: 160 },
];

function noise(size: number, seed: number) {
  const b = new Uint8Array(size);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < size; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    b[i] = x & 0xff;
  }
  return b;
}

function fill(buf: Uint8Array, m: MapDef, f: (r: number, c: number) => number) {
  const edits = [];
  for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) edits.push({ r, c, value: Math.round(f(r, c) / m.scale) * m.scale + 0 });
  return applyEdits(buf, m, edits);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function simulatedFile(kind: ControllerKind): { bytes: Uint8Array; def: DefinitionFile } {
  if (kind === 'ecu') {
    let b: Uint8Array = noise(256 * 1024, 0x59_4d_45);
    const [tq, tl, bt, bl, ig, lt, pm, rl, cp, oc, oi] = ECU_MAPS;
    b = fill(b, tq, (r, c) => clamp(350 * (r / 7) * (0.75 + 0.25 * Math.sin((c / 7) * Math.PI)), 0, 350));
    b = fill(b, tl, (_, c) => clamp(260 + 90 * Math.sin(((c + 1) / 12) * Math.PI), 0, 350));
    b = fill(b, bt, (r, c) => clamp(0.15 + 1.05 * (r / 7) * Math.min(1, (c + 2) / 6), 0, 1.25));
    b = fill(b, bl, (_, c) => clamp(0.6 + 0.8 * Math.min(1, (c + 1) / 5), 0, 1.4));
    b = fill(b, ig, (r, c) => clamp(32 - 22 * (r / 11) + 6 * (c / 11), -5, 38));
    b = fill(b, lt, (r) => clamp(1 - 0.18 * (r / 7), 0.8, 1));
    b = fill(b, pm, (r, c) => clamp(100 * Math.pow(r / 7, 1.3 - 0.03 * c), 0, 100));
    b = fill(b, rl, () => 6800);
    b = fill(b, cp, (_, c) => clamp(1 - 0.025 * c, 0.8, 1));
    b = fill(b, oc, (_, c) => 1800 - c * 120);
    b = fill(b, oi, (r, c) => (r === 0 ? 12 - c * 0.5 : 8 - c * 0.5));
    return {
      bytes: b,
      def: {
        format: 'ym-def/1',
        name: 'הגדרת הדגמה — ECU טורבו בנזין',
        controller: { kind: 'ecu', hwIds: ['SIM-ECU-HW-01'], swIds: ['SIM-ECU-SW-0100'] },
        fileSize: b.length,
        maps: ECU_MAPS,
        conditions: [
          { id: 'drive_mode', tag: 'cond.drive_mode', name: 'מצב נהיגה', values: ['normal', 'sport', 'eco'] },
          { id: 'clt', tag: 'cond.coolant_temp', name: 'טמפרטורת נוזל קירור' },
        ],
        source: 'simulated',
      },
    };
  }
  let b: Uint8Array = noise(128 * 1024, 0x54_43_55);
  const [up, st, trq, lim, pt] = TCU_MAPS;
  b = fill(b, up, (r, c) => clamp((r + 1) * (14 + 0.22 * c * 10 / 7 * 3), 0, 250));
  b = fill(b, st, (_, c) => 420 - c * 20);
  b = fill(b, trq, (_, c) => 35 - c * 3);
  b = fill(b, lim, (_, c) => 420 - c * 10);
  b = fill(b, pt, (_, c) => 110 + c * 10);
  return {
    bytes: b,
    def: {
      format: 'ym-def/1',
      name: 'הגדרת הדגמה — TCU אוטומטי 6 הילוכים',
      controller: { kind: 'tcu', hwIds: ['SIM-TCU-HW-01'], swIds: ['SIM-TCU-SW-0100'] },
      fileSize: b.length,
      maps: TCU_MAPS,
      source: 'simulated',
    },
  };
}
