import { useEffect, useMemo, useState } from 'react';
import type { MapData, ReviewPacket, Version, WriteGateResult } from '../../shared/workshop';
import type { Go } from '../App';
import { fmt, fmtv, ltrNum, t } from '../i18n';
import { useSession } from '../state/session';
import { run, useResult } from '../state/useApi';
import { useToast } from '../ui/toast';
import { EmptyState, Ltr, ProvenanceBadge } from '../ui/primitives';
import { CheckList, DesktopOnly, KindTag, Lifecycle, PlanView, Sha, StatusChip, fileProv, fmtDate } from '../ui/workshop';

export function CalibrationScreen({ go, initialProjectId }: { go: Go; initialProjectId?: string }) {
  const s = useSession();
  const toast = useToast();
  const api = s.api;
  const projects = useResult(api ? () => api.listProjects() : null, []);
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId);
  const [versionId, setVersionId] = useState<string | undefined>();
  const [mapId, setMapId] = useState<string | undefined>();
  const [review, setReview] = useState<ReviewPacket | null>(null);
  const [gate, setGate] = useState<WriteGateResult | null>(null);
  const onErr = (e: { code: string; detail?: string }) => toast(`${t(`errors.${e.code}.title`) || e.code}${e.detail ? ` — ${e.detail}` : ''}`, 'error');

  useEffect(() => {
    if (!projectId && projects.data?.length) {
      setProjectId(s.demoWorkspace?.ecu.projectId && projects.data.some((p) => p.id === s.demoWorkspace!.ecu.projectId) ? s.demoWorkspace.ecu.projectId : projects.data[0].id);
    }
  }, [projects.data, projectId, s.demoWorkspace]);

  const versions = useResult(api && projectId ? () => api.listVersions(projectId) : null, [projectId]);
  useEffect(() => {
    if (versions.data?.length && (!versionId || !versions.data.some((v) => v.id === versionId))) setVersionId(versions.data[versions.data.length - 1].id);
  }, [versions.data, versionId]);
  const maps = useResult(api && projectId && versionId ? () => api.readMaps(projectId, versionId) : null, [projectId, versionId]);
  const requests = useResult(api && projectId ? () => api.listRequests(projectId) : null, [projectId, versionId]);
  useEffect(() => {
    if (maps.data?.maps.length && (!mapId || !maps.data.maps.some((m) => m.map.id === mapId))) setMapId(maps.data.maps[0].map.id);
    setReview(null);
    setGate(null);
  }, [maps.data, mapId]);

  if (!api) return <div className="screen"><DesktopOnly /></div>;
  const project = projects.data?.find((p) => p.id === projectId);
  const version = versions.data?.find((v) => v.id === versionId);
  const current = maps.data?.maps.find((m) => m.map.id === mapId);

  const afterNewVersion = async (v: Version) => {
    await versions.reload();
    setVersionId(v.id);
    toast(t('calenv.versionSaved', { v: v.label }), 'success');
  };

  return (
    <div className="screen">
      <header className="screen__head ctl__head">
        <div>
          <h1>{t('calenv.title')}</h1>
          <p className="lead">{t('calenv.lead')}</p>
        </div>
        <div className="field-row">
          <label className="field field--inline">
            <span className="field__label">{t('calenv.project')}</span>
            <select value={projectId ?? ''} onChange={(e) => { setProjectId(e.target.value); setVersionId(undefined); setMapId(undefined); }}>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{`${p.kind.toUpperCase()} · ${p.name}`}</option>)}
            </select>
          </label>
          <label className="field field--inline">
            <span className="field__label">{t('calenv.version')}</span>
            <select value={versionId ?? ''} onChange={(e) => setVersionId(e.target.value)}>
              {versions.data?.map((v) => <option key={v.id} value={v.id}>{`${v.label} · ${t(`calenv.origin.${v.origin}`)}`}</option>)}
            </select>
          </label>
        </div>
      </header>

      {projects.data && projects.data.length === 0 && (
        <EmptyState title={t('calenv.noProjects')}>
          <button className="btn btn--primary" onClick={() => go('ecu')}>{t('nav2.ecu')}</button>
          <button className="btn" onClick={() => go('tcu')}>{t('nav2.tcu')}</button>
        </EmptyState>
      )}

      {project && version && (
        <>
          <div className="cal">
            <aside className="panel cal__maps">
              <h2 className="panel__title">{t('calenv.maps')} <KindTag kind={project.kind} /></h2>
              {maps.data?.definition && (
                <p className="small"><ProvenanceBadge p={maps.data.definition.source === 'simulated' ? 'simulated' : 'imported'} compact /> {t(maps.data.definition.source === 'simulated' ? 'ctl.definitionSimulated' : 'ctl.definitionUnverified')}</p>
              )}
              {!maps.data?.maps.length && <p className="muted small">{t('calenv.noMaps')}</p>}
              <ul className="maplist">
                {maps.data?.maps.map((m) => (
                  <li key={m.map.id}>
                    <button className={`maplist__b${m.map.id === mapId ? ' is-on' : ''}`} onClick={() => setMapId(m.map.id)}>
                      <span>{m.map.name}</span>
                      <span className="muted small"><Ltr>{`${m.map.rows}×${m.map.cols} ${m.map.unit}`}</Ltr></span>
                      {m.outOfRange > 0 && <span className="bad small">!</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            <section className="panel cal__editor">
              {current ? (
                <MapEditor key={`${current.map.id}:${version.id}`} data={current} onSave={async (edits, note) => {
                  const v = await run(api.editMap(project.id, version.id, current.map.id, edits, note), onErr);
                  if (v) await afterNewVersion(v);
                }} />
              ) : <p className="muted">{t('calenv.noMaps')}</p>}
            </section>
          </div>

          <div className="grid2">
            <section className="panel">
              <div className="panel__bar">
                <h2 className="panel__title">{t('calenv.checks')} · <Ltr mono={false}>{version.label}</Ltr></h2>
                <button className="btn btn--sm" onClick={async () => { if (await run(api.runChecks(project.id, version.id), onErr)) void versions.reload(); }}>{t('calenv.runChecks')}</button>
              </div>
              {version.checks.length ? <CheckList checks={version.checks} /> : <p className="muted small">{t('calenv.readOnlyOriginal')}</p>}
              <h3 className="panel__sub">{t('calenv.history')}</h3>
              <ol className="history">
                {versions.data?.slice().reverse().map((v) => (
                  <li key={v.id} className={v.id === version.id ? 'is-on' : ''}>
                    <button className="history__b" onClick={() => setVersionId(v.id)}>
                      <strong><Ltr mono={false}>{v.label}</Ltr></strong>
                      <span>{t(`calenv.origin.${v.origin}`)}</span>
                      <span className="muted small">{v.note}</span>
                      <span className="muted small">{fmtDate(v.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>

            <section className="panel">
              <h2 className="panel__title">{t('calenv.requests')}</h2>
              {!requests.data?.length && <p className="muted small">{t('calenv.noRequests')}</p>}
              {requests.data?.slice(0, 8).map((r) => (
                <div key={r.id} className="reqrow">
                  <div className="reqrow__top">
                    <StatusChip status={r.status} />
                    <span className="reqrow__text">{r.text}</span>
                  </div>
                  <Lifecycle status={r.status} />
                  <div className="actions">
                    {r.status === 'plan' && r.plan?.items.some((i) => i.status === 'ready' && i.operation) && (
                      <button className="btn btn--sm btn--primary" onClick={async () => { if (await run(api.approveRequest(r.id), onErr)) { toast(t('calenv.approved'), 'success'); void requests.reload(); } }}>{t('calenv.approve')}</button>
                    )}
                    {r.status === 'approved' && (
                      <button className="btn btn--sm btn--primary" onClick={async () => {
                        const out = await run(api.applyRequest(r.id), onErr);
                        if (out) { void requests.reload(); await afterNewVersion(out.version); }
                      }}>{t('calenv.apply')}</button>
                    )}
                    <button className="btn btn--sm btn--quiet" onClick={() => go('assistant', { projectId: project.id })}>{t('nav2.assistant')}</button>
                  </div>
                </div>
              ))}
            </section>
          </div>

          <section className="panel review">
            <div className="panel__bar">
              <h2 className="panel__title">{t('review.title')}</h2>
              <button className="btn btn--primary" onClick={async () => setReview(await run(api.review(project.id, version.id), onErr))}>{t('calenv.review')}</button>
            </div>
            {review && <ReviewView r={review} />}
            {review && (
              <div className="gate">
                <div className="panel__bar">
                  <h3 className="panel__sub">{t('review.readiness')}</h3>
                  <button className="btn btn--sm" onClick={async () => setGate(await run(api.readinessCheck(project.id, version.id, true), onErr))}>{t('review.readinessCheck')}</button>
                </div>
                {gate && (
                  <ul className="checklist">
                    {gate.requirements.map((q) => (
                      <li key={q.id} className={`checklist__i is-${q.met ? 'pass' : 'fail'}`}>
                        <span className="checklist__dot" aria-hidden="true" />
                        <span className="checklist__name">{t(`review.req.${q.id}`)}</span>
                        <span className="checklist__st">{q.met ? t('check.pass') : t('check.fail')}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <button className="btn btn--danger" disabled aria-disabled="true">{t('review.writeDisabled')}</button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ReviewView({ r }: { r: ReviewPacket }) {
  return (
    <div className="reviewv">
      <dl className="kv kv--wide">
        <dt>{t('review.controller')}</dt>
        <dd><KindTag kind={r.controller.kind} /> {r.controller.hwId && <Ltr>{r.controller.hwId}</Ltr>} {r.controller.swId && <Ltr>{r.controller.swId}</Ltr>} <ProvenanceBadge p={r.controller.idProvenance} compact /></dd>
        <dt>{t('review.original')}</dt>
        <dd><Ltr>{r.original.fileName}</Ltr> · <Sha value={r.original.sha256} /> <ProvenanceBadge p={fileProv(r.original.source)} compact /> {r.originalIntegrity.ok ? <span className="ok small">{t('ctl.verifiedOk')}</span> : <span className="bad small">{t('ctl.verifiedBad')}</span>}</dd>
        <dt>{t('review.working')}</dt>
        <dd><Ltr mono={false}>{r.version.label}</Ltr> · <Sha value={r.version.sha256} /></dd>
        <dt>{t('review.defSource')}</dt>
        <dd>{r.definitionSource ? <ProvenanceBadge p={r.definitionSource === 'simulated' ? 'simulated' : 'imported'} /> : '—'}</dd>
      </dl>

      <h3 className="panel__sub">{t('review.changes')}</h3>
      {r.diff.changedBytes === 0 ? (
        <p className="muted small">{t('review.noChanges')}</p>
      ) : (
        <table className="table table--tight">
          <thead><tr><th scope="col">{t('cmp.mapChanges')}</th><th scope="col">{t('cmp.cell')}</th><th scope="col">{t('review.from')}</th><th scope="col">{t('review.to')}</th></tr></thead>
          <tbody>
            {r.diff.mapChanges.flatMap((mc) =>
              mc.cells.slice(0, 6).map((c, i) => (
                <tr key={`${mc.mapId}-${c.r}-${c.c}`}>
                  <td>{i === 0 ? <>{mc.name} <span className="muted small">{t('review.cells', { n: mc.cells.length })}</span></> : ''}</td>
                  <td><Ltr>{`[${c.r},${c.c}]`}</Ltr></td>
                  <td className="table__num"><span className="num">{fmtv(c.from)}</span> <span className="unit">{mc.unit}</span></td>
                  <td className="table__num"><span className="num">{fmtv(c.to)}</span> <span className="unit">{mc.unit}</span></td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
      {r.diff.unexplained.length > 0 && <p className="notice notice--bad">{t('review.unexplained', { n: r.diff.unexplained.length })}</p>}
      {r.plan && <PlanView plan={r.plan} />}

      <div className="grid2">
        <div>
          <h3 className="panel__sub">{t('review.checks')}</h3>
          <CheckList checks={r.checks} />
        </div>
        <div>
          <h3 className="panel__sub">{t('review.warnings')}</h3>
          <ul className="bullets small">{r.warnings.map((w) => <li key={w}>{t(w)}</li>)}</ul>
          <h3 className="panel__sub">{t('review.restore')}</h3>
          <p className="small">{t('review.restoreNo')}</p>
        </div>
      </div>
    </div>
  );
}

type Edit = { r: number; c: number; value: number };

function MapEditor({ data, onSave }: { data: MapData; onSave: (edits: Edit[], note: string) => Promise<void> }) {
  const m = data.map;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const flat = data.values.flat();
  const lo = Math.min(...flat), hi = Math.max(...flat);
  const key = (r: number, c: number) => `${r}:${c}`;

  const edits = useMemo(() => {
    const out: (Edit & { bad: boolean })[] = [];
    for (const [k, v] of Object.entries(draft)) {
      const [r, c] = k.split(':').map(Number);
      const value = Number(v.replace(',', '.'));
      if (v.trim() === '' || value === data.values[r][c]) continue;
      const bad = !Number.isFinite(value) || (m.min !== undefined && value < m.min) || (m.max !== undefined && value > m.max);
      out.push({ r, c, value, bad });
    }
    return out;
  }, [draft, data.values, m.min, m.max]);
  const anyBad = edits.some((e) => e.bad);

  const heat = (v: number) => {
    const x = hi === lo ? 0.5 : (v - lo) / (hi - lo);
    return `hsl(${200 - x * 180} 70% ${18 + x * 14}%)`;
  };

  return (
    <div className="mapedit">
      <div className="panel__bar">
        <h2 className="panel__title">{m.name}</h2>
        <span className="muted small">
          {m.min !== undefined || m.max !== undefined ? t('calenv.range', { min: ltrNum(m.min ?? -Infinity), max: ltrNum(m.max ?? Infinity), unit: m.unit }) : t('calenv.noRange')}
        </span>
      </div>
      <p className="muted small"><Ltr>{`${m.id} · 0x${m.address.toString(16).toUpperCase()} · ${m.dataType}`}</Ltr></p>
      <div className="grid-wrap" dir="ltr">
        <table className="mapgrid">
          {m.xAxis && (
            <thead>
              <tr>
                <th className="mapgrid__corner"><span>{m.yAxis?.name ?? ''}</span><span>{m.xAxis.name}</span></th>
                {m.xAxis.values.map((x, i) => <th key={i}>{fmt(x, x % 1 ? 1 : 0)}</th>)}
              </tr>
            </thead>
          )}
          <tbody>
            {data.values.map((row, r) => (
              <tr key={r}>
                {(m.yAxis || m.xAxis) && <th>{m.yAxis ? fmt(m.yAxis.values[r], m.yAxis.values[r] % 1 ? 1 : 0) : ''}</th>}
                {row.map((v, c) => {
                  const k = key(r, c);
                  const d = draft[k];
                  const changed = d !== undefined && d.trim() !== '' && Number(d) !== v;
                  const bad = changed && edits.find((e) => e.r === r && e.c === c)?.bad;
                  return (
                    <td key={c} style={{ background: heat(changed ? Number(d) || v : v) }} className={`${changed ? 'is-changed' : ''}${bad ? ' is-bad' : ''}`}>
                      <input
                        aria-label={`${m.name} [${r},${c}]`}
                        value={d ?? String(v)}
                        onChange={(e) => setDraft((x) => ({ ...x, [k]: e.target.value }))}
                        inputMode="decimal"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mapedit__bar">
        <span className="small">{t('calenv.edited', { n: edits.length })}</span>
        {anyBad && <span className="bad small">{t('calenv.outOfRange', { min: ltrNum(m.min ?? -Infinity), max: ltrNum(m.max ?? Infinity) })}</span>}
        <input className="mapedit__note" placeholder={t('calenv.note')} value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn--quiet" disabled={!edits.length} onClick={() => setDraft({})}>{t('calenv.discard')}</button>
        <button
          className="btn btn--primary"
          disabled={!edits.length || anyBad || busy}
          onClick={async () => {
            setBusy(true);
            await onSave(edits.map(({ r, c, value }) => ({ r, c, value })), note);
            setBusy(false);
          }}
        >
          {t('calenv.saveVersion')}
        </button>
      </div>
    </div>
  );
}
