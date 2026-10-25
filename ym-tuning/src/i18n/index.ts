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

function lookup(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as any)[k] : undefined), dict);
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let v = lookup(dictionaries[current], key);
  if (typeof v !== 'string') v = lookup(he, key);
  if (typeof v !== 'string') {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
    return '';
  }
  return vars ? v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : v;
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
