import { useCallback, useEffect, useState } from 'react';
import { t } from './i18n';
import { useSession } from './state/session';
import { VciStatus } from './ui/primitives';
import { HomeScreen } from './screens/HomeScreen';
import { ConnectScreen } from './screens/ConnectScreen';
import { VehicleScreen } from './screens/VehicleScreen';
import { DiagnosticsScreen } from './screens/DiagnosticsScreen';
import { LabScreen } from './screens/LabScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export type Route = 'home' | 'connect' | 'vehicle' | 'diagnostics' | 'lab' | 'settings';

const NAV: { id: Route; code: string }[] = [
  { id: 'home', code: '00' },
  { id: 'connect', code: '01' },
  { id: 'vehicle', code: '02' },
  { id: 'diagnostics', code: '03' },
  { id: 'lab', code: '04' },
  { id: 'settings', code: '05' },
];

export function App() {
  const [route, setRoute] = useState<Route>('home');
  const s = useSession();
  const go = useCallback((r: Route) => setRoute(r), []);

  useEffect(() => {
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [route]);

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
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`navitem${route === n.id ? ' is-on' : ''}`}
              aria-current={route === n.id ? 'page' : undefined}
              onClick={() => go(n.id)}
            >
              <span className="navitem__code num" aria-hidden="true">{n.code}</span>
              <span className="navitem__label">{t(`nav.${n.id}`)}</span>
            </button>
          ))}
        </nav>
        <div className="side__foot">
          <VciStatus phase={s.status.phase} demo={s.mode === 'demo'} />
        </div>
      </aside>

      <div className="stage">
        {s.mode === 'demo' && (
          <div className="demo-band" role="note">
            <span>{t('demo.banner')}</span>
            <button className="btn btn--ghost btn--sm" onClick={() => { s.exitDemo(); go('home'); }}>
              {t('demo.exit')}
            </button>
          </div>
        )}
        <main id="main" tabIndex={-1} className="main" key={route}>
          {route === 'home' && <HomeScreen go={go} />}
          {route === 'connect' && <ConnectScreen go={go} />}
          {route === 'vehicle' && <VehicleScreen go={go} />}
          {route === 'diagnostics' && <DiagnosticsScreen go={go} />}
          {route === 'lab' && <LabScreen />}
          {route === 'settings' && <SettingsScreen />}
        </main>
      </div>
    </div>
  );
}
