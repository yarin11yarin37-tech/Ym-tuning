import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { ConnectionProfile, NetworkAdvice, ProbeResult } from '../../shared/types';
import type { Go } from '../App';
import type { InternetCheck, DefaultRoute, UsbScan } from '../../shared/workshop';
import { CapabilityTable } from './VciScreen';
import { t } from '../i18n';
import { useSession } from '../state/session';
import { useToast } from '../ui/toast';
import { ErrorCard, Ltr, Spinner } from '../ui/primitives';

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const isLocal = (h: string) => {
  if (!IPV4.test(h)) return false;
  const [a, b] = h.split('.').map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
};

/** Common factory defaults seen on ELM327-compatible Wi-Fi adapters. Not guaranteed for any model. */
const PRESETS = [
  { host: '192.168.0.10', port: 35000 },
  { host: '192.168.1.10', port: 35000 },
];

const emptyForm = () => ({ id: '', name: '', host: '', port: '35000', connectTimeoutMs: '5000', commandTimeoutMs: '2500' });
type Form = ReturnType<typeof emptyForm>;

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function ConnectScreen({ go }: { go: Go }) {
  const s = useSession();
  const toast = useToast();
  const [form, setForm] = useState<Form>(emptyForm);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [advice, setAdvice] = useState<NetworkAdvice | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult[] | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const prevPhase = useRef(s.status.phase);
  const [category, setCategory] = useState<'wifi' | 'usb' | 'demo'>(s.api ? 'wifi' : 'demo');
  const [netBefore, setNetBefore] = useState<InternetCheck | null>(null);
  const [netAfter, setNetAfter] = useState<InternetCheck | null>(null);
  const [route, setRoute] = useState<DefaultRoute | null>(null);
  const [usb, setUsb] = useState<UsbScan | null>(null);
  const [usbBusy, setUsbBusy] = useState(false);

  const checkNet = async (which: 'before' | 'after') => {
    if (!s.api) return;
    const [i, r] = await Promise.all([s.api.internetCheck().catch(() => null), s.api.defaultRoute().catch(() => null)]);
    if (i?.ok) (which === 'before' ? setNetBefore : setNetAfter)(i.data);
    if (r?.ok) setRoute(r.data);
  };
  useEffect(() => {
    if (s.status.phase !== 'connected') void checkNet('before');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const scanUsb = async () => {
    if (!s.api) return;
    setUsbBusy(true);
    const r = await s.api.usbScan().catch(() => null);
    setUsbBusy(false);
    if (r?.ok) setUsb(r.data);
  };

  const phase = s.status.phase;
  const busy = phase === 'connecting' || phase === 'initializing';

  // Lock-on animation exactly once, on the transition into "connected".
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = phase;
    if (was !== 'connected' && phase === 'connected') {
      setCelebrate(true);
      void checkNet('after');
      if (s.status.protocol) {
        const timer = setTimeout(() => go('diagnostics'), prefersReducedMotion() ? 600 : 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [phase, s.status.protocol, go]);

  const upd = (k: keyof Form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function buildProfile(): ConnectionProfile | null {
    if (!form.name.trim()) return setFormErr(t('connect.profile.invalidName')), null;
    if (!isLocal(form.host.trim())) return setFormErr(t('connect.profile.invalidHost')), null;
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return setFormErr(t('connect.profile.invalidPort')), null;
    setFormErr(null);
    return {
      id: form.id || `p-${Date.now().toString(36)}`,
      name: form.name.trim(),
      kind: 'wifi-tcp',
      host: form.host.trim(),
      port,
      connectTimeoutMs: Math.min(30000, Math.max(500, Number(form.connectTimeoutMs) || 5000)),
      commandTimeoutMs: Math.min(15000, Math.max(200, Number(form.commandTimeoutMs) || 2500)),
    };
  }

  async function saveAndConnect() {
    if (!s.api) return;
    const p = buildProfile();
    if (!p) return;
    const r = await s.api.saveProfile(p).catch(() => null);
    if (!r || !r.ok) {
      setFormErr(t('errors.INVALID_SETTINGS.title'));
      return;
    }
    toast(t('connect.profile.savedToast'), 'success');
    setForm((f) => ({ ...f, id: p.id }));
    await s.refreshProfiles();
    setAdvice(null);
    const st = await s.connect(p.id);
    if (st?.phase === 'error' && (st.error?.code === 'UNREACHABLE' || st.error?.code === 'TIMEOUT')) void checkNetwork(p.host);
  }

  async function checkNetwork(host = form.host.trim()) {
    if (!s.api || !IPV4.test(host)) return;
    const r = await s.api.networkAdvice(host).catch(() => null);
    if (r?.ok) setAdvice(r.data);
  }

  async function runProbe() {
    if (!s.api) return;
    const list = [...picked].map((k) => {
      const [host, port] = k.split(':');
      return { host, port: Number(port) };
    });
    if (list.length === 0) return toast(t('connect.discovery.noneSelected'), 'info');
    setProbing(true);
    setProbe(null);
    const r = await s.api.probeCandidates(list).catch(() => null);
    setProbing(false);
    setProbe(r?.ok ? r.data : []);
  }

  const candidates = [
    ...PRESETS,
    ...(isLocal(form.host.trim()) && Number(form.port) > 0 ? [{ host: form.host.trim(), port: Number(form.port) }] : []),
  ].filter((c, i, a) => a.findIndex((x) => x.host === c.host && x.port === c.port) === i);

  return (
    <div className="screen connect">
      <header className="screen__head">
        <h1>{t('connect.title')}</h1>
        <p className="lead">{t('connect.lead')}</p>
      </header>

      <div className="cats" role="tablist" aria-label={t('connect.methods')}>
        {(['wifi', 'usb', 'demo'] as const).map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={category === c}
            className={`cat cat--${c}${category === c ? ' is-on' : ''}`}
            onClick={() => setCategory(c)}
          >
            <span className="cat__name">{t(`connect2.cat${c === 'wifi' ? 'Wifi' : c === 'usb' ? 'Usb' : 'Demo'}`)}</span>
            <span className="cat__desc">{t(`connect2.cat${c === 'wifi' ? 'Wifi' : c === 'usb' ? 'Usb' : 'Demo'}Desc`)}</span>
            {c === 'demo' && <span className="tag tag--sim">{t('provenance.simulated')}</span>}
          </button>
        ))}
      </div>
      {s.api && (
        <div className="files-entry">
          <span className="muted small">{t('mode.filesDesc')}</span>
          <button className="btn btn--sm" onClick={() => { s.enterFiles(); go('vehicles'); }}>{t('mode.filesEnter')}</button>
        </div>
      )}

      {category === 'demo' && (
        <section className="panel panel--sim">
          <h2 className="panel__title">{t('connect2.catDemo')}</h2>
          <p className="small">{t('connect.method.demoDesc')}</p>
          {s.api && <p className="muted small">{t('connect2.demoPrepared')}</p>}
          <div className="actions">
            <button className="btn btn--primary" onClick={async () => { await s.enterDemo(); go('diagnostics'); }}>{t('connect2.demoEnter')}</button>
          </div>
        </section>
      )}

      {category === 'usb' && (
        <div className="connect__grid">
          <section className="panel">
            <div className="panel__bar">
              <h2 className="panel__title">{t('usb.title')}</h2>
              <button className="btn btn--sm" onClick={scanUsb} disabled={!s.api || usbBusy}>{usbBusy ? t('usb.scanning') : t('usb.scan')}</button>
            </div>
            {!s.api && <p className="notice">{t('connect.desktopOnly')}</p>}
            {usb && !usb.supported && <p className="notice">{t(usb.reasonKey ?? 'usb.reason.platform')}</p>}
            {usb && usb.supported && usb.devices.length === 0 && <p className="muted">{t('usb.none')}</p>}
            {usb?.devices.map((d) => (
              <div key={d.id} className="devrow">
                <div><Ltr>{d.path ?? d.name}</Ltr> <span className="muted small">{d.name}</span></div>
                <p className="small muted">{t('usb.notIdentified')}</p>
              </div>
            ))}
          </section>
          <section className="panel">
            <h2 className="panel__title">{t('vci2.hardware')}</h2>
            <p className="notice">{t('usb.vciNotFound')}</p>
            {usb?.devices[0] && <CapabilityTable caps={usb.devices[0].capabilities} />}
          </section>
        </div>
      )}

      {category === 'wifi' && !s.api && <div className="notice">{t('connect.desktopOnly')}</div>}

      {category === 'wifi' && s.api && (
        <div className="connect__grid">
          <section className="panel">
            <h2 className="panel__title">{t('connect.profile.title')}</h2>
            <div className="form">
              <label className="field">
                <span className="field__label">{t('connect.profile.name')}</span>
                <input value={form.name} onChange={upd('name')} placeholder={t('connect.profile.namePlaceholder')} maxLength={60} />
              </label>
              <div className="field-row">
                <label className="field field--grow">
                  <span className="field__label">{t('connect.profile.host')}</span>
                  <input dir="ltr" className="mono" value={form.host} onChange={upd('host')} placeholder="192.168.0.10" inputMode="decimal" />
                </label>
                <label className="field field--port">
                  <span className="field__label">{t('connect.profile.port')}</span>
                  <input dir="ltr" className="mono" value={form.port} onChange={upd('port')} inputMode="numeric" />
                </label>
              </div>
              <p className="field__hint">{t('connect.profile.hostHint')}</p>
              <div className="field-row">
                <label className="field">
                  <span className="field__label">{t('connect.profile.connectTimeout')} ({t('units.ms')})</span>
                  <input dir="ltr" className="mono" value={form.connectTimeoutMs} onChange={upd('connectTimeoutMs')} inputMode="numeric" />
                </label>
                <label className="field">
                  <span className="field__label">{t('connect.profile.commandTimeout')} ({t('units.ms')})</span>
                  <input dir="ltr" className="mono" value={form.commandTimeoutMs} onChange={upd('commandTimeoutMs')} inputMode="numeric" />
                </label>
              </div>
              {formErr && <div className="field__error" role="alert">{formErr}</div>}
              <div className="actions">
                <button className="btn btn--primary" disabled={busy} onClick={saveAndConnect}>
                  {t('connect.profile.saveAndConnect')}
                </button>
                <button className="btn btn--ghost" onClick={() => checkNetwork()} disabled={!IPV4.test(form.host.trim())}>
                  {t('network.check')}
                </button>
              </div>
            </div>

            <h3 className="panel__sub">{t('connect.profile.saved')}</h3>
            {s.profiles.length === 0 ? (
              <p className="muted">{t('connect.profile.none')}</p>
            ) : (
              <ul className="plist">
                {s.profiles.map((p) => (
                  <li key={p.id} className="plist__item">
                    <button
                      className="plist__main"
                      onClick={() =>
                        setForm({
                          id: p.id, name: p.name, host: p.host, port: String(p.port),
                          connectTimeoutMs: String(p.connectTimeoutMs), commandTimeoutMs: String(p.commandTimeoutMs),
                        })
                      }
                    >
                      <span className="plist__name">{p.name}</span>
                      <Ltr>{`${p.host}:${p.port}`}</Ltr>
                    </button>
                    <button className="btn btn--sm" disabled={busy} onClick={() => s.connect(p.id)}>
                      {t('connect.profile.connect')}
                    </button>
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

          <div className="connect__side">
            <ConnectionStatePanel go={go} celebrate={celebrate} onCelebrated={() => setCelebrate(false)} />
            <InternetPanel before={netBefore} after={netAfter} route={route} advice={advice} onCheck={() => checkNet(phase === 'connected' ? 'after' : 'before')} />

            {advice && <NetworkPanel advice={advice} />}

            <section className="panel">
              <h2 className="panel__title">{t('connect.discovery.title')}</h2>
              <p className="muted small">{t('connect.discovery.lead')}</p>
              <p className="muted small">{t('connect.discovery.presetsNote')}</p>
              <ul className="checks">
                {candidates.map((c) => {
                  const k = `${c.host}:${c.port}`;
                  const res = probe?.find((r) => r.host === c.host && r.port === c.port);
                  return (
                    <li key={k} className="checks__item">
                      <label>
                        <input
                          type="checkbox"
                          checked={picked.has(k)}
                          onChange={(e) =>
                            setPicked((set) => {
                              const n = new Set(set);
                              if (e.target.checked) n.add(k);
                              else n.delete(k);
                              return n;
                            })
                          }
                        />
                        <Ltr>{k}</Ltr>
                      </label>
                      {res && (
                        <span className={`tag ${res.ok ? 'tag--ok' : ''}`}>
                          {res.ok ? t('connect.discovery.found') : t('connect.discovery.notFound')}
                        </span>
                      )}
                      {res?.ok && (
                        <button className="btn btn--sm" onClick={() => setForm((f) => ({ ...f, host: c.host, port: String(c.port) }))}>
                          {t('connect.discovery.use')}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <button className="btn" onClick={runProbe} disabled={probing}>
                {probing ? <Spinner label={t('connect.discovery.running')} /> : t('connect.discovery.approve')}
              </button>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectionStatePanel({ go, celebrate, onCelebrated }: { go: Go; celebrate: boolean; onCelebrated: () => void }) {
  const s = useSession();
  const st = s.status;
  const steps = ['tcp', 'init', 'vehicle'] as const;
  const activeIdx = st.phase === 'connecting' ? 0 : st.phase === 'initializing' ? 1 : -1;

  if (st.phase === 'connecting' || st.phase === 'initializing') {
    return (
      <section className="panel panel--live" aria-live="polite">
        <h2 className="panel__title">{t('connect.progress.title')}</h2>
        <ol className="steps">
          {steps.map((k, i) => (
            <li key={k} className={`steps__item ${i < activeIdx ? 'is-done' : i === activeIdx ? 'is-active' : ''}`}>
              <span className="steps__dot" aria-hidden="true" />
              {t(`connect.progress.${k}`)}
            </li>
          ))}
        </ol>
        {st.host && <Ltr>{`${st.host}:${st.port}`}</Ltr>}
        <div className="actions">
          <button className="btn btn--ghost" onClick={() => s.cancel()}>{t('connect.progress.cancel')}</button>
        </div>
      </section>
    );
  }

  if (st.phase === 'connected') {
    return (
      <section className={`panel panel--ok${celebrate ? ' lockon' : ''}`} onAnimationEnd={onCelebrated} aria-live="polite">
        <div className="lockon__rings" aria-hidden="true"><span /><span /><span /></div>
        <h2 className="panel__title">{t('connect.detected.title')}</h2>
        {st.protocol ? <p className="muted">{t('connect.detected.subtitle')}</p> : <p className="notice">{t('connect.detected.noVehicle')}</p>}
        <dl className="kv">
          {st.adapterId && (<><dt>{t('vehicle.adapter')}</dt><dd><Ltr>{st.adapterId}</Ltr></dd></>)}
          {st.protocol && (<><dt>{t('vehicle.protocol')}</dt><dd><Ltr>{st.protocol}</Ltr></dd></>)}
        </dl>
        <div className="actions">
          <button className="btn btn--primary" onClick={() => go('diagnostics')}>{t('connect.detected.open')}</button>
          {!st.protocol && <button className="btn" onClick={() => s.reconnect()}>{t('common.retry')}</button>}
          <button className="btn btn--quiet" onClick={() => s.disconnect()}>{t('connect.disconnect')}</button>
        </div>
      </section>
    );
  }

  if (st.phase === 'lost') {
    return (
      <section className="panel panel--warn" role="alert">
        <h2 className="panel__title">{t('connect.lostTitle')}</h2>
        <p className="muted">{t('connect.lostLead')}</p>
        <div className="actions">
          <button className="btn btn--primary" onClick={() => s.reconnect()}>{t('connect.reconnect')}</button>
        </div>
      </section>
    );
  }

  if (st.phase === 'error' && st.error) {
    return (
      <ErrorCard error={st.error}>
        {st.error.code !== 'INVALID_SETTINGS' && (
          <button className="btn" onClick={() => s.reconnect()}>{t('common.retry')}</button>
        )}
      </ErrorCard>
    );
  }
  return null;
}

function NetworkPanel({ advice }: { advice: NetworkAdvice }) {
  return (
    <section className="panel">
      <h2 className="panel__title">{t('network.title')}</h2>
      {advice.adapterInterface ? (
        <p>{t('network.adapterOn', { iface: advice.adapterInterface })}</p>
      ) : (
        <p className="notice">{t('network.adapterNotOnAny')}</p>
      )}
      {advice.likelyNoInternet && (
        <>
          <p>{t('network.noInternet')}</p>
          <p className="panel__sub">{t('network.options')}</p>
          <ul className="bullets">
            <li>{t('network.opt1')}</li>
            <li>{t('network.opt2')}</li>
            <li>{t('network.opt3')}</li>
          </ul>
        </>
      )}
      <h3 className="panel__sub">{t('network.interfaces')}</h3>
      <ul className="iflist">
        {advice.interfaces.map((i) => (
          <li key={i.name + i.address}>
            <Ltr>{`${i.name}  ${i.address} / ${i.netmask}`}</Ltr>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InternetPanel({ before, after, route, advice, onCheck }: { before: InternetCheck | null; after: InternetCheck | null; route: DefaultRoute | null; advice: NetworkAdvice | null; onCheck: () => void }) {
  const show = (c: InternetCheck | null) =>
    !c ? <span className="muted">{t('connect2.internetUnknown')}</span> : c.online ? <span className="ok">{t('connect2.internetOnline', { ms: c.latencyMs ?? 0 })}</span> : <span className="bad">{t('connect2.internetOffline')}</span>;
  return (
    <section className="panel">
      <div className="panel__bar">
        <h2 className="panel__title">{t('network.title')}</h2>
        <button className="btn btn--sm" onClick={onCheck}>{t('connect2.internetCheck')}</button>
      </div>
      <dl className="kv">
        <dt>{t('connect2.primaryRoute')}</dt>
        <dd>{route?.known ? <Ltr>{`${route.iface ?? ''}${route.gateway ? ` → ${route.gateway}` : ''}`}</Ltr> : <span className="muted">{t('connect2.primaryUnknown')}</span>}</dd>
        <dt>{t('connect2.internetBefore')}</dt>
        <dd>{show(before)}</dd>
        <dt>{t('connect2.internetAfter')}</dt>
        <dd>{show(after)}</dd>
      </dl>
      {advice?.internetViaAdapter && <p className="notice">{t('connect2.viaAdapter')}</p>}
      <p className="muted small">{t('connect2.singleWifi')}</p>
      <p className="muted small">{t('connect2.routeNote')}</p>
    </section>
  );
}
