import { useCallback, useEffect, useRef, useState } from 'react';
import type { DtcReport, LiveReading, ObdErrorInfo, Sourced } from '../../shared/types';
import { LIVE_PIDS } from '../../shared/types';
import { describeDtc, dtcKind } from '../../shared/dtc';
import type { Go } from '../App';
import { t } from '../i18n';
import { useSession } from '../state/session';
import { run, useResult } from '../state/useApi';
import { useToast } from '../ui/toast';
import { EmptyState, ErrorCard, Ltr, MediaSlot, ProvenanceBadge, ProvenanceLegend, SourcedNumber, SourcedText, Spinner } from '../ui/primitives';
import { fmtDate } from '../ui/workshop';

export function DiagnosticsScreen({ go }: { go: Go }) {
  const s = useSession();
  const toast = useToast();
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
  const sessions = useResult(s.api ? () => s.api!.listSessions() : null, []);

  const active = s.mode === 'live' || s.mode === 'demo';

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
    if (!active) return;
    if (!s.identity && !s.identityLoading) void s.loadIdentity();
    void readLive();
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
          <button className="btn btn--primary" onClick={() => go('connect')}>{t('nav2.connect')}</button>
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

  const saveSession = async () => {
    if (!s.api) return;
    const title = `${s.identity?.vin?.value ?? t('vehicle.title')} · ${new Date().toLocaleDateString('he-IL')}`;
    const r = await run(
      s.api.saveSession({ mode: s.mode === 'demo' ? 'demo' : 'live', title, data: { vin: s.identity?.vin, protocol: s.identity?.protocol, live, dtcs } }),
      (e) => toast(t(`errors.${e.code}.title`), 'error'),
    );
    if (r) {
      toast(t('diag2.sessionSaved'), 'success');
      void sessions.reload();
    }
  };

  const id = s.identity;
  return (
    <div className="screen diag">
      <header className="screen__head">
        <h1>{t('diagnostics.title')}</h1>
        <p className="lead">{t('diagnostics.lead')}</p>
        <p className="muted small">{t('diag2.scope')}</p>
      </header>

      {s.identityLoading && <Spinner label={t('vehicle.reading')} />}
      {s.identityError && <ErrorCard error={s.identityError}><button className="btn" onClick={() => s.loadIdentity()}>{t('common.retry')}</button></ErrorCard>}
      {id && (
        <div className="vehicle__grid reveal">
          <section className="panel idcard">
            <div className="idcard__vin">
              <span className="idcard__label">{t('vehicle.vin')}</span>
              <span className="idcard__vinval">{id.vin ? <SourcedText v={id.vin} /> : <span className="muted">{t('common.notReported')}</span>}</span>
            </div>
            <dl className="kv kv--wide">
              <dt>{t('vehicle.ecuName')}</dt><dd><SourcedText v={id.ecuName} /></dd>
              <dt>{t('vehicle.calibration')}</dt>
              <dd>{id.calibrationIds.length ? id.calibrationIds.map((c) => <SourcedText key={c.value} v={c} />) : <span className="muted">{t('common.notReported')}</span>}</dd>
              <dt>{t('vehicle.protocol')}</dt><dd><SourcedText v={id.protocol} /></dd>
              <dt>{t('vehicle.adapter')}</dt><dd><SourcedText v={id.adapterId} /></dd>
              <dt>{t('vehicle.pids')}</dt>
              <dd>
                <span className="muted">{t('vehicle.pidsCount', { n: id.supportedPids.length })}</span>
                <span className="chips">{id.supportedPids.map((p) => <span key={p} className="chip"><Ltr>{p}</Ltr></span>)}</span>
              </dd>
            </dl>
          </section>
          <div className="vehicle__side">
            <MediaSlot label={t('vehicle.photoPlaceholder')} ratio="16 / 9" />
            <section className="panel">
              <h2 className="panel__title">{t('vehicle.capabilities')}</h2>
              <ul className="caps">
                <li className="caps__item is-on"><div className="caps__top"><span>{t('vehicle.cap.basic')}</span><span className="tag tag--ok">{t('vehicle.cap.available')}</span></div><p className="muted small">{t('vehicle.cap.basicDesc')}</p></li>
                <li className="caps__item"><div className="caps__top"><span>{t('vehicle.cap.oem')}</span><span className="tag">{t('vehicle.cap.unavailable')}</span></div><p className="muted small">{t('vehicle.cap.oemDesc')}</p></li>
                <li className="caps__item"><div className="caps__top"><span>{t('vehicle.cap.flash')}</span><span className="tag">{t('vehicle.cap.unavailable')}</span></div><p className="muted small">{t('vehicle.cap.flashDesc')}</p></li>
              </ul>
            </section>
          </div>
        </div>
      )}

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
          {lastRead && <p className="muted small">{t('diagnostics.lastRead', { time: lastRead.toLocaleTimeString('he-IL') })}</p>}
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

      {s.api && (
        <section className="panel">
          <div className="panel__bar">
            <h2 className="panel__title">{t('diag2.sessions')}</h2>
            <button className="btn btn--sm btn--primary" onClick={saveSession}>{t('diag2.saveSession')}</button>
          </div>
          {!sessions.data?.length ? (
            <p className="muted small">{t('diag2.noSessions')}</p>
          ) : (
            <ul className="plist">
              {sessions.data.slice(0, 10).map((x) => (
                <li key={x.id} className="plist__item">
                  <span className="plist__main">
                    <span className="plist__name">{x.title}</span>
                    <span className="muted small">{fmtDate(x.createdAt)}</span>
                    {x.mode === 'demo' && <ProvenanceBadge p="simulated" compact />}
                  </span>
                  <button className="btn btn--sm" onClick={async () => {
                    const ok = await run(s.api!.exportReport(x.id), (e) => toast(t(`errors.${e.code}.title`), 'error'));
                    if (ok) toast(t('diag2.reportSaved'), 'success');
                  }}>{t('diag2.exportReport')}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
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
        <ul className="dtc__rows">
          {codes.map((c) => (
            <li key={c.value} className="dtc__row">
              <span className="dtc__code"><Ltr>{c.value}</Ltr></span>
              <span className="dtc__desc">
                {describeDtc(c.value) ?? <span className="muted">{t('diag2.noDescription')}</span>}
                <span className="muted small"> · {t(dtcKind(c.value) === 'generic' ? 'diag2.generic' : 'diag2.manufacturer')}</span>
              </span>
              <ProvenanceBadge p={c.provenance} compact />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
