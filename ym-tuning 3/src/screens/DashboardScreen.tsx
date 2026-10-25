import type { Go } from '../App';
import { fmt, t } from '../i18n';
import { useSession } from '../state/session';
import { useResult } from '../state/useApi';
import { MediaSlot, VciStatus } from '../ui/primitives';
import { DesktopOnly, fmtDate } from '../ui/workshop';

export function DashboardScreen({ go }: { go: Go }) {
  const s = useSession();
  const api = s.api;
  const vehicles = useResult(api ? () => api.listVehicles() : null, []);
  const customers = useResult(api ? () => api.listCustomers() : null, []);
  const projects = useResult(api ? () => api.listProjects() : null, []);
  const originals = useResult(api ? () => api.listOriginals() : null, []);
  const audit = useResult(api ? () => api.auditList(8) : null, []);

  const stat = (label: string, n: number | undefined, onClick: () => void) => (
    <button className="stat" onClick={onClick}>
      <span className="stat__n num">{n === undefined ? '—' : fmt(n)}</span>
      <span className="stat__l">{label}</span>
    </button>
  );

  return (
    <div className="screen">
      <header className="screen__head dash__head">
        <div>
          <h1>{t('ws.dashTitle')}</h1>
          <p className="lead">{t('ws.dashLead')}</p>
        </div>
        <VciStatus phase={s.status.phase} demo={s.mode === 'demo'} />
      </header>

      {!api ? (
        <DesktopOnly />
      ) : (
        <>
          <div className="stats">
            {stat(t('ws.vehicles'), vehicles.data?.length, () => go('vehicles'))}
            {stat(t('ws.customers'), customers.data?.length, () => go('vehicles'))}
            {stat(t('ws.ecuProjects'), projects.data?.filter((p) => p.kind === 'ecu').length, () => go('ecu'))}
            {stat(t('ws.tcuProjects'), projects.data?.filter((p) => p.kind === 'tcu').length, () => go('tcu'))}
            {stat(t('ws.originals'), originals.data?.length, () => go('backups'))}
          </div>
          <div className="grid2">
            <section className="panel">
              <div className="panel__bar">
                <h2 className="panel__title">{t('ws.recent')}</h2>
                <button className="btn btn--sm btn--quiet" onClick={() => go('audit')}>{t('nav2.audit')}</button>
              </div>
              {audit.data?.length ? (
                <ul className="feed">
                  {audit.data.map((a) => (
                    <li key={a.id} className={`feed__i is-${a.outcome}`}>
                      <span className="feed__dot" aria-hidden="true" />
                      <bdi dir="ltr" className="mono small">{a.action}</bdi>
                      <span className="muted small">{t(`audit2.outcomes.${a.outcome}`)}</span>
                      <span className="muted small feed__t">{fmtDate(a.ts)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{t('ws.noData')}</p>
              )}
            </section>
            <section className="panel">
              <h2 className="panel__title">{t('ws.quick')}</h2>
              <div className="quick">
                <button className="btn btn--primary" onClick={() => go('connect')}>{t('nav2.connect')}</button>
                <button className="btn" onClick={() => go('vehicles')}>{t('veh.newVehicle')}</button>
                <button className="btn" onClick={() => go('assistant')}>{t('nav2.assistant')}</button>
                <button className="btn" onClick={() => go('backups')}>{t('nav2.backups')}</button>
              </div>
              <MediaSlot label={t('home.mediaPlaceholder')} ratio="21 / 9" />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
