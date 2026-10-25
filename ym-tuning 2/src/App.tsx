import { useCallback, useEffect, useState } from 'react';
import { t } from './i18n';
import { useSession } from './state/session';
import { VciStatus } from './ui/primitives';
import { DashboardScreen } from './screens/DashboardScreen';
import { ConnectScreen } from './screens/ConnectScreen';
import { VehiclesScreen } from './screens/VehiclesScreen';
import { DiagnosticsScreen } from './screens/DiagnosticsScreen';
import { ControllerScreen } from './screens/ControllerScreen';
import { CalibrationScreen } from './screens/CalibrationScreen';
import { BackupsScreen } from './screens/BackupsScreen';
import { CompareScreen } from './screens/CompareScreen';
import { AssistantScreen } from './screens/AssistantScreen';
import { VciScreen } from './screens/VciScreen';
import { AuditScreen } from './screens/AuditScreen';
import { LabScreen } from './screens/LabScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export type Route =
  | 'dashboard' | 'connect' | 'vehicles' | 'diagnostics' | 'ecu' | 'tcu' | 'calibration'
  | 'backups' | 'compare' | 'assistant' | 'vci' | 'audit' | 'lab' | 'settings';

/** Optional context passed when navigating (e.g. which project to open). */
export interface NavParams { projectId?: string; controllerId?: string; text?: string }
export type Go = (r: Route, p?: NavParams) => void;

const GROUPS: { key: string; items: Route[] }[] = [
  { key: 'groupWork', items: ['dashboard', 'connect', 'vehicles', 'diagnostics'] },
  { key: 'groupCal', items: ['ecu', 'tcu', 'calibration', 'backups', 'compare', 'assistant', 'lab'] },
  { key: 'groupSystem', items: ['vci', 'audit', 'settings'] },
];

/** Screens that require a connection choice first (spec: "חיבור רכב" comes before them). */
const GATED: Route[] = ['diagnostics', 'ecu', 'tcu', 'calibration'];

export function App() {
  const [route, setRoute] = useState<Route>('connect');
  const [params, setParams] = useState<NavParams>({});
  const s = useSession();
  const go = useCallback<Go>((r, p) => {
    setParams(p ?? {});
    setRoute(r);
  }, []);

  useEffect(() => {
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [route]);

  const gated = GATED.includes(route) && s.mode === 'none';

  return (
    <div className={`shell${s.mode === 'demo' ? ' is-demo' : ''}`}>
      <aside className="side">
        <div className="side__brand">
          <span className="wordmark">
            <span className="wordmark__ym">YM</span>
            <span className="wordmark__tuning">TUNING</span>
          </span>
        </div>
        <nav aria-label={t('nav.mainLabel')} className="side__nav">
          {GROUPS.map((g) => (
            <div key={g.key} className="side__group">
              <div className="side__glabel">{t(`nav2.${g.key}`)}</div>
              {g.items.map((id) => (
                <button
                  key={id}
                  className={`navitem${route === id ? ' is-on' : ''}`}
                  aria-current={route === id ? 'page' : undefined}
                  onClick={() => go(id)}
                >
                  <span className="navitem__label">{t(`nav2.${id}`)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="side__foot">
          <div className="ro-badge">{t('ws.writeDisabled')}</div>
          <VciStatus phase={s.status.phase} demo={s.mode === 'demo'} />
        </div>
      </aside>

      <div className="stage">
        {s.mode === 'demo' && (
          <div className="demo-band" role="note">
            <span>{t('demo.banner')}</span>
            <button className="btn btn--ghost btn--sm" onClick={() => { s.exitDemo(); go('connect'); }}>
              {t('demo.exit')}
            </button>
          </div>
        )}
        {s.mode === 'files' && (
          <div className="files-band" role="note">
            <span>{t('mode.filesBanner')}</span>
            <button className="btn btn--ghost btn--sm" onClick={() => go('connect')}>{t('nav2.connect')}</button>
          </div>
        )}
        <main id="main" tabIndex={-1} className="main" key={route + (params.projectId ?? '') + (params.controllerId ?? '')}>
          {gated ? (
            <div className="screen">
              <div className="empty">
                <div className="empty__mark" aria-hidden="true" />
                <h2 className="empty__title">{t('gate.title')}</h2>
                <p className="empty__lead">{t('gate.lead')}</p>
                <div className="empty__actions">
                  <button className="btn btn--primary" onClick={() => go('connect')}>{t('gate.go')}</button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {route === 'dashboard' && <DashboardScreen go={go} />}
              {route === 'connect' && <ConnectScreen go={go} />}
              {route === 'vehicles' && <VehiclesScreen go={go} />}
              {route === 'diagnostics' && <DiagnosticsScreen go={go} />}
              {route === 'ecu' && <ControllerScreen kind="ecu" go={go} initialId={params.controllerId} />}
              {route === 'tcu' && <ControllerScreen kind="tcu" go={go} initialId={params.controllerId} />}
              {route === 'calibration' && <CalibrationScreen go={go} initialProjectId={params.projectId} />}
              {route === 'backups' && <BackupsScreen />}
              {route === 'compare' && <CompareScreen initialProjectId={params.projectId} />}
              {route === 'assistant' && <AssistantScreen go={go} initialProjectId={params.projectId} initialText={params.text} />}
              {route === 'vci' && <VciScreen />}
              {route === 'audit' && <AuditScreen />}
              {route === 'lab' && <LabScreen />}
              {route === 'settings' && <SettingsScreen />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
