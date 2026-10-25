/**
 * Import of dyno results supplied by the user (CSV). Imported data is labelled 'user' —
 * YM TUNING cannot verify where a file came from, so it is never promoted to 'measured'.
 *
 * Accepted format (header row required, comma or semicolon separated):
 *   rpm,torque_nm,power_kw      or      rpm,torque_nm      or      rpm,power_hp
 */
import type { CurvePoint } from './curves';

export type DynoParseResult =
  | { ok: true; points: CurvePoint[]; fileName: string }
  | { ok: false; errorKey: 'dyno.errors.empty' | 'dyno.errors.header' | 'dyno.errors.rows' | 'dyno.errors.tooLarge' };

const MAX_BYTES = 512 * 1024;

export function parseDynoCsv(text: string, fileName: string): DynoParseResult {
  if (text.length > MAX_BYTES) return { ok: false, errorKey: 'dyno.errors.tooLarge' };
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return { ok: false, errorKey: 'dyno.errors.empty' };
  const sep = lines[0].includes(';') ? ';' : ',';
  const header = lines[0].toLowerCase().split(sep).map((h) => h.trim());
  const iR = header.indexOf('rpm');
  const iT = header.findIndex((h) => h === 'torque_nm' || h === 'torque');
  const iKw = header.findIndex((h) => h === 'power_kw' || h === 'kw');
  const iHp = header.findIndex((h) => h === 'power_hp' || h === 'hp');
  if (iR < 0 || (iT < 0 && iKw < 0 && iHp < 0)) return { ok: false, errorKey: 'dyno.errors.header' };

  const points: CurvePoint[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(sep).map((c) => Number(c.trim().replace(',', '.')));
    const rpm = cells[iR];
    if (!Number.isFinite(rpm) || rpm < 300 || rpm > 12000) continue;
    let kw = iKw >= 0 ? cells[iKw] : iHp >= 0 ? cells[iHp] / 1.341 : NaN;
    let nm = iT >= 0 ? cells[iT] : NaN;
    if (!Number.isFinite(nm) && Number.isFinite(kw)) nm = (kw * 9549) / rpm;
    if (!Number.isFinite(kw) && Number.isFinite(nm)) kw = (nm * rpm) / 9549;
    if (!Number.isFinite(nm) || nm <= 0 || nm > 3000) continue;
    points.push({ rpm, torqueNm: Math.round(nm * 10) / 10, powerKw: Math.round(kw * 10) / 10 });
  }
  if (points.length < 3) return { ok: false, errorKey: 'dyno.errors.rows' };
  points.sort((a, b) => a.rpm - b.rpm);
  return { ok: true, points, fileName: fileName.slice(0, 80) };
}
