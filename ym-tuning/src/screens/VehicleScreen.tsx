import { useEffect } from 'react';
import type { Route } from '../App';
import { t } from '../i18n';
import { useSession } from '../state/session';
import { EmptyState, ErrorCard, Ltr, MediaSlot, ProvenanceLegend, SourcedText, Spinner } from '../ui/primitives';

export function VehicleScreen({ go }: { go: (r: Route) => void }) {
  const s = useSession();
  const active = s.mode !== 'none';

  useEffect(() => {
    if (active && !s.identity && !s.identityLoading) void s.loadIdentity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, s.mode]);

  if (!active) {
    return (
      <div className="screen">
        <EmptyState title={t('vehicle.empty')} lead={t('vehicle.emptyLead')}>
          <button className="btn btn--primary" onClick={() => go('connect')}>{t('nav.connect')}</button>
          <button className="btn btn--ghost" onClick={() => { s.enterDemo(); }}>{t('home.ctaDemo')}</button>
        </EmptyState>
      </div>
    );
  }

  const id = s.identity;
  return (
    <div className="screen vehicle">
      <header className="screen__head">
        <h1>{t('vehicle.title')}</h1>
        <p className="lead">{t('vehicle.lead')}</p>
      </header>

      {s.identityLoading && <Spinner label={t('vehicle.reading')} />}
      {s.identityError && (
        <ErrorCard error={s.identityError}>
          <button className="btn" onClick={() => s.loadIdentity()}>{t('common.retry')}</button>
        </ErrorCard>
      )}

      {id && (
        <div className="vehicle__grid reveal">
          <section className="panel idcard">
            <div className="idcard__vin">
              <span className="idcard__label">{t('vehicle.vin')}</span>
              <span className="idcard__vinval">
                {id.vin ? <SourcedText v={id.vin} /> : <span className="muted">{t('common.notReported')}</span>}
              </span>
            </div>
            <dl className="kv kv--wide">
              <dt>{t('vehicle.ecuName')}</dt>
              <dd><SourcedText v={id.ecuName} /></dd>
              <dt>{t('vehicle.calibration')}</dt>
              <dd>{id.calibrationIds.length ? id.calibrationIds.map((c) => <SourcedText key={c.value} v={c} />) : <span className="muted">{t('common.notReported')}</span>}</dd>
              <dt>{t('vehicle.protocol')}</dt>
              <dd><SourcedText v={id.protocol} /></dd>
              <dt>{t('vehicle.adapter')}</dt>
              <dd><SourcedText v={id.adapterId} /></dd>
              <dt>{t('vehicle.pids')}</dt>
              <dd>
                <span className="muted">{t('vehicle.pidsCount', { n: id.supportedPids.length })}</span>
                <span className="chips">
                  {id.supportedPids.map((p) => (
                    <span key={p} className="chip"><Ltr>{p}</Ltr></span>
                  ))}
                </span>
              </dd>
            </dl>
            <div className="actions">
              <button className="btn btn--primary" onClick={() => go('diagnostics')}>{t('vehicle.toDiagnostics')}</button>
              <button className="btn" onClick={() => go('lab')}>{t('vehicle.toLab')}</button>
            </div>
          </section>

          <div className="vehicle__side">
            <MediaSlot label={t('vehicle.photoPlaceholder')} ratio="16 / 10" />
            <section className="panel">
              <h2 className="panel__title">{t('vehicle.capabilities')}</h2>
              <ul className="caps">
                <li className="caps__item is-on">
                  <div className="caps__top"><span>{t('vehicle.cap.basic')}</span><span className="tag tag--ok">{t('vehicle.cap.available')}</span></div>
                  <p className="muted small">{t('vehicle.cap.basicDesc')}</p>
                </li>
                <li className="caps__item">
                  <div className="caps__top"><span>{t('vehicle.cap.oem')}</span><span className="tag">{t('vehicle.cap.unavailable')}</span></div>
                  <p className="muted small">{t('vehicle.cap.oemDesc')}</p>
                </li>
                <li className="caps__item">
                  <div className="caps__top"><span>{t('vehicle.cap.flash')}</span><span className="tag">{t('vehicle.cap.unavailable')}</span></div>
                  <p className="muted small">{t('vehicle.cap.flashDesc')}</p>
                </li>
              </ul>
            </section>
          </div>
        </div>
      )}
      <ProvenanceLegend only={['vehicle', 'simulated']} />
    </div>
  );
}
