import { useState } from 'react';
import { t } from '../i18n';
import { run, useResult } from '../state/useApi';
import { useSession } from '../state/session';
import { useToast } from '../ui/toast';
import { Ltr } from '../ui/primitives';

const VERSION = '0.1.0';

export function SettingsScreen() {
  const s = useSession();
  const toast = useToast();
  const status = useResult(s.api ? () => s.api!.assistantStatus() : null, []);
  const info = useResult(s.api ? () => s.api!.wsInfo() : null, []);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('claude-sonnet-5-5');
  const onErr = (e: { code: string }) => toast(t(`errors.${e.code}.title`), 'error');
  return (
    <div className="screen settings">
      <header className="screen__head">
        <h1>{t('settings.title')}</h1>
      </header>
      <div className="settings__grid">
        <section className="panel">
          <h2 className="panel__title">{t('settings.language')}</h2>
          <div className="langs" role="radiogroup" aria-label={t('settings.language')}>
            <label className="langs__item is-on">
              <input type="radio" name="lang" checked readOnly />
              {t('settings.hebrew')}
            </label>
            <label className="langs__item is-disabled">
              <input type="radio" name="lang" disabled />
              {t('settings.english')} <span className="tag">{t('settings.comingLater')}</span>
            </label>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel__title">{t('settings.readOnly')}</h2>
          <p className="small">{t('settings.readOnlyText')}</p>
        </section>

        <section className="panel">
          <h2 className="panel__title">{t('settings.profiles')}</h2>
          {!s.api || s.profiles.length === 0 ? (
            <p className="muted">{t('settings.noProfiles')}</p>
          ) : (
            <ul className="plist">
              {s.profiles.map((p) => (
                <li key={p.id} className="plist__item">
                  <span className="plist__main">
                    <span className="plist__name">{p.name}</span>
                    <Ltr>{`${p.host}:${p.port}`}</Ltr>
                  </span>
                  <button
                    className="btn btn--sm btn--quiet"
                    onClick={async () => {
                      await s.api!.deleteProfile(p.id).catch(() => null);
                      await s.refreshProfiles();
                      toast(t('connect.profile.deletedToast'));
                    }}
                  >
                    {t('common.delete')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {s.api && !s.isWeb && (
          <section className="panel">
            <h2 className="panel__title">{t('aiSettings.title')}</h2>
            <p className="small muted">{t('aiSettings.lead')}</p>
            <p><span className={`tag ${status.data?.aiConfigured ? 'tag--ok' : ''}`}>{status.data?.aiConfigured ? t('aiSettings.connected') : t('aiSettings.notConnected')}</span></p>
            <label className="field">
              <span className="field__label">{t('aiSettings.key')}</span>
              <input type="password" dir="ltr" className="mono" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">{t('aiSettings.model')}</span>
              <input dir="ltr" className="mono" value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <div className="actions">
              <button className="btn btn--primary" disabled={key.length < 20} onClick={async () => { if (await run(s.api!.assistantConfigure(key, model), onErr)) { setKey(''); void status.reload(); } }}>{t('aiSettings.save')}</button>
              {status.data?.aiConfigured && <button className="btn btn--quiet" onClick={async () => { await run(s.api!.assistantConfigure(null), onErr); void status.reload(); }}>{t('aiSettings.remove')}</button>}
            </div>
          </section>
        )}

        {info.data && (
          <section className="panel">
            <h2 className="panel__title">{t('dataSettings.title')}</h2>
            <p className="small">{t('dataSettings.schema', { v: info.data.schemaVersion })}</p>
          </section>
        )}

        <section className="panel">
          <h2 className="panel__title">{t('settings.hardware')}</h2>
          <p className="small">{t('settings.hardwareText')}</p>
        </section>

        <section className="panel">
          <h2 className="panel__title">{t('settings.about')}</h2>
          <p className="wordmark wordmark--sm">
            <span className="wordmark__ym">YM</span>
            <span className="wordmark__tuning">TUNING</span>
          </p>
          <p className="muted small">{t('settings.version', { v: VERSION })}</p>
          <p className="small">{t('brand.rights')}</p>
        </section>
      </div>
    </div>
  );
}
