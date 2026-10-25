import { t } from '../i18n';
import { useSession } from '../state/session';
import { useResult } from '../state/useApi';
import { EmptyState } from '../ui/primitives';
import { DesktopOnly, fmtDate } from '../ui/workshop';

export function AuditScreen() {
  const s = useSession();
  const audit = useResult(s.api ? () => s.api!.auditList(300) : null, []);
  if (!s.api) return <div className="screen"><DesktopOnly /></div>;
  return (
    <div className="screen">
      <header className="screen__head ctl__head">
        <div>
          <h1>{t('audit2.title')}</h1>
          <p className="lead">{t('audit2.lead')}</p>
        </div>
        <button className="btn btn--sm" onClick={() => audit.reload()}>{t('common.refresh')}</button>
      </header>
      {audit.data && audit.data.length === 0 ? (
        <EmptyState title={t('audit2.empty')} />
      ) : (
        <section className="panel">
          <table className="table table--tight">
            <thead>
              <tr>
                <th scope="col">{t('audit2.time')}</th>
                <th scope="col">{t('audit2.action')}</th>
                <th scope="col">{t('audit2.outcome')}</th>
                <th scope="col">{t('audit2.entity')}</th>
              </tr>
            </thead>
            <tbody>
              {audit.data?.map((a) => (
                <tr key={a.id}>
                  <td className="small">{fmtDate(a.ts)}</td>
                  <td><bdi dir="ltr" className="mono small">{a.action}</bdi></td>
                  <td><span className={`outcome outcome--${a.outcome}`}>{t(`audit2.outcomes.${a.outcome}`)}</span></td>
                  <td className="small muted"><bdi dir="ltr" className="mono">{a.entityId ?? ''}</bdi></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
