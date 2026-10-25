import type { ReactNode } from 'react';
import type { CheckResult, ControllerKind, FileSource, IdProvenance, Plan, RequestStatus } from '../../shared/workshop';
import type { Provenance } from '../../shared/types';
import { fmt, t } from '../i18n';
import { Ltr, ProvenanceBadge } from './primitives';

export const fileProv = (s: FileSource): Provenance => (s === 'read' ? 'vehicle' : s === 'imported' ? 'imported' : 'simulated');
export const idProv = (s: IdProvenance): Provenance => s;

export function Sha({ value, short = true }: { value: string; short?: boolean }) {
  return (
    <span className="sha" title={value}>
      <Ltr>{short ? `${value.slice(0, 12)}…${value.slice(-6)}` : value}</Ltr>
    </span>
  );
}

export function KindTag({ kind }: { kind: ControllerKind }) {
  return <span className={`kind kind--${kind}`}><Ltr mono={false}>{kind.toUpperCase()}</Ltr></span>;
}

const STATUS_TONE: Record<RequestStatus, string> = {
  request: 'muted', plan: 'info', approved: 'info', applied: 'warn', verified: 'ok', written: 'ok', rejected: 'bad',
};

export function StatusChip({ status }: { status: RequestStatus }) {
  return <span className={`chipst chipst--${STATUS_TONE[status]}`}>{t(`reqStatus.${status}`)}</span>;
}

/** The request lifecycle, with the physical write step shown as unavailable. */
export function Lifecycle({ status }: { status: RequestStatus }) {
  const steps: RequestStatus[] = ['request', 'plan', 'approved', 'applied', 'verified', 'written'];
  const idx = status === 'rejected' ? -1 : steps.indexOf(status);
  return (
    <ol className="lifecycle" aria-label={t(`reqStatus.${status}`)}>
      {steps.map((s, i) => (
        <li key={s} className={`lifecycle__s${i <= idx ? ' is-done' : ''}${s === 'written' ? ' is-disabled' : ''}`}>
          {t(`reqStatus.${s}`)}
        </li>
      ))}
    </ol>
  );
}

export function CheckList({ checks }: { checks: CheckResult[] }) {
  return (
    <ul className="checklist">
      {checks.map((c) => (
        <li key={c.id} className={`checklist__i is-${c.status}`}>
          <span className="checklist__dot" aria-hidden="true" />
          <span className="checklist__name">{t(`check.${c.id}`)}</span>
          <span className="checklist__st">{t(`check.${c.status}`)}</span>
        </li>
      ))}
    </ul>
  );
}

export function PlanView({ plan }: { plan: Plan }) {
  return (
    <div className="planview">
      {plan.blocked.length > 0 && (
        <div className="planview__blocked" role="alert">
          <strong>{t('plan.blockedTitle')}</strong>
          <ul>{plan.blocked.map((b) => <li key={b}>{t(`blockedReason.${b}`)}</li>)}</ul>
        </div>
      )}
      {plan.items.length > 0 && (
        <table className="table table--tight">
          <tbody>
            {plan.items.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.mapName ?? (t(`plan.tag.${i.tag.replace(/\./g, '_')}`) || i.tag)}
                  {['plan.keepProtections', 'plan.lockTorqueLimit', 'plan.mapEdit'].includes(i.descKey) && <div className="muted small">{t(i.descKey)}</div>}
                </td>
                <td className="small">{i.operation ? t(`plan.op.${i.operation.type}`, { v: fmt(i.operation.value, 2) }) : ''}</td>
                <td><span className={`itemst itemst--${i.status}`}>{t(`plan.status.${i.status}`)}</span></td>
                <td>{i.definitionSource && <ProvenanceBadge p={i.definitionSource === 'simulated' ? 'simulated' : 'imported'} compact />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {plan.conditions.length > 0 && (
        <div>
          <div className="panel__sub">{t('plan.conditions')}</div>
          <ul className="condlist">
            {plan.conditions.map((c) => (
              <li key={c.key} className={c.supported ? 'is-ok' : 'is-no'}>
                <span>{t(`plan.${c.key}`)}</span>
                <span className="small">{c.supported ? t('plan.supported') : t('plan.notSupported')}</span>
                {c.via && <span className="muted small">{t('plan.via', { name: c.via })}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.risks.length > 0 && (
        <div>
          <div className="panel__sub">{t('review.risks')}</div>
          <ul className="bullets small">{plan.risks.map((r) => <li key={r}>{t(r)}</li>)}</ul>
        </div>
      )}
      {plan.unresolved.length > 0 && (
        <div>
          <div className="panel__sub">{t('plan.unresolvedTitle')}</div>
          <ul className="bullets small">{plan.unresolved.map((r) => <li key={r}>{t(r)}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function DesktopOnly() {
  return (
    <div className="empty">
      <div className="empty__mark" aria-hidden="true" />
      <h2 className="empty__title">{t('desktopOnly.title')}</h2>
      <p className="empty__lead">{t('desktopOnly.lead')}</p>
    </div>
  );
}

export const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const fmtBytes = (n: number) => t('backups.bytes', { n: fmt(n) });
