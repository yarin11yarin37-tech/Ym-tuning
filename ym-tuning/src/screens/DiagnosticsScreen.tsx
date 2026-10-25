import { useCallback, useEffect, useRef, useState } from 'react';
import type { DtcReport, LiveReading, ObdErrorInfo, Sourced } from '../../shared/types';
import { LIVE_PIDS } from '../../shared/types';
import type { Route } from '../App';
import { t } from '../i18n';
import { useSession } from '../state/session';
import { EmptyState, ErrorCard, Ltr, ProvenanceBadge, ProvenanceLegend, SourcedNumber, Spinner } from '../ui/primitives';

export function DiagnosticsScreen({ go }: { go: (r: Route) => void }) {
  const s = useSession();
  const [live, setLive] = useState<LiveReading[] | null>(null);
  const [liveErr, setLiveErr] = useState<ObdErrorInfo | null>(null);
  const [lastRead, setLastRead] = useState<Date | null>(null);
  const [auto, setAuto] = useState(false);
  const [dtcs, setDtcs] = useState<DtcReport | null>(null);
  const [dtcErr, setDtcErr] = useState<ObdErrorInfo | null>(null);
  const [dtcLoading, setDtcLoading] = useState(false);
  const inFlight = useRef(false);
  const sRef = useRef(s);
  sRef.current = s;

  const active = s.mode !== 'none';

  const readLive = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await sRef.current.readLive(LIVE_PIDS);
      if (r.ok) {
        setLive(r.data);
        setLiveErr(null);
        setLastRead(new Date());
      } else {
        setLiveErr(r.error);
        setAuto(false);
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (active) void readLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => void readLive(), 1000);
    return () => clearInterval(id);
  }, [auto, readLive]);

  if (!active) {
    return (
      <div className="screen">
        <EmptyState title={t('vehicle.empty')} lead={t('vehicle.emptyLead')}>
          <button className="btn btn--primary" onClick={() => go('connect')}>{t('nav.connect')}</button>
        </EmptyState>
      </div>
    );
  }

  const readDtcs = async () => {
    setDtcLoading(true);
    const r = await s.readDtcs();
    setDtcLoading(false);
    if (r.ok) {
      setDtcs(r.data);
      setDtcErr(null);
    } else setDtcErr(r.error);
  };

  return (
    <div className="screen diag">
      <header className="screen__head">
        <h1>{t('diagnostics.title')}</h1>
        <p className="lead">{t('diagnostics.lead')}</p>
      </header>

      <div className="diag__grid">
        <section className="panel">
          <div className="panel__bar">
            <h2 className="panel__title">{t('diagnostics.live')}</h2>
            <label className="switch">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              <span className="switch__track" aria-hidden="true" />
              {t('diagnostics.autoRefresh')}
            </label>
            <button className="btn btn--sm" onClick={readLive}>{t('common.refresh')}</button>
          </div>
          {lastRead && (
            <p className="muted small">
              {t('diagnostics.lastRead', { time: lastRead.toLocaleTimeString('he-IL') })}
            </p>
          )}
          {liveErr && <ErrorCard error={liveErr} />}
          {!live && !liveErr && <Spinner label={t('common.loading')} />}
          {live && (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('diagnostics.parameter')}</th>
                  <th scope="col">{t('diagnostics.value')}</th>
                  <th scope="col">{t('diagnostics.source')}</th>
                </tr>
              </thead>
              <tbody>
                {live.map((r) => (
                  <tr key={r.pid} className={r.unavailable ? 'is-muted' : ''}>
                    <th scope="row">{t(`diagnostics.pid.${r.pid}`)}</th>
                    <td className="table__num">
                      {r.unavailable ? <span className="muted">{t('diagnostics.unsupported')}</span> : <SourcedNumber v={r.value} digits={r.pid === '42' || r.pid === '10' ? 2 : 0} />}
                    </td>
                    <td><Ltr>{`01 ${r.pid}`}</Ltr></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <div className="panel__bar">
            <h2 className="panel__title">{t('diagnostics.dtcTitle')}</h2>
            <button className="btn btn--sm btn--primary" onClick={readDtcs} disabled={dtcLoading}>
              {dtcLoading ? <Spinner /> : t('diagnostics.readDtcs')}
            </button>
          </div>
          {dtcErr && <ErrorCard error={dtcErr} />}
          {!dtcs && !dtcErr && <p className="muted">{t('diagnostics.notRead')}</p>}
          {dtcs && (
            <div className="dtc">
              <DtcGroup title={t('diagnostics.stored')} empty={t('diagnostics.noStored')} codes={dtcs.stored} />
              <DtcGroup title={t('diagnostics.pending')} empty={t('diagnostics.noPending')} codes={dtcs.pending} />
              <DtcGroup title={t('diagnostics.permanent')} empty={t('diagnostics.noPermanent')} codes={dtcs.permanent} />
            </div>
          )}
          <p className="note">{t('diagnostics.clearNote')}</p>
        </section>
      </div>
      <ProvenanceLegend only={['vehicle', 'simulated']} />
    </div>
  );
}

function DtcGroup({ title, empty, codes }: { title: string; empty: string; codes: Sourced<string>[] }) {
  return (
    <div className="dtc__group">
      <h3 className="panel__sub">{title}</h3>
      {codes.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul className="dtc__list">
          {codes.map((c) => (
            <li key={c.value} className="dtc__code">
              <Ltr>{c.value}</Ltr>
              <ProvenanceBadge p={c.provenance} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
