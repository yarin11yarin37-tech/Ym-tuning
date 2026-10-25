import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { Provenance, Sourced } from '../../shared/types';
import { fmt, t, tList } from '../i18n';
import { useSession } from '../state/session';
import { VEHICLE_MODELS, getModel, scaleModelToTorque, type VehicleModel } from '../sim/vehicleModels';
import { DEFAULT_CUSTOM, PRESET_PROFILES, clampProfile, type ProfileId, type TuningProfile } from '../sim/tuningProfiles';
import { fullLoadCurve, kwToHp, summarize, throttleResponseCurve, type CurvePoint } from '../sim/curves';
import { parseDynoCsv } from '../sim/dynoImport';
import { Ltr, MediaSlot, ProvenanceBadge, ProvenanceLegend, Segmented } from '../ui/primitives';
import { LineChart, type Series } from '../ui/LineChart';
import { LiveStage } from './lab/LiveStage';

const PROFILE_IDS: ProfileId[] = ['stock', 'stage1', 'stage2', 'stage3', 'custom'];

export function LabScreen() {
  const s = useSession();
  const hasVehicle = s.mode !== 'none';
  const [choice, setChoice] = useState<string>(hasVehicle ? 'connected' : VEHICLE_MODELS[0].id);
  const [baseId, setBaseId] = useState(VEHICLE_MODELS[0].id);
  const [torqueInput, setTorqueInput] = useState('');
  const [userTorque, setUserTorque] = useState<number | null>(null);
  const [profileId, setProfileId] = useState<ProfileId>('stage1');
  const [custom, setCustom] = useState<TuningProfile>(DEFAULT_CUSTOM);
  const [dyno, setDyno] = useState<{ points: CurvePoint[]; fileName: string } | null>(null);
  const [dynoErr, setDynoErr] = useState<string | null>(null);

  useEffect(() => {
    if (!hasVehicle && choice === 'connected') setChoice(VEHICLE_MODELS[0].id);
  }, [hasVehicle, choice]);

  const usingConnected = choice === 'connected' && hasVehicle;
  const userScaled = usingConnected && s.mode === 'live' && userTorque !== null;

  const model: VehicleModel = useMemo(() => {
    if (!usingConnected) return getModel(choice);
    if (s.mode === 'demo') return getModel(VEHICLE_MODELS[0].id);
    const base = getModel(baseId);
    return userTorque ? scaleModelToTorque(base, userTorque) : base;
  }, [usingConnected, choice, s.mode, baseId, userTorque]);

  const profile: TuningProfile = profileId === 'custom' ? clampProfile(custom) : PRESET_PROFILES[profileId];
  const stock = PRESET_PROFILES.stock;

  const stockSum = useMemo(() => summarize(model, stock), [model, stock]);
  const selSum = useMemo(() => summarize(model, profile), [model, profile]);
  const stockCurve = useMemo(() => fullLoadCurve(model, stock), [model, stock]);
  const selCurve = useMemo(() => fullLoadCurve(model, profile), [model, profile]);

  const curveSeries: Series[] = useMemo(() => {
    const est: Provenance = 'estimated';
    const list: Series[] = [
      { id: 'tq-s', label: `${t('lab.charts.torque')} · ${t('lab.charts.stock')}`, tone: 'stock', provenance: est, points: stockCurve.map((p) => ({ x: p.rpm, y: p.torqueNm })) },
      { id: 'tq-x', label: `${t('lab.charts.torque')} · ${t('lab.charts.selected')}`, tone: 'selected', provenance: est, points: selCurve.map((p) => ({ x: p.rpm, y: p.torqueNm })) },
      { id: 'pw-s', label: `${t('lab.charts.power')} · ${t('lab.charts.stock')}`, tone: 'stock2', dashed: true, axis: 'right', provenance: est, points: stockCurve.map((p) => ({ x: p.rpm, y: kwToHp(p.powerKw) })) },
      { id: 'pw-x', label: `${t('lab.charts.power')} · ${t('lab.charts.selected')}`, tone: 'selected2', dashed: true, axis: 'right', provenance: est, points: selCurve.map((p) => ({ x: p.rpm, y: kwToHp(p.powerKw) })) },
    ];
    if (dyno) {
      list.push({ id: 'dyno', label: `${t('lab.charts.torque')} · ${t('lab.charts.dyno')}`, tone: 'dyno', provenance: 'user', points: dyno.points.map((p) => ({ x: p.rpm, y: p.torqueNm })) });
    }
    return list;
  }, [stockCurve, selCurve, dyno]);

  const respSeries: Series[] = useMemo(
    () => [
      { id: 'r-s', label: t('lab.charts.stock'), tone: 'stock', provenance: 'estimated', points: throttleResponseCurve(model, stock).map((p) => ({ x: p.t, y: p.frac * 100 })) },
      { id: 'r-x', label: t('lab.charts.selected'), tone: 'selected', provenance: 'estimated', points: throttleResponseCurve(model, profile).map((p) => ({ x: p.t, y: p.frac * 100 })) },
    ],
    [model, stock, profile],
  );

  const onDyno = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const r = parseDynoCsv(await f.text(), f.name);
    if (r.ok) {
      setDyno({ points: r.points, fileName: r.fileName });
      setDynoErr(null);
    } else setDynoErr(t(r.errorKey));
  };

  const vehicleOptions = [
    ...(hasVehicle ? [{ value: 'connected', label: s.mode === 'demo' ? `${t('demo.vehicleName')} (${t('provenance.simulated')})` : t('lab.connectedVehicle') }] : []),
    ...VEHICLE_MODELS.map((m) => ({ value: m.id, label: t(m.nameKey) })),
  ];

  const dynoPeak = dyno
    ? {
        torque: Math.max(...dyno.points.map((p) => p.torqueNm)),
        power: kwToHp(Math.max(...dyno.points.map((p) => p.powerKw))),
      }
    : null;

  return (
    <div className="screen lab">
      <header className="screen__head lab__head">
        <div>
          <h1>{t('lab.title')}</h1>
          <p className="lead">{t('lab.lead')}</p>
        </div>
        <div className="simflag" role="note">
          <span className="simflag__dot" aria-hidden="true" />
          {t('lab.simBadge')}
        </div>
      </header>

      <section className="lab__controls panel">
        <label className="field">
          <span className="field__label">{t('lab.vehicleSelect')}</span>
          <select value={usingConnected ? 'connected' : choice} onChange={(e) => setChoice(e.target.value)}>
            {vehicleOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        {usingConnected && s.mode === 'live' && (
          <div className="lab__connected">
            {s.identity?.vin && (
              <span className="muted small">
                {t('vehicle.vin')}: <Ltr>{s.identity.vin.value}</Ltr> <ProvenanceBadge p="vehicle" />
              </span>
            )}
            <p className="small">{t('lab.connectedNote')}</p>
            <div className="field-row">
              <label className="field">
                <span className="field__label">{t('lab.baseModel')}</span>
                <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                  {VEHICLE_MODELS.map((m) => (<option key={m.id} value={m.id}>{t(m.nameKey)}</option>))}
                </select>
              </label>
              <label className="field field--port">
                <span className="field__label">{t('lab.userTorque')} ({t('units.nm')})</span>
                <input dir="ltr" className="mono" inputMode="numeric" value={torqueInput} onChange={(e) => setTorqueInput(e.target.value)} />
              </label>
              <button
                className="btn btn--sm field-row__btn"
                onClick={() => {
                  const v = Number(torqueInput);
                  setUserTorque(Number.isFinite(v) && v >= 50 && v <= 2000 ? v : null);
                }}
              >
                {t('lab.applyTorque')}
              </button>
            </div>
          </div>
        )}
        {!usingConnected && <p className="muted small">{t('lab.modelNote')}</p>}

        <div className="field lab__profile">
          <span className="field__label">{t('lab.profile')}</span>
          <Segmented
            label={t('lab.profile')}
            value={profileId}
            onChange={setProfileId}
            options={PROFILE_IDS.map((id) => ({ value: id, label: t(`lab.profiles.${id}`) }))}
          />
          <p className="muted small">{t(`lab.profileDesc.${profileId}`)}</p>
        </div>

        {profileId === 'custom' && <CustomProfileEditor value={custom} onChange={setCustom} />}
        {profileId !== 'stock' && <p className="hypo" role="note">{t('lab.hypothetical')}</p>}
      </section>

      <div className="lab__stage">
        <LiveStage model={model} profile={profile} media={<MediaSlot label={t('lab.media')} ratio="21 / 9" />} />
      </div>

      <div className="lab__charts">
        <section className="panel">
          <LineChart
            title={t('lab.charts.curves')}
            series={curveSeries}
            xLabel={t('lab.charts.rpmAxis')}
            yLabel={`${t('lab.charts.torque')} (${t('units.nm')})`}
            yRightLabel={`${t('lab.charts.power')} (${t('units.hp')})`}
          />
        </section>
        <section className="panel">
          <LineChart
            title={t('lab.charts.response')}
            series={respSeries}
            xLabel={t('lab.charts.timeAxis')}
            yLabel={t('lab.charts.deliveredAxis')}
            xDigits={1}
            width={420}
            height={260}
          />
        </section>
      </div>

      <section className="panel compare">
        <h2 className="panel__title">{t('lab.compare.title')}</h2>
        <table className="table table--compare">
          <thead>
            <tr>
              <th scope="col">{t('lab.compare.metric')}</th>
              <th scope="col">{t('lab.compare.stock')}</th>
              <th scope="col">{t('lab.compare.selected')}</th>
              <th scope="col">{t('lab.compare.delta')}</th>
              {dynoPeak && <th scope="col">{t('lab.charts.dyno')}</th>}
            </tr>
          </thead>
          <tbody>
            <CompareRow
              label={t('lab.compare.peakTorque')}
              a={userScaled ? { ...stockSum.peakTorque, provenance: 'user' } : stockSum.peakTorque}
              b={selSum.peakTorque}
              unit={t('units.nm')}
              sub={[t('lab.compare.at', { rpm: fmt(stockSum.peakTorqueRpm) }), t('lab.compare.at', { rpm: fmt(selSum.peakTorqueRpm) })]}
              extra={dynoPeak ? { value: dynoPeak.torque, provenance: 'user' } : undefined}
              showExtra={!!dynoPeak}
            />
            <CompareRow
              label={t('lab.compare.peakPower')}
              a={{ ...stockSum.peakPower, value: kwToHp(stockSum.peakPower.value) }}
              b={{ ...selSum.peakPower, value: kwToHp(selSum.peakPower.value) }}
              unit={t('units.hp')}
              sub={[t('lab.compare.at', { rpm: fmt(stockSum.peakPowerRpm) }), t('lab.compare.at', { rpm: fmt(selSum.peakPowerRpm) })]}
              extra={dynoPeak ? { value: dynoPeak.power, provenance: 'user' } : undefined}
              showExtra={!!dynoPeak}
            />
            <CompareRow label={t('lab.compare.zeroTo100')} a={stockSum.zeroTo100} b={selSum.zeroTo100} unit={t('units.sec')} digits={1} lowerIsBetter showExtra={!!dynoPeak} />
            <CompareRow label={t('lab.compare.response')} a={stockSum.response90} b={selSum.response90} unit={t('units.sec')} digits={2} lowerIsBetter showExtra={!!dynoPeak} />
          </tbody>
        </table>
        <p className="note">{t('lab.compare.noPromise')}</p>
      </section>

      <div className="lab__bottom">
        <section className="panel">
          <h2 className="panel__title">{t('lab.assumptions.title')}</h2>
          <ul className="bullets">
            {tList('lab.assumptions.items').map((x) => (<li key={x}>{x}</li>))}
          </ul>
        </section>
        <section className="panel">
          <h2 className="panel__title">{t('lab.dyno.title')}</h2>
          <p className="muted small">{t('lab.dyno.lead')}</p>
          <div className="actions">
            <label className="btn">
              {t('lab.dyno.choose')}
              <input type="file" accept=".csv,text/csv" className="visually-hidden" onChange={onDyno} />
            </label>
            {dyno && <button className="btn btn--quiet" onClick={() => setDyno(null)}>{t('lab.dyno.remove')}</button>}
          </div>
          {dyno && (
            <p className="small">
              {t('lab.dyno.loaded', { n: dyno.points.length })} <Ltr>{dyno.fileName}</Ltr> <ProvenanceBadge p="user" />
            </p>
          )}
          {dynoErr && <p className="field__error" role="alert">{dynoErr}</p>}
        </section>
      </div>

      <ProvenanceLegend only={['vehicle', 'user', 'estimated', 'simulated']} />
    </div>
  );
}

function CompareRow({
  label, a, b, unit, digits = 0, sub, lowerIsBetter, extra, showExtra,
}: {
  label: string;
  a: Sourced<number> | null;
  b: Sourced<number> | null;
  unit: string;
  digits?: number;
  sub?: [string, string];
  lowerIsBetter?: boolean;
  extra?: { value: number; provenance: Provenance };
  showExtra: boolean;
}) {
  const delta = a && b ? b.value - a.value : null;
  const good = delta !== null && delta !== 0 && (lowerIsBetter ? delta < 0 : delta > 0);
  const cell = (v: Sourced<number> | null, i: number) => (
    <td className="table__num">
      {v ? (
        <>
          <span className="num">{fmt(v.value, digits)}</span> <span className="unit">{unit}</span> <ProvenanceBadge p={v.provenance} compact />
          {sub && <div className="muted small">{sub[i]}</div>}
        </>
      ) : (
        <span className="muted">{t('common.notAvailable')}</span>
      )}
    </td>
  );
  return (
    <tr>
      <th scope="row">{label}</th>
      {cell(a, 0)}
      {cell(b, 1)}
      <td className={`table__num ${good ? 'is-good' : delta ? 'is-bad' : ''}`}>
        {delta !== null ? (
          <Ltr mono={false}>
            <span className="num">{`${delta > 0 ? '+' : delta < 0 ? '−' : ''}${fmt(Math.abs(delta), digits)}`}</span>
          </Ltr>
        ) : '—'}
      </td>
      {showExtra && (
        <td className="table__num">
          {extra ? (<><span className="num">{fmt(extra.value, digits)}</span> <span className="unit">{unit}</span> <ProvenanceBadge p={extra.provenance} compact /></>) : '—'}
        </td>
      )}
    </tr>
  );
}

function CustomProfileEditor({ value, onChange }: { value: TuningProfile; onChange: (p: TuningProfile) => void }) {
  const row = (key: keyof TuningProfile, label: string, min: number, max: number, step: number, suffix: string) => (
    <label className="range">
      <span className="range__label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value[key] as number}
        onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })}
      />
      <span className="range__val num">{`${fmt(value[key] as number, step < 1 ? 2 : 0)}${suffix}`}</span>
    </label>
  );
  return (
    <div className="custom">
      {row('lowGainPct', t('lab.custom.low'), 0, 60, 1, '%')}
      {row('midGainPct', t('lab.custom.mid'), 0, 60, 1, '%')}
      {row('topGainPct', t('lab.custom.top'), 0, 60, 1, '%')}
      {row('revLimitDeltaRpm', t('lab.custom.rev'), 0, 800, 50, '')}
      <label className="range">
        <span className="range__label">{t('lab.custom.response')}</span>
        <input
          type="range"
          min={0.6}
          max={1.5}
          step={0.05}
          value={value.responseFactor}
          onChange={(e) => onChange({ ...value, responseFactor: Number(e.target.value) })}
          aria-valuetext={value.responseFactor < 1 ? t('lab.custom.responseSharper') : t('lab.custom.responseSofter')}
        />
        <span className="range__val small">
          {value.responseFactor < 1 ? t('lab.custom.responseSharper') : value.responseFactor > 1 ? t('lab.custom.responseSofter') : t('lab.profiles.stock')}
        </span>
      </label>
    </div>
  );
}
