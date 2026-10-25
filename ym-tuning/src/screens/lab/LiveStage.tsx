import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { fmt, t } from '../../i18n';
import type { VehicleModel } from '../../sim/vehicleModels';
import { PRESET_PROFILES, limiterRpm, type TuningProfile } from '../../sim/tuningProfiles';
import { advance, initialState, snapshot, type SimSnapshot, type SimState } from '../../sim/simulator';
import { WebAudioEngineSound, type EngineSoundEngine } from '../../sim/audio/engineAudio';
import { kwToHp } from '../../sim/curves';
import { Gauge } from '../../ui/Gauge';
import { Pedal } from '../../ui/Pedal';
import { ProvenanceBadge } from '../../ui/primitives';

interface Props {
  model: VehicleModel;
  profile: TuningProfile;
  media: ReactNode;
}

/**
 * Real-time part of מעבדת ביצועים: runs the deterministic simulator for the selected profile
 * and, in parallel with identical pedal input, for the stock profile (ghost needles).
 * Wall-clock time only paces the loop; the model itself is deterministic.
 */
export function LiveStage({ model, profile, media }: Props) {
  const [throttle, setThrottle] = useState(0);
  const throttleRef = useRef(0);
  const sel = useRef<SimState>(initialState(model));
  const ref = useRef<SimState>(initialState(model));
  const carry = useRef({ a: 0, b: 0 });
  const [snap, setSnap] = useState<SimSnapshot>(snapshot(sel.current));
  const [ghost, setGhost] = useState<SimSnapshot>(snapshot(ref.current));
  const [compare, setCompare] = useState(true);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const audio = useRef<EngineSoundEngine | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.6);

  const reset = useCallback(() => {
    sel.current = initialState(model);
    ref.current = initialState(model);
    carry.current = { a: 0, b: 0 };
    throttleRef.current = 0;
    setThrottle(0);
    setSnap(snapshot(sel.current));
    setGhost(snapshot(ref.current));
  }, [model]);

  // New vehicle model → fresh simulation.
  useEffect(() => reset(), [reset]);

  // Simulation loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const th = throttleRef.current;
      const a = advance(sel.current, th, dt + carry.current.a, model, profileRef.current);
      sel.current = a.state;
      carry.current.a = a.leftover;
      const b = advance(ref.current, th, dt + carry.current.b, model, PRESET_PROFILES.stock);
      ref.current = b.state;
      carry.current.b = b.leftover;
      const sn = snapshot(sel.current);
      setSnap(sn);
      setGhost(snapshot(ref.current));
      audio.current?.update({
        rpm: sn.rpm,
        load: sn.torqueFrac,
        throttle: sn.throttle,
        limiterCut: sn.limiterCut,
        shifting: sn.shifting,
        boost: model.engine === 'na-petrol' ? 0 : sn.torqueFrac * Math.min(1, sn.rpm / 3000),
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [model]);

  // Audio engine follows the model's cylinder count; always torn down on leave.
  useEffect(() => {
    return () => {
      void audio.current?.stop();
      audio.current = null;
      setSoundOn(false);
    };
  }, [model.cylinders]);

  const toggleSound = async () => {
    if (soundOn) {
      await audio.current?.stop();
      audio.current = null;
      setSoundOn(false);
      return;
    }
    // Created only here, inside an explicit user click.
    const eng = new WebAudioEngineSound(model.cylinders);
    eng.setVolume(volume);
    eng.setMuted(muted);
    await eng.start();
    audio.current = eng;
    setSoundOn(true);
  };

  const setTh = (v: number) => {
    throttleRef.current = v;
    setThrottle(v);
  };

  const lim = limiterRpm(model, profile);
  const rpmMax = Math.ceil((lim + 500) / 1000) * 1000;
  const speedMax = model.engine === 'turbo-diesel' ? 240 : 280;

  return (
    <section className="live panel" aria-label={t('lab.title')}>
      <div className="live__media">{media}</div>

      <div className="live__instruments">
        <Gauge
          value={Math.round(snap.rpm)}
          max={rpmMax}
          redFrom={model.redlineRpm}
          step={1000}
          tickDivisor={1000}
          label={t('lab.gauges.rpm')}
          unit={`× 1000 ${t('units.rpm')}`}
          ghost={compare ? Math.round(ghost.rpm) : null}
          ghostLabel={t('lab.gauges.stockGhost')}
          alert={snap.limiterCut}
        />
        <div className="live__center">
          <div className="gearbox" aria-live="off">
            <span className="gearbox__label">{t('lab.gauges.gear')}</span>
            <span className={`gearbox__gear num${snap.shifting ? ' is-shifting' : ''}`}>{snap.gear}</span>
            <span className="gearbox__state">
              {snap.limiterCut ? t('lab.gauges.limiter') : snap.shifting ? t('lab.gauges.shifting') : ' '}
            </span>
          </div>
          <dl className="readouts">
            <div>
              <dt>{t('lab.gauges.torque')}</dt>
              <dd><span className="num">{fmt(snap.engineTorqueNm)}</span> <span className="unit">{t('units.nm')}</span></dd>
            </div>
            <div>
              <dt>{t('lab.gauges.power')}</dt>
              <dd><span className="num">{fmt(kwToHp(snap.powerKw))}</span> <span className="unit">{t('units.hp')}</span></dd>
            </div>
          </dl>
          <ProvenanceBadge p="simulated" />
        </div>
        <Gauge
          value={Math.round(snap.speedKmh)}
          max={speedMax}
          step={40}
          label={t('lab.gauges.speed')}
          unit={t('units.kmh')}
          ghost={compare ? Math.round(ghost.speedKmh) : null}
          ghostLabel={t('lab.gauges.stockGhost')}
        />
        <Pedal value={throttle} onChange={setTh} onStop={reset} />
      </div>

      <div className="live__bar">
        <button className="btn btn--danger" onClick={reset}>{t('lab.controls.reset')}</button>
        <label className="switch">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          <span className="switch__track" aria-hidden="true" />
          {t('lab.controls.compare')}
        </label>
        <span className="live__spacer" />
        <button className={`btn${soundOn ? ' btn--on' : ''}`} onClick={toggleSound} aria-pressed={soundOn}>
          {soundOn ? t('lab.controls.soundOff') : t('lab.controls.soundOn')}
        </button>
        <button
          className="btn btn--quiet"
          disabled={!soundOn}
          aria-pressed={muted}
          onClick={() => {
            const m = !muted;
            setMuted(m);
            audio.current?.setMuted(m);
          }}
        >
          {muted ? t('lab.controls.unmute') : t('lab.controls.mute')}
        </button>
        <label className="range range--inline">
          <span className="range__label">{t('lab.controls.volume')}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              audio.current?.setVolume(v);
            }}
          />
        </label>
      </div>
      {!soundOn && <p className="muted small live__note">{t('lab.controls.soundNote')}</p>}
    </section>
  );
}
