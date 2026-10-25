import { useEffect, useState } from 'react';
import type { DiffReport } from '../../shared/workshop';
import { fmt, fmtv, ltrNum, t } from '../i18n';
import { useSession } from '../state/session';
import { run, useResult } from '../state/useApi';
import { useToast } from '../ui/toast';
import { Ltr } from '../ui/primitives';
import { DesktopOnly, Sha } from '../ui/workshop';

const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(6, '0')}`;

export function CompareScreen({ initialProjectId }: { initialProjectId?: string }) {
  const s = useSession();
  const toast = useToast();
  const api = s.api;
  const projects = useResult(api ? () => api.listProjects() : null, []);
  const [pid, setPid] = useState(initialProjectId);
  const versions = useResult(api && pid ? () => api.listVersions(pid) : null, [pid]);
  const [a, setA] = useState('original');
  const [b, setB] = useState<string>();
  const [diff, setDiff] = useState<DiffReport | null>(null);
  useEffect(() => {
    if (!pid && projects.data?.length) setPid(s.demoWorkspace && projects.data.some((p) => p.id === s.demoWorkspace!.ecu.projectId) ? s.demoWorkspace.ecu.projectId : projects.data[0].id);
  }, [projects.data, pid, s.demoWorkspace]);
  useEffect(() => {
    if (versions.data?.length) setB(versions.data[versions.data.length - 1].id);
    setDiff(null);
  }, [versions.data]);
  if (!api) return <div className="screen"><DesktopOnly /></div>;

  return (
    <div className="screen">
      <header className="screen__head"><h1>{t('cmp.title')}</h1></header>
      <section className="panel">
        <div className="field-row">
          <label className="field">
            <span className="field__label">{t('calenv.project')}</span>
            <select value={pid ?? ''} onChange={(e) => setPid(e.target.value)}>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{`${p.kind.toUpperCase()} · ${p.name}`}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{t('cmp.a')}</span>
            <select value={a} onChange={(e) => setA(e.target.value)}>
              <option value="original">{t('cmp.original')}</option>
              {versions.data?.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{t('cmp.b')}</span>
            <select value={b ?? ''} onChange={(e) => setB(e.target.value)}>
              {versions.data?.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </label>
          <button className="btn btn--primary field-row__btn" disabled={!pid || !b} onClick={async () => setDiff(await run(api.diff(pid!, a, b!), (e) => toast(t(`errors.${e.code}.title`), 'error')))}>
            {t('cmp.run')}
          </button>
        </div>
      </section>

      {diff && (
        <>
          <div className="stats">
            <div className="stat"><span className="stat__n num">{fmt(diff.changedBytes)}</span><span className="stat__l">{t('cmp.changedBytes')}</span></div>
            <div className="stat"><span className="stat__n num">{fmt(diff.ranges.length)}</span><span className="stat__l">{t('cmp.ranges')}</span></div>
            <div className="stat"><span className="stat__n num">{fmt(diff.mapChanges.length)}</span><span className="stat__l">{t('cmp.mapChanges')}</span></div>
            <div className={`stat${diff.unexplained.length ? ' stat--bad' : ''}`}><span className="stat__n num">{fmt(diff.unexplained.length)}</span><span className="stat__l">{t('cmp.unexplained')}</span></div>
          </div>
          <section className="panel">
            <p className="small"><Sha value={diff.aSha} /> ← <Sha value={diff.bSha} /></p>
            {diff.changedBytes === 0 && <p className="muted">{t('cmp.none')}</p>}
            {diff.mapChanges.map((mc) => (
              <div key={mc.mapId} className="cmpmap">
                <h3 className="panel__sub">{mc.name} · {t('review.cells', { n: mc.cells.length })}</h3>
                <table className="table table--tight">
                  <thead><tr><th scope="col">{t('cmp.cell')}</th><th scope="col">{t('review.from')}</th><th scope="col">{t('review.to')}</th><th scope="col">{t('lab.compare.delta')}</th></tr></thead>
                  <tbody>
                    {mc.cells.slice(0, 40).map((c) => (
                      <tr key={`${c.r}-${c.c}`}>
                        <td><Ltr>{`[${c.r},${c.c}]`}</Ltr></td>
                        <td className="table__num"><span className="num">{fmtv(c.from)}</span> <span className="unit">{mc.unit}</span></td>
                        <td className="table__num"><span className="num">{fmtv(c.to)}</span> <span className="unit">{mc.unit}</span></td>
                        <td className="table__num"><Ltr mono={false}><span className="num">{`${c.to - c.from > 0 ? '+' : ''}${fmtv(c.to - c.from)}`}</span></Ltr></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {diff.unexplained.length > 0 && (
              <div className="notice notice--bad">
                <strong>{t('cmp.unexplained')}</strong>
                <ul className="iflist">{diff.unexplained.slice(0, 20).map((r) => <li key={r.start}><Ltr>{`${hex(r.start)}–${hex(r.end)}`}</Ltr></li>)}</ul>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
