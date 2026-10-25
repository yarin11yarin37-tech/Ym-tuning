import { useState } from 'react';
import type { IntegrityReport } from '../../shared/workshop';
import { t } from '../i18n';
import { useSession } from '../state/session';
import { run, useResult } from '../state/useApi';
import { useToast } from '../ui/toast';
import { EmptyState, Ltr, ProvenanceBadge } from '../ui/primitives';
import { DesktopOnly, KindTag, Sha, fileProv, fmtBytes, fmtDate } from '../ui/workshop';

export function BackupsScreen() {
  const s = useSession();
  const toast = useToast();
  const api = s.api;
  const originals = useResult(api ? () => api.listOriginals() : null, []);
  const controllers = useResult(api ? () => api.listControllers() : null, []);
  const [checks, setChecks] = useState<Record<string, IntegrityReport>>({});
  if (!api) return <div className="screen"><DesktopOnly /></div>;
  const onErr = (e: { code: string }) => toast(t(`errors.${e.code}.title`), 'error');

  return (
    <div className="screen">
      <header className="screen__head">
        <h1>{t('backups.title')}</h1>
        <p className="lead">{t('backups.lead')}</p>
      </header>
      {originals.data && originals.data.length === 0 ? (
        <EmptyState title={t('backups.none')} />
      ) : (
        <section className="panel">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('backups.file')}</th>
                <th scope="col">{t('backups.controller')}</th>
                <th scope="col">{t('review.sha')}</th>
                <th scope="col">{t('backups.size')}</th>
                <th scope="col">{t('backups.source')}</th>
                <th scope="col">{t('backups.verified')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {originals.data?.map((o) => {
                const c = controllers.data?.find((x) => x.id === o.controllerId);
                const chk = checks[o.id];
                return (
                  <tr key={o.id}>
                    <td><Ltr>{o.fileName}</Ltr><div className="muted small">{fmtDate(o.createdAt)}</div></td>
                    <td><KindTag kind={o.kind} /> {c?.label ?? (c?.hwId && <Ltr>{c.hwId}</Ltr>)}</td>
                    <td><Sha value={o.sha256} /></td>
                    <td className="table__num">{fmtBytes(o.size)}</td>
                    <td><ProvenanceBadge p={fileProv(o.source)} /></td>
                    <td>
                      {chk ? (chk.ok ? <span className="ok small">{t('ctl.verifiedOk')}</span> : <span className="bad small">{t('ctl.verifiedBad')}</span>) : <span className="muted small">{fmtDate(o.verifiedAt)}</span>}
                    </td>
                    <td className="table__actions">
                      <button className="btn btn--sm" onClick={async () => { const r = await run(api.verifyOriginal(o.id), onErr); if (r) setChecks((x) => ({ ...x, [o.id]: r })); }}>{t('ctl.verify')}</button>
                      <button className="btn btn--sm btn--quiet" onClick={() => run(api.exportOriginal(o.id), onErr)}>{t('ctl.export')}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
