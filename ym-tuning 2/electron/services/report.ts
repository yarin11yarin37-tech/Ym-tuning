/**
 * Hebrew RTL diagnostic report (self-contained HTML). Every value carries its provenance.
 * Text is HTML-escaped; nothing from the vehicle is inserted unescaped.
 */
import { describeDtc } from '../../shared/dtc';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const PROV: Record<string, string> = {
  vehicle: 'נקרא מהרכב', simulated: 'סימולציה', user: 'הוזן על ידי המשתמש', imported: 'מיובא', estimated: 'הערכה', measured: 'נמדד',
};

const PID_HE: Record<string, string> = {
  '0C': 'סל"ד מנוע', '0D': 'מהירות רכב', '05': 'טמפרטורת נוזל קירור', '0F': 'טמפרטורת אוויר יניקה', '11': 'מיקום מצערת',
  '04': 'עומס מנוע מחושב', '0B': 'לחץ בסעפת היניקה', '10': 'ספיקת אוויר נכנס', '2F': 'מפלס דלק', '42': 'מתח יחידת הבקרה',
};

interface SessionData {
  vin?: { value: string; provenance: string } | null;
  protocol?: { value: string; provenance: string } | null;
  live?: { pid: string; value: { value: number; unit?: string; provenance: string } | null }[];
  dtcs?: Record<'stored' | 'pending' | 'permanent', { value: string; provenance: string }[]>;
}

export function renderReport(s: { title: string; mode: 'live' | 'demo'; createdAt: string; data: SessionData }): string {
  const d = s.data ?? {};
  const ltr = (v: unknown) => `<bdi dir="ltr">${esc(v)}</bdi>`;
  const live = (d.live ?? [])
    .map((r) => `<tr><td>${esc(PID_HE[r.pid] ?? r.pid)}</td><td>${r.value ? `${ltr(r.value.value)} ${esc(r.value.unit ?? '')}` : 'לא זמין'}</td><td>${esc(r.value ? PROV[r.value.provenance] : '')}</td><td>${ltr(`01 ${r.pid}`)}</td></tr>`)
    .join('');
  const group = (name: string, list: { value: string; provenance: string }[] = []) =>
    `<h3>${esc(name)}</h3>` +
    (list.length
      ? `<ul>${list.map((c) => `<li>${ltr(c.value)} — ${esc(describeDtc(c.value) ?? 'אין תיאור במאגר הקודים הגנרי המקומי')} <small>(${esc(PROV[c.provenance])})</small></li>`).join('')}</ul>`
      : '<p>לא נמצאו קודים</p>');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(s.title)}</title>
<style>body{font-family:Heebo,Arial,sans-serif;max-width:860px;margin:32px auto;color:#111;line-height:1.5}
h1{margin:0}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:start}
.demo{background:#ffe3f1;border:1px dashed #d63384;padding:8px 12px;border-radius:6px}small{color:#666}</style></head><body>
<h1>דוח אבחון — YM TUNING</h1>
<p>${esc(s.title)} · ${ltr(new Date(s.createdAt).toLocaleString('he-IL'))}</p>
${s.mode === 'demo' ? '<p class="demo">מצב הדגמה — כל הנתונים בדוח זה הם סימולציה ואינם מגיעים מרכב.</p>' : ''}
<h2>זיהוי</h2>
<p>מספר שלדה (VIN): ${d.vin ? `${ltr(d.vin.value)} <small>(${esc(PROV[d.vin.provenance])})</small>` : 'הרכב לא דיווח'}</p>
<p>פרוטוקול: ${d.protocol ? ltr(d.protocol.value) : 'לא ידוע'}</p>
<h2>נתוני זמן אמת</h2><table><thead><tr><th>פרמטר</th><th>ערך</th><th>מקור</th><th>שירות</th></tr></thead><tbody>${live || '<tr><td colspan="4">לא נקראו נתונים</td></tr>'}</tbody></table>
<h2>קודי תקלה</h2>${group('שמורים', d.dtcs?.stored)}${group('ממתינים', d.dtcs?.pending)}${group('קבועים', d.dtcs?.permanent)}
<p><small>אבחון OBD-II בסיסי, קריאה בלבד. הדוח אינו כולל אבחון יצרן.</small></p>
</body></html>`;
}
