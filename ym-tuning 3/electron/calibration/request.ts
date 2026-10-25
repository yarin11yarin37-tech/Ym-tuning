/**
 * Local, rule-based understanding of Hebrew calibration requests, and the plan builder.
 *
 * This is NOT an AI model and the UI says so. It extracts intent and explicit parameters.
 * It never invents calibration values: plan items that need numbers stay "needs-input" until
 * the calibrator supplies them, and numeric operations come only from numbers the user wrote.
 */
import type { ConditionSupport, ControllerKind, DefinitionFile, ExhaustSpec, ParsedRequest, Plan, PlanItem } from '../../shared/workshop';
import { OPTION_SPECS } from './catalog';

const MODE_WORDS: [RegExp, string][] = [
  [/^(sport|ספורט|ספורטיבי)/, 'sport'],
  [/^(normal|נורמל|רגיל)/, 'normal'],
  [/^(eco|אקו|חסכוני)/, 'eco'],
  [/^(comfort|קומפורט|נוחות)/, 'comfort'],
];
const normMode = (w: string) => MODE_WORDS.find(([re]) => re.test(w.replace(/^[-–]/, '')))?.[1];

const BLOCK_PATTERNS: [RegExp, string][] = [
  [/(ביטול|לבטל|הסרת|להסיר|להוריד|הורדת|לנטרל|נטרול|כיבוי|לכבות|בלי|ללא|delete|remove|off)\s*(את\s*)?(ה)?(קטליזטור|ממיר|decat|cat\b)/i, 'block.catalyst'],
  [/\bdecat\b|cat\s*(delete|off)/i, 'block.catalyst'],
  [/(ביטול|לבטל|הסרת|להסיר|לנטרל|נטרול|כיבוי|לכבות|בלי|ללא|delete|remove|off)\s*(את\s*)?(ה)?(מסנן חלקיקים|dpf|fap)/i, 'block.dpf'],
  [/\b(dpf|fap)\s*(delete|off)/i, 'block.dpf'],
  [/(ביטול|לבטל|לנטרל|נטרול|כיבוי|לכבות|בלי|ללא|delete|remove|off)\s*(את\s*)?(ה)?(egr|מערכת החזרת גזי פליטה)/i, 'block.egr'],
  [/\begr\s*(delete|off)/i, 'block.egr'],
  [/(ביטול|לבטל|לנטרל|נטרול|כיבוי|לכבות|בלי|ללא|delete|off)\s*(את\s*)?(ה)?(חיישן (ה)?חמצן|חיישני (ה)?חמצן|o2|למבדה אחורי)/i, 'block.o2'],
  [/(אימובילייזר|immo(bili[sz]er)?)/i, 'block.immobilizer'],
  [/(להבות|flames?|anti.?lag|אנטי.?לג)/i, 'block.flames'],
];

export function parseRequest(text: string, defaultKind: ControllerKind): ParsedRequest {
  const raw = String(text ?? '').slice(0, 4000);
  const t = raw.toLowerCase();
  const blockedReasons = Array.from(new Set(BLOCK_PATTERNS.filter(([re]) => re.test(raw)).map(([, k]) => k)));

  const tcuWords = /(גיר|תיבת (ה)?הילוכים|tcu|העברות|העברת הילוך|החלפות הילוכים|מצמד)/i.test(raw);
  const kind: ControllerKind = tcuWords ? 'tcu' : defaultKind;
  const base: ParsedRequest = { intent: 'unknown', kind, blockedReasons, missing: [] };

  if (/(השווה|השוואה|השוואת|compare|מה השתנה)/i.test(raw)) return { ...base, intent: 'compare' };

  if (/(pops|bangs|burble|פופס|פופים|באנגס|ברבל|צליל (ה)?פליטה|פיצוצים)/i.test(raw)) {
    const ex: ExhaustSpec = {};
    if (/(עדינ|עדין|רכים|רך|קלים|mild|soft|subtle)/i.test(raw)) ex.intensity = 'mild';
    else if (/(בינוני|medium)/i.test(raw)) ex.intensity = 'medium';
    else if (/(חזק|אגרסיב|aggressive|strong|loud)/i.test(raw)) ex.intensity = 'strong';
    for (const m of raw.matchAll(/רק\s+(?:ב|ב-)?\s*(?:מצב|במצב)?\s*([A-Za-z֐-׿-]+)/g)) {
      const mode = normMode(m[1].toLowerCase());
      if (mode) (ex.onlyModes ??= []).includes(mode) || ex.onlyModes!.push(mode);
    }
    for (const m of raw.matchAll(/(?:בלי|ללא|לא)\s+(?:הפעלה\s+)?(?:ב|ב-)?\s*(?:מצב|במצב)\s*([A-Za-z֐-׿-]+)/g)) {
      const mode = normMode(m[1].toLowerCase());
      if (mode) (ex.disableModes ??= []).includes(mode) || ex.disableModes!.push(mode);
    }
    if (/מזגן/.test(raw) && /(בלי|ללא|יושבת|להשבית|ישבית|כבוי|לא\s|כש(ה)?מזגן (פועל|דולק))/.test(raw)) ex.disableWithAc = true;
    if (/(מנוע|המנוע)\s+חם|(רק\s+)?אחרי (ש)?המנוע (מגיע|יגיע) לטמפרטורה/.test(raw)) ex.requireWarmEngine = true;
    const rpm = raw.match(/(\d{3,5})\s*(?:-|–|עד|ל-?)\s*(\d{3,5})\s*(?:סל"?ד|rpm)/i);
    if (rpm) {
      ex.rpmMin = Math.min(+rpm[1], +rpm[2]);
      ex.rpmMax = Math.max(+rpm[1], +rpm[2]);
    }
    const missing = ex.intensity ? [] : ['missing.intensity'];
    return { ...base, kind: 'ecu', intent: 'exhaust', exhaust: ex, missing };
  }

  const stage = raw.match(/(?:stage|שלב)\s*-?\s*([123])\b/i);
  if (stage && !tcuWords) {
    return {
      ...base,
      kind: 'ecu',
      intent: 'stage',
      stage: Number(stage[1]) as 1 | 2 | 3,
      keepProtections: /(שמיר[הת]|לשמור|לשמר|עם)\s+(על\s+)?(ה)?הגנות/.test(raw),
    };
  }

  const edits: NonNullable<ParsedRequest['edits']> = [];
  for (const m of raw.matchAll(/(הגדל|תגדיל|להגדיל|הוסף|תוסיף|להוסיף|הורד|תוריד|להוריד|הפחת|תפחית|להפחית|הקטן|תקטין|להקטין|קבע|תקבע|לקבוע)\s+(?:את\s+)?(.+?)\s+(ב|ל)-?\s*(-?\d+(?:\.\d+)?)\s*(%|אחוז)?/g)) {
    const verb = m[1];
    const value = Number(m[4]);
    const pct = !!m[5];
    const down = /(הורד|תוריד|להוריד|הפחת|תפחית|להפחית|הקטן|תקטין|להקטין)/.test(verb);
    const set = /(קבע|תקבע|לקבוע)/.test(verb) || (m[3] === 'ל' && !pct);
    const op: 'scale' | 'offset' | 'set' = set ? 'set' : pct ? 'scale' : 'offset';
    edits.push({ mapQuery: m[2].replace(/^ה/, '').trim(), op, value: op === 'set' ? value : down ? -Math.abs(value) : Math.abs(value) });
  }
  if (edits.length) return { ...base, intent: 'map-edit', edits };

  if (kind === 'tcu' && /(העברות|העברת|החלפות|החלפת|שיפט|shift)/i.test(raw)) {
    return {
      ...base,
      intent: 'tcu-shift',
      respectTorqueLimits: /(מגבלות|מגבלת)\s+(ה)?מומנט/.test(raw) && /(בלי לעבור|לא לעבור|לשמור|בתוך|מאומתות)/.test(raw),
    };
  }
  if (/(הסבר|מה זה|מה המשמעות)/.test(raw)) return { ...base, intent: 'explain' };
  return { ...base, missing: t.trim() ? ['missing.intent'] : ['missing.text'] };
}

const STAGE_RISKS = ['risk.drivetrain', 'risk.knock', 'risk.egt', 'risk.warranty', 'risk.inspection'];
const EXHAUST_RISKS = ['risk.catalyst', 'risk.egt', 'risk.exhaustValves', 'risk.fuel', 'risk.noiseLaw', 'risk.inspection'];
const TCU_RISKS = ['risk.clutchWear', 'risk.drivetrain', 'risk.tcuAdaptation'];

let seq = 0;
const itemId = () => `it${++seq}`;

function itemsForTags(tags: string[], def: DefinitionFile | undefined, src: 'imported' | 'simulated' | undefined): PlanItem[] {
  return tags.map((tag) => {
    const map = def?.maps.find((m) => m.tag === tag);
    return {
      id: itemId(),
      tag,
      mapId: map?.id,
      mapName: map?.name,
      descKey: `plan.tag.${tag.replace(/\./g, '_')}`,
      status: map ? 'needs-input' : 'unsupported',
      definitionSource: map ? src : undefined,
    };
  });
}

/** Compare names ignoring case, punctuation and the Hebrew definite article ("ה"). */
const normName = (x: string) =>
  x.toLowerCase().replace(/["'׳״.,]/g, '').split(/\s+/).filter(Boolean).map((w) => w.replace(/^ה(?=[\u0590-\u05FF]{2,})/, '')).join(' ');

function findMap(def: DefinitionFile | undefined, q: string) {
  if (!def) return undefined;
  const s = normName(q);
  if (!s) return undefined;
  return def.maps.find((m) => m.id.toLowerCase() === s || normName(m.name) === s) ??
    def.maps.find((m) => normName(m.name).includes(s) || s.includes(normName(m.name)));
}

export function buildPlan(p: ParsedRequest, def: DefinitionFile | undefined, defSource?: 'imported' | 'simulated'): Plan {
  const plan: Plan = { kind: p.kind, intent: p.intent, items: [], conditions: [], risks: [], unresolved: [], blocked: [...p.blockedReasons] };
  if (!def) plan.unresolved.push('unresolved.noDefinition');
  else plan.unresolved.push('unresolved.definitionUnverified');
  plan.unresolved.push('unresolved.checksum', 'unresolved.noWrite', 'unresolved.noRestore');

  if (p.intent === 'stage' && p.stage) {
    const spec = OPTION_SPECS.find((o) => o.id === `ecu.stage${p.stage}`)!;
    plan.items = itemsForTags(spec.requiredTags, def, defSource);
    if (p.keepProtections) {
      plan.items.push({ id: itemId(), tag: 'protect.thermal', descKey: 'plan.keepProtections', status: def?.maps.some((m) => m.tag.startsWith('protect.')) ? 'ready' : 'unsupported' });
    }
    plan.risks = STAGE_RISKS;
  }

  if (p.intent === 'exhaust') {
    plan.items = itemsForTags(['overrun.fuel_cut', 'overrun.ignition'], def, defSource);
    const conds = def?.conditions ?? [];
    const has = (tag: string) => conds.find((c) => c.tag === tag);
    const modeSignal = has('cond.drive_mode');
    const support: ConditionSupport[] = [];
    for (const m of p.exhaust?.onlyModes ?? []) {
      const ok = !!modeSignal?.values?.map((v) => v.toLowerCase()).includes(m);
      support.push({ key: `cond.onlyMode.${m}`, supported: ok, via: ok ? modeSignal!.name : undefined });
    }
    for (const m of p.exhaust?.disableModes ?? []) {
      const ok = !!modeSignal?.values?.map((v) => v.toLowerCase()).includes(m);
      support.push({ key: `cond.disableMode.${m}`, supported: ok, via: ok ? modeSignal!.name : undefined });
    }
    if (p.exhaust?.disableWithAc) support.push({ key: 'cond.ac', supported: !!has('cond.ac'), via: has('cond.ac')?.name });
    if (p.exhaust?.requireWarmEngine) support.push({ key: 'cond.coolant', supported: !!has('cond.coolant_temp'), via: has('cond.coolant_temp')?.name });
    if (p.exhaust?.rpmMin !== undefined) {
      const m = def?.maps.find((x) => x.tag === 'overrun.ignition');
      const ok = !!m && [m.xAxis, m.yAxis].some((a) => a && /rpm|סל/i.test(a.unit));
      support.push({ key: 'cond.rpmWindow', supported: ok, via: ok ? m!.name : undefined });
    }
    plan.conditions = support;
    plan.risks = EXHAUST_RISKS;
    plan.unresolved.push('unresolved.noAutoIgnitionFuel');
  }

  if (p.intent === 'tcu-shift') {
    plan.items = itemsForTags(['shift.time', 'shift.torque_reduction'], def, defSource);
    if (p.respectTorqueLimits) {
      const lim = def?.maps.find((m) => m.tag === 'tcu.torque_limit');
      plan.items.push({ id: itemId(), tag: 'tcu.torque_limit', mapId: lim?.id, mapName: lim?.name, descKey: 'plan.lockTorqueLimit', status: lim ? 'ready' : 'unsupported' });
    }
    plan.risks = TCU_RISKS;
  }

  if (p.intent === 'map-edit') {
    for (const e of p.edits ?? []) {
      const m = findMap(def, e.mapQuery);
      const wrongKind = def && def.controller.kind !== p.kind;
      plan.items.push({
        id: itemId(),
        tag: m?.tag ?? 'unknown',
        mapId: m?.id,
        mapName: m?.name ?? e.mapQuery,
        descKey: 'plan.mapEdit',
        operation: { type: e.op, value: e.value },
        status: m && !wrongKind ? 'ready' : 'unsupported',
        definitionSource: m ? defSource : undefined,
      });
    }
    plan.risks = p.kind === 'tcu' ? TCU_RISKS : STAGE_RISKS;
  }

  if (plan.blocked.length) plan.items = plan.items.map((i) => ({ ...i, status: 'unsupported' as const }));
  return plan;
}
