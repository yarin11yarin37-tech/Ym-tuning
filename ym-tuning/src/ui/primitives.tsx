import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { ConnectionPhase, ObdErrorInfo, Provenance, Sourced } from '../../shared/types';
import { fmt, t } from '../i18n';

/** Left-to-right island for VINs, DTCs, hex, IPs, paths and protocol names. */
export function Ltr({ children, mono = true }: { children: ReactNode; mono?: boolean }) {
  return (
    <bdi dir="ltr" className={mono ? 'ltr mono' : 'ltr'}>
      {children}
    </bdi>
  );
}

const PROV_GLYPH: Record<Provenance, string> = {
  measured: '●',
  vehicle: '◆',
  user: '▲',
  estimated: '◇',
  simulated: '◌',
};

export function ProvenanceBadge({ p, compact = false }: { p: Provenance; compact?: boolean }) {
  return (
    <span className={`prov prov--${p}`} title={t(`provenance.${p}Long`)} aria-label={t(`provenance.${p}Long`)}>
      <span aria-hidden="true" className="prov__glyph">{PROV_GLYPH[p]}</span>
      {!compact && <span className="prov__text">{t(`provenance.${p}`)}</span>}
    </span>
  );
}

export function ProvenanceLegend({ only }: { only?: Provenance[] }) {
  const all: Provenance[] = only ?? ['measured', 'vehicle', 'user', 'estimated', 'simulated'];
  return (
    <div className="prov-legend" aria-label={t('provenance.legend')}>
      <span className="prov-legend__title">{t('provenance.legend')}</span>
      {all.map((p) => (
        <span key={p} className="prov-legend__item">
          <ProvenanceBadge p={p} />
          <span className="prov-legend__desc">{t(`provenance.${p}Long`)}</span>
        </span>
      ))}
    </div>
  );
}

const UNIT_KEY: Record<string, string> = {
  rpm: 'units.rpm', 'km/h': 'units.kmh', Nm: 'units.nm', kW: 'units.kw', hp: 'units.hp', s: 'units.sec',
  '°C': 'units.celsius', kPa: 'units.kpa', 'g/s': 'units.gps', V: 'units.volt', '%': 'units.percent',
};
export const unitLabel = (u?: string) => (u ? (UNIT_KEY[u] ? t(UNIT_KEY[u]) : u) : '');

/** A number with its unit and provenance badge — the only way sourced numbers are rendered. */
export function SourcedNumber({ v, digits = 0, compact }: { v: Sourced<number> | null; digits?: number; compact?: boolean }) {
  if (!v) return <span className="muted">{t('common.notAvailable')}</span>;
  return (
    <span className={`sourced sourced--${v.provenance}`}>
      <span className="num">{fmt(v.value, digits)}</span>
      {v.unit && <span className="unit">{unitLabel(v.unit)}</span>}
      <ProvenanceBadge p={v.provenance} compact={compact} />
    </span>
  );
}

export function SourcedText({ v }: { v: Sourced<string> | null }) {
  if (!v) return <span className="muted">{t('common.notReported')}</span>;
  return (
    <span className={`sourced sourced--${v.provenance}`}>
      <Ltr>{v.value}</Ltr>
      <ProvenanceBadge p={v.provenance} />
    </span>
  );
}

export interface SegOption<T extends string> { value: T; label: string; disabled?: boolean }

/** Radio-group segmented control. Arrow keys follow visual order in RTL. */
export function Segmented<T extends string>({
  options, value, onChange, label,
}: { options: SegOption<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const rtl = document.documentElement.dir === 'rtl';
    let d = 0;
    if (e.key === 'ArrowLeft') d = rtl ? 1 : -1;
    if (e.key === 'ArrowRight') d = rtl ? -1 : 1;
    if (!d) return;
    e.preventDefault();
    const enabled = options.map((o, idx) => (!o.disabled ? idx : -1)).filter((x) => x >= 0);
    const pos = enabled.indexOf(i);
    const next = enabled[(pos + d + enabled.length) % enabled.length];
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          disabled={o.disabled}
          className={`seg__btn${o.value === value ? ' is-on' : ''}`}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, lead, children }: { title: string; lead?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__mark" aria-hidden="true" />
      <h2 className="empty__title">{title}</h2>
      {lead && <p className="empty__lead">{lead}</p>}
      {children && <div className="empty__actions">{children}</div>}
    </div>
  );
}

export function ErrorCard({ error, children }: { error: ObdErrorInfo; children?: ReactNode }) {
  return (
    <div className="errcard" role="alert">
      <div className="errcard__title">{t(`errors.${error.code}.title`)}</div>
      <p className="errcard__hint">{t(`errors.${error.code}.hint`)}</p>
      {error.detail && (
        <details className="errcard__details">
          <summary>{t('common.details')}</summary>
          <Ltr>{`${error.code} — ${error.detail}`}</Ltr>
        </details>
      )}
      {children && <div className="errcard__actions">{children}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner__ring" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function VciStatus({ phase, demo }: { phase: ConnectionPhase; demo: boolean }) {
  const state = demo ? 'demo' : phase;
  return (
    <div className={`vci vci--${state}`} aria-label={t('vci.statusLabel')} role="status">
      <span className="vci__led" aria-hidden="true" />
      <span className="vci__name">{t('brand.vci')}</span>
      <span className="vci__state">{t(`vci.${state}`)}</span>
    </div>
  );
}

export function MediaSlot({ label, ratio = '16 / 9' }: { label: string; ratio?: string }) {
  return (
    <div className="media-slot" style={{ aspectRatio: ratio }}>
      <span className="media-slot__label">{label}</span>
    </div>
  );
}
