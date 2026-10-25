import type { Route } from '../App';
import { t } from '../i18n';
import { useSession } from '../state/session';
import { MediaSlot } from '../ui/primitives';

export function HomeScreen({ go }: { go: (r: Route) => void }) {
  const s = useSession();
  const connected = s.mode !== 'none';
  const steps: { key: string; route: Route; done: boolean }[] = [
    { key: 'connect', route: 'connect', done: connected },
    { key: 'identify', route: 'vehicle', done: connected && !!s.identity },
    { key: 'diagnose', route: 'diagnostics', done: false },
    { key: 'lab', route: 'lab', done: false },
  ];
  const nextIdx = steps.findIndex((x) => !x.done);

  return (
    <div className="screen home">
      <section className="hero">
        <div className="hero__text">
          <div className="eyebrow">{t('home.eyebrow')}</div>
          <h1 className="hero__title">{t('home.title')}</h1>
          <p className="hero__lead">{t('home.lead')}</p>
          <div className="hero__ctas">
            <button className="btn btn--primary btn--lg" onClick={() => go('connect')}>
              {t('home.ctaConnect')}
            </button>
            <button
              className="btn btn--ghost btn--lg"
              onClick={() => {
                s.enterDemo();
                go('vehicle');
              }}
            >
              {t('home.ctaDemo')}
            </button>
          </div>
        </div>
        <MediaSlot label={t('home.mediaPlaceholder')} ratio="4 / 3" />
      </section>

      <section className="flow" aria-label={t('home.flowTitle')}>
        <h2 className="section-title">{t('home.flowTitle')}</h2>
        <ol className="flow__rail">
          {steps.map((st, i) => {
            const state = st.done ? 'done' : i === nextIdx ? 'next' : 'pending';
            return (
              <li key={st.key} className={`flow__step is-${state}`}>
                <button className="flow__btn" onClick={() => go(st.route)}>
                  <span className="flow__n num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="flow__name">{t(`home.flow.${st.key}`)}</span>
                  <span className="flow__state">
                    {state === 'done' ? t('home.flowDone') : state === 'next' ? t('home.flowNext') : t('home.flowPending')}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
