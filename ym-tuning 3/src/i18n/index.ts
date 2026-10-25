import { he } from './he';
import { en } from './en';

/**
 * Localization layer. Hebrew is the default and the only shipped language.
 * `en` is a partial, optional dictionary for a future English UI; missing English keys fall
 * back to Hebrew, never to a raw key.
 */
export type Locale = 'he' | 'en';

const dictionaries: Record<Locale, unknown> = { he, en };
let current: Locale = 'he';

export function setLocale(l: Locale) {
  current = l;
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'he' ? 'rtl' : 'ltr';
}
export const getLocale = () => current;

/** Nested lookup that also accepts keys containing dots (e.g. "catalog.opt.ecu.stage1"). */
export function lookup(dict: unknown, key: string): unknown {
  if (!dict || typeof dict !== 'object') return undefined;
  const o = dict as Record<string, unknown>;
  if (key in o) return o[key];
  const parts = key.split('.');
  for (let i = parts.length - 1; i >= 1; i--) {
    const head = parts.slice(0, i).join('.');
    if (head in o) {
      const r = lookup(o[head], parts.slice(i).join('.'));
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let v = lookup(dictionaries[current], key);
  if (typeof v !== 'string') v = lookup(he, key);
  if (typeof v !== 'string') {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
    return '';
  }
  // Numbers are formatted and isolated LTR so signs and decimals survive inside Hebrew text.
  return vars ? v.replace(/\{(\w+)\}/g, (_, k) => (typeof vars[k] === 'number' ? ltrNum(vars[k] as number) : String(vars[k] ?? ''))) : v;
}

export function tList(key: string): string[] {
  const v = lookup(dictionaries[current], key) ?? lookup(he, key);
  return Array.isArray(v) ? (v as string[]) : [];
}

export function hasKey(key: string): boolean {
  const v = lookup(he, key);
  return typeof v === 'string' || Array.isArray(v);
}

/** Number formatting with Hebrew locale conventions. */
export function fmt(n: number, digits = 0): string {
  return new Intl.NumberFormat('he-IL', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

/** Number with up to `max` decimals (no forced zeros). */
export function fmtv(n: number, max = 3): string {
  return new Intl.NumberFormat('he-IL', { maximumFractionDigits: max }).format(n);
}

/** Number wrapped in Unicode LTR isolates, for interpolation into Hebrew sentences (keeps "-15" intact). */
export function ltrNum(n: number, max = 3): string {
  return `⁦${fmtv(n, max)}⁩`;
}
